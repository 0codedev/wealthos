import os
import sys
import math
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any, Tuple
from fastapi import APIRouter, Query, HTTPException, Response, BackgroundTasks

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from logger import get_logger
from routers.shared import upstox_client, sanitize_symbol

log = get_logger("greeks_engine", tag="GREEKS_ENGINE")

router = APIRouter(prefix="/api/greeks", tags=["greeks"])

# Hardcoded default index lot sizes
LOT_SIZES = {
    "NIFTY": 75,
    "BANKNIFTY": 15,
    "FINNIFTY": 40,
    "MIDCPNIFTY": 75,
    "SENSEX": 10
}

def init_db():
    """Create the skew_history table in sqlite cache.db if not exists"""
    conn = None
    try:
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS skew_history (
                symbol TEXT,
                date TEXT,
                skew REAL,
                PRIMARY KEY (symbol, date)
            )
        """)
        conn.commit()
        log.info("skew_history database table checked/created successfully.")
    except Exception as e:
        log.error(f"Failed to create skew_history table: {e}")
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass

# Initialize table on import
init_db()

def get_underlying_key(symbol: str) -> str:
    """Resolve symbol to Upstox instrument key"""
    indices = {
        "NIFTY": "NSE_INDEX|Nifty 50",
        "BANKNIFTY": "NSE_INDEX|Nifty Bank",
        "FINNIFTY": "NSE_INDEX|Nifty Fin Service",
        "MIDCPNIFTY": "NSE_INDEX|Nifty Midcap 50",
        "NIFTYNXT50": "NSE_INDEX|Nifty Next 50",
        "INDIA VIX": "NSE_INDEX|India VIX",
        "SENSEX": "BSE_INDEX|SENSEX"
    }
    
    if symbol in indices:
        return indices[symbol]
        
    key = db.get_upstox_instrument_key(symbol, exchange="NSE_EQ")
    if not key:
        key = db.get_upstox_instrument_key(symbol)
    return key

@router.get("/gex")
def get_gex(symbol: str = Query(...), expiry: str = Query(None)):
    """Compute GEX and Zero-Gamma Level from live option chain"""
    symbol = sanitize_symbol(symbol)
    key = get_underlying_key(symbol)
    if not key:
        raise HTTPException(status_code=404, detail=f"Instrument key not found for {symbol}")
        
    try:
        # Resolve nearest expiry if not provided
        if not expiry:
            contracts_data = upstox_client.get_option_contracts(key)
            if contracts_data.get("status") == "success" and "data" in contracts_data:
                expiries = sorted([item.get("expiry") for item in contracts_data["data"] if item.get("expiry")])
                if expiries:
                    expiry = expiries[0]
                else:
                    raise HTTPException(status_code=404, detail=f"No active expiries found for {symbol}")
            else:
                raise HTTPException(status_code=500, detail="Failed to retrieve option contracts to find nearest expiry.")
                
        chain_data = upstox_client.get_option_chain(key, expiry)
        if chain_data.get("status") != "success" or "data" not in chain_data:
            raise HTTPException(status_code=500, detail=f"Failed to fetch option chain from Upstox: {chain_data.get('errors')}")
            
        strikes_list = chain_data["data"]
        lot_size = LOT_SIZES.get(symbol, 50)
        
        # Calculate Spot
        # Option chain response typically has underlying_value in the first strike's options or similar
        spot = 0.0
        if strikes_list:
            # Try to get spot price from one of the strikes
            first_strike = strikes_list[0]
            if "call_options" in first_strike and first_strike["call_options"]:
                spot = float(first_strike["call_options"].get("underlying_value", 0))
            elif "put_options" in first_strike and first_strike["put_options"]:
                spot = float(first_strike["put_options"].get("underlying_value", 0))
                
        if spot <= 0:
            # Fallback to LTP quote for underlying
            quotes = upstox_client.get_ltp_quotes([key])
            if quotes.get("status") == "success" and "data" in quotes and key in quotes["data"]:
                spot = float(quotes["data"][key].get("last_price", 0))
                
        if spot <= 0:
            spot = 100.0  # Safe fallback
            
        net_gex = 0.0
        strike_gex_map = []
        
        for item in strikes_list:
            strike_price = float(item.get("strike_price", 0))
            strike_gex = 0.0
            
            # CE options
            ce = item.get("call_options")
            if ce:
                oi = float(ce.get("oi", 0))
                greeks = ce.get("greeks") or {}
                gamma = float(greeks.get("gamma", 0))
                # Calls dealer short = negative gamma exposure
                strike_gex += -oi * gamma * lot_size * spot * spot * 0.01
                
            # PE options
            pe = item.get("put_options")
            if pe:
                oi = float(pe.get("oi", 0))
                greeks = pe.get("greeks") or {}
                gamma = float(greeks.get("gamma", 0))
                # Puts dealer short = positive gamma exposure under put-call sign convention
                strike_gex += oi * gamma * lot_size * spot * spot * 0.01
                
            net_gex += strike_gex
            strike_gex_map.append({"strike": strike_price, "gex": strike_gex})
            
        # Zero-Gamma Level crossover
        strike_gex_map.sort(key=lambda x: x["strike"])
        zero_gamma_level = spot
        running_gex = 0.0
        prev_running_gex = 0.0
        found_crossover = False
        
        for i, item in enumerate(strike_gex_map):
            running_gex += item["gex"]
            if i > 0:
                if (prev_running_gex < 0 and running_gex >= 0) or (prev_running_gex > 0 and running_gex <= 0):
                    dist_prev = abs(prev_running_gex)
                    dist_curr = abs(running_gex)
                    zero_gamma_level = strike_gex_map[i-1]["strike"] if dist_prev < dist_curr else item["strike"]
                    found_crossover = True
                    break
            prev_running_gex = running_gex
            
        if not found_crossover and strike_gex_map:
            min_abs_gex = float('inf')
            temp_sum = 0.0
            for item in strike_gex_map:
                temp_sum += item["gex"]
                if abs(temp_sum) < min_abs_gex:
                    min_abs_gex = abs(temp_sum)
                    zero_gamma_level = item["strike"]
                    
        regime = "TRENDING" if net_gex < 0 else "PINNING"
        
        # Max Pain calculation
        max_pain = spot
        min_loss = float('inf')
        for test_strike in [x["strike"] for x in strike_gex_map]:
            total_loss = 0.0
            for item in strikes_list:
                strike_price = float(item.get("strike_price", 0))
                # Call options
                ce = item.get("call_options")
                if ce:
                    oi = float(ce.get("oi", 0))
                    total_loss += oi * max(strike_price - test_strike, 0.0)
                # Put options
                pe = item.get("put_options")
                if pe:
                    oi = float(pe.get("oi", 0))
                    total_loss += oi * max(test_strike - strike_price, 0.0)
            if total_loss < min_loss:
                min_loss = total_loss
                max_pain = test_strike
                
        return {
            "net_gex": round(net_gex, 2),
            "zero_gamma_level": zero_gamma_level,
            "max_pain": max_pain,
            "regime": regime,
            "gex_by_strike": [{"strike": x["strike"], "gex": round(x["gex"], 2)} for x in strike_gex_map]
        }
    except Exception as e:
        log.error(f"GEX calculation failed for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/vrp")
def get_vrp(symbol: str = Query(...)):
    """Compute VRP (Implied Vol - Realized Vol)"""
    symbol = sanitize_symbol(symbol)
    key = get_underlying_key(symbol)
    if not key:
        raise HTTPException(status_code=404, detail=f"Instrument key not found for {symbol}")
        
    try:
        # 1. Fetch 30-day (45 calendar days) daily candle data to compute Realized Volatility
        to_date = datetime.now().strftime('%Y-%m-%d')
        from_date = (datetime.now() - timedelta(days=45)).strftime('%Y-%m-%d')
        
        candles_res = upstox_client.get_historical_candles(key, "day", to_date, from_date)
        
        closes = []
        if candles_res.get("status") == "success" and "data" in candles_res and "candles" in candles_res["data"]:
            candles = candles_res["data"]["candles"]
            # Candles are typically [ [timestamp, open, high, low, close, volume, oi], ... ]
            # Sort ascending by date
            candles.sort(key=lambda x: x[0])
            closes = [float(c[4]) for c in candles if len(c) > 4 and c[4] is not None]
            
        rv = 0.0
        if len(closes) >= 2:
            log_returns = []
            for i in range(1, len(closes)):
                if closes[i-1] > 0 and closes[i] > 0:
                    log_returns.append(math.log(closes[i] / closes[i-1]))
            if log_returns:
                mean_ret = sum(log_returns) / len(log_returns)
                var_ret = sum((r - mean_ret) ** 2 for r in log_returns) / (len(log_returns) - 1 if len(log_returns) > 1 else 1)
                rv = math.sqrt(var_ret) * math.sqrt(252) * 100
                
        # 2. Get Implied Volatility from option chain (nearest expiry ATM IV)
        iv = 15.0  # default fallback
        contracts_data = upstox_client.get_option_contracts(key)
        if contracts_data.get("status") == "success" and "data" in contracts_data:
            expiries = sorted([item.get("expiry") for item in contracts_data["data"] if item.get("expiry")])
            if expiries:
                nearest_expiry = expiries[0]
                chain_data = upstox_client.get_option_chain(key, nearest_expiry)
                if chain_data.get("status") == "success" and "data" in chain_data:
                    # Find spot
                    spot = closes[-1] if closes else 0.0
                    if spot <= 0 and chain_data["data"]:
                        first_strike = chain_data["data"][0]
                        if "call_options" in first_strike and first_strike["call_options"]:
                            spot = float(first_strike["call_options"].get("underlying_value", 0))
                            
                    # Find strike closest to spot
                    if spot > 0:
                        closest_strike_data = min(
                            chain_data["data"],
                            key=lambda x: abs(float(x.get("strike_price", 0)) - spot)
                        )
                        ce = closest_strike_data.get("call_options")
                        pe = closest_strike_data.get("put_options")
                        ce_iv = float(ce.get("iv", 0)) if ce else 0
                        pe_iv = float(pe.get("iv", 0)) if pe else 0
                        if ce_iv > 0 and pe_iv > 0:
                            iv = (ce_iv + pe_iv) / 2
                        elif ce_iv > 0:
                            iv = ce_iv
                        elif pe_iv > 0:
                            iv = pe_iv
                            
        vrp = iv - rv
        
        if vrp > 8.0:
            regime = "PREMIUM_SELLER_FAVORABLE"
        elif vrp < -2.0:
            regime = "LONG_GAMMA_FAVORABLE"
        else:
            regime = "NEUTRAL"
            
        return {
            "iv_30d": round(iv, 2),
            "realized_vol_30d": round(rv, 2),
            "vrp": round(vrp, 2),
            "regime": regime
        }
    except Exception as e:
        log.error(f"VRP calculation failed for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/skew")
def get_skew(symbol: str = Query(...), expiry: str = Query(None)):
    """Compute IV Skew and Percentile Rank"""
    symbol = sanitize_symbol(symbol)
    key = get_underlying_key(symbol)
    if not key:
        raise HTTPException(status_code=404, detail=f"Instrument key not found for {symbol}")
        
    try:
        # Resolve nearest expiry if not provided
        if not expiry:
            contracts_data = upstox_client.get_option_contracts(key)
            if contracts_data.get("status") == "success" and "data" in contracts_data:
                expiries = sorted([item.get("expiry") for item in contracts_data["data"] if item.get("expiry")])
                if expiries:
                    expiry = expiries[0]
                else:
                    raise HTTPException(status_code=404, detail=f"No active expiries found for {symbol}")
            else:
                raise HTTPException(status_code=500, detail="Failed to retrieve option contracts to find nearest expiry.")
                
        chain_data = upstox_client.get_option_chain(key, expiry)
        if chain_data.get("status") != "success" or "data" not in chain_data:
            raise HTTPException(status_code=500, detail=f"Failed to fetch option chain from Upstox: {chain_data.get('errors')}")
            
        strikes_list = chain_data["data"]
        
        # 1. Find call and put equidistant 25-delta options
        # We look for strike with delta closest to 0.25 (CE) and -0.25 (PE)
        ce_25d_strike = None
        ce_25d_iv = None
        ce_min_dist = float('inf')
        
        pe_25d_strike = None
        pe_25d_iv = None
        pe_min_dist = float('inf')
        
        for item in strikes_list:
            # CE
            ce = item.get("call_options")
            if ce:
                delta = abs(float((ce.get("greeks") or {}).get("delta", 0)))
                dist = abs(delta - 0.25)
                if dist < ce_min_dist:
                    ce_min_dist = dist
                    ce_25d_strike = float(item.get("strike_price", 0))
                    ce_25d_iv = float(ce.get("iv", 0))
            # PE
            pe = item.get("put_options")
            if pe:
                delta = abs(float((pe.get("greeks") or {}).get("delta", 0)))
                dist = abs(delta - 0.25)
                if dist < pe_min_dist:
                    pe_min_dist = dist
                    pe_25d_strike = float(item.get("strike_price", 0))
                    pe_25d_iv = float(pe.get("iv", 0))
                    
        # Fallbacks if delta details are not present
        if ce_25d_iv is None or pe_25d_iv is None:
            # Estimate from ATM
            ce_25d_iv = 15.0
            pe_25d_iv = 15.0
            
        skew_raw = pe_25d_iv - ce_25d_iv
        
        # 2. Database persistent 52-week skew history and rank
        today_str = datetime.now().strftime('%Y-%m-%d')
        
        conn = None
        try:
            conn = db.get_db_connection(write=True)
            cursor = conn.cursor()
            # Save today's skew
            cursor.execute(
                "INSERT OR REPLACE INTO skew_history (symbol, date, skew) VALUES (?, ?, ?)",
                (symbol, today_str, skew_raw)
            )
            conn.commit()
            
            # Fetch history
            cursor.execute("SELECT skew FROM skew_history WHERE symbol = ?", (symbol,))
            history = [r[0] for r in cursor.fetchall()]
            
            if len(history) < 5:
                iv_skew_rank = 50.0  # neutral rank if not enough history
            else:
                # Count how many historical values are below current skew
                below_count = sum(1 for x in history if x < skew_raw)
                iv_skew_rank = (below_count / len(history)) * 100.0
        except Exception as db_err:
            log.error(f"Failed to fetch/save skew history: {db_err}")
            iv_skew_rank = 50.0  # fallback
        finally:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
            
        sentiment = "NEUTRAL"
        if iv_skew_rank > 80.0:
            sentiment = "FEAR_EXTREME"
        elif iv_skew_rank > 60.0:
            sentiment = "MILD_FEAR"
        elif iv_skew_rank < 20.0:
            sentiment = "EUPHORIA_EXTREME"
            
        return {
            "skew_raw": round(skew_raw, 2),
            "iv_skew_rank": round(iv_skew_rank, 1),
            "call_skew_25d": round(ce_25d_iv, 2),
            "put_skew_25d": round(pe_25d_iv, 2),
            "sentiment": sentiment
        }
    except Exception as e:
        log.error(f"Skew calculation failed for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/qcs")
def get_qcs(symbol: str = Query(...), g_factor: float = Query(5.0), direction: str = Query("LONG")):
    """Aggregation endpoint for QCS components with dynamic macro regime modulation"""
    try:
        from routers.macro_engine import get_current_regime, get_dynamic_weights
        
        macro_regime = get_current_regime()
        macro_weights = get_dynamic_weights()
        
        gex_res = get_gex(symbol)
        vrp_res = get_vrp(symbol)
        skew_res = get_skew(symbol)
        
        # Calculate Mock/Base Conviction Index from regime
        ci = 0.0
        if gex_res["regime"] == "TRENDING":
            ci += 1.5
        if skew_res["sentiment"] == "EUPHORIA_EXTREME":
            ci += 2.0
        elif skew_res["sentiment"] == "FEAR_EXTREME":
            ci -= 2.0
            
        gfi = 1.0 if gex_res["regime"] == "TRENDING" else 0.0
        
        # Normalize to 0-10 scale
        ci_norm = max(0.0, min(10.0, ci + 5.0))
        gfi_norm = max(0.0, min(10.0, gfi + 5.0))
        
        # Map MPGS based on distance from Spot to Max Pain normalized by IV
        spot = gex_res["zero_gamma_level"]  # proxy for spot
        mp = gex_res["max_pain"]
        iv = vrp_res["iv_30d"] / 100.0
        mpgs_raw = (mp - spot) / (spot * iv) if spot > 0 and iv > 0 else 0
        mpgs_norm = max(0.0, min(10.0, mpgs_raw + 5.0))
        
        # Map VRP to 0-10 scale
        vrp_norm = max(0.0, min(10.0, (vrp_res["vrp"] + 5.0)))
        
        # Map Skew Rank to 0-10 scale
        skew_norm = skew_res["iv_skew_rank"] / 10.0
        
        # Apply dynamic macro regime weight modifiers
        w_gf = 0.30 * macro_weights.get("g_factor", 1.0)
        w_ci = 0.25 * macro_weights.get("ci", 1.0)
        w_gex = 0.20 * macro_weights.get("gex", 1.0)
        w_gfi = 0.10 * macro_weights.get("gfi", 1.0)
        w_mpgs = 0.10 * macro_weights.get("mpgs", 1.0)
        w_skew = 0.05 * macro_weights.get("iv_skew", 1.0)
        
        # Normalize sum of weights to 1.0
        total_w = w_gf + w_ci + w_gex + w_gfi + w_mpgs + w_skew
        w_gf /= total_w
        w_ci /= total_w
        w_gex /= total_w
        w_gfi /= total_w
        w_mpgs /= total_w
        w_skew /= total_w
        
        # Final weighted QCS
        qcs = (
            w_gf * g_factor +
            w_ci * ci_norm +
            w_gfi * gfi_norm +
            w_mpgs * mpgs_norm +
            w_skew * skew_norm
        )
        
        qcs = round(max(0.0, min(10.0, qcs)), 1)
        
        grade = "NEUTRAL"
        if qcs >= 8.0:
            grade = "ELITE"
        elif qcs >= 6.0:
            grade = "STRONG_BULLISH"
        elif qcs >= 4.0:
            grade = "MODERATE"
        elif qcs >= 2.0:
            grade = "NEUTRAL"
        else:
            grade = "AVOID"
            
        # Entry Gate Check 7: Macro Regime Alignment
        macro_aligned = (
            (macro_regime in ["BULL", "STRONG_BULL"] and direction.upper() == "LONG") or
            (macro_regime in ["BEAR", "STRONG_BEAR"] and direction.upper() == "SHORT") or
            (macro_regime == "NEUTRAL")
        )
        
        # Entry Gate Check 8: Liquidity Normal (Amihud < 95th percentile)
        liquidity_normal = True
        try:
            liq_params_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "macro", "liquidity_params.json")
            if os.path.exists(liq_params_path):
                import json
                with open(liq_params_path, "r") as f:
                    params_map = json.load(f)
                if symbol in params_map:
                    alert = params_map[symbol].get("current_alert_level", "NORMAL")
                    liquidity_normal = (alert == "NORMAL")
        except Exception as liq_err:
            log.warning(f"Failed to read liquidity alert for {symbol}: {liq_err}")
            
        gate_checks = {
            "g_factor": g_factor > 3.0,
            "ci": ci_norm > 5.0,
            "gex_trending": gex_res["regime"] == "TRENDING",
            "gfi_positive": gfi_norm > 5.0,
            "mpgs_aligned": mpgs_norm > 4.0,
            "iv_skew_rank": skew_norm < 5.0,
            "macro_aligned": macro_aligned,
            "liquidity_normal": liquidity_normal,
        }
        
        passed_count = sum(1 for v in gate_checks.values() if v)
        approved = passed_count >= 6
            
        return {
            "qcs": qcs,
            "grade": grade,
            "macro_regime": macro_regime,
            "entry_gate": {
                "checks": gate_checks,
                "passed_count": passed_count,
                "total_checks": 8,
                "required_pass": 6,
                "approved": approved
            },
            "gate_checks": gate_checks,
            "components": {
                "g_factor": g_factor,
                "conviction_index": round(ci_norm, 1),
                "gfi": round(gfi_norm, 1),
                "mpgs": round(mpgs_norm, 1),
                "vrp_factor": round(vrp_norm, 1),
                "iv_skew_factor": round(skew_norm, 1)
            }
        }
    except Exception as e:
        log.error(f"QCS lookup failed for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==============================================================================
# WORK PACKAGE 01: OPTIONS CHAIN SNAPSHOT FUSION, IV RANK & HERO-ZERO SCANNER
# ==============================================================================

def _ensure_chain_loaded(symbol: str, expiry: Optional[str] = None) -> Tuple[str, str, float]:
    """Ensures option chain is loaded in OptionsChainSnapshotStore."""
    from services.options_chain_state import options_chain_store
    sym = sanitize_symbol(symbol).upper()
    key = get_underlying_key(sym)
    if not key:
        raise HTTPException(status_code=404, detail=f"Instrument key not found for {sym}")

    if not expiry:
        contracts_data = upstox_client.get_option_contracts(key)
        if contracts_data.get("status") == "success" and "data" in contracts_data:
            expiries = sorted([item.get("expiry") for item in contracts_data["data"] if item.get("expiry")])
            if expiries:
                expiry = expiries[0]
            else:
                raise HTTPException(status_code=404, detail=f"No active expiries found for {sym}")
        else:
            raise HTTPException(status_code=500, detail="Failed to retrieve option contracts to find nearest expiry.")

    # Check store first
    cached = options_chain_store.get_chain_snapshot(sym, expiry)
    if cached and (time.time() - cached.get("metadata", {}).get("updated_at", 0)) < 15.0:
        return sym, expiry, cached.get("metadata", {}).get("spot", 0.0)

    # Fetch from broker
    chain_data = upstox_client.get_option_chain(key, expiry)
    if chain_data.get("status") != "success" or "data" not in chain_data:
        raise HTTPException(status_code=500, detail=f"Failed to fetch option chain from Upstox: {chain_data.get('errors')}")

    strikes_list = chain_data["data"]
    spot = 0.0
    if strikes_list:
        first_strike = strikes_list[0]
        if "call_options" in first_strike and first_strike["call_options"]:
            spot = float(first_strike["call_options"].get("underlying_value", 0))
        elif "put_options" in first_strike and first_strike["put_options"]:
            spot = float(first_strike["put_options"].get("underlying_value", 0))

    if spot <= 0:
        quotes = upstox_client.get_ltp_quotes([key])
        if quotes.get("status") == "success" and "data" in quotes and key in quotes["data"]:
            spot = float(quotes["data"][key].get("last_price", 0))

    options_chain_store.update_from_rest_chain(
        symbol=sym,
        expiry=expiry,
        spot=spot if spot > 0 else 100.0,
        chain_rows=strikes_list
    )
    return sym, expiry, spot


@router.get("/chain-state")
def get_chain_state(
    symbol: str = Query(..., description="Underlying symbol e.g. NIFTY, BANKNIFTY"),
    expiry: Optional[str] = Query(None, description="Expiry date YYYY-MM-DD"),
    force_refresh: bool = Query(False, description="Bypass cache and force REST reload")
):
    """
    Returns high-frequency fused options chain state with atomic CE/PE legs,
    synthetic forward parity, dealer Net GEX, PCR, and Zero-Gamma flip point.
    """
    from services.options_chain_state import options_chain_store
    sym = sanitize_symbol(symbol).upper()

    if force_refresh:
        _ensure_chain_loaded(sym, expiry)
    else:
        cached = options_chain_store.get_chain_snapshot(sym, expiry)
        if not cached:
            try:
                _ensure_chain_loaded(sym, expiry)
            except Exception as e:
                log.warning(f"Could not load fresh chain for {sym}: {e}")

    snapshot = options_chain_store.get_chain_snapshot(sym, expiry)
    if not snapshot:
        raise HTTPException(status_code=404, detail=f"No chain state available for {sym}")
    return snapshot


@router.get("/iv-rank")
def get_iv_rank(
    symbol: str = Query(..., description="Underlying symbol e.g. NIFTY, BANKNIFTY"),
    expiry: Optional[str] = Query(None, description="Expiry date YYYY-MM-DD")
):
    """
    Computes 52-week IV Rank and IV Percentile using institutional historical IV bands.
    Automatically persists today's ATM IV to SQLite cache.db.
    """
    from services.options_chain_state import options_chain_store
    from services.options_greeks_surface import calculate_iv_rank_percentile, record_daily_atm_iv

    sym = sanitize_symbol(symbol).upper()
    snapshot = options_chain_store.get_chain_snapshot(sym, expiry)
    current_iv = 0.15

    if snapshot:
        meta = snapshot.get("metadata", {})
        atm_strike = meta.get("atm_strike")
        for s in snapshot.get("strikes", []):
            if s["strike"] == atm_strike:
                c_iv = s.get("ce", {}).get("iv", 0.0)
                p_iv = s.get("pe", {}).get("iv", 0.0)
                if c_iv > 0 and p_iv > 0:
                    current_iv = (c_iv + p_iv) / 2.0
                elif c_iv > 0:
                    current_iv = c_iv
                elif p_iv > 0:
                    current_iv = p_iv
                break

    # Persist daily record
    today_str = datetime.now().strftime("%Y-%m-%d")
    spot_val = snapshot.get("metadata", {}).get("spot", 0.0) if snapshot else 0.0
    record_daily_atm_iv(sym, today_str, current_iv, spot=spot_val)

    return calculate_iv_rank_percentile(sym, current_iv)


@router.get("/hero-zero/candidates")
def get_hero_zero_candidates(
    symbol: str = Query("NIFTY", description="Index symbol e.g. NIFTY, BANKNIFTY"),
    expiry: Optional[str] = Query(None, description="Expiry date YYYY-MM-DD")
):
    """
    2:00 PM Hero-Zero Gamma Explosion Scanner.
    Operationalizes the mathematical risk-parity boundary ER(u) = 1.0 at 14:04 IST.
    Returns filtered convex strikes with targets, stops, and mandatory 15:15 IST off-ramp.
    """
    from services.hero_zero_scanner import scan_hero_zero_opportunities
    from services.options_chain_state import options_chain_store

    sym = sanitize_symbol(symbol).upper()
    if not options_chain_store.get_chain_snapshot(sym, expiry):
        try:
            _ensure_chain_loaded(sym, expiry)
        except Exception as e:
            log.warning(f"Could not load chain for hero-zero scanner: {e}")

    return scan_hero_zero_opportunities(sym, expiry)


@router.get("/surface-benchmark")
def get_surface_benchmark(
    n_strikes: int = Query(60, ge=10, le=200, description="Number of strikes to simulate"),
    repeats: int = Query(25, ge=5, le=100, description="Number of benchmark iterations")
):
    """
    Microsecond latency benchmark asserting <15ms end-to-end Greek recalculation SLA.
    Compares pure NumPy vectorized surface engine against scalar loop.
    """
    from services.options_greeks_surface import benchmark_chain
    return benchmark_chain(n_strikes=n_strikes, repeats=repeats)



