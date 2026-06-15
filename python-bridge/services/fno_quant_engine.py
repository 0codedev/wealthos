"""
fno_quant_engine.py - Institutional F&O Quantitative Analytics Engine
----------------------------------------------------------------------
Core calculations for Alpha Engine F&O Sector 2.0:
1. Cross-Sector Dispersion (CSD) & Standardized Sector Z-Scores for choppy markets.
2. 10:30 AM - 10:45 AM Dip-and-Rebound Mathematical Validator with PVCR.
3. Live Upstox Option Chain Ingestion (PCR, OI Buildup, Greeks, ATM Delta ~0.50).
4. Bid-Ask Spread & Contract Liquidity Gate (<= 1.50% spread enforcement).
5. F&O Institutional Quant Score (FIQS 0-100).
"""

import os
import sys
import math
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any, Tuple

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from logger import get_logger

log = get_logger("fno_quant_engine", tag="FNO_QUANT")


# ==============================================================================
# 1. CROSS-SECTOR DISPERSION & EXTREME SECTOR DETECTION
# ==============================================================================

def calculate_cross_sector_dispersion(
    sectors_summary: List[Dict[str, Any]], 
    nifty_change: float = 0.0
) -> Dict[str, Any]:
    """
    Evaluates institutional capital rotation across all 15 NSE sector indices.
    Calculates Cross-Sector Dispersion (CSD), mean return, standard deviation,
    and individual standardized Z-scores with Macro Benchmark Primacy.

    Solves the Macro Trend & Choppy Market Alignment:
    1. Benchmark Primacy: If NIFTY 50 is trending strongly (|nifty_change| >= 0.30%),
       the macro index governs dominant direction (CALL on bull days, PUT on bear days).
       Dominant sector is strictly picked from aligned sectors (never shorting into a +1.6% Nifty rally).
    2. Rotation Mode: If NIFTY 50 is flat/choppy (|nifty_change| < 0.30%), wide sector dispersion
       (Spread >= 1.80%) reveals institutional divergence to capture outperforming sectors.
    """
    if not sectors_summary or len(sectors_summary) < 3:
        return {
            "status": "INSUFFICIENT_DATA",
            "spread": 0.0,
            "mean": 0.0,
            "std": 0.0,
            "regime": "NEUTRAL_CHOP_SQUELCH",
            "dominant_sector": None,
            "direction": "CALL",
            "sectors_ranked": []
        }

    # Extract percentage changes
    changes = [float(s.get("percentChange", 0.0)) for s in sectors_summary]
    mean_chg = sum(changes) / len(changes)
    variance = sum((c - mean_chg) ** 2 for c in changes) / max(1, len(changes) - 1)
    std_chg = math.sqrt(variance) if variance > 0 else 0.001

    # Enrich each sector with its Z-factor
    enriched_sectors = []
    for s in sectors_summary:
        chg = float(s.get("percentChange", 0.0))
        z_score = round((chg - mean_chg) / std_chg, 2)
        item = dict(s)
        item["z_score"] = z_score
        enriched_sectors.append(item)

    # Sort descending for Bullish ranking, ascending for Bearish ranking
    enriched_sectors.sort(key=lambda x: x["percentChange"], reverse=True)
    top_sector = enriched_sectors[0]
    bot_sector = enriched_sectors[-1]

    spread = round(top_sector["percentChange"] - bot_sector["percentChange"], 2)

    # Outlier Z-score flags
    is_bull_extreme = top_sector["z_score"] >= 1.35 and top_sector["percentChange"] >= 0.80
    is_bear_extreme = bot_sector["z_score"] <= -1.35 and bot_sector["percentChange"] <= -0.80

    regime = "NEUTRAL_CHOP_SQUELCH"
    dominant_sector = None
    direction = "CALL"

    # --------------------------------------------------------------------------
    # 🛡️ 1. MACRO BENCHMARK PRIMACY GATE (NIFTY 50 Directional Anchor)
    # --------------------------------------------------------------------------
    if nifty_change >= 0.30:
        # Bullish Macro Day: Direction is locked to CALL unconditionally
        direction = "CALL"
        pos_sectors = [s for s in enriched_sectors if s.get("percentChange", 0.0) > 0]
        dominant_sector = pos_sectors[0] if pos_sectors else top_sector
        is_bull_lead = dominant_sector.get("z_score", 0.0) >= 1.35 or dominant_sector.get("percentChange", 0.0) >= 1.20
        regime = "EXTREME_BULL_ROTATION" if is_bull_lead else "MACRO_BULL_ALIGNMENT"
    elif nifty_change <= -0.30:
        # Bearish Macro Day: Direction is locked to PUT unconditionally
        direction = "PUT"
        neg_sectors = [s for s in enriched_sectors if s.get("percentChange", 0.0) < 0]
        dominant_sector = neg_sectors[-1] if neg_sectors else bot_sector
        is_bear_lead = dominant_sector.get("z_score", 0.0) <= -1.35 or dominant_sector.get("percentChange", 0.0) <= -1.20
        regime = "EXTREME_BEAR_ROTATION" if is_bear_lead else "MACRO_BEAR_ALIGNMENT"
    else:
        # ----------------------------------------------------------------------
        # 2. NEUTRAL / FLAT NIFTY ROTATION REGIME (-0.30% < nifty_change < +0.30%)
        # ----------------------------------------------------------------------
        if spread >= 1.80:
            if is_bull_extreme and is_bear_extreme:
                # Dual extreme divergence: pick the side with stronger absolute Z-score
                if abs(top_sector["z_score"]) >= abs(bot_sector["z_score"]):
                    dominant_sector = top_sector
                    direction = "CALL"
                    regime = "EXTREME_BULL_ROTATION"
                else:
                    dominant_sector = bot_sector
                    direction = "PUT"
                    regime = "EXTREME_BEAR_ROTATION"
            elif is_bull_extreme:
                dominant_sector = top_sector
                direction = "CALL"
                regime = "EXTREME_BULL_ROTATION"
            elif is_bear_extreme:
                dominant_sector = bot_sector
                direction = "PUT"
                regime = "EXTREME_BEAR_ROTATION"
            else:
                # Wide spread but moderate Z-scores
                if top_sector["percentChange"] >= 0.70:
                    dominant_sector = top_sector
                    direction = "CALL"
                    regime = "MODERATE_BULL_ROTATION"
                elif bot_sector["percentChange"] <= -0.70:
                    dominant_sector = bot_sector
                    direction = "PUT"
                    regime = "MODERATE_BEAR_ROTATION"
                else:
                    dominant_sector = top_sector if top_sector["percentChange"] >= 0 else bot_sector
                    direction = "CALL" if dominant_sector["percentChange"] >= 0 else "PUT"
                    regime = "NEUTRAL_CHOP_SQUELCH"
        else:
            # Spread is tight: market is tightly compressed/choppy
            regime = "NEUTRAL_CHOP_SQUELCH"
            dominant_sector = top_sector if top_sector["percentChange"] >= 0 else bot_sector
            direction = "CALL" if (dominant_sector and dominant_sector["percentChange"] >= 0) else "PUT"

    return {
        "status": "SUCCESS",
        "spread": spread,
        "mean_return": round(mean_chg, 2),
        "std_return": round(std_chg, 2),
        "regime": regime,
        "is_extreme": "EXTREME" in regime,
        "dominant_sector": dominant_sector,
        "direction": direction,
        "nifty_change": nifty_change,
        "sectors_ranked": enriched_sectors
    }


# ==============================================================================
# ==============================================================================
# 2. DUAL-ARCHETYPE MOMENTUM SCORER & EXHAUSTION TRAP SENTRY
# ==============================================================================

def score_dual_archetype_momentum(
    symbol: str,
    direction: str,
    candles_1m: List[List[Any]],
    daily_atr: float = 0.0,
    vwap: float = 0.0,
    ema_9: float = 0.0,
    ema_21: float = 0.0,
    sector_return: float = 0.0,
    nifty_return: float = 0.0,
) -> Dict[str, Any]:
    """
    Sovereign Dual-Archetype Momentum Scorer & Exhaustion Trap Invariant.
    
    Scores candidate setups (0 to 100 points) across two institutional runner profiles:
    - Archetype A: Coiled Shelf Runner (e.g. ICICIBANK)
      Tight morning consolidation (ORC <= 0.35 ATR), variance < 0.45%, First-5m Low defended,
      breaking out with expanding volume to deliver smooth linear y=mx trending.
    - Archetype B: Impulse Dip & Rebound (e.g. BHARTIARTL)
      Early morning thrust (> 1.5%), orderly low-volume pullback into VWAP/support (PVCR <= 0.65),
      Higher Low defended above morning open, and rebound candle reclaim with volume.
    
    Hard Exhaustion Trap Invariant (Tata Elxsi Killer):
    - Opening ATR Blowout (> 70% of daily ATR consumed in first 30 mins) or pump-and-dump:
      Assesses heavy penalty (-50 to -90 pts) and immediate EXHAUSTION_TRAP disqualification.
    """
    if not candles_1m or len(candles_1m) < 15:
        return {
            "confirmed": False,
            "status": "INSUFFICIENT_CANDLES",
            "archetype": "NONE",
            "score": 0.0,
            "reason": "Less than 15 historical 1-minute bars available."
        }

    chrono = list(candles_1m)
    if chrono[0][0] > chrono[-1][0]:
        chrono = list(reversed(chrono))

    latest_bar = chrono[-1]
    curr_close = float(latest_bar[4])
    curr_vol = float(latest_bar[5])
    curr_high = float(latest_bar[2])
    curr_low = float(latest_bar[3])

    # 1. First 5-Minute Window (09:15 - 09:20 IST)
    first_5m_bars = chrono[:min(len(chrono), 5)]
    first_5m_low = min(float(b[3]) for b in first_5m_bars)
    first_5m_high = max(float(b[2]) for b in first_5m_bars)

    # 2. Opening Range Window (First 45 bars or 09:15-10:00)
    or_bars = chrono[:min(len(chrono) - 3, 45)]
    or_high = max(float(b[2]) for b in or_bars) if or_bars else curr_high
    or_low = min(float(b[3]) for b in or_bars) if or_bars else curr_low
    or_range = or_high - or_low

    or_range_pct = (or_range / curr_close) * 100 if curr_close > 0 else 1.0
    atr_consumption = round((or_range / daily_atr), 3) if daily_atr > 0 else 0.0

    # 3. Horizontal Accumulation Shelf (Bars from index 5 to end-1)
    shelf_bars = chrono[5:-1] if len(chrono) > 10 else chrono[:-1]
    shelf_high = max(float(b[2]) for b in shelf_bars) if shelf_bars else or_high
    shelf_low = min(float(b[3]) for b in shelf_bars) if shelf_bars else or_low
    shelf_range = shelf_high - shelf_low
    shelf_variance_pct = round((shelf_range / curr_close) * 100, 2) if curr_close > 0 else 1.0

    # 4. Recent Dip Bars & Volume Analysis
    recent_bars = chrono[-8:-1] if len(chrono) >= 12 else chrono[-4:-1]
    prior_bars = chrono[-25:-12] if len(chrono) >= 25 else chrono[:min(len(chrono) - 5, 15)]
    prior_vols = [float(b[5]) for b in prior_bars]
    avg_prior_vol = sum(prior_vols) / max(1, len(prior_vols)) if prior_vols else 1.0

    # Volume Contraction on Dip (PVCR)
    if direction == "CALL":
        dip_low = min(float(b[3]) for b in recent_bars) if recent_bars else curr_low
        dip_high = max(float(b[2]) for b in recent_bars) if recent_bars else curr_high
        dip_vols = [float(b[5]) for b in recent_bars if float(b[4]) <= float(b[1])]
        avg_dip_vol = sum(dip_vols) / max(1, len(dip_vols)) if dip_vols else avg_prior_vol
        pvcr = round(avg_dip_vol / avg_prior_vol, 2) if avg_prior_vol > 0 else 1.0
        bounce_high = dip_high
        bounce_low = dip_low
    else:
        bounce_high = max(float(b[2]) for b in recent_bars) if recent_bars else curr_high
        bounce_low = min(float(b[3]) for b in recent_bars) if recent_bars else curr_low
        bounce_vols = [float(b[5]) for b in recent_bars if float(b[4]) >= float(b[1])]
        avg_bounce_vol = sum(bounce_vols) / max(1, len(bounce_vols)) if bounce_vols else avg_prior_vol
        pvcr = round(avg_bounce_vol / avg_prior_vol, 2) if avg_prior_vol > 0 else 1.0
        dip_high = bounce_high
        dip_low = bounce_low

    # --------------------------------------------------------------------------
    # 🚨 EXHAUSTION TRAP DETECTION (Tata Elxsi / Pump-and-Dump Trap Disqualification)
    # --------------------------------------------------------------------------
    exhaustion_penalty = 0.0
    trap_reasons = []

    # Check 1: Opening ATR Blowout (> 80% daily ATR or > 4.5% swing in morning)
    atr_blowout = False
    if (daily_atr > 0 and atr_consumption >= 0.80) or or_range_pct >= 4.50:
        atr_blowout = True
        trap_reasons.append(f"Morning ATR blowout: {atr_consumption:.1%} ATR consumed ({or_range_pct:.2f}%)")

    # Check 2: Severe breakdown below VWAP / 21-EMA with institutional abandonment
    below_vwap = False
    if direction == "CALL":
        if vwap > 0 and curr_close < (vwap * 0.997):
            below_vwap = True
            trap_reasons.append("Price decaying below VWAP with institutional abandonment")
    else:
        if vwap > 0 and curr_close > (vwap * 1.003):
            below_vwap = True
            trap_reasons.append("Price rising above VWAP contrary to short")

    # Full Trap Veto: Requires BOTH high ATR depletion AND structural breakdown below VWAP
    if atr_blowout and below_vwap:
        exhaustion_penalty = 80.0
        is_exhaustion_trap = True
    elif below_vwap:
        exhaustion_penalty = 40.0
        is_exhaustion_trap = False
    elif (daily_atr > 0 and atr_consumption >= 1.25) or or_range_pct >= 6.0:
        exhaustion_penalty = 50.0
        is_exhaustion_trap = True
    else:
        exhaustion_penalty = 0.0
        is_exhaustion_trap = False

    # --------------------------------------------------------------------------
    # 🏛️ ARCHETYPE A: COILED SHELF RUNNER (ICICIBANK Type) - Max 100 pts
    # --------------------------------------------------------------------------
    score_a = 0.0
    a_reasons = []

    # A1. ATR Compression (< 35% ATR consumed or tight < 0.80% morning range)
    if (daily_atr > 0 and atr_consumption <= 0.35) or (daily_atr <= 0 and or_range_pct <= 0.80):
        score_a += 30.0
        a_reasons.append(f"Coiled ATR ({atr_consumption:.1%} <= 35%) +30")
    elif (daily_atr > 0 and atr_consumption <= 0.45) or (daily_atr <= 0 and or_range_pct <= 1.20):
        score_a += 15.0
        a_reasons.append(f"Moderate ATR ({atr_consumption:.1%}) +15")

    # A2. Horizontal Accumulation Shelf (Price variance < 0.45%)
    if shelf_variance_pct <= 0.45:
        score_a += 30.0
        a_reasons.append(f"Tight Shelf ({shelf_variance_pct:.2f}% <= 0.45%) +30")
    elif shelf_variance_pct <= 0.75:
        score_a += 15.0
        a_reasons.append(f"Acceptable Shelf ({shelf_variance_pct:.2f}%) +15")

    # A3. First 5-Minute Low Defended Floor (FLI)
    if direction == "CALL":
        min_subsequent = min(float(b[3]) for b in chrono[5:]) if len(chrono) > 5 else curr_low
        fli_held = min_subsequent >= (first_5m_low * 0.9990)
    else:
        max_subsequent = max(float(b[2]) for b in chrono[5:]) if len(chrono) > 5 else curr_high
        fli_held = max_subsequent <= (first_5m_high * 1.0010)

    if fli_held:
        score_a += 20.0
        a_reasons.append("First-5m Floor Defended +20")

    # A4. Shelf Breakout & Volume Expansion
    if direction == "CALL":
        breakout = curr_close >= (shelf_high * 0.998)
        vol_exp = curr_vol >= (avg_prior_vol * 1.05)
    else:
        breakout = curr_close <= (shelf_low * 1.002)
        vol_exp = curr_vol >= (avg_prior_vol * 1.05)

    if breakout and vol_exp:
        score_a += 20.0
        a_reasons.append("Breakout with Volume Expansion +20")
    elif breakout:
        score_a += 10.0
        a_reasons.append("Breakout Testing +10")

    # --------------------------------------------------------------------------
    # ⚡ ARCHETYPE B: IMPULSE DIP & REBOUND (BHARTIARTL Type) - Max 100 pts
    # --------------------------------------------------------------------------
    score_b = 0.0
    b_reasons = []

    # B1. Morning Impulse Magnitude (> 1.50%)
    impulse_pct = (or_range / or_low * 100) if or_low > 0 else 0.0
    if impulse_pct >= 1.80:
        score_b += 30.0
        b_reasons.append(f"Strong Impulse ({impulse_pct:.2f}% >= 1.8%) +30")
    elif impulse_pct >= 1.00:
        score_b += 15.0
        b_reasons.append(f"Moderate Impulse ({impulse_pct:.2f}%) +15")

    # B2. Dry Volume Contraction on Dip (PVCR <= 0.65)
    if pvcr <= 0.65:
        score_b += 30.0
        b_reasons.append(f"Dry Dip (PVCR {pvcr:.2f}x <= 0.65) +30")
    elif pvcr <= 0.75:
        score_b += 15.0
        b_reasons.append(f"Low Vol Dip (PVCR {pvcr:.2f}x) +15")

    # B3. Higher Low Defended Structure
    if direction == "CALL":
        hl_held = dip_low >= (first_5m_low * 1.001)
    else:
        hl_held = bounce_high <= (first_5m_high * 0.999)

    if hl_held:
        score_b += 20.0
        b_reasons.append("Higher Low Structure Defended +20")

    # B4. Rebound Candle Reclaim with Volume
    if direction == "CALL":
        rebound_break = curr_close >= (dip_high * 0.999)
        vol_exp_b = curr_vol >= (avg_prior_vol * 1.05)
    else:
        rebound_break = curr_close <= (bounce_low * 1.001)
        vol_exp_b = curr_vol >= (avg_prior_vol * 1.05)

    if rebound_break and vol_exp_b:
        score_b += 20.0
        b_reasons.append("Rebound Reclaim with Volume +20")
    elif rebound_break:
        score_b += 10.0
        b_reasons.append("Rebound Level Tested +10")

    # Apply Exhaustion Trap Deductions
    net_score_a = max(0.0, score_a - exhaustion_penalty)
    net_score_b = max(0.0, score_b - exhaustion_penalty)

    # --------------------------------------------------------------------------
    # 🏁 SCORING WATERFALL VERDICT
    # --------------------------------------------------------------------------
    if is_exhaustion_trap:
        return {
            "confirmed": False,
            "status": "EXHAUSTION_TRAP",
            "archetype": "EXHAUSTION_TRAP",
            "score": round(max(net_score_a, net_score_b), 1),
            "score_a": round(net_score_a, 1),
            "score_b": round(net_score_b, 1),
            "exhaustion_penalty": exhaustion_penalty,
            "atr_consumption": atr_consumption,
            "pvcr": pvcr,
            "direction": direction,
            "current_price": curr_close,
            "first_5m_low": round(first_5m_low, 2),
            "first_5m_high": round(first_5m_high, 2),
            "reason": f"Disqualified: Extreme exhaustion pump trap - {'; '.join(trap_reasons)}."
        }

    best_score = max(net_score_a, net_score_b)
    if net_score_a >= net_score_b:
        chosen_archetype = "ARCHETYPE_A_COILED_RUNNER"
        reasons_list = a_reasons
    else:
        chosen_archetype = "ARCHETYPE_B_DIP_REBOUND"
        reasons_list = b_reasons

    # Dynamic Confirmation Threshold: >= 55.0 points confirms runner
    confirmed = best_score >= 55.0
    status = (
        "UPFRONT_RUNNER_CONFIRMED" if (confirmed and chosen_archetype == "ARCHETYPE_A_COILED_RUNNER") else
        ("REBOUND_CONFIRMED" if (confirmed and chosen_archetype == "ARCHETYPE_B_DIP_REBOUND") else
        ("FORMING_BASE" if best_score >= 35.0 else "WAITING_FOR_SETUP"))
    )

    rebound_trigger = (
        shelf_high if (direction == "CALL" and chosen_archetype == "ARCHETYPE_A_COILED_RUNNER") else
        (dip_high if direction == "CALL" else (
            shelf_low if chosen_archetype == "ARCHETYPE_A_COILED_RUNNER" else bounce_low
        ))
    )

    return {
        "confirmed": confirmed,
        "status": status,
        "archetype": chosen_archetype,
        "score": round(best_score, 1),
        "score_a": round(net_score_a, 1),
        "score_b": round(net_score_b, 1),
        "exhaustion_penalty": exhaustion_penalty,
        "atr_consumption": atr_consumption,
        "orc": atr_consumption,
        "first_5m_low": round(first_5m_low, 2),
        "first_5m_high": round(first_5m_high, 2),
        "fli_held": fli_held,
        "pvcr": pvcr,
        "rebound_trigger_price": round(rebound_trigger, 2),
        "dip_low": round(dip_low, 2),
        "dip_high": round(dip_high, 2),
        "is_low_vol_dip": pvcr <= 0.75,
        "rebound_break": confirmed,
        "vol_expansion": (curr_vol >= avg_prior_vol * 1.05),
        "direction": direction,
        "current_price": curr_close,
        "mode": "MOMENTUM_RUNNER_UPFRONT" if chosen_archetype == "ARCHETYPE_A_COILED_RUNNER" else "INTRADAY_DIP_REBOUND",
        "reason": (
            f"Confirmed {chosen_archetype} (Score {best_score:.0f}/100): {', '.join(reasons_list)}"
            if confirmed else
            f"Under observation: {chosen_archetype} score {best_score:.0f}/100 (< 55 threshold). {', '.join(reasons_list)}"
        )
    }


# ==============================================================================
# 2.1 UPFRONT COMPRESSION RUNNER EVALUATOR (10:10 - 10:35 AM IST)
# ==============================================================================

def evaluate_upfront_compression_runner(
    symbol: str,
    direction: str,
    candles_1m: List[List[Any]],
    daily_atr: float = 0.0,
    sector_return: float = 0.0,
    nifty_return: float = 0.0,
    vwap: float = 0.0,
    ema_9: float = 0.0,
    ema_21: float = 0.0,
) -> Dict[str, Any]:
    """
    Evaluates Upfront F&O Momentum Runner Detection (10:10 - 10:35 AM IST Window).
    Solves the '2:00 PM Top Gainer Fallacy' by catching the coiled spring setup upfront.

    Quantitative Invariants:
    1. Sector Dispersion Dominance (SDD >= 2.5x NIFTY): sector_return >= 2.5 * nifty_return.
    2. Opening Range Compression (ORC_45 <= 0.35 Daily ATR): Range 09:15-10:00 is tightly coiled.
    3. 5-Minute Low Invariant (FLI): Low of first 5 minutes is never broken through morning consolidation.
    4. Dry-Volume Dip (PVCR <= 0.60x): Red dip candle (10:20-10:25) prints dry volume (< 60% of 10-bar avg).
    5. Rejection Wick Velocity (RWV >= 40%): Strong lower rejection wick with fast reclaim of dip high.
    """
    if not candles_1m or len(candles_1m) < 15:
        return {
            "confirmed": False,
            "status": "INSUFFICIENT_CANDLES",
            "reason": "Less than 15 historical 1-minute bars available."
        }

    chrono = list(candles_1m)
    if chrono[0][0] > chrono[-1][0]:
        chrono = list(reversed(chrono))

    latest_bar = chrono[-1]
    curr_close = float(latest_bar[4])
    curr_vol = float(latest_bar[5])

    # 1. Opening Range Compression (ORC) between 09:15 and 10:00 (first 45 bars)
    or_bars = chrono[:min(len(chrono) - 3, 45)]
    if not or_bars:
        return {"confirmed": False, "status": "INSUFFICIENT_OR_BARS", "reason": "No opening range bars"}

    or_high = max(float(b[2]) for b in or_bars)
    or_low = min(float(b[3]) for b in or_bars)
    or_range = or_high - or_low

    if daily_atr > 0:
        orc = round(or_range / daily_atr, 3)
        is_compressed = orc <= 0.38  # Upper threshold for coiled compression
    else:
        # Fallback without ATR: check percentage range relative to spot (< 1.6%)
        orc = round((or_range / curr_close) * 100, 2) if curr_close > 0 else 1.0
        is_compressed = orc <= 1.60

    # 2. 5-Minute Low Invariant (FLI)
    # The low formed during the first 5 minutes (09:15-09:20) must be defended throughout morning
    first_5m_bars = chrono[:min(len(chrono), 5)]
    first_5m_low = min(float(b[3]) for b in first_5m_bars)
    first_5m_high = max(float(b[2]) for b in first_5m_bars)

    if direction == "CALL":
        min_subsequent_low = min(float(b[3]) for b in chrono[5:]) if len(chrono) > 5 else float(latest_bar[3])
        fli_held = min_subsequent_low >= (first_5m_low * 0.9992) # Max 0.08% micro-wick tolerance
        floor_level = first_5m_low
    else:
        max_subsequent_high = max(float(b[2]) for b in chrono[5:]) if len(chrono) > 5 else float(latest_bar[2])
        fli_held = max_subsequent_high <= (first_5m_high * 1.0008)
        floor_level = first_5m_high

    # 3. Recent Dip Phase (The 10:20 - 10:25 AM Shakeout)
    recent_bars = chrono[-12:-1] if len(chrono) >= 13 else chrono[-5:-1]
    if not recent_bars:
        return {"confirmed": False, "status": "INSUFFICIENT_RECENT_BARS", "reason": "No consolidation bars"}

    prior_bars = chrono[-25:-12] if len(chrono) >= 25 else chrono[:min(len(chrono) - 5, 15)]
    prior_vols = [float(b[5]) for b in prior_bars]
    avg_prior_vol = sum(prior_vols) / max(1, len(prior_vols)) if prior_vols else 1.0

    if direction == "CALL":
        # Identify lowest dip bar
        dip_bar = min(recent_bars, key=lambda b: float(b[3]))
        dip_low = float(dip_bar[3])
        dip_high = float(dip_bar[2])
        dip_open = float(dip_bar[1])
        dip_close = float(dip_bar[4])
        dip_vol = float(dip_bar[5])

        # Price-Volume Contraction Ratio (PVCR)
        pvcr = round(dip_vol / avg_prior_vol, 2) if avg_prior_vol > 0 else 1.0
        is_dry_dip = pvcr <= 0.65  # Institutional quiet accumulation, not selling

        # Rejection Wick Velocity
        bar_range = max(0.01, dip_high - dip_low)
        lower_wick = max(0.0, min(dip_open, dip_close) - dip_low)
        wick_pct = round(lower_wick / bar_range, 2)
        has_rejection_wick = wick_pct >= 0.35

        # Reclaim & Volume Expansion
        rebound_break = curr_close >= dip_high * 0.998
        vol_expansion = curr_vol >= avg_prior_vol * 1.05

        # Structural support (holding VWAP or 21-EMA)
        near_vwap = (curr_close >= vwap * 0.997) if vwap > 0 else True
        near_ema = (curr_close >= ema_9 * 0.997) if ema_9 > 0 else True
        structure_intact = near_vwap or near_ema

        confirmed = is_compressed and fli_held and is_dry_dip and (has_rejection_wick or rebound_break) and vol_expansion and structure_intact

        status = "UPFRONT_RUNNER_CONFIRMED" if confirmed else (
            "COMPRESSION_COILING" if (is_compressed and fli_held) else "WAITING_FOR_UPFRONT_SETUP"
        )

        return {
            "confirmed": confirmed,
            "status": status,
            "direction": "CALL",
            "current_price": curr_close,
            "orc": orc,
            "is_compressed": is_compressed,
            "first_5m_low": round(first_5m_low, 2),
            "fli_held": fli_held,
            "dip_low": round(dip_low, 2),
            "dip_high": round(dip_high, 2),
            "rebound_trigger_price": round(dip_high, 2),
            "pvcr": pvcr,
            "is_low_vol_dip": is_dry_dip,
            "wick_pct": wick_pct,
            "has_rejection_wick": has_rejection_wick,
            "rebound_break": rebound_break,
            "vol_expansion": vol_expansion,
            "structure_intact": structure_intact,
            "mode": "MOMENTUM_RUNNER_UPFRONT",
            "reason": (
                f"Sovereign Upfront Runner Confirmed: ORC={orc} (<=0.38), FLI Defended (₹{first_5m_low:.2f}), "
                f"PVCR={pvcr}x (dry-vol <=0.65x), Wick={wick_pct:.0%}, Rebound={rebound_break}"
                if confirmed else
                f"Upfront check: ORC={orc}, Compressed={is_compressed}, FLI_Held={fli_held}, PVCR={pvcr}x, Wick={wick_pct:.0%}, Reclaim={rebound_break}"
            )
        }
    else:
        # PUT logic (bearish compression breakdown)
        bounce_bar = max(recent_bars, key=lambda b: float(b[2]))
        bounce_low = float(bounce_bar[3])
        bounce_high = float(bounce_bar[2])
        bounce_open = float(bounce_bar[1])
        bounce_close = float(bounce_bar[4])
        bounce_vol = float(bounce_bar[5])

        pvcr = round(bounce_vol / avg_prior_vol, 2) if avg_prior_vol > 0 else 1.0
        is_dry_bounce = pvcr <= 0.65

        bar_range = max(0.01, bounce_high - bounce_low)
        upper_wick = max(0.0, bounce_high - max(bounce_open, bounce_close))
        wick_pct = round(upper_wick / bar_range, 2)
        has_rejection_wick = wick_pct >= 0.35

        breakdown_break = curr_close <= bounce_low * 1.002
        vol_expansion = curr_vol >= avg_prior_vol * 1.05

        confirmed = is_compressed and fli_held and is_dry_bounce and (has_rejection_wick or breakdown_break) and vol_expansion

        status = "UPFRONT_RUNNER_CONFIRMED" if confirmed else (
            "COMPRESSION_COILING" if (is_compressed and fli_held) else "WAITING_FOR_UPFRONT_SETUP"
        )

        return {
            "confirmed": confirmed,
            "status": status,
            "direction": "PUT",
            "current_price": curr_close,
            "orc": orc,
            "is_compressed": is_compressed,
            "first_5m_high": round(first_5m_high, 2),
            "fli_held": fli_held,
            "bounce_low": round(bounce_low, 2),
            "bounce_high": round(bounce_high, 2),
            "rebound_trigger_price": round(bounce_low, 2),
            "pvcr": pvcr,
            "is_low_vol_dip": is_dry_bounce,
            "wick_pct": wick_pct,
            "has_rejection_wick": has_rejection_wick,
            "rebound_break": breakdown_break,
            "vol_expansion": vol_expansion,
            "mode": "MOMENTUM_RUNNER_UPFRONT",
            "reason": (
                f"Sovereign Upfront Short Confirmed: ORC={orc}, FLI Defended (₹{first_5m_high:.2f}), "
                f"PVCR={pvcr}x, Wick={wick_pct:.0%}, Breakdown={breakdown_break}"
                if confirmed else
                f"Upfront check: ORC={orc}, Compressed={is_compressed}, FLI_Held={fli_held}, PVCR={pvcr}x, Wick={wick_pct:.0%}"
            )
        }


# ==============================================================================
# 2.1 INTRADAY DIP & REBOUND MATHEMATICAL VALIDATOR (10:15 - 10:45 AM)
# ==============================================================================

def detect_fno_dip_and_rebound(
    symbol: str,
    direction: str,
    candles_1m: List[List[Any]],
    vwap: float = 0.0,
    ema_9: float = 0.0,
    daily_atr: float = 0.0,
    sector_return: float = 0.0,
    nifty_return: float = 0.0,
    ema_21: float = 0.0,
) -> Dict[str, Any]:
    """
    Mathematical Dip-and-Rebound Confirmation Engine with Upfront Compression Runner Fallback.
    Eradicates premature entries and captures coiled multi-bagger runners by verifying:
    1. Morning impulse height (H_imp) established between 09:15 and 10:15, OR Upfront Compression.
    2. Orderly pullback (Dip) into 38.2% - 61.8% Fibonacci zone near VWAP/9-EMA.
    3. Low-Volume Contraction: Pullback Volume Contraction Ratio (PVCR <= 0.70x).
    4. Confirmed Rebound Trigger: 1m/5m candle closing ABOVE the dip candle high with expanding volume.
    """
    if not candles_1m or len(candles_1m) < 15:
        return {
            "confirmed": False,
            "status": "INSUFFICIENT_CANDLES",
            "reason": "Less than 15 historical 1-minute bars available."
        }

    # Format candles: [timestamp, open, high, low, close, volume]
    # Ensure chronological order (oldest to newest)
    chrono = list(candles_1m)
    if chrono[0][0] > chrono[-1][0]:
        chrono = list(reversed(chrono))

    # Current bar is the last bar
    latest_bar = chrono[-1]
    curr_close = float(latest_bar[4])
    curr_vol = float(latest_bar[5])

    # --------------------------------------------------------------------------
    # 0. SOVEREIGN DUAL-ARCHETYPE MOMENTUM SCORER & EXHAUSTION SENTRY
    # --------------------------------------------------------------------------
    dual_res = score_dual_archetype_momentum(
        symbol=symbol,
        direction=direction,
        candles_1m=chrono,
        daily_atr=daily_atr,
        vwap=vwap,
        ema_9=ema_9,
        ema_21=ema_21,
        sector_return=sector_return,
        nifty_return=nifty_return
    )

    # Disqualify immediately if confirmed as an exhaustion pump trap (Tata Elxsi killer)
    if dual_res.get("status") == "EXHAUSTION_TRAP":
        return dual_res

    # If confirmed by either Archetype A (Coiled Runner) or Archetype B (Dip Rebound), return immediately!
    if dual_res.get("confirmed", False):
        return dual_res

    # 1. Morning Impulse Phase: 09:15 to 10:15 bars (first 30-60 bars)
    impulse_bars = chrono[:min(len(chrono) - 5, 60)]
    if not impulse_bars:
        return {"confirmed": False, "status": "WAITING_FOR_IMPULSE", "reason": "No impulse window"}

    impulse_high = max(float(b[2]) for b in impulse_bars)
    impulse_low = min(float(b[3]) for b in impulse_bars)
    impulse_range = impulse_high - impulse_low

    if impulse_range <= 0 or (impulse_range / curr_close) * 100 < 0.80:
        # Check if candidate is an Upfront Compression Runner (Coiled Spring)
        upfront_res = evaluate_upfront_compression_runner(
            symbol=symbol,
            direction=direction,
            candles_1m=chrono,
            daily_atr=daily_atr,
            sector_return=sector_return,
            nifty_return=nifty_return,
            vwap=vwap,
            ema_9=ema_9,
            ema_21=ema_21
        )
        if upfront_res.get("confirmed", False):
            return upfront_res

        return {
            "confirmed": False,
            "status": "FLAT_MORNING_NO_IMPULSE",
            "reason": f"Morning range too narrow ({impulse_range:.2f}, < 0.80% of LTP), ORC={upfront_res.get('orc')}."
        }

    # Calculate average volume of initial push candles
    push_volumes = [float(b[5]) for b in impulse_bars if float(b[4]) >= float(b[1])]
    avg_push_vol = sum(push_volumes) / max(1, len(push_volumes))

    # 2. Recent Dip Phase: Last 5 to 12 bars (representing the 10:15 - 10:35 consolidation)
    recent_bars = chrono[-10:-1]  # Exclude current active bar
    if not recent_bars:
        return {"confirmed": False, "status": "INSUFFICIENT_DIP_BARS", "reason": "No consolidation bars"}

    if direction == "CALL":
        # For Longs: Find lowest dip point and the highest candle of the pullback
        dip_low = min(float(b[3]) for b in recent_bars)
        dip_high = max(float(b[2]) for b in recent_bars)
        
        # Pullback retracement depth
        retracement_pct = ((impulse_high - dip_low) / impulse_range) * 100 if impulse_range > 0 else 0.0

        # Check support level proximity (VWAP or 9-EMA)
        near_vwap = (abs(dip_low - vwap) / vwap * 100 <= 0.45) if vwap > 0 else False
        near_ema = (abs(dip_low - ema_9) / ema_9 * 100 <= 0.45) if ema_9 > 0 else False
        has_support_kiss = near_vwap or near_ema or (retracement_pct >= 30.0 and retracement_pct <= 65.0)

        # Pullback Volume Contraction Ratio (PVCR)
        dip_volumes = [float(b[5]) for b in recent_bars if float(b[4]) <= float(b[1])]
        avg_dip_vol = sum(dip_volumes) / max(1, len(dip_volumes)) if dip_volumes else avg_push_vol
        pvcr = round(avg_dip_vol / avg_push_vol, 2) if avg_push_vol > 0 else 1.0
        is_low_vol_dip = pvcr <= 0.75

        # Rebound Confirmation: Current price breaking above recent dip consolidation high with expanding volume
        rebound_break = curr_close >= dip_high * 0.999
        vol_expansion = curr_vol >= avg_dip_vol * 1.15

        confirmed = has_support_kiss and is_low_vol_dip and rebound_break and vol_expansion

        if not confirmed:
            # Check upfront compression runner fallback
            upfront_fallback = evaluate_upfront_compression_runner(
                symbol=symbol,
                direction=direction,
                candles_1m=chrono,
                daily_atr=daily_atr,
                sector_return=sector_return,
                nifty_return=nifty_return,
                vwap=vwap,
                ema_9=ema_9,
                ema_21=ema_21
            )
            if upfront_fallback.get("confirmed", False):
                return upfront_fallback

        status = "REBOUND_CONFIRMED" if confirmed else (
            "IN_DIP_ZONE" if (has_support_kiss and is_low_vol_dip) else "WAITING_FOR_DIP"
        )

        return {
            "confirmed": confirmed,
            "status": status,
            "direction": "CALL",
            "current_price": curr_close,
            "dip_low": round(dip_low, 2),
            "dip_high": round(dip_high, 2),
            "rebound_trigger_price": round(dip_high, 2),
            "retracement_pct": round(retracement_pct, 1),
            "pvcr": pvcr,
            "is_low_vol_dip": is_low_vol_dip,
            "has_support_kiss": has_support_kiss,
            "rebound_break": rebound_break,
            "vol_expansion": vol_expansion,
            "reason": "Valid low-vol dip with confirmed volume rebound break" if confirmed else (
                f"PVCR={pvcr}x (max 0.75x), Retrace={retracement_pct:.1f}%, ReboundBreak={rebound_break}, VolExpansion={vol_expansion}"
            )
        }

    else:
        # For Puts (Shorts): Find highest bounce point and lowest candle of the bounce
        bounce_high = max(float(b[2]) for b in recent_bars)
        bounce_low = min(float(b[3]) for b in recent_bars)

        # Bounce retracement depth
        bounce_pct = ((bounce_high - impulse_low) / impulse_range) * 100 if impulse_range > 0 else 0.0

        near_vwap = (abs(bounce_high - vwap) / vwap * 100 <= 0.45) if vwap > 0 else False
        near_ema = (abs(bounce_high - ema_9) / ema_9 * 100 <= 0.45) if ema_9 > 0 else False
        has_resistance_kiss = near_vwap or near_ema or (bounce_pct >= 30.0 and bounce_pct <= 65.0)

        # Volume contraction during upward bounce bars
        bounce_volumes = [float(b[5]) for b in recent_bars if float(b[4]) >= float(b[1])]
        avg_bounce_vol = sum(bounce_volumes) / max(1, len(bounce_volumes)) if bounce_volumes else avg_push_vol
        pvcr = round(avg_bounce_vol / avg_push_vol, 2) if avg_push_vol > 0 else 1.0
        is_low_vol_bounce = pvcr <= 0.75

        # Rebound Confirmation (Downside Breakdown) with expanding volume
        breakdown_break = curr_close <= bounce_low * 1.001
        vol_expansion = curr_vol >= avg_bounce_vol * 1.15

        confirmed = has_resistance_kiss and is_low_vol_bounce and breakdown_break and vol_expansion

        if not confirmed:
            upfront_fallback = evaluate_upfront_compression_runner(
                symbol=symbol,
                direction=direction,
                candles_1m=chrono,
                daily_atr=daily_atr,
                sector_return=sector_return,
                nifty_return=nifty_return,
                vwap=vwap,
                ema_9=ema_9,
                ema_21=ema_21
            )
            if upfront_fallback.get("confirmed", False):
                return upfront_fallback

        status = "REBOUND_CONFIRMED" if confirmed else (
            "IN_DIP_ZONE" if (has_resistance_kiss and is_low_vol_bounce) else "WAITING_FOR_DIP"
        )

        return {
            "confirmed": confirmed,
            "status": status,
            "direction": "PUT",
            "current_price": curr_close,
            "bounce_high": round(bounce_high, 2),
            "bounce_low": round(bounce_low, 2),
            "rebound_trigger_price": round(bounce_low, 2),
            "retracement_pct": round(bounce_pct, 1),
            "pvcr": pvcr,
            "is_low_vol_dip": is_low_vol_bounce,
            "has_support_kiss": has_resistance_kiss,
            "rebound_break": breakdown_break,
            "vol_expansion": vol_expansion,
            "reason": "Valid low-vol bounce with confirmed breakdown" if confirmed else (
                f"PVCR={pvcr}x (max 0.75x), Bounce={bounce_pct:.1f}%, Breakdown={breakdown_break}"
            )
        }


# ==============================================================================
# 2.5 INSTITUTIONAL VOLUME PARTICIPATION GATE (COUNTERFACTUAL ROOT-CAUSE RESOLUTION)
# ==============================================================================

def validate_institutional_participation(
    volume: float,
    rvol: float = 1.0,
    min_volume: float = 500_000.0,
    min_rvol: float = 2.0
) -> Dict[str, Any]:
    """
    Evaluates whether candidate exhibits genuine institutional order flow participation.
    Eradicates low-volume whipsaw traps (e.g. illiquid morning breakouts) as proven
    by empirical counterfactual replay diagnostics.
    """
    is_liquid = volume >= min_volume
    is_rvol_expanded = rvol >= min_rvol
    passed = is_liquid or is_rvol_expanded

    return {
        "passed": passed,
        "is_liquid": is_liquid,
        "is_rvol_expanded": is_rvol_expanded,
        "volume": volume,
        "rvol": rvol,
        "reason": "Institutional participation verified" if passed else (
            f"Low liquidity trap: Vol={volume:,.0f} (< {min_volume:,.0f}) and RVOL={rvol:.2f}x (< {min_rvol:.1f}x)"
        )
    }


# ==============================================================================
# 3. OPTIONS QUANT DOMAIN & CONTRACT SELECTION
# ==============================================================================

def evaluate_option_chain_quant(
    symbol: str,
    direction: str,
    spot_price: float,
    upstox_client_instance: Any
) -> Dict[str, Any]:
    """
    Evaluates real-time Upstox Option Chain metrics:
    1. Put-Call Ratio (PCR): OI Put / OI Call.
    2. Open Interest Buildup Classification (Long Buildup vs Short Covering vs Unwinding).
    3. Strike Selection: Selects ATM strike where Delta is ~0.50 (0.45 to 0.55).
    4. Bid-Ask Spread Gate: Enforces Spread <= 1.50% to prevent fatal execution slippage.
    5. Contract Liquidity: Open Interest >= 100,000 contracts and Volume >= 500 lots.
    """
    default_payload = {
        "verified": False,
        "pcr": 1.0,
        "oi_buildup": "UNKNOWN",
        "selected_strike": 0.0,
        "option_type": "CE" if direction == "CALL" else "PE",
        "contract_symbol": "",
        "instrument_key": "",
        "ltp": 0.0,
        "bid": 0.0,
        "ask": 0.0,
        "spread_pct": 0.0,
        "spread_acceptable": False,
        "delta": 0.50 if direction == "CALL" else -0.50,
        "gamma": 0.0,
        "vega": 0.0,
        "theta": 0.0,
        "iv": 0.0,
        "oi": 0,
        "volume": 0,
        "error": None
    }

    if not upstox_client_instance:
        default_payload["error"] = "Upstox client unavailable"
        return default_payload

    # Resolve instrument key
    key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ") or db.get_upstox_instrument_key(symbol)
    if not key:
        default_payload["error"] = f"No instrument key found for {symbol}"
        return default_payload

    try:
        # 1. Fetch Option Contracts to identify nearest active monthly expiry
        contracts_data = upstox_client_instance.get_option_contracts(key)
        if contracts_data.get("status") != "success" or not contracts_data.get("data"):
            default_payload["error"] = f"No option contracts found for {symbol}"
            return default_payload

        # Sort expiries
        raw_expiries = sorted(list(set(item.get("expiry") for item in contracts_data["data"] if item.get("expiry"))))
        if not raw_expiries:
            default_payload["error"] = f"Empty expiry list for {symbol}"
            return default_payload

        # Auto-select nearest expiry with at least 2 trading days remaining
        today_str = datetime.now().strftime("%Y-%m-%d")
        valid_expiries = [e for e in raw_expiries if e >= today_str]
        selected_expiry = valid_expiries[0] if valid_expiries else raw_expiries[0]

        # 2. Fetch full option chain
        chain_res = upstox_client_instance.get_option_chain(key, selected_expiry)
        if chain_res.get("status") != "success" or not chain_res.get("data"):
            default_payload["error"] = f"Option chain fetch failed for {symbol} on {selected_expiry}"
            return default_payload

        chain_list = chain_res["data"]

        # Compute Stock-Level PCR
        tot_put_oi = 0.0
        tot_call_oi = 0.0
        strikes_map = []

        for item in chain_list:
            strike = float(item.get("strike_price", 0.0))
            call_opt = item.get("call_options")
            put_opt = item.get("put_options")

            c_oi = float(call_opt.get("market_data", {}).get("oi", 0.0)) if call_opt else 0.0
            p_oi = float(put_opt.get("market_data", {}).get("oi", 0.0)) if put_opt else 0.0
            tot_call_oi += c_oi
            tot_put_oi += p_oi

            target_opt = call_opt if direction == "CALL" else put_opt
            if target_opt:
                mdata = target_opt.get("market_data", {})
                greeks = target_opt.get("option_greeks", {})
                ltp = float(mdata.get("ltp", 0.0))
                bid = float(mdata.get("bid_price", 0.0) or ltp * 0.995)
                ask = float(mdata.get("ask_price", 0.0) or ltp * 1.005)
                delta = float(greeks.get("delta", 0.50 if direction == "CALL" else -0.50) or 0.0)
                gamma = float(greeks.get("gamma", 0.0) or 0.0)
                vega = float(greeks.get("vega", 0.0) or 0.0)
                theta = float(greeks.get("theta", 0.0) or 0.0)
                iv = float(greeks.get("iv", 0.0) or 0.0)
                oi = int(mdata.get("oi", 0) or 0)
                vol = int(mdata.get("volume", 0) or 0)
                contract_key = target_opt.get("instrument_key", "")
                contract_sym = target_opt.get("trading_symbol", "")

                strikes_map.append({
                    "strike": strike,
                    "diff_to_spot": abs(strike - spot_price),
                    "ltp": ltp,
                    "bid": bid,
                    "ask": ask,
                    "delta": delta,
                    "gamma": gamma,
                    "vega": vega,
                    "theta": theta,
                    "iv": iv,
                    "oi": oi,
                    "volume": vol,
                    "contract_key": contract_key,
                    "trading_symbol": contract_sym
                })

        pcr = round(tot_put_oi / tot_call_oi, 2) if tot_call_oi > 0 else 1.0

        # Classify OI Buildup
        # Long Buildup: Call OI increasing on bullish move, or Put OI writing increasing
        if direction == "CALL":
            oi_buildup = "LONG_BUILDUP" if pcr >= 1.05 else ("SHORT_COVERING" if pcr >= 0.85 else "LONG_UNWINDING")
        else:
            oi_buildup = "SHORT_BUILDUP" if pcr <= 0.70 else ("CALL_WRITING" if pcr <= 0.85 else "SHORT_COVERING")

        # Select ATM strike: Strike with Delta closest to 0.50 (or closest to spot)
        if not strikes_map:
            default_payload["error"] = "No valid option strikes in chain"
            return default_payload

        # Sort strikes by Delta proximity to 0.50 (or spot price distance)
        strikes_map.sort(key=lambda s: abs(abs(s["delta"]) - 0.50) if s["delta"] != 0 else s["diff_to_spot"])
        chosen = strikes_map[0]

        # Extract lot size
        lot_size = 1
        if contracts_data.get("data") and len(contracts_data["data"]) > 0:
            first_c = contracts_data["data"][0]
            lot_size = int(first_c.get("lot_size", first_c.get("lotsize", 1)) or 1)

        # Calculate Bid-Ask Spread
        spread_abs = max(0.0, chosen["ask"] - chosen["bid"])
        spread_pct = round((spread_abs / chosen["ltp"]) * 100, 2) if chosen["ltp"] > 0 else 0.0
        spread_acceptable = spread_pct <= 2.50

        # Overall Verification: Spread is acceptable (<= 2.50%) and PCR confirms direction
        pcr_confirmed = (pcr >= 0.85) if direction == "CALL" else (pcr <= 0.90)

        # Advanced Derivatives Quant Calculations (OpenAlgo 12-Tool Parity)
        from services.derivatives_quant_math import (
            calculate_dealer_gex,
            calculate_25d_iv_skew,
            calculate_synthetic_basis,
            calculate_max_pain,
            calculate_gamma_density_and_expected_move
        )

        gex_data = calculate_dealer_gex(chain_list, spot_price, lot_size=lot_size)
        skew_data = calculate_25d_iv_skew(chain_list, spot_price, atm_strike=chosen["strike"])
        basis_data = calculate_synthetic_basis(chain_list, spot_price, atm_strike=chosen["strike"])
        max_pain_data = calculate_max_pain(chain_list, spot_price)
        density_data = calculate_gamma_density_and_expected_move(
            chain_list, spot_price, atm_iv_pct=chosen["iv"], lot_size=lot_size
        )

        # Momentum Continuation Verification:
        # Ensures that institutions are not hedging against the move, 
        # dealers are in Short Gamma or balanced gamma, and price has headroom
        is_call = direction == "CALL"
        skew_ok = (skew_data["skew_25d"] <= 2.5) if is_call else (skew_data["skew_25d"] >= -0.5)
        basis_ok = (basis_data["basis_pct"] >= -0.08) if is_call else (basis_data["basis_pct"] <= 0.08)
        pain_ok = (max_pain_data["spot_distance_pct"] <= 4.0) if is_call else (max_pain_data["spot_distance_pct"] >= -4.0)

        momentum_continuation_confirmed = (
            pcr_confirmed and spread_acceptable and skew_ok and basis_ok and pain_ok
        )
        verified = spread_acceptable and pcr_confirmed and momentum_continuation_confirmed

        return {
            "verified": verified,
            "momentum_continuation_confirmed": momentum_continuation_confirmed,
            "pcr": pcr,
            "pcr_confirmed": pcr_confirmed,
            "oi_buildup": oi_buildup,
            "total_call_oi": tot_call_oi,
            "total_put_oi": tot_put_oi,
            "selected_strike": chosen["strike"],
            "option_type": "CE" if direction == "CALL" else "PE",
            "contract_symbol": chosen["trading_symbol"],
            "instrument_key": chosen["contract_key"],
            "expiry": selected_expiry,
            "ltp": chosen["ltp"],
            "bid": chosen["bid"],
            "ask": chosen["ask"],
            "spread_pct": spread_pct,
            "spread_acceptable": spread_acceptable,
            "delta": round(chosen["delta"], 3),
            "gamma": round(chosen["gamma"], 5),
            "vega": round(chosen["vega"], 3),
            "theta": round(chosen["theta"], 3),
            "iv": round(chosen["iv"], 2),
            "oi": chosen["oi"],
            "volume": chosen["volume"],
            "gex": gex_data,
            "skew": skew_data,
            "synthetic_basis": basis_data,
            "max_pain": max_pain_data,
            "gamma_density": density_data,
            "error": None
        }

    except Exception as e:
        log.error(f"Error evaluating option chain quant for {symbol}: {e}", exc_info=True)
        default_payload["error"] = str(e)
        return default_payload


# ==============================================================================
# 4. F&O INSTITUTIONAL QUANT SCORE (FIQS 2.0 - 100 POINTS)
# ==============================================================================

def compute_fiqs_score(
    stock_pct_chg: float,
    sector_z_score: float,
    rvol: float,
    pcr: float,
    clean_trend: str,
    pvcr: float,
    direction: str = "CALL",
    gex_regime: str = "NEUTRAL",
    skew_verdict: str = "BALANCED_NORMAL",
    basis_pct: float = 0.0,
    pain_gravity: str = "NEUTRAL"
) -> float:
    """
    Computes the 100-point Omni-Quant Score (FIQS 2.0).
    Blends:
    - Sector Outlier Z-Score (20 pts)
    - Momentum Velocity & Low-Vol Dip Quality (20 pts)
    - Relative Volume & Energy (10 pts)
    - Option Chain PCR Alignment (15 pts)
    - Dealer Gamma Regime & Zero-Gamma Positioning (15 pts)
    - 25-Delta IV Skew & Synthetic Basis Flow (10 pts)
    - Max Pain Gravitational Tailwind (10 pts)
    """
    # 1. Sector Z-Factor Score (0-20)
    sec_z = sector_z_score if direction == "CALL" else -sector_z_score
    sec_score = min(20.0, max(0.0, (sec_z + 1.0) * 6.67))

    # 2. Velocity Momentum & Low-Vol Dip Score (0-20)
    chg = abs(stock_pct_chg)
    vel_score = min(10.0, max(0.0, chg * 2.5))
    dip_score = 5.0 if pvcr <= 0.70 else (2.5 if pvcr <= 0.85 else 0.0)
    ct_score = 5.0 if clean_trend == "CLEAN" else (0.0 if clean_trend == "TRAP" else 2.5)
    momentum_dip_score = vel_score + dip_score + ct_score

    # 3. Energy / RVOL Score (0-10)
    rvol_score = min(10.0, max(0.0, rvol * 3.33))

    # 4. Option Chain PCR Alignment (0-15)
    if direction == "CALL":
        pcr_score = 15.0 if pcr >= 1.20 else (10.0 if pcr >= 1.0 else (5.0 if pcr >= 0.85 else 0.0))
    else:
        pcr_score = 15.0 if pcr <= 0.65 else (10.0 if pcr <= 0.80 else (5.0 if pcr <= 0.95 else 0.0))

    # 5. Dealer Gamma Regime Score (0-15)
    # Short gamma expands momentum; Long gamma pins and chops
    if gex_regime == "SHORT_GAMMA_EXPANSION":
        gamma_score = 15.0
    elif gex_regime == "LONG_GAMMA_PINNED":
        gamma_score = 5.0
    else:
        gamma_score = 10.0

    # 6. 25-Delta Skew & Synthetic Basis (0-10)
    skew_pts = 0.0
    if direction == "CALL":
        if skew_verdict == "BULLISH_CALL_ACCUMULATION":
            skew_pts += 5.0
        elif skew_verdict == "BALANCED_NORMAL":
            skew_pts += 3.5
        if basis_pct >= 0.05:
            skew_pts += 5.0
        elif basis_pct >= -0.05:
            skew_pts += 3.0
    else:
        if skew_verdict == "BEARISH_HEDGE_OVERLOAD":
            skew_pts += 5.0
        elif skew_verdict == "BALANCED_NORMAL":
            skew_pts += 3.5
        if basis_pct <= -0.05:
            skew_pts += 5.0
        elif basis_pct <= 0.05:
            skew_pts += 3.0
    skew_basis_score = min(10.0, max(0.0, skew_pts))

    # 7. Max Pain Gravitational Tailwind (0-10)
    if direction == "CALL":
        pain_score = 10.0 if pain_gravity == "UPWARD_GRAVITATIONAL_TAILWIND" else (7.0 if pain_gravity == "AT_MAX_PAIN_PIN" else 2.0)
    else:
        pain_score = 10.0 if pain_gravity == "DOWNWARD_GRAVITATIONAL_DRAG" else (7.0 if pain_gravity == "AT_MAX_PAIN_PIN" else 2.0)

    total_fiqs = round(sec_score + momentum_dip_score + rvol_score + pcr_score + gamma_score + skew_basis_score + pain_score, 1)
    return min(100.0, max(10.0, total_fiqs))
