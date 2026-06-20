"""
optopsy_engine.py
Options strategy backtesting and payoff simulation engine.
"""
import logging
from typing import List, Dict, Any

log = logging.getLogger("optopsy_engine")

def run_options_backtest(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Simulates option strategy payoff and calculates metrics.
    Payload expected format:
      symbol: str
      spot_price: float
      legs: List[dict] where each leg has:
        strike: float
        type: 'CE' | 'PE'
        action: 'BUY' | 'SELL'
        premium: float
        quantity: int
    """
    symbol = payload.get("symbol", "NIFTY")
    spot_price = float(payload.get("spot_price", 24000.0))
    legs = payload.get("legs", [])
    
    if not legs:
        return {"status": "error", "message": "No strategy legs provided."}
        
    # Calculate net premium debit/credit
    net_premium = 0.0
    for leg in legs:
        multiplier = 1 if leg.get("action") == "BUY" else -1
        net_premium += float(leg.get("premium", 0.0)) * multiplier * int(leg.get("quantity", 1))
        
    # Generate payoff points at maturity
    # Generate spots from -10% to +10% of current spot
    min_spot = int(spot_price * 0.9)
    max_spot = int(spot_price * 1.1)
    step = max(10, int((max_spot - min_spot) / 100))
    
    payoff_curve = []
    max_profit = float("-inf")
    max_loss = float("inf")
    
    for spot in range(min_spot, max_spot, step):
        pnl = 0.0
        for leg in legs:
            strike = float(leg.get("strike", 0.0))
            opt_type = leg.get("type", "CE").upper()
            action = leg.get("action", "BUY").upper()
            premium = float(leg.get("premium", 0.0))
            qty = int(leg.get("quantity", 1))
            
            # Payoff at expiration
            if opt_type == "CE":
                intrinsic = max(0.0, spot - strike)
            else:
                intrinsic = max(0.0, strike - spot)
                
            if action == "BUY":
                leg_pnl = (intrinsic - premium) * qty
            else:
                leg_pnl = (premium - intrinsic) * qty
                
            pnl += leg_pnl
            
        payoff_curve.append({"spot": spot, "pnl": round(pnl, 2)})
        max_profit = max(max_profit, pnl)
        max_loss = min(max_loss, pnl)
        
    # Determine break-even points
    break_evens = []
    for i in range(len(payoff_curve) - 1):
        p1 = payoff_curve[i]
        p2 = payoff_curve[i+1]
        if (p1["pnl"] <= 0 and p2["pnl"] > 0) or (p1["pnl"] >= 0 and p2["pnl"] < 0):
            # Interpolated zero-crossing
            slope = (p2["pnl"] - p1["pnl"]) / (p2["spot"] - p1["spot"])
            if slope != 0:
                zero_spot = p1["spot"] - (p1["pnl"] / slope)
                break_evens.append(round(zero_spot, 2))

    # Attempt to load open source optopsy module if present
    try:
        import optopsy
        log.info("Optopsy library loaded.")
    except ImportError:
        pass

    return {
        "symbol": symbol,
        "underlying_spot": spot_price,
        "net_premium": round(net_premium, 2),
        "strategy_type": "Debit" if net_premium > 0 else "Credit",
        "max_profit": round(max_profit, 2) if max_profit != float("inf") else "Unlimited",
        "max_loss": round(max_loss, 2) if max_loss != float("-inf") else "Unlimited",
        "break_evens": break_evens,
        "payoff_curve": payoff_curve,
        "status": "success"
    }
