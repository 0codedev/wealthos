"""
WealthOS Loop Engineering — Strategy Validation Engine Router
Implements IC/ICIR scoring, signal decay analysis, and 3-check Out-of-Sample Gate
for the QCS composite signal and alpha sub-signals.
"""

import os
import sys
import logging
import numpy as np
import pandas as pd
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy import stats

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logger import get_logger

log = get_logger("loop_validator", tag="LOOP_VALIDATOR")

router = APIRouter(prefix="/api/loop-validator", tags=["LoopValidator"])


class ICScoreRequest(BaseModel):
    signal_values: List[float]       # QCS scores or alpha signal values
    subsequent_returns: List[float]  # Actual returns that followed each signal
    period_labels: List[str]         # Month/week labels for grouping


class DecayCheckRequest(BaseModel):
    signal_values: List[float]


class OOSGateRequest(BaseModel):
    in_sample_icir: float
    oos_signal: List[float]
    oos_returns: List[float]
    oos_period_labels: List[str]
    n_strategies_tested: int = 1     # For Bonferroni correction
    in_sample_half_life: float = 10.0


def _interpret_icir(icir: float) -> str:
    if icir > 0.5:
        return (
            "ICIR > 0.5: This signal consistently predicts direction. "
            "The QCS score is finding real institutional footprint, not noise. "
            "Safe to increase position sizing on high-QCS qualifying setups."
        )
    elif icir > 0.3:
        return (
            "ICIR 0.3-0.5: Moderate predictive consistency. "
            "The signal works but with some periods of noise. "
            "Use with full entry gate checks to filter to cleanest setups."
        )
    else:
        return (
            "ICIR < 0.3: Signal is primarily noise in this period. "
            "Do NOT trade. Investigate if market regime has shifted. "
            "Re-run loop with different parameter combinations."
        )


@router.post("/ic-score")
def compute_ic_icir(req: ICScoreRequest):
    """
    Computes Information Coefficient (IC) and ICIR for a signal series.
    IC = Pearson correlation between signal and next-period return.
    ICIR = mean(IC_per_period) / std(IC_per_period)
    """
    if len(req.signal_values) != len(req.subsequent_returns) or len(req.signal_values) != len(req.period_labels):
        raise HTTPException(status_code=400, detail="Lengths of signal_values, subsequent_returns, and period_labels must match.")
        
    df = pd.DataFrame({
        "signal": req.signal_values,
        "return": req.subsequent_returns,
        "period": req.period_labels,
    })
    
    # Monthly / Period IC
    monthly_ic = df.groupby("period").apply(
        lambda g: stats.pearsonr(g["signal"], g["return"])[0]
        if len(g) >= 5 and g["signal"].nunique() > 1 and g["return"].nunique() > 1
        else np.nan
    ).dropna()
    
    if len(monthly_ic) < 2:
        return {
            "icir": 0.0,
            "mean_ic": 0.0,
            "std_ic": 0.0,
            "grade": "INSUFFICIENT_DATA",
            "n_periods": len(monthly_ic),
            "monthly_ic": {},
            "interpretation": "Insufficient historical data periods to compute reliable ICIR.",
        }
        
    ic_mean = float(monthly_ic.mean())
    ic_std = float(monthly_ic.std())
    icir = ic_mean / (ic_std + 1e-9)
    
    grade = (
        "STRONG — Signal has real edge, trade this"    if icir > 0.5 else
        "MODERATE — Promising, needs more validation"  if icir > 0.3 else
        "WEAK — Likely noise, do not trade"
    )
    
    return {
        "icir": round(icir, 4),
        "mean_ic": round(ic_mean, 4),
        "std_ic": round(ic_std, 4),
        "grade": grade,
        "n_periods": len(monthly_ic),
        "monthly_ic": {str(k): round(float(v), 4) for k, v in monthly_ic.to_dict().items()},
        "interpretation": _interpret_icir(icir),
    }


@router.post("/decay-check")
def compute_signal_decay(req: DecayCheckRequest):
    """
    Computes autocorrelation at multiple lags [1, 5, 10, 20, 50] to estimate signal half-life.
    Flags signals with half-life < 5 days as untradeable.
    """
    series = pd.Series(req.signal_values)
    lags = [1, 5, 10, 20, 50]
    
    autocorr = {}
    for lag in lags:
        if len(series) > lag:
            val = series.autocorr(lag=lag)
            autocorr[str(lag)] = round(float(val), 4) if not np.isnan(val) else 0.0
        else:
            autocorr[str(lag)] = 0.0
            
    ac1 = autocorr.get("1", 0.0)
    if ac1 > 0.01 and ac1 < 1.0:
        half_life = round(float(-np.log(2) / np.log(abs(ac1))), 1)
    else:
        half_life = 0.0
        
    tradeable = half_life >= 5.0
    
    return {
        "autocorrelations": autocorr,
        "estimated_half_life_days": half_life,
        "tradeable": tradeable,
        "verdict": (
            f"Signal decays in {half_life} days — "
            + ("sufficient for intraday/swing strategies." if tradeable
               else "TOO SHORT. Signal power is gone before execution can complete.")
        )
    }


@router.post("/oos-gate")
def run_oos_gate(req: OOSGateRequest):
    """
    Runs the 3-check Out-of-Sample Gate:
    1. ICIR Hold: OOS ICIR >= 50% of in-sample ICIR
    2. Decay Hold: OOS half-life >= 50% of in-sample half-life
    3. Bonferroni Correction: p-value < 0.05 / N_strategies_tested
    """
    if len(req.oos_signal) != len(req.oos_returns) or len(req.oos_signal) != len(req.oos_period_labels):
        raise HTTPException(status_code=400, detail="Lengths of oos_signal, oos_returns, and oos_period_labels must match.")
        
    oos_df = pd.DataFrame({
        "signal": req.oos_signal,
        "return": req.oos_returns,
        "period": req.oos_period_labels,
    })
    
    oos_monthly_ic = oos_df.groupby("period").apply(
        lambda g: stats.pearsonr(g["signal"], g["return"])[0]
        if len(g) >= 5 and g["signal"].nunique() > 1 and g["return"].nunique() > 1
        else np.nan
    ).dropna()
    
    oos_icir = float(oos_monthly_ic.mean() / (oos_monthly_ic.std() + 1e-9)) if len(oos_monthly_ic) >= 2 else 0.0
    
    # Check 1: ICIR Hold
    icir_ratio = oos_icir / (req.in_sample_icir + 1e-9)
    check1_pass = icir_ratio >= 0.5
    
    # Check 2: Decay Hold
    oos_series = pd.Series(req.oos_signal)
    oos_ac1 = oos_series.autocorr(lag=1) if len(oos_series) > 1 else 0.0
    oos_half_life = float(-np.log(2) / np.log(abs(oos_ac1) + 1e-9)) if (oos_ac1 > 0.01 and oos_ac1 < 1.0) else 0.0
    decay_ratio = oos_half_life / (req.in_sample_half_life + 1e-9)
    check2_pass = decay_ratio >= 0.5
    
    # Check 3: Bonferroni Significance
    n = max(len(oos_monthly_ic), 1)
    t_stat = oos_icir * np.sqrt(n)
    p_value = float(2 * (1 - stats.t.cdf(abs(t_stat), df=max(n-1, 1))))
    bonferroni_threshold = 0.05 / max(req.n_strategies_tested, 1)
    check3_pass = p_value < bonferroni_threshold
    
    all_pass = check1_pass and check2_pass and check3_pass
    
    return {
        "verdict": "REAL EDGE — Strategy is validated for live execution" if all_pass else "OVERFITTED — Strategy failed OOS gate, discard",
        "all_checks_pass": all_pass,
        "checks": {
            "icir_hold": {
                "in_sample_icir": round(req.in_sample_icir, 4),
                "oos_icir": round(oos_icir, 4),
                "ratio": round(float(icir_ratio), 4),
                "pass": check1_pass,
                "note": "OOS ICIR must be >= 50% of in-sample ICIR"
            },
            "decay_hold": {
                "in_sample_half_life": req.in_sample_half_life,
                "oos_half_life": round(oos_half_life, 1),
                "ratio": round(float(decay_ratio), 4),
                "pass": check2_pass,
                "note": "OOS signal half-life must be >= 50% of in-sample"
            },
            "bonferroni": {
                "n_strategies_tested": req.n_strategies_tested,
                "adjusted_p_threshold": round(bonferroni_threshold, 6),
                "p_value": round(p_value, 6),
                "pass": check3_pass,
                "note": f"p-value ({p_value:.5f}) must be < 0.05/{req.n_strategies_tested} = {bonferroni_threshold:.5f}"
            }
        }
    }


class FullAuditRequest(BaseModel):
    signal_values: List[float]
    subsequent_returns: List[float]
    period_labels: List[str]
    n_strategies_tested: int = 1


@router.post("/full-audit")
def run_full_strategy_audit(req: FullAuditRequest):
    """
    Executes ICIR computation, signal decay half-life, and OOS Gate in a single atomic request.
    Split: 70% In-Sample, 30% Out-of-Sample.
    """
    N = len(req.signal_values)
    if N < 20:
        raise HTTPException(status_code=400, detail="Minimum 20 samples required for full strategy audit.")
        
    split_idx = int(0.70 * N)
    
    # In-Sample ICIR
    ic_res = compute_ic_icir(ICScoreRequest(
        signal_values=req.signal_values[:split_idx],
        subsequent_returns=req.subsequent_returns[:split_idx],
        period_labels=req.period_labels[:split_idx],
    ))
    
    # In-Sample Decay
    decay_res = compute_signal_decay(DecayCheckRequest(
        signal_values=req.signal_values[:split_idx],
    ))
    
    # OOS Gate
    oos_res = run_oos_gate(OOSGateRequest(
        in_sample_icir=ic_res["icir"],
        oos_signal=req.signal_values[split_idx:],
        oos_returns=req.subsequent_returns[split_idx:],
        oos_period_labels=req.period_labels[split_idx:],
        n_strategies_tested=req.n_strategies_tested,
        in_sample_half_life=decay_res["estimated_half_life_days"],
    ))
    
    return {
        "status": "success",
        "icir_analysis": ic_res,
        "decay_analysis": decay_res,
        "oos_gate": oos_res,
        "final_verdict": oos_res["verdict"],
        "approved_for_live": oos_res["all_checks_pass"] and ic_res["icir"] > 0.3,
    }

