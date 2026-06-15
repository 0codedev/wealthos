"""
freqtrade_client.py
Freqtrade REST API client wrapper.
Integrates status checking and active trade tracking from a local Freqtrade bot instance.
"""
import urllib.request
import json
import logging
from typing import Dict, Any

log = logging.getLogger("freqtrade_client")

FREQTRADE_API_URL = "http://127.0.0.1:8080/api/v1"

def get_freqtrade_status() -> Dict[str, Any]:
    """
    Fetch active status, open trades, and profits from the Freqtrade bot.
    Falls back to offline status if the bot is not running.
    """
    try:
        # Freqtrade endpoints: /ping, /status, /daily
        req = urllib.request.Request(
            f"{FREQTRADE_API_URL}/ping",
            headers={"Accept": "application/json"},
            method="GET"
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            
        # Get actual status of open trades
        status_req = urllib.request.Request(
            f"{FREQTRADE_API_URL}/status",
            headers={"Accept": "application/json"},
            method="GET"
        )
        with urllib.request.urlopen(status_req, timeout=2) as resp:
            open_trades = json.loads(resp.read().decode("utf-8"))
            
        return {
            "status": "online",
            "bot_status": data.get("status", "running"),
            "open_trades": open_trades,
            "source": "freqtrade"
        }
    except Exception as e:
        log.warning(f"Freqtrade bot is offline: {e}")
        # Return elegant offline state
        return {
            "status": "offline",
            "bot_status": "stopped",
            "open_trades": [],
            "message": "Local Freqtrade instance is not running on port 8080.",
            "fallback_mock_trades": [
                {
                    "trade_id": 1,
                    "pair": "BTC/USDT",
                    "open_date": "2026-07-07 10:00:00",
                    "open_rate": 62500.0,
                    "close_rate": None,
                    "profit_percent": 1.25,
                    "initial_amount": 1000.0
                }
            ],
            "source": "freqtrade-mock"
        }
