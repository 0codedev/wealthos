"""
WealthOS Algo Engine — Master Process
Runs 24/7 under PM2. Schedules strategy execution during market hours.
"""
import time
import math
import datetime
import os
import sys
import argparse
import json

# Ensure current directory is in PYTHONPATH for easy imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
# Load environment configuration
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "config", ".env"))

from oms.kill_switch import is_halted, halt_engine

# ── Configuration ────────────────────────────────────────────
MARKET_OPEN  = datetime.time(9, 15)
MARKET_CLOSE = datetime.time(15, 20)

strategies = []

def calculate_daily_indicators(symbol, data_root):
    import pandas as pd
    import numpy as np
    day_path = os.path.join(data_root, symbol, "day", "data.parquet")
    if not os.path.exists(day_path):
        return 2500.0, 2480.0, 28.0
    try:
        df = pd.read_parquet(day_path)
        df = df.sort_values(by="timestamp").reset_index(drop=True)
        if len(df) < 50:
            return 2500.0, 2480.0, 28.0
        closes = df["close"].values
        highs = df["high"].values
        lows = df["low"].values
        
        # 1. EMA 20
        ema_20 = pd.Series(closes).ewm(span=20, adjust=False).mean().iloc[-1]
        # 2. EMA 50
        ema_50 = pd.Series(closes).ewm(span=50, adjust=False).mean().iloc[-1]
        
        # 3. ADX 14
        prev_closes = df["close"].shift(1).values
        tr = np.zeros(len(df))
        for i in range(len(df)):
            if i == 0:
                tr[i] = highs[i] - lows[i]
            else:
                tr[i] = max(highs[i] - lows[i], abs(highs[i] - prev_closes[i]), abs(lows[i] - prev_closes[i]))
        
        plus_dm = np.zeros(len(df))
        minus_dm = np.zeros(len(df))
        for i in range(1, len(df)):
            up = highs[i] - highs[i-1]
            down = lows[i-1] - lows[i]
            if up > down and up > 0:
                plus_dm[i] = up
            if down > up and down > 0:
                minus_dm[i] = down
                
        alpha = 1.0 / 14.0
        atr = pd.Series(tr).ewm(alpha=alpha, adjust=False).mean().values
        plus_di = 100.0 * pd.Series(plus_dm).ewm(alpha=alpha, adjust=False).mean().values / atr
        minus_di = 100.0 * pd.Series(minus_dm).ewm(alpha=alpha, adjust=False).mean().values / atr
        
        dx = 100.0 * np.abs(plus_di - minus_di) / (plus_di + minus_di)
        adx = pd.Series(dx).ewm(alpha=alpha, adjust=False).mean().iloc[-1]
        return float(ema_20), float(ema_50), float(adx)
    except Exception as e:
        print(f"[ENGINE WARNING] Error calculating daily indicators: {e}")
        return 2500.0, 2480.0, 28.0

def init_strategies(strategy_type=None):
    global strategies
    if not strategy_type:
        strategy_type = os.getenv("STRATEGY", "ORB").upper()
        
    strategies = []
    if strategy_type == "VWAP":
        from strategies.vwap_reversion import VWAPReversion
        vwap_config = {
            "instrument": "2885",   # RELIANCE security_id on NSE
            "quantity": 1,          # Minimal quantity for sandbox verification
            "std_dev_multiplier": 1.5,
            "stop_multiplier": 2.5
        }
        strategies.append(VWAPReversion(config=vwap_config))
        print(f"[ENGINE] Initialized S1: VWAP Mean Reversion Strategy")
    elif strategy_type == "SQUEEZE":
        from strategies.volatility_squeezev2 import VolatilitySqueezeV2
        squeeze_config = {
            "instrument": "2885",   # RELIANCE security_id on NSE
            "quantity": 1,          # Minimal quantity for sandbox verification
            "lookback": 20,
            "bb_std": 2.0,
            "kc_multiplier": 1.5,
            "min_squeeze_duration": 6,
            "confidence": 0.6,
            "capital": 100000.0
        }
        strategies.append(VolatilitySqueezeV2(config=squeeze_config))
        print(f"[ENGINE] Initialized S2: Volatility Squeeze Breakout Strategy (v2)")
    elif strategy_type == "PAIRS":
        from strategies.pairs_arbitrage import PairsArbitrage
        config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config", "pairs_config.json")
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
                print(f"[ENGINE WARNING] Failed to load pairs config: {e}")
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
        strategies.append(PairsArbitrage(config=pairs_config))
        print(f"[ENGINE] Initialized S3: Pairs Arbitrage Strategy ({pairs_config['symbol_a']}/{pairs_config['symbol_b']})")
    elif strategy_type == "MTF":
        from strategies.mtf_momentum import MTFMomentum
        mtf_config = {
            "instrument": "2885",   # RELIANCE security_id on NSE
            "quantity": 50,
            "pullback_band": 2.0,
            "max_trades_per_day": 3,
            "capital": 1000000.0,
            "force_intraday_exit": False
        }
        strategy = MTFMomentum(config=mtf_config)
        # Load daily indicators pre-market
        data_root = os.path.abspath(os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..",
            "python-bridge",
            "data",
            "underlying"
        ))
        try:
            ema_20, ema_50, adx = calculate_daily_indicators("RELIANCE", data_root)
            strategy.update_daily_state(ema_20, ema_50, adx)
        except Exception as e:
            print(f"[ENGINE WARNING] Failed to load daily indicators for MTF: {e}")
            strategy.update_daily_state(2500.0, 2480.0, 28.0)
        strategies.append(strategy)
        print(f"[ENGINE] Initialized S4: Multi-Timeframe Momentum Strategy")
    elif strategy_type == "GAP":
        from strategies.gap_fade import GapFade
        gap_config = {
            "instrument": "2885",   # RELIANCE security_id on NSE
            "quantity": 50,
            "max_trades_per_day": 1,
            "capital": 1000000.0
        }
        strategy = GapFade(config=gap_config)
        strategies.append(strategy)
        print(f"[ENGINE] Initialized S6: Gap Fade & Continuation Filter Strategy")
    elif strategy_type == "ROUTER":
        from strategies.regime_router import RegimeRouter
        router_config = {
            "instrument": "2885",   # RELIANCE security_id on NSE
            "quantity": 100,         # High base quantity to test fractional scaling
            "capital": 1000000.0
        }
        strategy = RegimeRouter(config=router_config)
        data_root = os.path.abspath(os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..",
            "python-bridge",
            "data",
            "underlying"
        ))
        try:
            ema_20, ema_50, adx = calculate_daily_indicators("RELIANCE", data_root)
            strategy.update_daily_state(ema_20, ema_50, adx, vix=15.0)
        except Exception as e:
            print(f"[ENGINE WARNING] Failed to load daily indicators for ROUTER: {e}")
            strategy.update_daily_state(2500.0, 2480.0, 28.0, vix=15.0)
        strategies.append(strategy)
        print(f"[ENGINE] Initialized S7: Adaptive Regime Router Strategy")
    elif strategy_type == "SNAP":
        from strategies.ema_snap import EMASnap
        snap_config = {
            "instrument": "2885",   # RELIANCE security_id on NSE
            "quantity": 10,
            "max_trades_per_day": 3,
            "capital": 100000.0
        }
        strategies.append(EMASnap(config=snap_config))
        print(f"[ENGINE] Initialized S8: 10 EMA Snap Strategy")
    else:
        from strategies.orb_breakout import ORBBreakout
        orb_config = {
            "instrument": "2885",   # RELIANCE security_id on NSE
            "quantity": 1,          # Minimal quantity for sandbox verification
        }
        best_params_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config", "orb_best_params.json")
        if os.path.exists(best_params_path):
            try:
                with open(best_params_path, "r") as f:
                    best_params = json.load(f)
                    orb_config.update(best_params)
                    print(f"[ENGINE] Loaded optimized parameters from config: {best_params}")
            except Exception as e:
                print(f"[ENGINE WARNING] Failed to load optimized parameters: {e}")
        strategies.append(ORBBreakout(config=orb_config))
        print(f"[ENGINE] Initialized S1: ORB Breakout Strategy")

def is_market_hours():
    now = datetime.datetime.now().time()
    today = datetime.datetime.today().weekday()
    is_weekday = today < 5   # Monday=0, Friday=4
    return is_weekday and MARKET_OPEN <= now <= MARKET_CLOSE

def run_strategies(candle: dict):
    """Feed a candle to all active strategies."""
    if is_halted():
        print("[ENGINE] Halted by Kill Switch. Not processing signals.")
        return
    
    for strategy in strategies:
        if strategy.is_active:
            try:
                signals = strategy.on_candle(candle)
                if signals:
                    if not isinstance(signals, list):
                        signals = [signals]
                    for signal in signals:
                        from oms.openalgo_executor import execute_signal
                        print(f"[ENGINE] Strategy '{strategy.name}' triggered signal: {signal.direction} {signal.quantity} shares on {signal.instrument}")
                        execute_signal(signal)
            except Exception as e:
                print(f"[ENGINE ERROR] Exception running strategy '{strategy.name}': {e}")

def main_loop(test_mode=False, sandbox_mode=False, simulate_mode=False, strategy_type=None):
    init_strategies(strategy_type)
    print(f"[ENGINE] Algo engine started. Paper Trading: {os.getenv('PAPER_TRADING', 'true')}")
    
    if test_mode:
        print(f"[ENGINE] Running in TEST mode for strategy: {strategies[0].name}...")
        if strategies[0].name.startswith("VWAP"):
            # Simulate a mean reversion drop and recovery
            # VWAP calculation requires cumulative Close*Volume / Volume.
            # We'll generate mock candles where VWAP is ~2450, price drops to 2420 (below -1.5std_dev), RSI drops, then recovers.
            # Generate 15 candles of steady decline to get RSI < 35
            mock_candles = []
            base_price = 2480.0
            for i in range(15):
                close_p = base_price - (i * 4.0)
                mock_candles.append({
                    "open": close_p + 2.0,
                    "high": close_p + 3.0,
                    "low": close_p - 1.0,
                    "close": close_p,
                    "volume": 1000.0,
                    "time": f"09:{16+i:02d}:00"
                })
            # Trigger bounce candle
            mock_candles.append({
                "open": 2418.0,
                "high": 2422.0,
                "low": 2417.0,
                "close": 2420.0,
                "volume": 2000.0,
                "time": "09:32:00"
            })
            print("[TEST] Feeding VWAP mock candles...")
            for candle in mock_candles[:-1]:
                run_strategies(candle)
            
            # The last candle should trigger the signal
            print(f"[TEST] Feeding trigger candle with close: {mock_candles[-1]['close']} (open: {mock_candles[-1]['open']})")
            run_strategies(mock_candles[-1])
        elif strategies[0].name.startswith("Volatility_Squeeze"):
            print("[TEST] Generating 36 mock candles for Volatility Squeeze v2...")
            mock_candles = []
            # 1. Warmup / flat bars (1 to 20)
            for i in range(20):
                mock_candles.append({
                    "open": 2450.0,
                    "high": 2452.0,
                    "low": 2448.0,
                    "close": 2450.0,
                    "volume": 1000.0,
                    "time": f"09:{16+i:02d}:00"
                })
            # 2. Squeeze compression bars (21 to 35)
            for i in range(15):
                mock_candles.append({
                    "open": 2450.0,
                    "high": 2450.5,
                    "low": 2449.5,
                    "close": 2450.0,
                    "volume": 1000.0,
                    "time": f"09:{36+i:02d}:00"
                })
            # 3. Squeeze release breakout bar (36)
            mock_candles.append({
                "open": 2450.0,
                "high": 2465.0,
                "low": 2449.0,
                "close": 2462.0,
                "volume": 5000.0,
                "time": "09:51:00"
            })
            
            print("[TEST] Feeding Squeeze mock candles...")
            for candle in mock_candles[:-1]:
                run_strategies(candle)
                
            print(f"[TEST] Feeding trigger breakout candle with close: {mock_candles[-1]['close']}")
            run_strategies(mock_candles[-1])
        elif strategies[0].name.startswith("Pairs_Arbitrage"):
            print("[TEST] Generating 22 mock dual-symbol candles for Pairs Arbitrage...")
            mock_candles = []
            # Oscillating spread to pass the cointegration check (variance ratio < 0.85)
            for i in range(20):
                price_a = 4000.0 + math.sin(i) * 5.0
                price_b = 2000.0
                time_str = f"09:{16+i:02d}:00"
                mock_candles.append({
                    "time": time_str,
                    "symbol_a": {
                        "open": price_a - 1.0,
                        "high": price_a + 2.0,
                        "low": price_a - 2.0,
                        "close": price_a,
                        "volume": 1000.0,
                        "time": time_str
                    },
                    "symbol_b": {
                        "open": price_b,
                        "high": price_b + 1.0,
                        "low": price_b - 1.0,
                        "close": price_b,
                        "volume": 1000.0,
                        "time": time_str
                    }
                })
            # Diverging entry trigger candle
            price_a = 4040.0
            price_b = 2000.0
            time_str = "09:36:00"
            mock_candles.append({
                "time": time_str,
                "symbol_a": {
                    "open": 4000.0,
                    "high": 4042.0,
                    "low": 3998.0,
                    "close": price_a,
                    "volume": 1000.0,
                    "time": time_str
                },
                "symbol_b": {
                    "open": 2000.0,
                    "high": 2002.0,
                    "low": 1998.0,
                    "close": price_b,
                    "volume": 1000.0,
                    "time": time_str
                }
            })
            # Converging exit trigger candle
            exit_price_a = 4000.0
            exit_price_b = 2000.0
            exit_time_str = "09:37:00"
            mock_candles.append({
                "time": exit_time_str,
                "symbol_a": {
                    "open": 4040.0,
                    "high": 4041.0,
                    "low": 3999.0,
                    "close": exit_price_a,
                    "volume": 1000.0,
                    "time": exit_time_str
                },
                "symbol_b": {
                    "open": 2000.0,
                    "high": 2002.0,
                    "low": 1998.0,
                    "close": exit_price_b,
                    "volume": 1000.0,
                    "time": exit_time_str
                }
            })
            print("[TEST] Feeding Pairs mock candles...")
            for candle in mock_candles[:-2]:
                run_strategies(candle)
            print(f"[TEST] Feeding entry trigger candle with close: A={price_a}, B={price_b}")
            run_strategies(mock_candles[-2])
            print(f"[TEST] Feeding exit convergence candle with close: A={exit_price_a}, B={exit_price_b}")
            run_strategies(mock_candles[-1])
        elif strategies[0].name.startswith("MTF_Momentum"):
            print("[TEST] Generating 22 mock 15-minute candles for MTF Momentum...")
            # Set up daily state: bullish trend and trending ADX
            strategies[0].update_daily_state(2510.0, 2480.0, 30.0)
            
            mock_candles = []
            # 20 warmup candles with volume = 1000
            for i in range(20):
                price = 2500.0 + i * 2.0
                time_str = f"09:{16+i:02d}:00"
                mock_candles.append({
                    "open": price - 1.0,
                    "high": price + 2.0,
                    "low": price - 2.0,
                    "close": price,
                    "volume": 1000.0,
                    "time": time_str
                })
            
            # Candle 21: Pullback and reclaim with volume confirmation
            # Prev close was 2538.0. Let's make EMA(20) around 2520.
            # Low dips to 2518.0 (below EMA(20) + pullback band), close reclaims at 2542.0.
            # Volume is 2500 (>1.3x avg volume of 1000)
            trigger_time = "09:36:00"
            trigger_candle = {
                "open": 2538.0,
                "high": 2545.0,
                "low": 2518.0,
                "close": 2542.0,
                "volume": 2500.0,
                "time": trigger_time
            }
            mock_candles.append(trigger_candle)
            
            print("[TEST] Feeding MTF warmup candles...")
            for candle in mock_candles[:-1]:
                run_strategies(candle)
                
            # Set hourly RSI & MACD manually or ensure they are favorable
            # Since we generated 5 hourly bars, RSI & MACD are calculated.
            # We can force them to favorable values for testing or trust our generated data.
            # Let's ensure the state is favorable for buy:
            strategies[0].state.rsi_14_1h = 55.0
            strategies[0].state.macd_hist_1h = 0.5
            
            print(f"[TEST] Feeding trigger pullback candle with close: {trigger_candle['close']} and low: {trigger_candle['low']}")
            run_strategies(trigger_candle)
            
            # Feed a tick to check trailing stop
            if strategies[0].state.position:
                print("[TEST] Emulating price tick moving up to trigger trailing stop...")
                # Entry was 2542. ATR is calculated. Let's force ATR to 10.0 for simplicity
                strategies[0].state.position.atr = 10.0
                strategies[0].state.position.target = 3000.0 # high target so target isn't hit
                # Tick price up by 28.0 (> 2x ATR = 20.0)
                tick_sim = {"price": 2570.0}
                strategies[0].on_tick(tick_sim)
                if strategies[0].state.position:
                    print(f"[TEST] Position after tick: SL={strategies[0].state.position.stop_loss:.2f}, TrailTriggered={strategies[0].state.position.trail_triggered}")
                    
                    # Tick price down to hit stop
                    print("[TEST] Emulating price drop to hit trailing stop...")
                    tick_sl = {"price": 2555.0} # Should be <= SL (2570 - 10 = 2560)
                    strategies[0].on_tick(tick_sl)
        elif strategies[0].name.startswith("Gap_Fade"):
            print("[TEST] Generating mock 5-minute candles for Gap Fade...")
            # Set yesterday close to 2500
            strategies[0].update_prev_close(2500.0)
            
            # Scenario: Gap up of 0.5% (Open at 2512.5) -> FADE regime
            # Candle 1 (09:15 to 09:20): Open 2512.5, Close 2508.0 (Bearish body confirms reversal)
            # Candle 2 (09:20 to 09:25): Open 2508.0, Close 2505.0
            mock_candles = [
                {"open": 2512.5, "high": 2515.0, "low": 2507.0, "close": 2508.0, "volume": 100.0, "time": "09:20:00", "date": "2026-06-29"},
                {"open": 2508.0, "high": 2510.0, "low": 2504.0, "close": 2505.0, "volume": 3000.0, "time": "09:25:00", "date": "2026-06-29"}
            ]
            print("[TEST] Feeding Gap Fade mock candles...")
            for candle in mock_candles:
                run_strategies(candle)
                
            # Feed a tick to trigger exit
            if strategies[0].state.position:
                print("[TEST] Emulating price tick to hit target (yesterday close)...")
                tick_sim = {"price": 2500.0}
                strategies[0].on_tick(tick_sim)
        elif strategies[0].name.startswith("Regime_Router"):
            print("[TEST] Running Regime Router test...")
            # Set up daily trend: EMA20 > EMA50, ADX=30.0 -> TRENDING_UP -> primary=mtf, secondary=squeeze
            strategies[0].update_daily_state(2510.0, 2480.0, 30.0, vix=15.0)
            
            # Feed 9:20 AM candle to trigger classification
            candle_920 = {"open": 2500.0, "high": 2505.0, "low": 2495.0, "close": 2502.0, "volume": 1000.0, "time": "09:20:00", "date": "2026-06-29"}
            run_strategies(candle_920)
        elif strategies[0].name.startswith("EMA_Snap"):
            print("[TEST] Running EMA Snap test...")
            # Generate 20 candles building up EMAs
            mock_candles = []
            base_price = 2500.0
            for i in range(20):
                price = base_price + i * 5.0
                mock_candles.append({
                    "open": price - 2.0,
                    "high": price + 4.0,
                    "low": price - 3.0,
                    "close": price,
                    "volume": 100.0,
                    "time": f"09:{15 + i}:00",
                    "date": "2026-06-29"
                })
            print("[TEST] Feeding 20 trending candles to build EMAs...")
            for candle in mock_candles:
                run_strategies(candle)
                
            pullback_candle = {
                "open": 2595.0,
                "high": 2600.0,
                "low": 2575.0,   # Touches EMA10
                "close": 2585.0,  # Closes above EMA10
                "volume": 3000.0,  # Volume > Average (100)
                "time": "09:36:00",
                "date": "2026-06-29"
            }
            print("[TEST] Feeding pullback touch candle...")
            run_strategies(pullback_candle)
            
            # Tick to trigger exit
            if strategies[0].state.position:
                print("[TEST] Emulating price tick to hit target...")
                tick_sim = {"price": 2610.0}
                strategies[0].on_tick(tick_sim)
        else:
            # ORB Breakout test
            mock_candles = [
                {"high": 2450.0, "low": 2440.0, "close": 2445.0, "time": "09:16:00"},
                {"high": 2455.0, "low": 2442.0, "close": 2452.0, "time": "09:20:00"},
                {"high": 2453.0, "low": 2445.0, "close": 2448.0, "time": "09:25:00"},
                {"high": 2451.0, "low": 2446.0, "close": 2450.0, "time": "09:30:00"},
            ]
            print("[TEST] Building 15-minute opening range...")
            for candle in mock_candles:
                for strategy in strategies:
                    strategy.on_candle(candle)
            
            breakout_candle = {"high": 2462.0, "low": 2450.0, "close": 2460.0, "time": "09:31:00"}
            print(f"[TEST] Triggering breakout past high ({strategies[0].orb_high if hasattr(strategies[0], 'orb_high') else 'N/A'}) with close: {breakout_candle['close']}")
            run_strategies(breakout_candle)
            
        print("[TEST] Simulation completed successfully.")
        return

    def write_status(mode):
        status_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "journal", "status.json")
        os.makedirs(os.path.dirname(status_file), exist_ok=True)
        status_data = {
            "status": "running",
            "mode": mode,
            "pid": os.getpid(),
            "startTime": int(time.time())
        }
        with open(status_file, "w") as f:
            json.dump(status_data, f)

    def clear_status():
        status_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "journal", "status.json")
        if os.path.exists(status_file):
            try:
                os.remove(status_file)
            except Exception:
                pass

    instrument = strategies[0].config["instrument"]
    quantity = strategies[0].config["quantity"]

    if sandbox_mode or simulate_mode:
        mode = "sandbox" if sandbox_mode else "simulate"
        write_status(mode)
        try:
            from paper_trader.session_manager import SessionManager
            session = SessionManager(
                simulate=simulate_mode, 
                symbol=instrument, 
                quantity=quantity,
                strategy_type=strategy_type
            )
            session.run_loop()
        finally:
            clear_status()
        return


    # Normal 24/7 background scheduler loop
    while True:
        try:
            if is_market_hours():
                print(f"[ENGINE] Market active. Timestamp: {datetime.datetime.now()}")
                # Run the actual sandbox process
                from paper_trader.session_manager import SessionManager
                session = SessionManager(
                    simulate=False, 
                    symbol=instrument, 
                    quantity=quantity,
                    strategy_type=strategy_type
                )
                session.run_loop()
            else:
                print(f"[ENGINE] Market closed. Idle mode. Timestamp: {datetime.datetime.now()}")
        except Exception as e:
            print(f"[ENGINE ERROR] Loop exception: {e}")
            
        time.sleep(60)  # Check every minute

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WealthOS Algo Engine")
    parser.add_argument("--test", action="store_true", help="Run a simulation test run of the selected strategy")
    parser.add_argument("--sandbox", action="store_true", help="Run paper trading session with live Dhan API snapshot data")
    parser.add_argument("--simulate", action="store_true", help="Run a local paper trading session simulation with mock ticks")
    parser.add_argument("--strategy", type=str, default=None, choices=["orb", "vwap", "squeeze", "pairs", "mtf", "gap", "router", "snap"], help="Override strategy to run (orb, vwap, squeeze, pairs, mtf, gap, router, or snap)")
    args = parser.parse_args()
    
    strat_type = args.strategy.upper() if args.strategy else None
    
    main_loop(test_mode=args.test, sandbox_mode=args.sandbox, simulate_mode=args.simulate, strategy_type=strat_type)

