import os
import sys
import time
import logging
import csv
import urllib.request
from datetime import datetime

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.dhan_client import dhan_client

logger = logging.getLogger("dhan_alert_manager")

class DhanAlertManager:
    def __init__(self, client=dhan_client):
        self.client = client
        self.use_fallback = False
        self._scrip_map = {}
        self._scrip_loaded = False
        self.scrip_csv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "api-scrip-master.csv")

    def _initialize_scrip_resolver(self):
        if self._scrip_loaded:
            return
        try:
            # Create data dir if not exists
            os.makedirs(os.path.dirname(self.scrip_csv_path), exist_ok=True)
            
            # Download if not exists or older than 24 hours
            should_download = True
            if os.path.exists(self.scrip_csv_path):
                file_age = time.time() - os.path.getmtime(self.scrip_csv_path)
                if file_age < 86400:  # 24 hours
                    should_download = False
            
            if should_download:
                logger.info("[DHAN ALERTS] Downloading scrip master CSV from Dhan...")
                urllib.request.urlretrieve("https://images.dhan.co/api-data/api-scrip-master.csv", self.scrip_csv_path)
                logger.info("[DHAN ALERTS] Scrip master CSV downloaded successfully.")
            
            # Parse CSV
            with open(self.scrip_csv_path, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                headers = next(reader)
                
                try:
                    security_id_idx = headers.index('SEM_SMST_SECURITY_ID')
                    trading_symbol_idx = headers.index('SEM_TRADING_SYMBOL')
                    custom_symbol_idx = headers.index('SEM_CUSTOM_SYMBOL')
                except ValueError:
                    logger.error("[DHAN ALERTS] CSV headers format changed")
                    return
                
                for row in reader:
                    if len(row) > max(security_id_idx, trading_symbol_idx, custom_symbol_idx):
                        sec_id = row[security_id_idx].strip()
                        trad_sym = row[trading_symbol_idx].strip().upper()
                        cust_sym = row[custom_symbol_idx].strip().upper()
                        
                        if trad_sym and sec_id:
                            self._scrip_map[trad_sym] = sec_id
                        if cust_sym and sec_id:
                            self._scrip_map[cust_sym] = sec_id
            
            self._scrip_loaded = True
            logger.info("[DHAN ALERTS] Loaded %d Dhan scrips from CSV.", len(self._scrip_map))
        except Exception as e:
            logger.error("[DHAN ALERTS] Failed to load Dhan scrip CSV: %s", str(e))
            self._scrip_loaded = False

    def resolve_symbol_to_security_id(self, symbol: str) -> str:
        self._initialize_scrip_resolver()
        if not self._scrip_loaded:
            return "0"
        
        clean_sym = symbol.strip().upper().replace(" ", "")
        
        # 1. Try exact match on keys (ignoring spaces)
        for key, sec_id in self._scrip_map.items():
            if key.replace(" ", "") == clean_sym:
                return sec_id
                
        # 2. Try partial match
        parts = symbol.strip().upper().split(" ")
        for key, sec_id in self._scrip_map.items():
            if all(part in key for part in parts):
                return sec_id
                
        return "0"

    def get_existing_alerts(self) -> list[dict]:
        """
        Retrieves active alerts from Dhan API.
        Falls back gracefully if the endpoint is not supported.
        """
        try:
            res = self.client.request_with_retry("GET", "/v2/alerts")
            if res.status_code == 200:
                data = res.json()
                return data if isinstance(data, list) else data.get("data", [])
            elif res.status_code in [404, 405]:
                logger.warning("[DHAN ALERTS] Price Alert API not supported/found (Status %d). Using fallback.", res.status_code)
                self.use_fallback = True
                return []
            else:
                logger.error("[DHAN ALERTS] Failed to fetch alerts: Status %d, response: %s", res.status_code, res.text)
                return []
        except Exception as e:
            logger.error("[DHAN ALERTS] Error fetching alerts: %s", str(e))
            self.use_fallback = True
            return []

    def create_price_alert(
        self,
        security_id: str,
        symbol: str,
        trigger_price: float,
        condition: str,  # 'GREATER_THAN' or 'LESS_THAN'
        alert_name: str,
        exchange_segment: str = "NSE_EQ"
    ) -> dict:
        """
        Creates a price alert on Dhan.
        If API fails or is not supported, logs fallback warning.
        """
        if self.use_fallback:
            logger.info("[DHAN ALERTS] [FALLBACK] Simulated Alert for %s: %s at %.2f", symbol, condition, trigger_price)
            return {"status": "simulated", "alertId": f"sim_{symbol}_{int(trigger_price)}"}

        payload = {
            "securityId": security_id,
            "exchangeSegment": exchange_segment,
            "triggerPrice": trigger_price,
            "alertCondition": condition,  # 'ABOVE'/'BELOW' or 'GREATER_THAN'/'LESS_THAN'
            "alertName": alert_name,
            "remarks": f"Auto-synced Day H/L alert for {symbol}"
        }

        try:
            res = self.client.request_with_retry("POST", "/v2/alerts", json=payload)
            if res.status_code in [200, 201]:
                logger.info("[DHAN ALERTS] Successfully created alert for %s at %.2f", symbol, trigger_price)
                return res.json()
            elif res.status_code in [404, 405]:
                logger.warning("[DHAN ALERTS] Create alert endpoint not supported. Switching to fallback.")
                self.use_fallback = True
                return {"status": "simulated", "remarks": "Switching to simulation mode"}
            else:
                logger.error("[DHAN ALERTS] Failed to create alert: Status %d, Response: %s", res.status_code, res.text)
                return {"status": "error", "error": res.text}
        except Exception as e:
            logger.error("[DHAN ALERTS] Exception creating alert: %s", str(e))
            self.use_fallback = True
            return {"status": "simulated", "remarks": str(e)}

    def delete_alert(self, alert_id: str) -> bool:
        """
        Deletes a price alert on Dhan.
        """
        if self.use_fallback or str(alert_id).startswith("sim_"):
            logger.info("[DHAN ALERTS] [FALLBACK] Deleted simulated alert %s", alert_id)
            return True

        try:
            res = self.client.request_with_retry("DELETE", f"/v2/alerts/{alert_id}")
            if res.status_code in [200, 204]:
                logger.info("[DHAN ALERTS] Successfully deleted alert %s", alert_id)
                return True
            return False
        except Exception as e:
            logger.error("[DHAN ALERTS] Exception deleting alert %s: %s", alert_id, str(e))
            return False

    def sync_day_high_low_alerts(self, watchlist: list[dict]) -> dict:
        """
        For each symbol in watchlist, deletes old synced alerts and creates new ones
        at the specified day high and day low trigger prices.
        watchlist format: [{ "symbol": "RELIANCE", "security_id": "2885", "day_high": 2510.5, "day_low": 2480.0 }]
        """
        logger.info("[DHAN ALERTS] Syncing Day High/Low alerts for %d symbols...", len(watchlist))
        
        # 1. Fetch current alerts
        existing_alerts = self.get_existing_alerts()
        
        # 2. Delete existing auto-synced Day H/L alerts (based on name or remarks)
        deleted_count = 0
        for alert in existing_alerts:
            alert_id = alert.get("alertId")
            remarks = alert.get("remarks", "")
            if alert_id and "Auto-synced Day H/L" in remarks:
                if self.delete_alert(alert_id):
                    deleted_count += 1

        # 3. Create new alerts
        created_count = 0
        results = []
        for stock in watchlist:
            symbol = stock.get("symbol")
            sec_id = stock.get("security_id")
            high = stock.get("day_high")
            low = stock.get("day_low")

            if not symbol:
                continue
            
            # Resolve security_id if not provided
            if not sec_id or sec_id == "0" or sec_id == "":
                sec_id = self.resolve_symbol_to_security_id(symbol)

            if not sec_id or sec_id == "0":
                logger.warning("[DHAN ALERTS] Could not resolve security ID for symbol %s. Skipping.", symbol)
                continue

            # Day High Breakout Alert
            if high and high > 0:
                res_high = self.create_price_alert(
                    security_id=sec_id,
                    symbol=symbol,
                    trigger_price=high,
                    condition="GREATER_THAN",
                    alert_name=f"{symbol} Day High Break ₹{high}"
                )
                results.append(res_high)
                created_count += 1

            # Day Low Breakdown Alert
            if low and low > 0:
                res_low = self.create_price_alert(
                    security_id=sec_id,
                    symbol=symbol,
                    trigger_price=low,
                    condition="LESS_THAN",
                    alert_name=f"{symbol} Day Low Break ₹{low}"
                )
                results.append(res_low)
                created_count += 1

        status_str = "success" if not self.use_fallback else "simulated"
        remarks_str = "Completed sync successfully" if not self.use_fallback else "Dhan alert API not active, simulated fallback alerts"

        return {
            "status": status_str,
            "deleted_alerts_count": deleted_count,
            "created_alerts_count": created_count,
            "remarks": remarks_str,
            "results": results
        }

dhan_alert_manager = DhanAlertManager()
