import threading
import json
import time
import os
import websocket
from dotenv import load_dotenv

# Load environment configuration
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", ".env"))

OPENALGO_API_KEY = os.getenv("OPENALGO_API_KEY", "openalgo_mcp_api_key_2026")

class OpenAlgoWebSocketClient:
    def __init__(self, symbol, exchange="NSE", on_tick_callback=None):
        self.symbol = symbol
        self.exchange = exchange
        self.on_tick_callback = on_tick_callback
        self.ws = None
        self.thread = None
        self.running = False
        self._lock = threading.Lock()
        self._last_price = None
        
        # OpenAlgo WS proxy port is set to 8766 to avoid collision with python-bridge on 8765
        self.ws_url = "ws://127.0.0.1:8766"
        
    @property
    def last_price(self):
        with self._lock:
            return self._last_price

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        print(f"[WS CLIENT] Started background tick stream for {self.symbol} on {self.exchange}.")

    def stop(self):
        self.running = False
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass
        print("[WS CLIENT] Stopped tick stream.")

    def _run_loop(self):
        while self.running:
            try:
                self.ws = websocket.WebSocketApp(
                    self.ws_url,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close
                )
                self.ws.run_forever()
            except Exception as e:
                print(f"[WS CLIENT ERROR] Connection crashed: {e}")
            
            if self.running:
                time.sleep(5)

    def _on_open(self, ws):
        print("[WS CLIENT] Handshake successful. Authenticating...")
        auth_msg = {
            "action": "auth",
            "apikey": OPENALGO_API_KEY
        }
        ws.send(json.dumps(auth_msg))

    def _on_message(self, ws, message):
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "auth" and data.get("status") == "success":
                print("[WS CLIENT] Authentication successful. Subscribing to market data...")
                sub_msg = {
                    "action": "subscribe",
                    "symbol": self.symbol,
                    "exchange": self.exchange,
                    "mode": "LTP"
                }
                ws.send(json.dumps(sub_msg))
                
            elif msg_type == "subscribe" and data.get("status") == "success":
                print(f"[WS CLIENT] Subscription confirmed for {self.symbol}:{self.exchange}")
                
            elif msg_type == "market_data":
                tick_data = data.get("data")
                if tick_data:
                    # Update cache
                    price = tick_data.get("ltp")
                    if price is not None:
                        with self._lock:
                            self._last_price = float(price)
                    
                    # Fire user callback
                    if self.on_tick_callback:
                        try:
                            self.on_tick_callback(tick_data)
                        except Exception as cb_err:
                            print(f"[WS CLIENT ERROR] Callback exception: {cb_err}")
                            
            elif data.get("status") == "error":
                print(f"[WS CLIENT WARNING] Server error response: {data}")
                
        except Exception as e:
            print(f"[WS CLIENT ERROR] Failed to handle incoming message: {e}")

    def _on_error(self, ws, error):
        print(f"[WS CLIENT ERROR] Connection error: {error}")

    def _on_close(self, ws, close_status_code, close_msg):
        print(f"[WS CLIENT] Connection closed. Code={close_status_code}, Msg={close_msg}")
