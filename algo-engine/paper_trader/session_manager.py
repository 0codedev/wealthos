import time
import datetime
import os
import sys
from paper_trader.dhan_feed import DhanFeed
from oms.kill_switch import is_halted
from oms.openalgo_executor import execute_signal

class SessionManager:
    def __init__(self, simulate=False, symbol="2885", quantity=1, strategy_type=None):
        self.simulate = simulate
        self.symbol = symbol
        self.quantity = quantity
        self.feed = DhanFeed(simulate=self.simulate)
        
        # Determine strategy type
        if not strategy_type:
            strategy_type = os.getenv("STRATEGY", "ORB").upper()
            
        import json
        if strategy_type == "VWAP":
            from strategies.vwap_reversion import VWAPReversion
            vwap_config = {
                "instrument": self.symbol,
                "quantity": self.quantity,
                "std_dev_multiplier": 1.5,
                "stop_multiplier": 2.5
            }
            self.strategy = VWAPReversion(config=vwap_config)
            print(f"[SESSION] Loaded S1: VWAP Mean Reversion Strategy")
        elif strategy_type == "SQUEEZE":
            from strategies.volatility_squeezev2 import VolatilitySqueezeV2
            squeeze_config = {
                "instrument": self.symbol,
                "quantity": self.quantity,
                "lookback": 20,
                "bb_std": 2.0,
                "kc_multiplier": 1.5,
                "min_squeeze_duration": 6,
                "confidence": 0.6,
                "capital": 100000.0
            }
            self.strategy = VolatilitySqueezeV2(config=squeeze_config)
            print(f"[SESSION] Loaded S2: Volatility Squeeze Breakout Strategy (v2)")
        elif strategy_type == "PAIRS":
            from strategies.pairs_arbitrage import PairsArbitrage
            config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "pairs_config.json")
            pairs_config = {}
            if os.path.exists(config_path):
                try:
                    with open(config_path, "r") as f:
                        data = json.load(f)
                        for p in data.get("pairs", []):
                            if p.get("symbol_a") == "TCS" and p.get("symbol_b") == "INFY":
                                pairs_config = p
                                break
                except Exception as e:
                    print(f"[SESSION WARNING] Failed to load pairs config: {e}")
            if not pairs_config:
                pairs_config = {
                    "symbol_a": "TCS",
                    "symbol_b": "INFY",
                    "security_id_a": "11536",
                    "security_id_b": "3506",
                    "z_entry": 2.0,
                    "z_exit": 0.0,
                    "z_stop": 3.5,
                    "capital_allocation": 0.25,
                    "lookback": 20
                }
            pairs_config["capital"] = 1000000.0
            self.strategy = PairsArbitrage(config=pairs_config)
            print(f"[SESSION] Loaded S3: Pairs Arbitrage Strategy ({pairs_config['symbol_a']}/{pairs_config['symbol_b']})")
        elif strategy_type == "MTF":
            from strategies.mtf_momentum import MTFMomentum
            from main import calculate_daily_indicators
            mtf_config = {
                "instrument": self.symbol,
                "quantity": self.quantity,
                "pullback_band": 2.0,
                "max_trades_per_day": 3,
                "capital": 1000000.0,
                "force_intraday_exit": False
            }
            self.strategy = MTFMomentum(config=mtf_config)
            data_root = os.path.abspath(os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "..",
                "python-bridge",
                "data",
                "underlying"
            ))
            try:
                ema_20, ema_50, adx = calculate_daily_indicators(self.symbol, data_root)
                self.strategy.update_daily_state(ema_20, ema_50, adx)
            except Exception as e:
                print(f"[SESSION WARNING] Failed to calculate daily indicators: {e}")
                self.strategy.update_daily_state(2500.0, 2480.0, 28.0)
            print(f"[SESSION] Loaded S4: Multi-Timeframe Momentum Strategy")
        elif strategy_type == "GAP":
            from strategies.gap_fade import GapFade
            gap_config = {
                "instrument": self.symbol,
                "quantity": self.quantity,
                "max_trades_per_day": 1,
                "capital": 1000000.0
            }
            self.strategy = GapFade(config=gap_config)
            self.strategy.update_prev_close(2500.0)
            print(f"[SESSION] Loaded S6: Gap Fade & Continuation Filter Strategy")
        else:
            from strategies.orb_breakout import ORBBreakout
            orb_config = {
                "instrument": self.symbol,
                "quantity": self.quantity,
            }
            
            # Load optimized multipliers if they exist
            best_params_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "orb_best_params.json")
            if os.path.exists(best_params_path):
                try:
                    with open(best_params_path, "r") as f:
                        best_params = json.load(f)
                        orb_config.update(best_params)
                        print(f"[SESSION] Loaded best parameters for ORB: {best_params}")
                except Exception as e:
                    print(f"[SESSION WARNING] Failed to load best parameters: {e}")
                    
            self.strategy = ORBBreakout(config=orb_config)
            print(f"[SESSION] Loaded S1: ORB Breakout Strategy")

    def is_market_open(self):
        """Checks if the actual stock market is open."""
        if self.simulate:
            return True  # Simulation is always open
            
        now = datetime.datetime.now().time()
        today = datetime.datetime.today().weekday()
        is_weekday = today < 5
        market_start = datetime.time(9, 15)
        market_end = datetime.time(15, 20)
        return is_weekday and market_start <= now <= market_end

    def run_loop(self):
        print(f"[SESSION] Starting Paper Trading Session Loop. Symbol: {self.symbol}, Quantity: {self.quantity}, Simulation: {self.simulate}")
        
        ws_client = None
        if not self.simulate:
            try:
                from oms.openalgo_websocket import OpenAlgoWebSocketClient
                from oms.openalgo_executor import _get_symbol_from_token
                
                # Resolve the symbol name (e.g. RELIANCE) from Dhan token if needed
                symbol_name = _get_symbol_from_token(str(self.symbol))
                
                # Callback to process ticks
                def handle_tick(tick_data):
                    # Feed tick to strategy
                    self.strategy.on_tick(tick_data)
                
                ws_client = OpenAlgoWebSocketClient(symbol=symbol_name, exchange="NSE", on_tick_callback=handle_tick)
                ws_client.start()
            except Exception as e:
                print(f"[SESSION WARNING] Failed to start WebSocket client: {e}")
        
        try:
            while True:
                try:
                    if is_halted():
                        print("[SESSION] Engine halted by Kill Switch. Pausing loop...")
                        time.sleep(5)
                        continue

                    if not self.is_market_open():
                        print(f"[SESSION] Market is closed. Idle mode. Timestamp: {datetime.datetime.now()}")
                        time.sleep(30)
                        continue

                    # 1. Fetch current candle snapshot
                    candle = self.feed.get_candle_snapshot(self.symbol)
                    sim_time_str = candle["time"].strftime("%H:%M:%S") if isinstance(candle["time"], datetime.time) else str(candle["time"])
                    print(f"[SESSION] Time: {sim_time_str} | Close LTP: {candle['close']} | High: {candle['high']:.2f} | Low: {candle['low']:.2f}")

                    # 2. Feed to strategy
                    signal = self.strategy.on_candle(candle)
                    
                    # Report strategy building state
                    if self.strategy.orb_high is not None and not self.strategy.orb_captured:
                        if candle["time"] >= datetime.time(9, 30) if isinstance(candle["time"], datetime.time) else True:
                            self.strategy.orb_captured = True
                            print(f"[SESSION] Opening range built: High = {self.strategy.orb_high:.2f}, Low = {self.strategy.orb_low:.2f}")
                    
                    # 3. If strategy outputs signal, execute
                    if signal:
                        print(f"[SESSION] Signal Triggered: {signal.direction} {signal.quantity} shares of {self.symbol} at {candle['close']}")
                        response = execute_signal(signal)
                        print(f"[SESSION] Execution response: {response}")

                    # Poll interval: 2 seconds in simulation to make it fast; 10 seconds in real sandbox
                    time.sleep(2 if self.simulate else 10)
                    
                    # In simulation mode, exit loop once simulation reaches market close (15:20)
                    if self.simulate and isinstance(candle["time"], datetime.time) and candle["time"] >= datetime.time(15, 20):
                        print("[SESSION] Simulated session reached 15:20 market close. Exiting loop.")
                        break
                        
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    print(f"[SESSION ERROR] Exception in session loop: {e}")
                    time.sleep(5)
        except KeyboardInterrupt:
            print("[SESSION] Stopped by user command.")
        finally:
            if ws_client:
                ws_client.stop()
