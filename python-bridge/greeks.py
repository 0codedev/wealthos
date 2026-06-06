import math
import threading
from scipy.stats import norm
from logger import get_logger

log = get_logger("greeks", tag="GREEKS")

# Thread-safe global cache for live greeks fetched from Upstox
_live_greeks_cache = {}
_cache_lock = threading.Lock()

def update_live_greeks_cache(greeks_data: dict):
    """
    Updates the global greeks cache.
    greeks_data is a dict in the format: { "instrument_key": { "delta": 0.5, "theta": -0.2, ... } }
    """
    if not greeks_data:
        return
    with _cache_lock:
        for key, val in greeks_data.items():
            if isinstance(val, dict):
                # Ensure keys are lowercase for easy lookup
                _live_greeks_cache[key] = {k.lower(): v for k, v in val.items()}

def get_cached_greek(instrument_key: str, greek_name: str) -> float:
    """Retrieves a cached greek value by instrument key and name (e.g. 'delta')."""
    if not instrument_key:
        return None
    with _cache_lock:
        entry = _live_greeks_cache.get(instrument_key)
        if entry:
            val = entry.get(greek_name.lower())
            if val is not None:
                try:
                    return float(val)
                except (ValueError, TypeError):
                    pass
    return None

def calculate_option_delta(spot: float, strike: float, days_to_expiry: float, r: float, iv: float, option_type: str, instrument_key: str = None) -> float:
    """
    Calculates Black-Scholes Delta for a call or put option,
    or returns live cached Upstox Greek if instrument_key is provided and cached.
    spot: current underlying price
    strike: strike price of the option
    days_to_expiry: days remaining until expiry (will convert to T in years)
    r: risk-free interest rate (annualised, e.g., 0.07 for 7%)
    iv: implied volatility (as decimal, e.g., 0.15 for 15%)
    option_type: 'CE' (Call) or 'PE' (Put)
    instrument_key: optional Upstox instrument key for live lookup
    """
    if instrument_key:
        live_delta = get_cached_greek(instrument_key, "delta")
        if live_delta is not None:
            return live_delta

    if spot <= 0 or strike <= 0 or iv <= 0 or days_to_expiry <= 0:
        return 0.5 if option_type == 'CE' else -0.5
        
    # Try Mibian first
    try:
        import sys
        import os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'services'))
        from mibian_greeks import calculate_greeks
        res = calculate_greeks(spot, strike, days_to_expiry, r, iv, option_type)
        if "delta" in res and res["delta"] is not None:
            return float(res["delta"])
    except Exception:
        pass

    # Fallback to scipy formula
    T = days_to_expiry / 365.0
    
    try:
        d1 = (math.log(spot / strike) + (r + 0.5 * iv ** 2) * T) / (iv * math.sqrt(T))
        if option_type.upper() == 'CE':
            return float(norm.cdf(d1))
        elif option_type.upper() == 'PE':
            return float(norm.cdf(d1) - 1.0)
    except Exception as e:
        log.error("Failed to calculate delta: %s", e)
        
    return 0.5 if option_type == 'CE' else -0.5

