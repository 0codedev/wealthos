import math
from typing import List, Dict, Any

def detect_hammer(candles: List[List[Any]]) -> Dict[str, Any]:
    """
    Hammer: small body near high, long lower shadow (>= 2x body size), small/no upper shadow.
    Expects candles in Upstox V3 format: [[timestamp, open, high, low, close, volume, open_interest], ...]
    sorted chronological (index 0 is oldest, last index is most recent).
    Let's check the most recent candle (last in list).
    """
    if len(candles) < 1:
        return {"detected": False, "confidence": 0.0}
        
    c = candles[-1]
    o, h, l, cl = float(c[1]), float(c[2]), float(c[3]), float(c[4])
    
    body = abs(cl - o)
    high_body = max(o, cl)
    low_body = min(o, cl)
    
    total_range = h - l
    if total_range <= 0:
        return {"detected": False, "confidence": 0.0}
        
    lower_shadow = low_body - l
    upper_shadow = h - high_body
    
    # Body should be small, lower shadow long, upper shadow short
    is_small_body = body <= (total_range * 0.3)
    is_long_lower_shadow = lower_shadow >= (body * 2.0)
    is_short_upper_shadow = upper_shadow <= (total_range * 0.15)
    
    if is_small_body and is_long_lower_shadow and is_short_upper_shadow:
        # Confidence increases if lower shadow is even longer
        confidence = min(lower_shadow / (body * 3.0) if body > 0 else 1.0, 1.0)
        return {"detected": True, "confidence": round(confidence, 2)}
        
    return {"detected": False, "confidence": 0.0}

def detect_engulfing(candles: List[List[Any]]) -> Dict[str, Any]:
    """
    Engulfing: Current body engulfs previous body, opposite direction.
    """
    if len(candles) < 2:
        return {"detected": False, "direction": "NEUTRAL", "confidence": 0.0}
        
    c_prev = candles[-2]
    c_curr = candles[-1]
    
    o_prev, cl_prev = float(c_prev[1]), float(c_prev[4])
    o_curr, cl_curr = float(c_curr[1]), float(c_curr[4])
    
    body_prev = abs(cl_prev - o_prev)
    body_curr = abs(cl_curr - o_curr)
    
    # Needs to be a significant engulfing (e.g. current body > previous body)
    is_engulfing = (max(o_curr, cl_curr) >= max(o_prev, cl_prev)) and (min(o_curr, cl_curr) <= min(o_prev, cl_prev)) and (body_curr > body_prev)
    
    if is_engulfing:
        prev_dir = "BULLISH" if cl_prev > o_prev else "BEARISH"
        curr_dir = "BULLISH" if cl_curr > o_curr else "BEARISH"
        
        if prev_dir == "BEARISH" and curr_dir == "BULLISH":
            return {"detected": True, "direction": "BULLISH", "confidence": 0.85}
        elif prev_dir == "BULLISH" and curr_dir == "BEARISH":
            return {"detected": True, "direction": "BEARISH", "confidence": 0.85}
            
    return {"detected": False, "direction": "NEUTRAL", "confidence": 0.0}

def detect_doji_at_support(candles: List[List[Any]], support_level: float = None) -> Dict[str, Any]:
    """
    Doji: open very close to close.
    If support_level is provided, checks if Doji's low is within 1% of support.
    """
    if len(candles) < 1:
        return {"detected": False, "confidence": 0.0}
        
    c = candles[-1]
    o, h, l, cl = float(c[1]), float(c[2]), float(c[3]), float(c[4])
    
    body = abs(cl - o)
    total_range = h - l
    if total_range <= 0:
        return {"detected": False, "confidence": 0.0}
        
    # Doji has extremely thin body
    is_doji = body <= (total_range * 0.1)
    
    if is_doji:
        confidence = 0.70
        if support_level is not None and support_level > 0:
            dist_pct = abs(l - support_level) / support_level
            if dist_pct <= 0.015:
                confidence = 0.95  # Doji right at support
                return {"detected": True, "confidence": confidence, "at_support": True}
        return {"detected": True, "confidence": confidence, "at_support": False}
        
    return {"detected": False, "confidence": 0.0}

def detect_inside_bar(candles: List[List[Any]]) -> Dict[str, Any]:
    """
    Inside Bar: current high < prev high and current low > prev low.
    """
    if len(candles) < 2:
        return {"detected": False, "confidence": 0.0}
        
    c_prev = candles[-2]
    c_curr = candles[-1]
    
    h_prev, l_prev = float(c_prev[2]), float(c_prev[3])
    h_curr, l_curr = float(c_curr[2]), float(c_curr[3])
    
    if h_curr < h_prev and l_curr > l_prev:
        return {"detected": True, "confidence": 0.80}
        
    return {"detected": False, "confidence": 0.0}

def detect_gap_and_hold(candles: List[List[Any]]) -> Dict[str, Any]:
    """
    Gap & Hold: current open is at least 0.5% gap from prev close,
    and current close stays in that direction (i.e. does not fill the gap).
    """
    if len(candles) < 2:
        return {"detected": False, "direction": "NEUTRAL", "confidence": 0.0}
        
    c_prev = candles[-2]
    c_curr = candles[-1]
    
    cl_prev = float(c_prev[4])
    o_curr, cl_curr = float(c_curr[1]), float(c_curr[4])
    
    gap_pct = (o_curr - cl_prev) / cl_prev
    
    if gap_pct >= 0.005:  # Gap up
        # Held if close is still higher than prev close (or in upper 50% of candle range)
        if cl_curr > cl_prev + (o_curr - cl_prev) * 0.5:
            return {"detected": True, "direction": "BULLISH", "gap_pct": round(gap_pct * 100.0, 2), "confidence": 0.80}
    elif gap_pct <= -0.005:  # Gap down
        if cl_curr < cl_prev - (cl_prev - o_curr) * 0.5:
            return {"detected": True, "direction": "BEARISH", "gap_pct": round(gap_pct * 100.0, 2), "confidence": 0.80}
            
    return {"detected": False, "direction": "NEUTRAL", "confidence": 0.0}

def detect_volume_climax(candles: List[List[Any]], vol_avg_20d: float) -> Dict[str, Any]:
    """
    Volume Climax: current volume is > 3x the 20-day average volume,
    and has a large candle body or long wick.
    """
    if len(candles) < 1 or vol_avg_20d <= 0:
        return {"detected": False, "confidence": 0.0}
        
    c = candles[-1]
    o, h, l, cl, vol = float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[5])
    
    vol_ratio = vol / vol_avg_20d
    
    if vol_ratio >= 3.0:
        direction = "BULLISH" if cl > o else "BEARISH"
        # Confidence scaled by volume ratio
        confidence = min(vol_ratio / 5.0, 1.0)
        return {"detected": True, "direction": direction, "vol_ratio": round(vol_ratio, 2), "confidence": round(confidence, 2)}
        
    return {"detected": False, "confidence": 0.0}

def scan_all_patterns(candles: List[List[Any]], vol_avg_20d: float, support_level: float = None) -> Dict[str, Any]:
    """
    Scans a daily candle series and returns all active patterns detected on the latest candle.
    """
    patterns = []
    max_score = 0.0
    
    # 1. Hammer
    hammer = detect_hammer(candles)
    if hammer["detected"]:
        patterns.append("Hammer")
        max_score = max(max_score, hammer["confidence"])
        
    # 2. Engulfing
    engulfing = detect_engulfing(candles)
    if engulfing["detected"]:
        patterns.append(f"{engulfing['direction']} Engulfing")
        max_score = max(max_score, engulfing["confidence"])
        
    # 3. Doji at Support
    doji = detect_doji_at_support(candles, support_level)
    if doji["detected"]:
        patterns.append("Doji at Support" if doji.get("at_support") else "Doji")
        max_score = max(max_score, doji["confidence"])
        
    # 4. Inside Bar
    inside = detect_inside_bar(candles)
    if inside["detected"]:
        patterns.append("Inside Bar")
        max_score = max(max_score, inside["confidence"])
        
    # 5. Gap & Hold
    gap = detect_gap_and_hold(candles)
    if gap["detected"]:
        patterns.append(f"Gap & Hold ({gap['direction']})")
        max_score = max(max_score, gap["confidence"])
        
    # 6. Volume Climax
    climax = detect_volume_climax(candles, vol_avg_20d)
    if climax["detected"]:
        patterns.append(f"Volume Climax ({climax['direction']})")
        max_score = max(max_score, climax["confidence"])
        
    return {
        "patterns": patterns,
        "pattern_score": round(max_score, 2)
    }
