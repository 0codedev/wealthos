import os
import sys
import datetime
import argparse
import pandas as pd

# Add the parent directory to sys.path to resolve imports from strategies/
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strategies.orb_breakout import ORBBreakout
from strategies.orb_enhanced import ORBEnhanced

def load_data(symbol: str, data_root: str, timeframe: str = "15minute") -> pd.DataFrame:
    """Loads historical candles from the local Parquet archive for the given timeframe."""
    parquet_path = os.path.join(data_root, symbol, timeframe, "data.parquet")
    if not os.path.exists(parquet_path):
        raise FileNotFoundError(f"Historical data not found for {symbol} at: {parquet_path}")
    
    df = pd.read_parquet(parquet_path)
    # Parse timestamp strings, removing timezone offsets for sorting/grouping
    # e.g., '2025-12-03T09:15:00+05:30' -> '2025-12-03 09:15:00'
    df['datetime'] = pd.to_datetime(df['timestamp'].str.slice(0, 19))
    df['date'] = df['datetime'].dt.date
    df['time'] = df['datetime'].dt.time
    df = df.sort_values(by='datetime').reset_index(drop=True)
    return df

def get_dynamic_qty(entry_price: float, stop_loss: float, symbol: str, capital: float = 100000.0, risk_pct: float = 0.02, leverage: float = 5.0) -> int:
    """Calculates risk-scaled position sizing (2% risk rule by default) with leverage cap."""
    risk_budget = capital * risk_pct
    price_diff = abs(entry_price - stop_loss)
    
    is_index = "NIFTY" in symbol.upper() or "BANKNIFTY" in symbol.upper()
    
    if price_diff <= 0:
        qty = 1 if is_index else 100
    else:
        qty = int(risk_budget / price_diff)
        qty = max(1, qty)
        
    # Prevent nominal position value from exceeding the total account capital scaled by leverage
    if entry_price > 0:
        max_qty_by_capital = int((capital * leverage) / entry_price)
        qty = min(qty, max_qty_by_capital)
        
    qty = max(1, qty)
    
    # Cap maximum quantity for indices to prevent overleveraging
    if is_index:
        qty = min(qty, 15)
        
    return qty

def calculate_transaction_costs(entry_price: float, exit_price: float, qty: int, symbol: str, is_intraday: bool) -> float:
    """Computes real-world transaction charges: brokerage, STT, exchange transaction charges, SEBI fees, GST, and Stamp duty."""
    buy_val = entry_price * qty
    sell_val = exit_price * qty
    total_turnover = buy_val + sell_val
    
    is_index = "NIFTY" in symbol.upper() or "BANKNIFTY" in symbol.upper()
    
    # 1. Brokerage: flat Rs. 20 per leg = Rs. 40 round-trip
    brokerage = 40.0
    
    # 2. STT (Securities Transaction Tax)
    if is_index:
        stt = 0.000125 * sell_val # Index Futures STT is 0.0125% on sell side
    else:
        if is_intraday:
            stt = 0.00025 * sell_val # Intraday equity STT is 0.025% on sell side
        else:
            stt = 0.001 * buy_val + 0.001 * sell_val # Delivery equity STT is 0.1% on both sides
            
    # 3. Exchange Transaction Charges (NSE)
    if is_index:
        exchange_charges = 0.000019 * total_turnover # NSE Futures (0.0019%)
    else:
        exchange_charges = 0.0000335 * total_turnover # NSE Equity (0.00335%)
        
    # 4. SEBI Turnover Fee
    sebi_fee = 0.000001 * total_turnover # 0.0001% (Rs. 10 per crore)
    
    # 5. Stamp Duty (on buy side only)
    if is_index:
        stamp_duty = 0.00002 * buy_val # 0.002% for futures
    else:
        if is_intraday:
            stamp_duty = 0.00003 * buy_val # 0.003%
        else:
            stamp_duty = 0.00015 * buy_val # 0.015%
            
    # 6. GST (18% on Brokerage + Exchange charges + SEBI fee)
    gst = 0.18 * (brokerage + exchange_charges + sebi_fee)
    
    # Conservatively model slippage as 0.02% of total turnover
    slippage = 0.0002 * total_turnover
    
    total_costs = brokerage + stt + exchange_charges + sebi_fee + stamp_duty + gst + slippage
    return total_costs

def make_trade_record(date, entry_time, exit_time, direction, entry_price, exit_price, stop_loss, target, qty, exit_reason, symbol):
    """Constructs a detailed trade execution record with gross/net P&L and itemized costs."""
    gross_pnl = (exit_price - entry_price) * qty if direction == "BUY" else (entry_price - exit_price) * qty
    is_intraday = str(entry_time).split('T')[0] == str(exit_time).split('T')[0] if 'T' in str(entry_time) and 'T' in str(exit_time) else True
    transaction_costs = calculate_transaction_costs(entry_price, exit_price, qty, symbol, is_intraday)
    net_pnl = gross_pnl - transaction_costs
    
    return {
        "date": date,
        "entry_time": entry_time,
        "exit_time": exit_time,
        "direction": direction,
        "entry_price": entry_price,
        "exit_price": exit_price,
        "stop_loss": stop_loss,
        "target": target,
        "quantity": qty,
        "gross_pnl": gross_pnl,
        "transaction_costs": transaction_costs,
        "pnl": net_pnl,
        "exit_reason": exit_reason
    }

def run_backtest(symbol: str, data_df: pd.DataFrame, quantity: int, from_date: str, to_date: str, target_multiplier: float = 1.5, stop_multiplier: float = 1.0, strategy_name: str = "orb", verbose: bool = True, daily_df: pd.DataFrame = None, capital: float = 100000.0, risk_pct: float = 0.02, dynamic_sizing: bool = True, **kwargs):
    """Simulates trading of the selected strategy over the historical candles dataframe."""
    leverage = float(kwargs.get("leverage", 5.0))
    # Positional carry: when enabled, an open position is NOT force-closed at the
    # end of each session. It is held across days until it hits its stop or target
    # (with realistic gap fills at the next open) or until max_hold_days is reached.
    # This is used by mean-reversion strategies whose reversion target frequently
    # needs more than one session to complete (diagnosed via a high EOD square-off %).
    carry = bool(kwargs.get("positional_carry", False))
    max_hold_days = int(kwargs.get("max_hold_days", 5))
    start_date = datetime.datetime.strptime(from_date, "%Y-%m-%d").date()
    end_date = datetime.datetime.strptime(to_date, "%Y-%m-%d").date()
    
    # Filter by date range
    df = data_df[(data_df['date'] >= start_date) & (data_df['date'] <= end_date)].copy()
    if df.empty:
        if verbose:
            print(f"[ERROR] No candle data found for {symbol} between {from_date} and {to_date}")
        return {}
        
    if verbose:
        print(f"\n[BACKTEST] Running {strategy_name.upper()} Strategy backtest on {symbol}")
        print(f"[BACKTEST] Period: {start_date} to {end_date} ({len(df['date'].unique())} trading days)")
    
    trades = []
    active_trade = None
    active_trades = {}
    
    # Group candles by date and replay each day sequentially
    grouped = df.groupby('date')
    
    strategy = None
    
    for date, day_df in sorted(grouped):
        day_df = day_df.sort_values(by='datetime').reset_index(drop=True)
        
        # Calculate daily reference volume (excluding current day's lookahead)
        ref_volume = None
        if daily_df is not None:
            prev_days = daily_df[daily_df['date'] < date]
            if len(prev_days) >= 20:
                avg_daily_vol = prev_days['volume'].tail(20).mean()
                expected_candles = 75 if len(day_df) > 40 else 25
                ref_volume = avg_daily_vol / expected_candles
                
        # Instantiate strategy
        if strategy is None or strategy_name.upper() != "MTF":
            strategy_config = {
                "instrument": symbol,
                "quantity": quantity,
                "target_multiplier": target_multiplier,
                "stop_multiplier": stop_multiplier,
                "std_dev_multiplier": target_multiplier, # For VWAP
                "capital": capital,
                "risk_pct": risk_pct,
                "dynamic_position_sizing": dynamic_sizing,
                "leverage": leverage
            }
            if ref_volume is not None:
                strategy_config["reference_volume"] = ref_volume
            strategy_config.update(kwargs)
            
            if strategy_name.upper() == "VWAP":
                from strategies.vwap_mean_reversion import VWAPMeanReversion
                strategy = VWAPMeanReversion(config=strategy_config)
            elif strategy_name.upper() == "SQUEEZE":
                from strategies.volatility_squeezev2 import VolatilitySqueezeV2
                strategy_config["lookback"] = 20
                strategy_config["bb_std"] = 2.0
                strategy_config["kc_multiplier"] = 1.5
                strategy_config["min_squeeze_duration"] = 6
                strategy_config["capital"] = capital
                strategy = VolatilitySqueezeV2(strategy_config)
            elif strategy_name.upper() == "PAIRS":
                from strategies.pairs_arbitrage import PairsArbitrage
                # Split combined symbol TCS_INFY back to individual symbols
                symbols = symbol.split('_')
                sym_a = symbols[0] if len(symbols) > 0 else "TCS"
                sym_b = symbols[1] if len(symbols) > 1 else "INFY"
                strategy_config["symbol_a"] = sym_a
                strategy_config["symbol_b"] = sym_b
                strategy_config["security_id_a"] = "11536" if sym_a == "TCS" else "1333"
                strategy_config["security_id_b"] = "3506" if sym_b == "INFY" else "4963"
                strategy_config["z_entry"] = 2.0
                strategy_config["z_exit"] = 0.0
                strategy_config["z_stop"] = 3.5
                strategy_config["capital_allocation"] = 0.25
                strategy_config["lookback"] = 20
                strategy_config["capital"] = capital
                strategy = PairsArbitrage(strategy_config)
            elif strategy_name.upper() == "MTF":
                from strategies.mtf_momentum import MTFMomentum
                strategy_config["pullback_band"] = 2.0
                strategy_config["max_trades_per_day"] = 3
                strategy_config["capital"] = capital
                strategy_config["force_intraday_exit"] = False
                strategy_config["daily_adx_threshold"] = 15.0
                strategy = MTFMomentum(strategy_config)
            elif strategy_name.upper() == "GAP":
                from strategies.gap_fade import GapFade
                strategy_config["capital"] = capital
                strategy_config["max_trades_per_day"] = 1
                strategy_config["volume_threshold_mult"] = 0.5
                strategy = GapFade(strategy_config)
            elif strategy_name.upper() == "ROUTER":
                from strategies.regime_router import RegimeRouter
                strategy_config["capital"] = capital
                strategy = RegimeRouter(strategy_config)
            elif strategy_name.upper() == "SNAP":
                from strategies.ema_snap import EMASnap
                strategy_config["capital"] = capital
                strategy_config["quantity"] = quantity
                strategy = EMASnap(strategy_config)
            elif strategy_name.upper() == "ORB":
                from strategies.orb_enhanced import ORBEnhanced
                strategy = ORBEnhanced(config=strategy_config)
            else:
                strategy = ORBBreakout(strategy_config)
        else:
            if ref_volume is not None:
                strategy.config["reference_volume"] = ref_volume
            
        # Track if we entered a trade today to prevent multiple entries on the same day
        trade_entered_today = False
        
        total_candles = len(day_df)
        
        if strategy_name.upper() == "PAIRS":
            # Pairs Arbitrage execution path
            for idx, row in day_df.iterrows():
                candle_dict = {
                    "time": row['time_a'],
                    "symbol_a": {
                        "open": row['open_a'],
                        "high": row['high_a'],
                        "low": row['low_a'],
                        "close": row['close_a'],
                        "volume": row.get('volume_a', 1000.0),
                        "time": row['time_a']
                    },
                    "symbol_b": {
                        "open": row['open_b'],
                        "high": row['high_b'],
                        "low": row['low_b'],
                        "close": row['close_b'],
                        "volume": row.get('volume_b', 1000.0),
                        "time": row['time_b']
                    }
                }
                
                signals = strategy.on_candle(candle_dict)
                
                if active_trade is None:
                    if signals is not None and len(signals) == 2:
                        sig_a = next(s for s in signals if s.instrument == strategy.instrument_a)
                        sig_b = next(s for s in signals if s.instrument == strategy.instrument_b)
                        active_trade = {
                            "entry_time": row['datetime'],
                            "entry_price_a": sig_a.price,
                            "entry_price_b": sig_b.price,
                            "direction_a": sig_a.direction,
                            "direction_b": sig_b.direction,
                            "qty_a": sig_a.quantity,
                            "qty_b": sig_b.quantity,
                            "pair_type": strategy.state.position.pair_type
                        }
                else:
                    if strategy.state.position is None:
                        # Exit occurred
                        close_a = row['close_a']
                        close_b = row['close_b']
                        
                        if active_trade["direction_a"] == "BUY":
                            pnl_a = (close_a - active_trade["entry_price_a"]) * active_trade["qty_a"]
                        else:
                            pnl_a = (active_trade["entry_price_a"] - close_a) * active_trade["qty_a"]
                            
                        if active_trade["direction_b"] == "BUY":
                            pnl_b = (close_b - active_trade["entry_price_b"]) * active_trade["qty_b"]
                        else:
                            pnl_b = (active_trade["entry_price_b"] - close_b) * active_trade["qty_b"]
                            
                        pnl = pnl_a + pnl_b
                        
                        is_intraday = str(active_trade["entry_time"]).split('T')[0] == str(row['datetime']).split('T')[0] if 'T' in str(active_trade["entry_time"]) and 'T' in str(row['datetime']) else True
                        costs_a = calculate_transaction_costs(active_trade["entry_price_a"], close_a, active_trade["qty_a"], sym_a, is_intraday)
                        costs_b = calculate_transaction_costs(active_trade["entry_price_b"], close_b, active_trade["qty_b"], sym_b, is_intraday)
                        total_costs = costs_a + costs_b
                        net_pnl = pnl - total_costs
                        
                        trades.append({
                            "date": date,
                            "entry_time": active_trade["entry_time"],
                            "exit_time": row['datetime'],
                            "direction": active_trade["pair_type"],
                            "entry_price": active_trade["entry_price_a"],
                            "exit_price": close_a,
                            "stop_loss": 0.0,
                            "target": 0.0,
                            "quantity": active_trade["qty_a"],
                            "gross_pnl": pnl,
                            "transaction_costs": total_costs,
                            "pnl": net_pnl,
                            "exit_reason": "MEAN_REVERSION_OR_STOP"
                        })
                        active_trade = None
            continue
        if strategy_name.upper() in ("MTF", "VWAP", "SNAP"):
            # MTF or VWAP daily state update path
            # 1. Update daily indicators at the start of the day (avoiding lookahead bias)
            import numpy as np
            if daily_df is not None:
                try:
                    prev_day_df = daily_df[daily_df['date'] < date]
                    if len(prev_day_df) >= 20:
                        closes = prev_day_df['close'].values
                        highs = prev_day_df['high'].values
                        lows = prev_day_df['low'].values
                        
                        ema_20 = pd.Series(closes).ewm(span=20, adjust=False).mean().iloc[-1]
                        ema_50 = pd.Series(closes).ewm(span=50, adjust=False).mean().iloc[-1]
                        
                        # ADX 14
                        prev_closes = prev_day_df['close'].shift(1).values
                        tr = np.zeros(len(prev_day_df))
                        for i in range(len(prev_day_df)):
                            if i == 0:
                                tr[i] = highs[i] - lows[i]
                            else:
                                tr[i] = max(highs[i] - lows[i], abs(highs[i] - prev_closes[i]), abs(lows[i] - prev_closes[i]))
                                
                        plus_dm = np.zeros(len(prev_day_df))
                        minus_dm = np.zeros(len(prev_day_df))
                        for i in range(1, len(prev_day_df)):
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
                        
                        strategy.update_daily_state(ema_20, ema_50, adx)
                    else:
                        strategy.update_daily_state(2500.0, 2480.0, 28.0)
                except Exception as e:
                    print(f"[BACKTEST WARNING] Failed to calculate daily indicators on {date}: {e}")
                    strategy.update_daily_state(2500.0, 2480.0, 28.0)
            else:
                strategy.update_daily_state(2500.0, 2480.0, 28.0)
        if strategy_name.upper() in ("GAP", "ROUTER"):
            # GAP / ROUTER execution path
            # 1. Update yesterday's close and daily state (for ROUTER)
            if daily_df is not None:
                try:
                    prev_day_df = daily_df[daily_df['date'] < date]
                    if len(prev_day_df) >= 1:
                        prev_close = float(prev_day_df['close'].values[-1])
                        strategy.update_prev_close(prev_close)
                    else:
                        strategy.update_prev_close(2500.0)
                        
                    if strategy_name.upper() == "ROUTER":
                        import numpy as np
                        if len(prev_day_df) >= 20:
                            closes = prev_day_df['close'].values
                            highs = prev_day_df['high'].values
                            lows = prev_day_df['low'].values
                            
                            ema_20 = pd.Series(closes).ewm(span=20, adjust=False).mean().iloc[-1]
                            ema_50 = pd.Series(closes).ewm(span=50, adjust=False).mean().iloc[-1]
                            
                            plus_dm = np.zeros(len(closes))
                            minus_dm = np.zeros(len(closes))
                            tr = np.zeros(len(closes))
                            for i in range(1, len(closes)):
                                up = highs[i] - highs[i-1]
                                down = lows[i-1] - lows[i]
                                plus_dm[i] = up if up > down and up > 0 else 0
                                minus_dm[i] = down if down > up and down > 0 else 0
                                tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
                                
                            alpha = 1.0 / 14.0
                            atr = pd.Series(tr).ewm(alpha=alpha, adjust=False).mean().iloc[-1]
                            plus_di = 100.0 * pd.Series(plus_dm).ewm(alpha=alpha, adjust=False).mean().iloc[-1] / (atr if atr > 0 else 1.0)
                            minus_di = 100.0 * pd.Series(minus_dm).ewm(alpha=alpha, adjust=False).mean().iloc[-1] / (atr if atr > 0 else 1.0)
                            dx = 100.0 * np.abs(plus_di - minus_di) / ((plus_di + minus_di) if (plus_di + minus_di) > 0 else 1.0)
                            adx = pd.Series(dx).ewm(alpha=alpha, adjust=False).mean().iloc[-1]
                            
                            strategy.update_daily_state(ema_20, ema_50, adx, vix=15.0)
                        else:
                            strategy.update_daily_state(2500.0, 2480.0, 28.0, vix=15.0)
                except Exception as e:
                    print(f"[BACKTEST WARNING] Failed to get prev close/daily indicators on {date}: {e}")
                    strategy.update_prev_close(2500.0)
                    if strategy_name.upper() == "ROUTER":
                        strategy.update_daily_state(2500.0, 2480.0, 28.0, vix=15.0)
            else:
                strategy.update_prev_close(2500.0)
                if strategy_name.upper() == "ROUTER":
                    strategy.update_daily_state(2500.0, 2480.0, 28.0, vix=15.0)

            # 2. Replay 5-minute candles
            for idx, row in day_df.iterrows():
                candle_time = row['time']
                close = row['close']
                high = row['high']
                low = row['low']
                
                candle_dict = {
                    "open": row['open'],
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": row.get('volume', 1000.0),
                    "time": candle_time,
                    "date": date
                }
                
                if strategy_name.upper() == "ROUTER":
                    # Check ticks for active concurrent positions
                    if active_trades:
                        for child_name, trade in list(active_trades.items()):
                            direction = trade["direction"]
                            qty = trade["quantity"]
                            ticks = [
                                {"price": row['open']},
                                {"price": low if direction == "BUY" else high},
                                {"price": high if direction == "BUY" else low},
                                {"price": close}
                            ]
                            for tick in ticks:
                                strategy.on_tick(tick)
                                child_strat = strategy.children.get(child_name)
                                is_closed = False
                                if child_name == "gap" and child_strat.state.position is None:
                                    is_closed = True
                                elif child_name == "mtf" and child_strat.state.position is None:
                                    is_closed = True
                                elif child_name == "squeeze" and getattr(child_strat, "state", None) is not None and child_strat.state.position is None:
                                    is_closed = True
                                elif child_name == "vwap" and getattr(child_strat, "state", None) is not None and child_strat.state.position is None:
                                    is_closed = True
                                    
                                if is_closed:
                                    exit_price = tick["price"]
                                    is_target = (direction == "BUY" and exit_price >= trade["target"]) or (direction == "SELL" and exit_price <= trade["target"])
                                    reason = "TARGET" if is_target else "TRAILING_STOP_LOSS"
                                    trades.append(make_trade_record(
                                        date=date,
                                        entry_time=trade["entry_time"],
                                        exit_time=row['datetime'],
                                        direction=direction,
                                        entry_price=trade["entry_price"],
                                        exit_price=exit_price,
                                        stop_loss=trade["stop_loss"],
                                        target=trade["target"],
                                        qty=qty,
                                        exit_reason=f"{child_name.upper()}_{reason}",
                                        symbol=symbol
                                    ))
                                    del active_trades[child_name]
                                    break
                                    
                    # Router entries check
                    sigs = strategy.on_candle(candle_dict)
                    if sigs is not None:
                        sig_list = sigs if isinstance(sigs, list) else [sigs]
                        for sig in sig_list:
                            child_key = None
                            if "MTF" in sig.strategy_name:
                                child_key = "mtf"
                            elif "Gap" in sig.strategy_name:
                                child_key = "gap"
                            elif "VWAP" in sig.strategy_name:
                                child_key = "vwap"
                            elif "Squeeze" in sig.strategy_name:
                                child_key = "squeeze"
                            elif "Pairs" in sig.strategy_name:
                                child_key = "pairs"
                                
                            if child_key and child_key not in active_trades:
                                entry_price = sig.price if (sig.price is not None and sig.price > 0.0) else close
                                stop_loss = sig.stop_loss
                                if dynamic_sizing:
                                    qty = get_dynamic_qty(entry_price, stop_loss, symbol, capital, risk_pct, leverage)
                                else:
                                    qty = sig.quantity
                                active_trades[child_key] = {
                                    "entry_time": row['datetime'],
                                    "entry_price": entry_price,
                                    "direction": sig.direction,
                                    "stop_loss": stop_loss,
                                    "target": sig.target,
                                    "quantity": qty
                                }
                else:
                    # Normal single GAP strategy path
                    if active_trade is not None:
                        direction = active_trade["direction"]
                        if direction == "BUY":
                            ticks = [
                                {"price": row['open']},
                                {"price": low},
                                {"price": high},
                                {"price": close}
                            ]
                        else:
                            ticks = [
                                {"price": row['open']},
                                {"price": high},
                                {"price": low},
                                {"price": close}
                            ]
                            
                        for tick in ticks:
                            strategy.on_tick(tick)
                            if strategy.state.position is None:
                                exit_price = tick["price"]
                                is_target = (direction == "BUY" and exit_price >= active_trade["target"]) or (direction == "SELL" and exit_price <= active_trade["target"])
                                reason = "TARGET" if is_target else "TRAILING_STOP_LOSS"
                                trades.append(make_trade_record(
                                    date=date,
                                    entry_time=active_trade["entry_time"],
                                    exit_time=row['datetime'],
                                    direction=direction,
                                    entry_price=active_trade["entry_price"],
                                    exit_price=exit_price,
                                    stop_loss=active_trade["stop_loss"],
                                    target=active_trade["target"],
                                    qty=active_trade["quantity"],
                                    exit_reason=reason,
                                    symbol=symbol
                                ))
                                active_trade = None
                                break
                                
                    if active_trade is None:
                        if not trade_entered_today:
                            signal = strategy.on_candle(candle_dict)
                            if signal is not None:
                                entry_price = signal.price if signal.price > 0.0 else close
                                stop_loss = signal.stop_loss
                                if dynamic_sizing:
                                    qty = get_dynamic_qty(entry_price, stop_loss, symbol, capital, risk_pct, leverage)
                                else:
                                    qty = quantity
                                active_trade = {
                                    "entry_time": row['datetime'],
                                    "entry_price": entry_price,
                                    "direction": signal.direction,
                                    "stop_loss": stop_loss,
                                    "target": signal.target,
                                    "quantity": qty
                                }
                                trade_entered_today = True
                    else:
                        signal = strategy.on_candle(candle_dict)
                        if signal is not None and signal.price == 0.0:
                            exit_price = close
                            direction = active_trade["direction"]
                            trades.append(make_trade_record(
                                date=date,
                                entry_time=active_trade["entry_time"],
                                exit_time=row['datetime'],
                                direction=direction,
                                entry_price=active_trade["entry_price"],
                                exit_price=exit_price,
                                stop_loss=active_trade["stop_loss"],
                                target=active_trade["target"],
                                qty=active_trade["quantity"],
                                exit_reason="REGIME_EXIT",
                                symbol=symbol
                            ))
                            active_trade = None
 
            # End of day square-off for ROUTER child strategies
            if strategy_name.upper() == "ROUTER":
                for child_name, trade in list(active_trades.items()):
                    exit_price = close
                    direction = trade["direction"]
                    qty = trade["quantity"]
                    trades.append(make_trade_record(
                        date=date,
                        entry_time=trade["entry_time"],
                        exit_time=row['datetime'],
                        direction=direction,
                        entry_price=trade["entry_price"],
                        exit_price=exit_price,
                        stop_loss=trade["stop_loss"],
                        target=trade["target"],
                        qty=qty,
                        exit_reason=f"{child_name.upper()}_EOD_SQUAREOFF",
                        symbol=symbol
                    ))
                    child_strat = strategy.children.get(child_name)
                    if child_name == "gap":
                        child_strat.state.position = None
                    elif child_name == "mtf":
                        child_strat.state.position = None
                    elif child_name == "squeeze" and getattr(child_strat, "state", None) is not None:
                        child_strat.state.position = None
                    elif child_name == "vwap":
                        child_strat.position = None
                active_trades.clear()
        else:
            # Single asset execution path (ORB/VWAP/SQUEEZE/SNAP)
            for idx, row in day_df.iterrows():
                candle_time = row['time']
                close = row['close']
                high = row['high']
                low = row['low']
                
                candle_dict = {
                    "open": row['open'],
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": row.get('volume', 1.0),
                    "time": candle_time,
                    "date": date
                }
                
                if active_trade is not None:
                    direction = active_trade["direction"]

                    # --- Positional carry: realistic gap fill at the candle open ---
                    # If a carried position opens beyond its stop/target (typically an
                    # overnight gap), fill at the open rather than the (optimistic) level.
                    if carry:
                        op = float(row['open'])
                        gap_exit = None
                        if direction == "BUY":
                            if op <= active_trade["stop_loss"]:
                                gap_exit = (op, "GAP_STOP_LOSS")
                            elif op >= active_trade["target"]:
                                gap_exit = (op, "GAP_TARGET")
                        else:
                            if op >= active_trade["stop_loss"]:
                                gap_exit = (op, "GAP_STOP_LOSS")
                            elif op <= active_trade["target"]:
                                gap_exit = (op, "GAP_TARGET")
                        if gap_exit is not None:
                            exit_price, reason = gap_exit
                            trades.append(make_trade_record(
                                date=date,
                                entry_time=active_trade["entry_time"],
                                exit_time=row['datetime'],
                                direction=direction,
                                entry_price=active_trade["entry_price"],
                                exit_price=exit_price,
                                stop_loss=active_trade["stop_loss"],
                                target=active_trade["target"],
                                qty=active_trade["quantity"],
                                exit_reason=reason,
                                symbol=symbol
                            ))
                            active_trade = None
                            if hasattr(strategy, "state"):
                                strategy.state.position = None
                                strategy.on_candle(candle_dict)
                            else:
                                strategy.position_open = False
                            continue

                    if direction == "BUY":
                        # Check Stop-Loss
                        if low <= active_trade["stop_loss"]:
                            exit_price = active_trade["stop_loss"]
                            trades.append(make_trade_record(
                                date=date,
                                entry_time=active_trade["entry_time"],
                                exit_time=row['datetime'],
                                direction="BUY",
                                entry_price=active_trade["entry_price"],
                                exit_price=exit_price,
                                stop_loss=active_trade["stop_loss"],
                                target=active_trade["target"],
                                qty=active_trade["quantity"],
                                exit_reason="STOP_LOSS",
                                symbol=symbol
                            ))
                            active_trade = None
                            if hasattr(strategy, "state"):
                                strategy.state.position = None
                                strategy.on_candle(candle_dict)  # Update indicators
                            else:
                                strategy.position_open = False
                            continue
                        
                        # Check Target
                        if high >= active_trade["target"]:
                            exit_price = active_trade["target"]
                            trades.append(make_trade_record(
                                date=date,
                                entry_time=active_trade["entry_time"],
                                exit_time=row['datetime'],
                                direction="BUY",
                                entry_price=active_trade["entry_price"],
                                exit_price=exit_price,
                                stop_loss=active_trade["stop_loss"],
                                target=active_trade["target"],
                                qty=active_trade["quantity"],
                                exit_reason="TARGET",
                                symbol=symbol
                            ))
                            active_trade = None
                            if hasattr(strategy, "state"):
                                strategy.state.position = None
                                strategy.on_candle(candle_dict)  # Update indicators
                            else:
                                strategy.position_open = False
                            continue
                    
                    else: # SELL / SHORT
                        # Check Stop-Loss (higher price than entry)
                        if high >= active_trade["stop_loss"]:
                            exit_price = active_trade["stop_loss"]
                            trades.append(make_trade_record(
                                date=date,
                                entry_time=active_trade["entry_time"],
                                exit_time=row['datetime'],
                                direction="SELL",
                                entry_price=active_trade["entry_price"],
                                exit_price=exit_price,
                                stop_loss=active_trade["stop_loss"],
                                target=active_trade["target"],
                                qty=active_trade["quantity"],
                                exit_reason="STOP_LOSS",
                                symbol=symbol
                            ))
                            active_trade = None
                            if hasattr(strategy, "state"):
                                strategy.state.position = None
                                strategy.on_candle(candle_dict)  # Update indicators
                            else:
                                strategy.position_open = False
                            continue
                        
                        # Check Target (lower price than entry)
                        if low <= active_trade["target"]:
                            exit_price = active_trade["target"]
                            trades.append(make_trade_record(
                                date=date,
                                entry_time=active_trade["entry_time"],
                                exit_time=row['datetime'],
                                direction="SELL",
                                entry_price=active_trade["entry_price"],
                                exit_price=exit_price,
                                stop_loss=active_trade["stop_loss"],
                                target=active_trade["target"],
                                qty=active_trade["quantity"],
                                exit_reason="TARGET",
                                symbol=symbol
                            ))
                            active_trade = None
                            if hasattr(strategy, "state"):
                                strategy.state.position = None
                                strategy.on_candle(candle_dict)  # Update indicators
                            else:
                                strategy.position_open = False
                            continue
                    
                    # End of Day Square-Off (Exit on the last candle of the day).
                    # In positional-carry mode we do NOT force a session-end exit; we
                    # only square off on the last candle once the position has been
                    # held for max_hold_days, to bound overnight exposure.
                    is_last_candle = (idx == total_candles - 1)
                    do_squareoff = False
                    squareoff_reason = "EOD_SQUAREOFF"
                    if is_last_candle:
                        if not carry:
                            do_squareoff = True
                        else:
                            try:
                                held_days = (pd.to_datetime(row['datetime']).normalize()
                                             - pd.to_datetime(active_trade["entry_time"]).normalize()).days
                            except Exception:
                                held_days = 0
                            if held_days >= max_hold_days:
                                do_squareoff = True
                                squareoff_reason = "MAX_HOLD_SQUAREOFF"
                    if do_squareoff:
                        exit_price = close
                        trades.append(make_trade_record(
                            date=date,
                            entry_time=active_trade["entry_time"],
                            exit_time=row['datetime'],
                            direction=direction,
                            entry_price=active_trade["entry_price"],
                            exit_price=exit_price,
                            stop_loss=active_trade["stop_loss"],
                            target=active_trade["target"],
                            qty=active_trade["quantity"],
                            exit_reason=squareoff_reason,
                            symbol=symbol
                        ))
                        active_trade = None
                        if hasattr(strategy, "state"):
                            strategy.state.position = None
                            strategy.on_candle(candle_dict)  # Update indicators
                        else:
                            strategy.position_open = False
                        continue
                    
                    # If not hit stop/target, call on_candle to update indicators and check for trailing stop.
                    # In carry mode we still update indicators but ignore the strategy's own
                    # session square-off (price==0) so the position can be held across days.
                    if hasattr(strategy, "state"):
                        sig = strategy.on_candle(candle_dict)
                        if (not carry) and sig is not None and sig.price == 0.0:  # Trailing stop or EOD exit triggered by strategy
                            exit_price = close
                            trades.append(make_trade_record(
                                date=date,
                                entry_time=active_trade["entry_time"],
                                exit_time=row['datetime'],
                                direction=direction,
                                entry_price=active_trade["entry_price"],
                                exit_price=exit_price,
                                stop_loss=active_trade["stop_loss"],
                                target=active_trade["target"],
                                qty=active_trade["quantity"],
                                exit_reason="TRAILING_STOP_LOSS",
                                symbol=symbol
                            ))
                            active_trade = None
                            strategy.state.position = None
                            continue
                
                # 2. If no active trade, let strategy check for breakout / entries
                elif not trade_entered_today:
                    signal = strategy.on_candle(candle_dict)
                    if signal is not None:
                        entry_price = close
                        stop_loss = signal.stop_loss
                        if dynamic_sizing:
                            qty = get_dynamic_qty(entry_price, stop_loss, symbol, capital, risk_pct, leverage)
                        else:
                            qty = quantity
                        active_trade = {
                            "entry_time": row['datetime'],
                            "entry_price": entry_price,
                            "stop_loss": stop_loss,
                            "target": signal.target,
                            "direction": signal.direction,
                            "quantity": qty
                        }
                        trade_entered_today = True

    # Final cleanup: in carry mode, close any position still open at the end of the
    # available data at the last observed close so it is accounted for in the stats.
    if carry and active_trade is not None:
        trades.append(make_trade_record(
            date=date,
            entry_time=active_trade["entry_time"],
            exit_time=row['datetime'],
            direction=active_trade["direction"],
            entry_price=active_trade["entry_price"],
            exit_price=close,
            stop_loss=active_trade["stop_loss"],
            target=active_trade["target"],
            qty=active_trade["quantity"],
            exit_reason="FINAL_SQUAREOFF",
            symbol=symbol
        ))
        active_trade = None

    # Compute stats
    return report_stats(symbol, trades, quantity, strategy_name, verbose=verbose)

def report_stats(symbol: str, trades: list, quantity: int, strategy_name: str, verbose: bool = True):
    """Calculates, prints and returns performance metrics of the backtest simulation."""
    if not trades:
        if verbose:
            print(f"\n[BACKTEST] No trades were triggered during the selected period for {strategy_name.upper()}.")
        return {
            "total_trades": 0,
            "win_rate": 0.0,
            "total_pnl": 0.0,
            "profit_factor": 0.0,
            "max_drawdown": 0.0,
            "avg_pnl": 0.0
        }
        
    df_trades = pd.DataFrame(trades)
    
    total_trades = len(df_trades)
    winning_trades = df_trades[df_trades['pnl'] > 0]
    losing_trades = df_trades[df_trades['pnl'] <= 0]
    
    total_pnl = df_trades['pnl'].sum()
    win_rate = (len(winning_trades) / total_trades) * 100
    
    gross_profits = winning_trades['pnl'].sum()
    gross_losses = abs(losing_trades['pnl'].sum())
    profit_factor = gross_profits / gross_losses if gross_losses > 0 else float('inf')
    
    avg_pnl = df_trades['pnl'].mean()
    max_win = df_trades['pnl'].max()
    max_loss = df_trades['pnl'].min()
    
    # Calculate drawdown
    df_trades['cumulative_pnl'] = df_trades['pnl'].cumsum()
    peak = df_trades['cumulative_pnl'].cummax()
    drawdown = peak - df_trades['cumulative_pnl']
    max_drawdown = drawdown.max()
    
    # Exits split
    reasons = df_trades['exit_reason'].value_counts()
    
    if verbose:
        print("\n" + "="*50)
        print(f" {strategy_name.upper()} BACKTEST REPORT: {symbol}")
        print("="*50)
        print(f"Total Trades         : {total_trades}")
        print(f"Win Rate             : {win_rate:.2f}%")
        print(f"Total P&L            : Rs. {total_pnl:,.2f}")
        print(f"Profit Factor        : {profit_factor:.2f}")
        print(f"Max Drawdown         : Rs. {max_drawdown:,.2f}")
        print(f"Avg P&L per Trade    : Rs. {avg_pnl:,.2f}")
        print(f"Largest Winning Trade: Rs. {max_win:,.2f}")
        print(f"Largest Losing Trade : Rs. {max_loss:,.2f}")
        print("-"*50)
        print("Exit Analysis:")
        for reason, count in reasons.items():
            print(f"  - {reason}: {count} ({count/total_trades*100:.1f}%)")
        print("="*50 + "\n")
        
    # Save report (always export trade ledger CSV for portfolio aggregator scripts)
    os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports"), exist_ok=True)
    report_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports", f"report_{strategy_name.lower()}_{symbol}.csv")
    df_trades.to_csv(report_file, index=False)
    if verbose:
        print(f"[BACKTEST] Detailed trade ledger exported to: {report_file}")

    return {
        "total_trades": total_trades,
        "win_rate": win_rate,
        "total_pnl": total_pnl,
        "profit_factor": profit_factor,
        "max_drawdown": max_drawdown,
        "avg_pnl": avg_pnl
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WealthOS Strategy Backtester")
    parser.add_argument("--symbol", type=str, default="RELIANCE", help="Symbol to backtest (e.g. RELIANCE, NIFTY)")
    parser.add_argument("--symbol-a", type=str, default="TCS", help="Symbol A for pairs trading")
    parser.add_argument("--symbol-b", type=str, default="INFY", help="Symbol B for pairs trading")
    parser.add_argument("--quantity", type=int, default=100, help="Order quantity per trade")
    parser.add_argument("--from-date", type=str, default="2023-01-01", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--to-date", type=str, default="2026-06-28", help="End date (YYYY-MM-DD)")
    parser.add_argument("--target-multiplier", type=float, default=1.5, help="Target multiplier (ORB range or VWAP std dev)")
    parser.add_argument("--stop-multiplier", type=float, default=1.0, help="Stop loss multiplier")
    parser.add_argument("--strategy", type=str, default="orb", choices=["orb", "vwap", "squeeze", "pairs", "mtf", "gap", "router", "snap"], help="Strategy to run (orb, vwap, squeeze, pairs, mtf, gap, router, or snap)")
    parser.add_argument("--data-root", type=str, default=None, help="Root folder of parquet data")
    parser.add_argument("--capital", type=float, default=100000.0, help="Trading capital")
    parser.add_argument("--risk-pct", type=float, default=0.02, help="Risk percent per trade")
    parser.add_argument("--dynamic-sizing", action="store_true", default=True, help="Enable dynamic position sizing based on risk")
    parser.add_argument("--no-dynamic-sizing", action="store_false", dest="dynamic_sizing", help="Disable dynamic position sizing")
    parser.add_argument("--opening-range-minutes", type=int, default=15, help="Opening range size in minutes (ORB only)")
    parser.add_argument("--volume-multiple", type=float, default=1.5, help="Volume confirmation threshold multiplier (ORB only)")
    parser.add_argument("--require-retest", type=str, default="true", help="'true' or 'false' to require ORB retest confirmation")
    parser.add_argument("--require-volume-confirmation", type=str, default="true", help="'true' or 'false' to require ORB volume confirmation")
    parser.add_argument("--no-new-entry", type=str, default="15:00:00", help="Time after which no new entries are allowed (HH:MM:SS)")
    parser.add_argument("--leverage", type=float, default=5.0, help="Leverage multiplier for position sizing")
    
    args = parser.parse_args()
    
    # Resolve default data root path relative to this script
    if args.data_root is None:
        args.data_root = os.path.abspath(os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "..",
            "python-bridge",
            "data",
            "underlying"
        ))
        
    try:
        tf = "5minute" if args.strategy.lower() in ("squeeze", "gap", "router") else "15minute"
        
        if args.strategy.lower() == "pairs":
            print(f"[BACKTEST] Loading dual symbols: {args.symbol_a} and {args.symbol_b}")
            data_df_a = load_data(args.symbol_a, args.data_root, timeframe=tf)
            data_df_b = load_data(args.symbol_b, args.data_root, timeframe=tf)
            
            # Align and merge by datetime
            data_df = pd.merge(data_df_a, data_df_b, on="datetime", suffixes=("_a", "_b"))
            data_df["date"] = data_df["datetime"].dt.date
            data_df["time_a"] = data_df["datetime"].dt.time
            data_df["time_b"] = data_df["datetime"].dt.time
            
            run_backtest(
                symbol=f"{args.symbol_a}_{args.symbol_b}",
                data_df=data_df,
                quantity=args.quantity,
                from_date=args.from_date,
                to_date=args.to_date,
                target_multiplier=args.target_multiplier,
                stop_multiplier=args.stop_multiplier,
                strategy_name=args.strategy,
                capital=args.capital,
                risk_pct=args.risk_pct,
                dynamic_sizing=args.dynamic_sizing
            )
        elif args.strategy.lower() in ("mtf", "gap", "router", "vwap", "orb", "squeeze"):
            print(f"[BACKTEST] Loading {args.strategy} data: {tf} and Daily candles for {args.symbol}")
            data_df = load_data(args.symbol, args.data_root, timeframe=tf)
            daily_df = load_data(args.symbol, args.data_root, timeframe="day")
            # Ensure day is datetime
            daily_df["date"] = daily_df["datetime"].dt.date
            
            run_backtest(
                symbol=args.symbol,
                data_df=data_df,
                quantity=args.quantity,
                from_date=args.from_date,
                to_date=args.to_date,
                target_multiplier=args.target_multiplier,
                stop_multiplier=args.stop_multiplier,
                strategy_name=args.strategy,
                daily_df=daily_df,
                capital=args.capital,
                risk_pct=args.risk_pct,
                dynamic_sizing=args.dynamic_sizing,
                opening_range_minutes=args.opening_range_minutes,
                volume_multiple=args.volume_multiple,
                require_retest=args.require_retest.lower() == 'true',
                require_volume_confirmation=args.require_volume_confirmation.lower() == 'true',
                no_new_entry=args.no_new_entry
            )
        else:
            data_df = load_data(args.symbol, args.data_root, timeframe=tf)
            run_backtest(
                symbol=args.symbol,
                data_df=data_df,
                quantity=args.quantity,
                from_date=args.from_date,
                to_date=args.to_date,
                target_multiplier=args.target_multiplier,
                stop_multiplier=args.stop_multiplier,
                strategy_name=args.strategy,
                capital=args.capital,
                risk_pct=args.risk_pct,
                dynamic_sizing=args.dynamic_sizing,
                opening_range_minutes=args.opening_range_minutes,
                volume_multiple=args.volume_multiple,
                require_retest=args.require_retest.lower() == 'true',
                require_volume_confirmation=args.require_volume_confirmation.lower() == 'true',
                no_new_entry=args.no_new_entry
            )
    except Exception as e:
        print(f"[ERROR] Backtest run failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
