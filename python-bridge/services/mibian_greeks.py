"""
mibian_greeks.py
Mibian-backed Black-Scholes Options Greeks Engine.
Calculates Delta, Gamma, Theta, Vega, and Implied Volatility.
"""
import logging
from typing import Optional

log = logging.getLogger("mibian_greeks")

try:
    import mibian
    _HAS_MIBIAN = True
except ImportError:
    _HAS_MIBIAN = False
    log.warning("Mibian package not installed. Option greeks calculation will fall back to py_greeks / scipy.")

def calculate_greeks(
    spot: float,
    strike: float,
    days_to_expiry: float,
    r: float,
    iv: float,
    option_type: str
) -> dict:
    """
    Calculate options greeks using mibian library.
    r: risk-free rate as decimal (e.g. 0.07 for 7%)
    iv: implied volatility as decimal (e.g. 0.15 for 15%)
    """
    if not _HAS_MIBIAN:
        return {}

    try:
        # mibian expects interest rate and volatility as percentages (0-100)
        interest_rate_pct = r * 100.0
        volatility_pct = iv * 100.0
        
        bs = mibian.BS([spot, strike, interest_rate_pct, days_to_expiry], volatility=volatility_pct)
        
        if option_type.upper() == 'CE':
            return {
                "price": bs.callPrice,
                "delta": bs.callDelta,
                "theta": bs.callTheta,
                "vega": bs.vega,
                "gamma": bs.gamma
            }
        else:
            return {
                "price": bs.putPrice,
                "delta": bs.putDelta,
                "theta": bs.putTheta,
                "vega": bs.vega,
                "gamma": bs.gamma
            }
    except Exception as e:
        log.debug(f"Mibian greeks calculation failed: {e}")
        return {}


def calculate_implied_volatility(
    spot: float,
    strike: float,
    days_to_expiry: float,
    r: float,
    price: float,
    option_type: str
) -> float:
    """
    Calculate Implied Volatility (IV) given the option price using mibian.
    Returns IV as decimal (e.g. 0.15 for 15%).
    """
    try:
        import mibian
        interest_rate_pct = r * 100.0
        
        if option_type.upper() == 'CE':
            bs = mibian.BS([spot, strike, interest_rate_pct, days_to_expiry], callPrice=price)
        else:
            bs = mibian.BS([spot, strike, interest_rate_pct, days_to_expiry], putPrice=price)
            
        return bs.impliedVolatility / 100.0 if bs.impliedVolatility else 0.0
    except Exception as e:
        log.error(f"Mibian implied volatility calculation failed: {e}")
        return 0.0
