"""
WealthOS Liquidity & Market Impact Engine Router
Implements Amihud Illiquidity Ratio, Kyle Lambda, and Kyle Square-Root Law
for NSE F&O stocks. Used to estimate pre-trade impact costs and enforce Check 8 in entry gate.
"""

import os
import sys
import logging
import numpy as np
import pandas as pd
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from scipy.optimize import curve_fit
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import HuberRegressor
from sklearn.model_selection import cross_val_score

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logger import get_logger

log = get_logger("liquidity_engine", tag="LIQUIDITY_ENGINE")

router = APIRouter(prefix="/api/liquidity", tags=["LiquidityEngine"])


class OHLCVData(BaseModel):
    dates: List[str]
    opens: List[float]
    highs: List[float]
    lows: List[float]
    closes: List[float]
    volumes: List[float]   # in shares


class TradeRequest(BaseModel):
    symbol: str
    trade_size_shares: Optional[int] = None
    trade_size_value: Optional[float] = None  # in ₹ crore
    current_price: float
    current_adv: float         # Average Daily Volume (shares)
    ann_volatility: float      # Annualised volatility decimal (e.g. 0.20)
    kyle_a: float = 0.024      # Kyle sqrt model parameter a
    kyle_b: float = 0.006      # Kyle sqrt model parameter b


def _interpret_liquidity(current_amihud: float, p95: float, kyle_a: float) -> str:
    ratio = current_amihud / (p95 + 1e-9)
    if ratio > 2.0:
        return "CRITICAL: Stock is extremely illiquid today. Options will have wide bid-ask spreads."
    elif ratio > 1.0:
        return "ELEVATED: Above-average illiquidity. Reduce position size or avoid."
    elif kyle_a > 0.04:
        return "MODERATE: Stock has naturally high impact sensitivity. Use limit orders."
    else:
        return "NORMAL: Liquidity is adequate for standard lot-size F&O trades."


@router.post("/build-model/{symbol}")
def build_liquidity_model(symbol: str, data: OHLCVData):
    """
    Builds the full liquidity model for a stock:
    - Log returns & rolling annualised volatility
    - Amihud ratio & Kyle Lambda time series
    - Fits Kyle √ Law parameters (a, b)
    - Fits Huber robust regression model
    - Returns liquidity alert thresholds (L1/L2/L3)
    """
    if len(data.closes) < 30:
        raise HTTPException(status_code=400, detail="Minimum 30 historical days required to build liquidity model.")
        
    df = pd.DataFrame({
        "date": pd.to_datetime(data.dates),
        "open": data.opens,
        "high": data.highs,
        "low": data.lows,
        "close": data.closes,
        "volume": data.volumes,
    }).sort_values("date").reset_index(drop=True)
    
    # Log returns and volatility
    df["log_return"] = np.log(df["close"] / df["close"].shift(1))
    df["vol_20d"] = df["log_return"].rolling(20).std()
    df["ann_vol"] = df["vol_20d"] * np.sqrt(252)
    
    # Relative volume
    df["avg_vol_20d"] = df["volume"].rolling(20).mean()
    df["rel_vol"] = df["volume"] / (df["avg_vol_20d"] + 1e-9)
    
    # Dollar volume (in ₹ crore for Indian market)
    df["dollar_vol_crore"] = (df["close"] * df["volume"]) / 10_000_000
    
    # Intraday impact
    df["intraday_impact"] = (df["close"] - df["open"]) / (df["open"] + 1e-9)
    df["abs_impact"] = df["intraday_impact"].abs()
    
    # Amihud Illiquidity Ratio
    df["amihud"] = df["log_return"].abs() / (df["dollar_vol_crore"] + 1e-9)
    
    # Kyle Lambda (price move per 1M shares)
    df["kyle_lambda"] = df["abs_impact"] / ((df["volume"] / 1_000_000) + 1e-9)
    
    df_clean = df.dropna().copy()
    
    # Fit Kyle √ Law: impact = a * sqrt(rel_vol) + b
    def kyle_sqrt_func(rel_v, a, b):
        return a * np.sqrt(rel_v) + b
        
    try:
        popt, _ = curve_fit(
            kyle_sqrt_func,
            df_clean["rel_vol"].clip(0.01, 10).values,
            df_clean["abs_impact"].values,
            p0=[0.02, 0.005],
            maxfev=5000
        )
        kyle_a, kyle_b = float(popt[0]), float(popt[1])
    except Exception:
        kyle_a, kyle_b = 0.024, 0.006
        
    # Fit Huber Regression
    X = df_clean[["rel_vol", "ann_vol"]].values
    y = df_clean["abs_impact"].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    huber = HuberRegressor(epsilon=1.35).fit(X_scaled, y)
    
    try:
        cv_r2 = float(cross_val_score(huber, X_scaled, y, cv=min(5, len(y)//5), scoring='r2').mean())
    except Exception:
        cv_r2 = 0.15
        
    amihud_95 = float(df_clean["amihud"].quantile(0.95))
    amihud_99 = float(df_clean["amihud"].quantile(0.99))
    kyle_90 = float(df_clean["kyle_lambda"].quantile(0.90))
    kyle_99 = float(df_clean["kyle_lambda"].quantile(0.99))
    
    recent = df_clean.tail(5)
    current_amihud = float(recent["amihud"].mean())
    current_alert = (
        "CRITICAL (L3)" if current_amihud > amihud_99 else
        "HIGH (L2)"     if current_amihud > amihud_95 else
        "NORMAL"
    )
    
    return {
        "symbol": symbol,
        "model_params": {
            "kyle_a": round(kyle_a, 6),
            "kyle_b": round(kyle_b, 6),
            "huber_cv_r2": round(cv_r2, 4),
            "avg_daily_volume": int(df_clean["volume"].mean()),
            "median_ann_vol": round(float(df_clean["ann_vol"].median()), 4),
        },
        "liquidity_stats": {
            "median_amihud": round(float(df_clean["amihud"].median()), 6),
            "amihud_95th": round(amihud_95, 6),
            "amihud_99th": round(amihud_99, 6),
            "median_kyle_lambda": round(float(df_clean["kyle_lambda"].median()), 6),
            "kyle_90th": round(kyle_90, 6),
            "kyle_99th": round(kyle_99, 6),
            "current_amihud": round(current_amihud, 6),
            "current_alert_level": current_alert,
        },
        "interpretation": _interpret_liquidity(current_amihud, amihud_95, kyle_a),
    }


@router.post("/pre-trade-cost")
def estimate_pre_trade_cost(req: TradeRequest):
    """
    Estimates pre-trade market impact cost for a proposed order.
    Uses 60% Kyle √ Law + 40% Huber regression blend.
    Returns: impact in bps, % of trade value, ₹ cost, execution recommendation.
    """
    if req.trade_size_shares:
        shares = req.trade_size_shares
    elif req.trade_size_value:
        shares = int((req.trade_size_value * 10_000_000) / (req.current_price + 1e-9))
    else:
        raise HTTPException(status_code=400, detail="Provide either trade_size_shares or trade_size_value")
        
    rel_vol = shares / (req.current_adv + 1e-9)
    
    # Kyle √ Law impact
    kyle_impact = req.kyle_a * np.sqrt(rel_vol) + req.kyle_b
    kyle_bps = kyle_impact * 10_000
    
    # Huber blended impact
    huber_impact = (0.015 * np.sqrt(rel_vol) + 0.003) * (1 + 0.5 * req.ann_volatility / 0.2)
    huber_bps = huber_impact * 10_000
    
    # 60/40 blend
    blended_bps = 0.6 * kyle_bps + 0.4 * huber_bps
    trade_value = shares * req.current_price
    cost_inr = trade_value * (blended_bps / 10_000)
    
    if rel_vol < 0.1:
        execution = "SINGLE ORDER — Low impact, execute at market"
    elif rel_vol < 0.5:
        execution = "VWAP — Spread over 2-3 hours to minimize impact"
    elif rel_vol < 1.5:
        execution = "TWAP — Spread over full trading day"
    else:
        execution = "MULTI-DAY — Execute over 2+ trading days to keep impact < 50 bps/day"
        
    return {
        "symbol": req.symbol,
        "trade": {
            "shares": shares,
            "value_inr": round(trade_value, 2),
            "relative_volume": round(rel_vol, 4),
        },
        "impact": {
            "kyle_bps": round(kyle_bps, 1),
            "huber_bps": round(huber_bps, 1),
            "blended_bps": round(blended_bps, 1),
            "pct_of_trade": round(blended_bps / 100, 4),
            "cost_inr": round(cost_inr, 2),
        },
        "execution_strategy": execution,
        "risk_flag": "HIGH IMPACT" if blended_bps > 100 else "ACCEPTABLE",
    }


@router.get("/alert/{symbol}")
def get_liquidity_alert(
    symbol: str,
    amihud_current: float = Query(0.001),
    amihud_95th: float = Query(0.005),
    kyle_current: float = Query(0.002),
    kyle_90th: float = Query(0.004),
    kyle_99th: float = Query(0.010),
):
    """
    Returns liquidity alert level for entry gate Check 8.
    """
    amihud_current = float(amihud_current.default) if hasattr(amihud_current, "default") else float(amihud_current)
    amihud_95th = float(amihud_95th.default) if hasattr(amihud_95th, "default") else float(amihud_95th)
    kyle_current = float(kyle_current.default) if hasattr(kyle_current, "default") else float(kyle_current)
    kyle_90th = float(kyle_90th.default) if hasattr(kyle_90th, "default") else float(kyle_90th)
    kyle_99th = float(kyle_99th.default) if hasattr(kyle_99th, "default") else float(kyle_99th)


    if amihud_current > amihud_95th and kyle_current > kyle_99th:

        level = "L3_CRITICAL"
        action = "DO NOT TRADE — Extreme illiquidity. Options spreads will be very wide."
    elif amihud_current > amihud_95th and kyle_current > kyle_90th:
        level = "L2_HIGH"
        action = "AVOID or reduce position size 50%. Execution costs are elevated."
    elif amihud_current > amihud_95th:
        level = "L1_CAUTION"
        action = "Trade with limit orders only. Market impact is above normal."
    else:
        level = "NORMAL"
        action = "Liquidity is normal. Standard execution."
        
    return {
        "symbol": symbol,
        "alert_level": level,
        "gate_8_pass": level == "NORMAL",
        "action": action,
        "metrics": {
            "amihud_current": round(amihud_current, 6),
            "amihud_95th": round(amihud_95th, 6),
            "ratio_to_95th": round(amihud_current / (amihud_95th + 1e-9), 2),
        }
    }


class TWAPScheduleRequest(BaseModel):
    symbol: str
    total_shares: int
    execution_window_minutes: int = 60
    max_child_order_pct_adv: float = 0.02
    current_adv: float = 5000000.0


@router.post("/twap-schedule")
def generate_twap_schedule(req: TWAPScheduleRequest):
    """
    Generates exact TWAP child-order execution schedule for large or high-impact orders.
    Calculates slice count, interval minutes, and per-slice share count.
    """
    max_slice = int(req.current_adv * req.max_child_order_pct_adv)
    max_slice = max(max_slice, 1)
    
    n_slices = int(np.ceil(req.total_shares / max_slice))
    n_slices = max(n_slices, 2)
    
    interval_mins = max(1, req.execution_window_minutes // n_slices)
    slice_size = int(np.ceil(req.total_shares / n_slices))
    
    slices = []
    accumulated = 0
    for i in range(n_slices):
        qty = slice_size if (accumulated + slice_size) <= req.total_shares else (req.total_shares - accumulated)
        accumulated += qty
        slices.append({
            "slice_number": i + 1,
            "minute_offset": i * interval_mins,
            "quantity_shares": qty,
        })
        if accumulated >= req.total_shares:
            break
            
    return {
        "symbol": req.symbol,
        "total_shares": req.total_shares,
        "n_slices": len(slices),
        "interval_minutes": interval_mins,
        "slice_size_shares": slice_size,
        "schedule": slices,
    }

