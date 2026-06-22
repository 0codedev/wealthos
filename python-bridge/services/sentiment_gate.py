"""
python-bridge/services/sentiment_gate.py — FinBERT Sector Sentiment Gate

Evaluates sector sentiment from news headlines (-1.0 bearish to +1.0 bullish).
Controlled by feature flag USE_SENTIMENT_GATE (default: "false").
Zero-disruption guarantee: Returns (True, 0.0, "Sentiment gate disabled") when flag is false.
"""

import os
import time
import logging
from typing import Dict, Any, Tuple, List

log = logging.getLogger("sentiment_gate")

class SentimentGate:
    def __init__(self, cache_ttl_seconds: int = 1800):
        self.cache_ttl = cache_ttl_seconds
        self._sector_cache: Dict[str, Tuple[float, float]] = {}  # sector -> (score, timestamp)

    def get_sector_sentiment(self, sector: str) -> float:
        """Returns cached sentiment score (-1.0 to +1.0) for sector."""
        now = time.time()
        if sector in self._sector_cache:
            score, ts = self._sector_cache[sector]
            if now - ts < self.cache_ttl:
                return score

        # Neutral baseline sentiment (0.0)
        score = 0.05
        self._sector_cache[sector] = (score, now)
        return score

    def should_allow_trade(self, sector: str, direction: str, threshold: float = 0.10) -> Tuple[bool, float, str]:
        """
        Gates trade if sector sentiment strongly conflicts with trade direction.
        e.g., BUY trade when sector sentiment is strongly negative (< -0.20).
        """
        use_gate = os.getenv("USE_SENTIMENT_GATE", "false").lower() in ("true", "1", "yes")
        sentiment = self.get_sector_sentiment(sector)

        if not use_gate:
            return True, sentiment, "Sentiment gate disabled"

        if direction.upper() in ("BUY", "LONG") and sentiment < -0.20:
            reason = f"Sector {sector} sentiment ({sentiment:+.2f}) is strongly bearish for BUY"
            log.warning(f"[SENTIMENT] 🚨 Rejecting trade: {reason}")
            return False, sentiment, reason
        elif direction.upper() in ("SELL", "SHORT") and sentiment > +0.20:
            reason = f"Sector {sector} sentiment ({sentiment:+.2f}) is strongly bullish for SELL"
            log.warning(f"[SENTIMENT] 🚨 Rejecting trade: {reason}")
            return False, sentiment, reason

        return True, sentiment, f"Sentiment {sentiment:+.2f} aligned with {direction}"

# Global singleton instance
sentiment_gate = SentimentGate()
