import os
import json
import math
import duckdb
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from scipy.stats import norm
from logger import get_logger

log = get_logger("analytics_engine", tag="ANALYTICS")

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

def black_scholes_price(S: float, K: float, T: float, r: float, v: float, option_type: str) -> float:
    """Calculates Black-Scholes price of an option."""
    if T <= 0:
        return max(0.0, S - K) if option_type == 'CE' else max(0.0, K - S)
    if v <= 0:
        v = 0.0001
        
    d1 = (math.log(S / K) + (r + 0.5 * v * v) * T) / (v * math.sqrt(T))
    d2 = d1 - v * math.sqrt(T)
    
    if option_type == 'CE':
        price = S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)
    else:
        price = K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
    return price

def black_scholes_vega(S: float, K: float, T: float, r: float, v: float, option_type: str) -> float:
    """Calculates Black-Scholes Vega of an option."""
    if T <= 0 or v <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + 0.5 * v * v) * T) / (v * math.sqrt(T))
    vega = S * math.sqrt(T) * norm.pdf(d1)
    return vega / 100.0  # matches TS OptionsSimulator.calculatePrice (scaled by 100)

def calculate_implied_volatility(S: float, market_price: float, K: float, T: float, r: float, option_type: str) -> float:
    """
    Calculates Implied Volatility (IV) using the Newton-Raphson method
    with a robust Bisection Search fallback.
    """
    if market_price <= 0.05:
        return 0.0001

    intrinsic = max(0.0, S - K) if option_type == 'CE' else max(0.0, K - S)
    if market_price < intrinsic:
        market_price = intrinsic + 0.05  # buffer above intrinsic

    v = 0.20  # 20% Initial guess
    max_iterations = 100
    tolerance = 1e-5

    # 1. Newton-Raphson
    for _ in range(max_iterations):
        price = black_scholes_price(S, K, T, r, v, option_type)
        vega_scaled = black_scholes_vega(S, K, T, r, v, option_type) * 100.0  # raw vega
        
        diff = price - market_price
        if abs(diff) < tolerance:
            return v

        if abs(vega_scaled) < 1e-7:
            break  # Vega near zero, fall through to bisection

        next_v = v - diff / vega_scaled
        if next_v <= 0 or next_v > 5.0:
            break  # Volatility out of reasonable bounds, fall through
        v = next_v

    # 2. Bisection Search Fallback
    low = 0.0001
    high = 5.0
    mid = 0.20
    for _ in range(50):
        mid = (low + high) / 2.0
        price = black_scholes_price(S, K, T, r, mid, option_type)
        diff = price - market_price

        if abs(diff) < tolerance:
            return mid

        if diff > 0:
            high = mid
        else:
            low = mid

    return mid

def build_iv_surface(underlying: str, expiry: str) -> dict:
    """
    Queries option parquet files, calculates IV for all strikes and DTEs,
    and returns a pivot grid structure: Record<strike, Record<dte, iv>>.
    Applies linear interpolation/clipping for gaps.
    """
    underlying_upper = underlying.upper().strip()
    opt_parquet_path = os.path.join(DATA_DIR, "options", underlying_upper, expiry, "data.parquet")
    und_parquet_path = os.path.join(DATA_DIR, "underlying", underlying_upper, "day", "data.parquet")

    if not os.path.exists(opt_parquet_path) or not os.path.exists(und_parquet_path):
        log.warning("Parquet path missing: opt=%s, und=%s", os.path.exists(opt_parquet_path), os.path.exists(und_parquet_path))
        return {}

    try:
        conn = duckdb.connect()
        query = f"""
            SELECT 
                opt.timestamp,
                opt.strike_price,
                upper(opt.option_type) as option_type,
                opt.close AS option_close,
                und.close AS spot_close
            FROM '{opt_parquet_path}' opt
            JOIN '{und_parquet_path}' und 
              ON CAST(opt.timestamp AS DATE) = CAST(und.timestamp AS DATE)
            ORDER BY opt.timestamp ASC, opt.strike_price ASC
        """
        df = conn.execute(query).df()
        conn.close()

        if df.empty:
            return {}

        # Convert timestamp to date only string
        df['date_str'] = df['timestamp'].apply(lambda x: str(x)[:10])
        expiry_dt = datetime.strptime(expiry, "%Y-%m-%d")

        # Compute DTE
        def calc_dte(date_s):
            try:
                curr_dt = datetime.strptime(date_s, "%Y-%m-%d")
                return max(0, (expiry_dt - curr_dt).days)
            except:
                return 0

        df['dte'] = df['date_str'].apply(calc_dte)
        
        # We want to group by (strike_price, dte)
        # To avoid noise, for each (strike, dte) we choose CE or PE based on OTM status:
        # CE if strike > spot_close else PE. Fallback to available if one is missing.
        grouped = df.groupby(['strike_price', 'dte'])
        
        raw_grid = {}  # strike -> dte -> iv
        all_dtes = sorted(list(df['dte'].unique()))
        all_strikes = sorted(list(df['strike_price'].unique()))

        for (strike, dte), group in grouped:
            spot_close = float(group.iloc[0]['spot_close'])
            
            # Select contract: CE if strike > spot_close else PE
            selected_row = None
            preferred_type = 'CE' if strike > spot_close else 'PE'
            
            pref_rows = group[group['option_type'] == preferred_type]
            if not pref_rows.empty:
                selected_row = pref_rows.iloc[0]
            else:
                selected_row = group.iloc[0]  # take whatever is available

            option_close = float(selected_row['option_close'])
            opt_type = selected_row['option_type']
            
            T = max(0.0001, dte) / 365.0
            iv = calculate_implied_volatility(
                S=spot_close,
                market_price=option_close,
                K=strike,
                T=T,
                r=0.07,
                option_type=opt_type
            )
            
            # Filter out extreme dummy IVs
            if 0.01 < iv < 4.0:
                if strike not in raw_grid:
                    raw_grid[strike] = {}
                raw_grid[strike][dte] = iv

        # Interpolate missing values for each DTE
        final_grid = {}
        for dte in all_dtes:
            # Gather known strikes and their IVs for this DTE
            known_strikes = []
            known_ivs = []
            for strike in all_strikes:
                if strike in raw_grid and dte in raw_grid[strike]:
                    known_strikes.append(strike)
                    known_ivs.append(raw_grid[strike][dte])

            if len(known_strikes) >= 2:
                # Interpolate for all strikes
                interpolated_ivs = np.interp(all_strikes, known_strikes, known_ivs)
                for strike, iv in zip(all_strikes, interpolated_ivs):
                    if strike not in final_grid:
                        final_grid[strike] = {}
                    final_grid[strike][dte] = float(iv)
            elif len(known_strikes) == 1:
                # Fill all strikes with the single known IV
                single_iv = known_ivs[0]
                for strike in all_strikes:
                    if strike not in final_grid:
                        final_grid[strike] = {}
                    final_grid[strike][dte] = float(single_iv)
            else:
                # Fallback default IV (18%)
                for strike in all_strikes:
                    if strike not in final_grid:
                        final_grid[strike] = {}
                    final_grid[strike][dte] = 0.18

        # Structure response: list of strikes with their DTE IVs
        # e.g., [{"strike": 24000, "dtes": {"7": 0.15, "14": 0.16}}]
        formatted_list = []
        for strike in all_strikes:
            formatted_list.append({
                "strike": float(strike),
                "ivs": {str(dte): val for dte, val in final_grid[strike].items()}
            })

        return {
            "underlying": underlying_upper,
            "expiry": expiry,
            "dtes": [str(d) for d in all_dtes],
            "strikes": [float(s) for s in all_strikes],
            "surface": formatted_list
        }

    except Exception as e:
        log.error("Failed to build IV surface", exc_info=True)
        return {}

def calculate_max_pain(chain_df: pd.DataFrame) -> float:
    """
    Computes the Max Pain strike from an option chain DataFrame.
    chain_df columns: strike_price, option_type, open_interest
    """
    # Drop rows without OI
    chain_df = chain_df[chain_df['open_interest'].notna() & (chain_df['open_interest'] > 0)]
    if chain_df.empty:
        return None

    strikes = sorted(list(chain_df['strike_price'].unique()))
    if not strikes:
        return None

    calls = chain_df[chain_df['option_type'].str.upper() == 'CE']
    puts = chain_df[chain_df['option_type'].str.upper() == 'PE']

    call_data = [(float(r['strike_price']), float(r['open_interest'])) for _, r in calls.iterrows()]
    put_data = [(float(r['strike_price']), float(r['open_interest'])) for _, r in puts.iterrows()]

    min_loss = float('inf')
    max_pain_strike = strikes[0]

    for test_strike in strikes:
        total_loss = 0.0
        
        # Call sellers loss: if test_strike > call_strike
        for k, oi in call_data:
            if test_strike > k:
                total_loss += (test_strike - k) * oi
                
        # Put sellers loss: if test_strike < put_strike
        for k, oi in put_data:
            if test_strike < k:
                total_loss += (k - test_strike) * oi

        if total_loss < min_loss:
            min_loss = total_loss
            max_pain_strike = test_strike

    return float(max_pain_strike)

def filter_monthly_expiries(expiry_dates: list) -> list:
    """Filters a list of expiry date strings to keep only monthly expiries (last of month)."""
    groups = {}
    for d_str in expiry_dates:
        try:
            dt = datetime.strptime(d_str, "%Y-%m-%d")
            ym = (dt.year, dt.month)
            if ym not in groups:
                groups[ym] = []
            groups[ym].append(d_str)
        except:
            continue
            
    monthly = []
    for ym, dates in groups.items():
        dates.sort()
        monthly.append(dates[-1])
    monthly.sort()
    return monthly

def get_historical_max_pain(underlying: str, count: int = 24, view_all: bool = False) -> list:
    """
    Computes Max Pain history for the last N expiries.
    Queries options Parquet folders to find expiries.
    """
    underlying_upper = underlying.upper().strip()
    underlying_options_dir = os.path.join(DATA_DIR, "options", underlying_upper)
    und_parquet_path = os.path.join(DATA_DIR, "underlying", underlying_upper, "day", "data.parquet")

    if not os.path.exists(underlying_options_dir) or not os.path.exists(und_parquet_path):
        log.warning("Paths missing: opt_dir=%s, und=%s", os.path.exists(underlying_options_dir), os.path.exists(und_parquet_path))
        return []

    # Get expiries
    expiries = []
    for d in os.listdir(underlying_options_dir):
        if os.path.isdir(os.path.join(underlying_options_dir, d)):
            try:
                datetime.strptime(d, "%Y-%m-%d")
                expiries.append(d)
            except:
                continue
    expiries.sort()

    if not expiries:
        return []

    # Filter monthly if requested
    if not view_all:
        expiries = filter_monthly_expiries(expiries)

    # Slice to last N expiries
    expiries = expiries[-count:]
    history = []

    try:
        conn = duckdb.connect()
        for expiry in expiries:
            opt_path = os.path.join(underlying_options_dir, expiry, "data.parquet")
            if not os.path.exists(opt_path):
                continue
            
            # Find the max date in option parquet <= expiry
            max_date_res = conn.execute(
                f"SELECT MAX(CAST(timestamp AS DATE)) FROM '{opt_path}' WHERE CAST(timestamp AS DATE) <= ?",
                [expiry]
            ).fetchone()
            
            if not max_date_res or not max_date_res[0]:
                continue
            
            max_date = max_date_res[0]
            max_date_str = max_date.strftime("%Y-%m-%d")
            
            # Load option chain for this date
            df = conn.execute(
                f"""
                SELECT strike_price, upper(option_type) as option_type, open_interest
                FROM '{opt_path}'
                WHERE CAST(timestamp AS DATE) = ?
                """,
                [max_date]
            ).df()
            
            if df.empty:
                continue
                
            max_pain = calculate_max_pain(df)
            if max_pain is None:
                continue
                
            # Get underlying spot close on the same date
            und_res = conn.execute(
                f"SELECT close FROM '{und_parquet_path}' WHERE CAST(timestamp AS DATE) = ?",
                [max_date]
            ).fetchone()
            
            spot_close = float(und_res[0]) if und_res else None
            if spot_close is None:
                continue
                
            gap = spot_close - max_pain
            gap_pct = (gap / spot_close) * 100.0
            
            history.append({
                "expiry": expiry,
                "date": max_date_str,
                "maxPain": max_pain,
                "actualClose": spot_close,
                "gap": gap,
                "gapPercent": gap_pct
            })
            
        conn.close()
        return history

    except Exception as e:
        log.error("Failed to calculate Max Pain history", exc_info=True)
        return []
