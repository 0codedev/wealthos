"""
Derivatives Quantitative Mathematics Engine (WealthOS Alpha Engine 2.0)

Implements institutional derivatives quantitative mathematics inspired by OpenAlgo's 12 tools:
1. Black-76 Model & Greeks (Delta, Gamma, Theta, Vega, Implied Volatility solver)
2. Dealer Gamma Exposure (GEX): Net GEX, Call GEX, Put GEX, Zero Gamma Flip Point
3. 25-Delta IV Skew: Put IV vs Call IV spread (Crash Hedging vs Call Frenzy)
4. Synthetic Future Parity Basis: F* = K + CE - PE, Basis = F* - S
5. Max Pain & Pinning Gravity: Strike with minimal writer loss
6. Gamma Density & Expected Move Bands: 1-sigma & 2-sigma convexity envelopes
"""

import math
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
from scipy.stats import norm
from scipy.optimize import brentq

# Constants
DAYS_PER_YEAR = 365.0
INTRADAY_T_YEARS = 1.0 / DAYS_PER_YEAR
DEFAULT_RISK_FREE_RATE = 0.07  # 7.0% RBI benchmark


# ==============================================================================
# 1. BLACK-76 CLOSED-FORM GREEKS & IMPLIED VOLATILITY
# ==============================================================================

def black76_price_and_greeks(
    F: float,
    K: float,
    t: float,
    r: float,
    sigma: float,
    option_type: str = "CE"
) -> Dict[str, float]:
    """
    Computes exact Black-76 price and Greeks for options on forwards/futures.
    Standard model for Indian NSE F&O (index and stock options).
    """
    if F <= 0 or K <= 0 or t <= 0 or sigma <= 0:
        return {
            "price": max(0.0, F - K) if option_type.upper() in ("CE", "CALL") else max(0.0, K - F),
            "delta": 1.0 if (option_type.upper() in ("CE", "CALL") and F > K) else 0.0,
            "gamma": 0.0,
            "theta": 0.0,
            "vega": 0.0
        }

    opt_type = option_type.upper()
    is_call = opt_type in ("CE", "CALL")
    sqrt_t = math.sqrt(t)
    df = math.exp(-r * t)

    d1 = (math.log(F / K) + 0.5 * (sigma ** 2) * t) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t

    n_d1 = norm.cdf(d1)
    n_d2 = norm.cdf(d2)
    n_prime_d1 = norm.pdf(d1)

    if is_call:
        price = df * (F * n_d1 - K * n_d2)
        delta = df * n_d1
        theta = -(df * F * n_prime_d1 * sigma) / (2.0 * sqrt_t) - r * price
    else:
        n_minus_d1 = norm.cdf(-d1)
        n_minus_d2 = norm.cdf(-d2)
        price = df * (K * n_minus_d2 - F * n_minus_d1)
        delta = -df * n_minus_d1
        theta = -(df * F * n_prime_d1 * sigma) / (2.0 * sqrt_t) + r * df * (K * n_minus_d2 - F * n_minus_d1)

    gamma = (df * n_prime_d1) / (F * sigma * sqrt_t) if (F * sigma * sqrt_t) > 0 else 0.0
    vega = (df * F * sqrt_t * n_prime_d1) / 100.0  # per 1% vol change

    return {
        "price": max(0.0, float(price)),
        "delta": float(delta),
        "gamma": float(gamma),
        "theta": float(theta / DAYS_PER_YEAR),  # 1-day theta decay
        "vega": float(vega)
    }


def solve_implied_volatility(
    market_price: float,
    F: float,
    K: float,
    t: float,
    r: float,
    option_type: str = "CE"
) -> float:
    """
    Numerically inverts Black-76 formula using Brent's method to compute exact IV.
    """
    if market_price <= 0 or F <= 0 or K <= 0 or t <= 0:
        return 0.0

    intrinsic = max(0.0, F - K) if option_type.upper() in ("CE", "CALL") else max(0.0, K - F)
    if market_price < intrinsic * math.exp(-r * t):
        return 0.0

    def objective(sigma):
        res = black76_price_and_greeks(F, K, t, r, sigma, option_type)
        return res["price"] - market_price

    try:
        iv = brentq(objective, 1e-4, 5.0, maxiter=100, xtol=1e-5)
        return float(iv)
    except Exception:
        # Fallback approximation
        return 0.20


# ==============================================================================
# 2. DEALER GAMMA EXPOSURE (GEX) & ZERO-GAMMA FLIP ENGINE
# ==============================================================================

def calculate_dealer_gex(
    chain_list: List[Dict[str, Any]],
    spot_price: float,
    lot_size: int = 1
) -> Dict[str, Any]:
    """
    Calculates strike-wise and aggregate Dealer Gamma Exposure (GEX).
    
    GEX_i = Gamma_i * OI_i * LotSize
    Net GEX = Call GEX - Put GEX
    
    Regimes:
    - Net GEX > 0 (Positive Gamma): Dealers buy dips & sell rallies -> Volatility dampens, breakouts chop.
    - Net GEX < 0 (Short Gamma): Dealers sell dips & buy rallies -> Volatility expands, explosive trends!
    - Zero Gamma Level: The inflection strike where dealer hedging switches direction.
    """
    if not chain_list or spot_price <= 0:
        return {
            "net_gex": 0.0,
            "total_call_gex": 0.0,
            "total_put_gex": 0.0,
            "zero_gamma_strike": spot_price,
            "regime": "NEUTRAL",
            "is_short_gamma": False,
            "strikes_gex": []
        }

    strikes_gex = []
    total_call_gex = 0.0
    total_put_gex = 0.0

    # Sort chain by strike ascending
    sorted_chain = sorted(
        chain_list,
        key=lambda x: float(x.get("strike_price", 0.0))
    )

    for item in sorted_chain:
        strike = float(item.get("strike_price", 0.0))
        if strike <= 0:
            continue

        c_opt = item.get("call_options", {}) or {}
        p_opt = item.get("put_options", {}) or {}

        c_mdata = c_opt.get("market_data", {}) or {}
        p_mdata = p_opt.get("market_data", {}) or {}
        c_greeks = c_opt.get("option_greeks", {}) or {}
        p_greeks = p_opt.get("option_greeks", {}) or {}

        c_oi = float(c_mdata.get("oi", 0.0) or 0.0)
        p_oi = float(p_mdata.get("oi", 0.0) or 0.0)

        # Gamma from Upstox or fallback to 0.0
        c_gamma = float(c_greeks.get("gamma", 0.0) or 0.0)
        p_gamma = float(p_greeks.get("gamma", 0.0) or 0.0)

        # Standard GEX formula: Gamma * OI * LotSize * Spot
        # Expressed in Millions / Crores of hedging currency units
        c_gex = (c_gamma * c_oi * lot_size * spot_price) / 1e5
        p_gex = (p_gamma * p_oi * lot_size * spot_price) / 1e5
        net_strike_gex = c_gex - p_gex

        total_call_gex += c_gex
        total_put_gex += p_gex

        strikes_gex.append({
            "strike": strike,
            "call_oi": c_oi,
            "put_oi": p_oi,
            "call_gex": round(c_gex, 2),
            "put_gex": round(p_gex, 2),
            "net_gex": round(net_strike_gex, 2)
        })

    net_gex = total_call_gex - total_put_gex

    # Calculate Zero Gamma Flip Point
    # Where cumulative net GEX crosses 0 from low strike to high strike
    zero_gamma_strike = spot_price
    cum_gex = 0.0
    for i, s in enumerate(strikes_gex):
        prev_cum = cum_gex
        cum_gex += s["net_gex"]
        if i > 0 and ((prev_cum < 0 and cum_gex >= 0) or (prev_cum >= 0 and cum_gex < 0)):
            zero_gamma_strike = s["strike"]
            break

    # If no flip found, select strike closest to zero net GEX
    if zero_gamma_strike == spot_price and strikes_gex:
        zero_gamma_strike = min(strikes_gex, key=lambda s: abs(s["net_gex"]))["strike"]

    is_short_gamma = net_gex < 0 or (spot_price < zero_gamma_strike)
    regime = "SHORT_GAMMA_EXPANSION" if is_short_gamma else "LONG_GAMMA_PINNED"

    return {
        "net_gex": round(net_gex, 2),
        "total_call_gex": round(total_call_gex, 2),
        "total_put_gex": round(total_put_gex, 2),
        "zero_gamma_strike": zero_gamma_strike,
        "regime": regime,
        "is_short_gamma": is_short_gamma,
        "strikes_gex": strikes_gex
    }


# ==============================================================================
# 3. 25-DELTA IV SKEW (INSTITUTIONAL CRASH HEDGE VS CALL FRENZY)
# ==============================================================================

def calculate_25d_iv_skew(
    chain_list: List[Dict[str, Any]],
    spot_price: float,
    atm_strike: float
) -> Dict[str, Any]:
    """
    Computes the 25-Delta IV Skew = IV(25-Delta PE) - IV(25-Delta CE).
    Uses ~5% OTM distance as proxy for 25-Delta strike.
    
    Significance:
    - Skew <= 0: BULLISH CALL DEMAND (Institutions paying premium for calls, zero put fear).
    - 0 < Skew <= 2.5%: BALANCED NORMAL.
    - Skew > 2.5%: BEARISH HEDGING OVERLOAD (Institutions heavily hedging downside).
    """
    if not chain_list or spot_price <= 0:
        return {
            "skew_25d": 0.0,
            "call_25d_iv": 0.0,
            "put_25d_iv": 0.0,
            "atm_iv": 0.0,
            "skew_verdict": "NEUTRAL"
        }

    target_otm_dist = spot_price * 0.05
    target_pe_strike = spot_price - target_otm_dist
    target_ce_strike = spot_price + target_otm_dist

    # Extract all strikes with IV
    strikes_data = []
    for item in chain_list:
        strike = float(item.get("strike_price", 0.0))
        c_opt = item.get("call_options", {}) or {}
        p_opt = item.get("put_options", {}) or {}

        c_iv = float(c_opt.get("option_greeks", {}).get("iv", 0.0) or 0.0)
        p_iv = float(p_opt.get("option_greeks", {}).get("iv", 0.0) or 0.0)

        strikes_data.append({
            "strike": strike,
            "ce_iv": c_iv,
            "pe_iv": p_iv
        })

    if not strikes_data:
        return {
            "skew_25d": 0.0,
            "call_25d_iv": 0.0,
            "put_25d_iv": 0.0,
            "atm_iv": 0.0,
            "skew_verdict": "NEUTRAL"
        }

    # Find ATM IV
    atm_entry = min(strikes_data, key=lambda s: abs(s["strike"] - atm_strike))
    atm_iv = atm_entry["ce_iv"] if atm_entry["ce_iv"] > 0 else (atm_entry["pe_iv"] if atm_entry["pe_iv"] > 0 else 0.20)

    # Find 25d OTM PE
    pe_valid = [s for s in strikes_data if s["pe_iv"] > 0 and s["strike"] < spot_price]
    put_25d_entry = min(pe_valid, key=lambda s: abs(s["strike"] - target_pe_strike)) if pe_valid else atm_entry
    put_25d_iv = put_25d_entry["pe_iv"] if put_25d_entry["pe_iv"] > 0 else atm_iv

    # Find 25d OTM CE
    ce_valid = [s for s in strikes_data if s["ce_iv"] > 0 and s["strike"] > spot_price]
    call_25d_entry = min(ce_valid, key=lambda s: abs(s["strike"] - target_ce_strike)) if ce_valid else atm_entry
    call_25d_iv = call_25d_entry["ce_iv"] if call_25d_entry["ce_iv"] > 0 else atm_iv

    # Skew in percentage points
    skew_25d = round((put_25d_iv - call_25d_iv) * 100.0, 2)

    if skew_25d <= 0.0:
        verdict = "BULLISH_CALL_ACCUMULATION"
    elif skew_25d <= 2.5:
        verdict = "BALANCED_NORMAL"
    else:
        verdict = "BEARISH_HEDGE_OVERLOAD"

    return {
        "skew_25d": skew_25d,
        "call_25d_iv": round(call_25d_iv * 100.0, 2),
        "put_25d_iv": round(put_25d_iv * 100.0, 2),
        "atm_iv": round(atm_iv * 100.0, 2),
        "skew_verdict": verdict
    }


# ==============================================================================
# 4. SYNTHETIC FUTURE PARITY BASIS (F* - S)
# ==============================================================================

def calculate_synthetic_basis(
    chain_list: List[Dict[str, Any]],
    spot_price: float,
    atm_strike: float
) -> Dict[str, Any]:
    """
    Computes Synthetic Future via Put-Call Parity:
    F* = K_ATM + CE_LTP - PE_LTP
    Basis = F* - Spot
    Basis% = ((F* - Spot) / Spot) * 100
    
    Significance:
    - Basis% > +0.10%: Institutional Synthetic Long (Calls trade at genuine cash premium).
    - Basis% < -0.10%: Institutional Synthetic Short (Calls trade at discount; cash move is a trap).
    """
    if not chain_list or spot_price <= 0:
        return {
            "synthetic_future": spot_price,
            "basis": 0.0,
            "basis_pct": 0.0,
            "verdict": "NEUTRAL"
        }

    # Find ATM strike
    atm_item = None
    min_diff = float("inf")
    for item in chain_list:
        strike = float(item.get("strike_price", 0.0))
        diff = abs(strike - atm_strike)
        if diff < min_diff:
            min_diff = diff
            atm_item = item

    if not atm_item:
        return {
            "synthetic_future": spot_price,
            "basis": 0.0,
            "basis_pct": 0.0,
            "verdict": "NEUTRAL"
        }

    c_opt = atm_item.get("call_options", {}) or {}
    p_opt = atm_item.get("put_options", {}) or {}

    c_ltp = float(c_opt.get("market_data", {}).get("ltp", 0.0) or 0.0)
    p_ltp = float(p_opt.get("market_data", {}).get("ltp", 0.0) or 0.0)

    if c_ltp <= 0 or p_ltp <= 0:
        return {
            "synthetic_future": spot_price,
            "basis": 0.0,
            "basis_pct": 0.0,
            "verdict": "NEUTRAL"
        }

    synth_future = round(atm_strike + c_ltp - p_ltp, 2)
    basis = round(synth_future - spot_price, 2)
    basis_pct = round((basis / spot_price) * 100.0, 3)

    if basis_pct >= 0.08:
        verdict = "INSTITUTIONAL_SYNTHETIC_LONG"
    elif basis_pct <= -0.08:
        verdict = "INSTITUTIONAL_SYNTHETIC_SHORT"
    else:
        verdict = "FAIR_VALUE_NEUTRAL"

    return {
        "synthetic_future": synth_future,
        "basis": basis,
        "basis_pct": basis_pct,
        "verdict": verdict
    }


# ==============================================================================
# 5. MAX PAIN & EXPIRATION PINNING GRAVITY
# ==============================================================================

def calculate_max_pain(
    chain_list: List[Dict[str, Any]],
    spot_price: float
) -> Dict[str, Any]:
    """
    Computes Max Pain strike:
    Min Total Pain = Sum((K_cand - K_i)*CE_OI for K_i < K_cand) + Sum((K_j - K_cand)*PE_OI for K_j > K_cand)
    """
    if not chain_list or spot_price <= 0:
        return {
            "max_pain_strike": spot_price,
            "spot_distance_pct": 0.0,
            "pain_gravity_verdict": "NEUTRAL"
        }

    # Extract valid strikes and OIs
    strikes_oi = []
    for item in chain_list:
        strike = float(item.get("strike_price", 0.0))
        if strike <= 0:
            continue
        c_oi = float((item.get("call_options", {}) or {}).get("market_data", {}).get("oi", 0.0) or 0.0)
        p_oi = float((item.get("put_options", {}) or {}).get("market_data", {}).get("oi", 0.0) or 0.0)
        strikes_oi.append({"strike": strike, "ce_oi": c_oi, "pe_oi": p_oi})

    if not strikes_oi:
        return {
            "max_pain_strike": spot_price,
            "spot_distance_pct": 0.0,
            "pain_gravity_verdict": "NEUTRAL"
        }

    min_pain = float("inf")
    max_pain_strike = spot_price

    for cand in strikes_oi:
        k_cand = cand["strike"]
        total_pain = 0.0
        for s in strikes_oi:
            k = s["strike"]
            if k_cand > k and s["ce_oi"] > 0:
                total_pain += (k_cand - k) * s["ce_oi"]
            elif k_cand < k and s["pe_oi"] > 0:
                total_pain += (k - k_cand) * s["pe_oi"]

        if total_pain < min_pain:
            min_pain = total_pain
            max_pain_strike = k_cand

    dist_pct = round(((max_pain_strike - spot_price) / spot_price) * 100.0, 2)
    if dist_pct > 1.0:
        gravity = "UPWARD_GRAVITATIONAL_TAILWIND"
    elif dist_pct < -1.0:
        gravity = "DOWNWARD_GRAVITATIONAL_DRAG"
    else:
        gravity = "AT_MAX_PAIN_PIN"

    return {
        "max_pain_strike": max_pain_strike,
        "spot_distance_pct": dist_pct,
        "pain_gravity_verdict": gravity
    }


# ==============================================================================
# 6. GAMMA DENSITY & 1-SIGMA / 2-SIGMA EXPECTED MOVE RUNWAY
# ==============================================================================

def calculate_gamma_density_and_expected_move(
    chain_list: List[Dict[str, Any]],
    spot_price: float,
    atm_iv_pct: float,
    lot_size: int = 1
) -> Dict[str, Any]:
    """
    Computes:
    - 1-Sigma daily expected move = Spot * (ATM_IV / 100) * sqrt(1 / 365)
    - 2-Sigma daily expected move = 2 * 1-Sigma
    - Major Gamma Walls (Peak Call Gamma and Peak Put Gamma strikes)
    """
    if spot_price <= 0:
        return {
            "sigma_1d": 0.0,
            "one_sigma_high": 0.0,
            "one_sigma_low": 0.0,
            "two_sigma_high": 0.0,
            "two_sigma_low": 0.0,
            "call_gamma_wall": 0.0,
            "put_gamma_wall": 0.0
        }

    iv_decimal = (atm_iv_pct / 100.0) if atm_iv_pct > 0 else 0.20
    sigma_1d = round(spot_price * iv_decimal * math.sqrt(INTRADAY_T_YEARS), 2)
    sigma_2d = round(2.0 * sigma_1d, 2)

    call_gamma_wall = spot_price
    put_gamma_wall = spot_price
    max_c_density = 0.0
    max_p_density = 0.0

    for item in chain_list:
        strike = float(item.get("strike_price", 0.0))
        if strike <= 0:
            continue
        c_opt = item.get("call_options", {}) or {}
        p_opt = item.get("put_options", {}) or {}

        c_gamma = float(c_opt.get("option_greeks", {}).get("gamma", 0.0) or 0.0)
        p_gamma = float(p_opt.get("option_greeks", {}).get("gamma", 0.0) or 0.0)

        c_oi = float(c_opt.get("market_data", {}).get("oi", 0.0) or 0.0)
        p_oi = float(p_opt.get("market_data", {}).get("oi", 0.0) or 0.0)

        c_density = c_gamma * c_oi * lot_size
        p_density = p_gamma * p_oi * lot_size

        if c_density > max_c_density:
            max_c_density = c_density
            call_gamma_wall = strike
        if p_density > max_p_density:
            max_p_density = p_density
            put_gamma_wall = strike

    return {
        "sigma_1d": sigma_1d,
        "one_sigma_high": round(spot_price + sigma_1d, 2),
        "one_sigma_low": round(spot_price - sigma_1d, 2),
        "two_sigma_high": round(spot_price + sigma_2d, 2),
        "two_sigma_low": round(spot_price - sigma_2d, 2),
        "call_gamma_wall": call_gamma_wall,
        "put_gamma_wall": put_gamma_wall
    }
