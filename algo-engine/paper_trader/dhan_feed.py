import time
import datetime
import random
import os
from dhanhq import DhanContext, dhanhq

class DhanFeed:
    def __init__(self, client_id=None, access_token=None, simulate=False):
        self.simulate = simulate
        self.client_id = client_id or os.getenv("DHAN_CLIENT_ID")
        self.access_token = access_token or os.getenv("DHAN_ACCESS_TOKEN")
        self.dhan = None
        self.dhan_context = None

        if not self.simulate:
            if not self.client_id or not self.access_token:
                raise ValueError("[FEED] Missing DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN in env configuration.")
            
            # Setup Dhan context and point to Sandbox
            self.dhan_context = DhanContext(self.client_id, self.access_token)
            # Route to Sandbox base URL
            self.dhan_context.dhan_http.base_url = "https://sandbox.dhan.co/v2"
            self.dhan = dhanhq(self.dhan_context)
            print("[FEED] Initialized Live Dhan Sandbox Feed API connection.")
        else:
            print("[FEED] Running in MOCK/SIMULATION Mode. Upstox/Dhan API calls bypassed.")

        # Simulation parameters
        self.sim_price = 2450.0  # Base price for RELIANCE simulation
        self.sim_time = datetime.datetime.now().replace(hour=9, minute=14, second=0)

    def get_latest_price(self, security_id="2885", exchange_segment="NSE_EQ") -> float:
        """Fetch latest price for the target symbol. Falls back to mock on weekends/holidays."""
        if self.simulate:
            # Random walk generator for testing
            self.sim_price += round(random.uniform(-1.5, 1.5), 2)
            self.sim_price = max(100.0, round(self.sim_price, 2))
            return self.sim_price

        try:
            # Query quote data snapshot from Dhan Sandbox (free API)
            # Dhan expects segment key like "NSE_EQ" or "NSE_FNO"
            securities = {exchange_segment: [int(security_id)]}
            response = self.dhan.ticker_data(securities)
            
            if response.get("status") == "success" and "data" in response:
                segment_data = response["data"].get(exchange_segment, {})
                scrip_data = segment_data.get(str(security_id), {})
                last_price = scrip_data.get("last_price")
                if last_price:
                    return float(last_price)
            
            # Fallback if API response is empty/failed
            print(f"[FEED WARNING] Quote request failed: {response.get('remarks')}. Falling back to default price.")
            return 2450.0
        except Exception as e:
            print(f"[FEED EXCEPTION] Failed to query quote data: {e}")
            return 2450.0

    def get_candle_snapshot(self, security_id="2885", exchange_segment="NSE_EQ") -> dict:
        """
        Builds or retrieves the latest candle snapshot.
        In simulation mode, it increments the simulated clock.
        """
        if self.simulate:
            # Speed up simulation clock: 1 minute passes every 5 ticks
            self.sim_time += datetime.timedelta(seconds=12)
            price = self.get_latest_price()
            return {
                "high": price + random.uniform(0.1, 1.0),
                "low": price - random.uniform(0.1, 1.0),
                "close": price,
                "time": self.sim_time.time()
            }
        
        # Real-time actual market candles
        price = self.get_latest_price(security_id, exchange_segment)
        now = datetime.datetime.now()
        return {
            "high": price,  # Snapshots use current price for H/L/C verification
            "low": price,
            "close": price,
            "time": now.time()
        }
