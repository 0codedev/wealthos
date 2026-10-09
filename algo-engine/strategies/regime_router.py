"""Adaptive Regime Router Meta-Strategy.

This module implements the S7: Adaptive Regime Router strategy.
"""

from strategies.base_strategy import BaseStrategy, Signal
from typing import Optional, List, Union
import datetime
import os
import csv

class PerDayState:
    def __init__(self):
        self.last_time = None
        self.last_date = None
        self.daily_ema_20 = None
        self.daily_ema_50 = None
        self.daily_adx_14 = 0.0
        self.daily_vix = 15.0
        
        self.regime = None
        self.primary_strategy = None
        self.secondary_strategy = None
        self.capital_primary = 0.0
        self.capital_secondary = 0.0

class RegimeRouter(BaseStrategy):
    def __init__(self, config: dict):
        super().__init__("Regime_Router_v1", config)
        self.state = PerDayState()
        
        # Initialize child strategies
        self._init_children(config)
        
        # Prepare log file path
        self.log_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "journal",
            "regime_log.csv"
        )
        os.makedirs(os.path.dirname(self.log_file), exist_ok=True)
        self._init_log_csv()

    def _init_children(self, config: dict):
        from strategies.vwap_mean_reversion import VWAPMeanReversion
        from strategies.volatility_squeezev2 import VolatilitySqueezeV2
        from strategies.pairs_arbitrage import PairsArbitrage
        from strategies.mtf_momentum import MTFMomentum
        from strategies.gap_fade import GapFade
        
        instrument = config.get("instrument", "2885")
        quantity = config.get("quantity", 50)
        
        self.children = {
            "vwap": VWAPMeanReversion(config={
                "instrument": instrument,
                "quantity": quantity,
                "entry_sd_multiplier": 1.5,
                "stop_sd_multiplier": 2.5,
                "capital": 100000.0
            }),
            "squeeze": VolatilitySqueezeV2({
                "instrument": instrument,
                "quantity": quantity,
                "lookback": 20,
                "bb_std": 2.0,
                "kc_multiplier": 1.5,
                "min_squeeze_duration": 6,
                "confidence": 0.6,
                "capital": 100000.0
            }),
            "pairs": PairsArbitrage({
                "symbol_a": "TCS",
                "symbol_b": "INFY",
                "security_id_a": "11536",
                "security_id_b": "3506",
                "z_entry": 2.0,
                "z_exit": 0.0,
                "z_stop": 3.5,
                "capital_allocation": 0.25,
                "lookback": 20,
                "capital": 1000000.0
            }),
            "mtf": MTFMomentum({
                "instrument": instrument,
                "quantity": quantity,
                "pullback_band": 2.0,
                "max_trades_per_day": 3,
                "capital": 1000000.0,
                "force_intraday_exit": False,
                "daily_adx_threshold": 15.0
            }),
            "gap": GapFade({
                "instrument": instrument,
                "quantity": quantity,
                "max_trades_per_day": 1,
                "capital": 1000000.0,
                "volume_threshold_mult": 0.5
            })
        }

    def _init_log_csv(self):
        if not os.path.exists(self.log_file):
            try:
                with open(self.log_file, "w", newline="") as f:
                    writer = csv.writer(f)
                    writer.writerow([
                        "date", "time", "regime", 
                        "primary_strategy", "secondary_strategy",
                        "capital_primary", "capital_secondary"
                    ])
            except Exception as e:
                print(f"[{self.name}] Failed to initialize CSV log: {e}")

    def update_daily_state(self, ema_20: float, ema_50: float, adx_14: float, vix: float = 15.0) -> None:
        self.state.daily_ema_20 = ema_20
        self.state.daily_ema_50 = ema_50
        self.state.daily_adx_14 = adx_14
        self.state.daily_vix = vix
        
        # Forward to children
        self.children["mtf"].update_daily_state(ema_20, ema_50, adx_14)
        self.children["vwap"].update_daily_state(ema_20, ema_50, adx_14)

    def update_prev_close(self, prev_close: float) -> None:
        # Forward to GapFade
        self.children["gap"].update_prev_close(prev_close)

    def _log(self, msg: str) -> None:
        print(f"[{self.name}] {msg}")

    def _normalize_time(self, val) -> datetime.time:
        if isinstance(val, datetime.time):
            return val
        if isinstance(val, datetime.datetime):
            return val.time()
        if isinstance(val, str):
            for fmt in ("%H:%M:%S", "%H:%M"):
                try:
                    return datetime.datetime.strptime(val, fmt).time()
                except ValueError:
                    continue
        raise TypeError(f"Unsupported time type: {type(val)}")

    def _normalize_date(self, val) -> datetime.date:
        if isinstance(val, datetime.date):
            return val
        if isinstance(val, datetime.datetime):
            return val.date()
        if isinstance(val, str):
            try:
                return datetime.datetime.strptime(val, "%Y-%m-%d").date()
            except ValueError:
                pass
        return datetime.date.today()

    def _reset_day_state(self, new_date) -> None:
        daily_ema_20 = self.state.daily_ema_20
        daily_ema_50 = self.state.daily_ema_50
        daily_adx_14 = self.state.daily_adx_14
        daily_vix = self.state.daily_vix
        
        self.state = PerDayState()
        self.state.last_date = new_date
        self.state.daily_ema_20 = daily_ema_20
        self.state.daily_ema_50 = daily_ema_50
        self.state.daily_adx_14 = daily_adx_14
        self.state.daily_vix = daily_vix

    def _classify_regime(self, date_val, t_val):
        weekday = date_val.weekday()
        vix = self.state.daily_vix
        adx = self.state.daily_adx_14
        ema_20 = self.state.daily_ema_20
        ema_50 = self.state.daily_ema_50
        
        # 1. Expiry Day Regime Override
        if weekday == 3:  # Thursday
            regime = "EXPIRY_DAY"
            primary = "vwap"  # Fallback to S1 since we deploy S5 options last
            secondary = "gap"
        # 2. High Volatility Regime
        elif vix > 18.0:
            regime = "HIGH_VOLATILITY"
            primary = "vwap"
            secondary = "gap"
        # 3. Low Volatility Regime
        elif vix < 12.0:
            regime = "LOW_VOLATILITY"
            primary = "squeeze"
            secondary = "pairs"
        # 4. Trending Regime
        elif adx > 25.0 and ema_20 is not None and ema_50 is not None:
            if ema_20 > ema_50:
                regime = "TRENDING_UP"
            else:
                regime = "TRENDING_DOWN"
            primary = "mtf"
            secondary = "squeeze"
        # 5. Range-Bound Regime (Default)
        else:
            regime = "RANGE_BOUND"
            primary = "vwap"
            secondary = "gap"
            
        self.state.regime = regime
        self.state.primary_strategy = primary
        self.state.secondary_strategy = secondary
        self.state.capital_primary = 0.60
        self.state.capital_secondary = 0.30
        
        self._log(f"[{t_val}] Classified Regime: {regime}. Primary: {primary} (60%), Secondary: {secondary} (30%)")
        self._write_regime_log(date_val, t_val)

    def _write_regime_log(self, date_val, t_val):
        try:
            with open(self.log_file, "a", newline="") as f:
                writer = csv.writer(f)
                writer.writerow([
                    str(date_val), str(t_val), self.state.regime,
                    self.state.primary_strategy, self.state.secondary_strategy,
                    self.state.capital_primary, self.state.capital_secondary
                ])
        except Exception as e:
            print(f"[{self.name}] Failed to write regime log: {e}")

    def on_candle(self, candle: dict) -> Optional[Union[Signal, List[Signal]]]:
        candle_date = self._normalize_date(candle.get("date") or candle.get("time"))
        if self.state.last_date is None or candle_date != self.state.last_date:
            self._reset_day_state(candle_date)
            
        t = self._normalize_time(candle["time"])
        self.state.last_time = t
        
        # Regime classification trigger (at 9:20 AM and mid-day 1:00 PM)
        if self.state.regime is None or t == datetime.time(9, 20) or t == datetime.time(13, 0):
            self._classify_regime(candle_date, t)
            
        # Route to whitelisted child strategies to keep indicator windows warm and process exit tracking
        signals = []
        primary_name = self.state.primary_strategy
        secondary_name = self.state.secondary_strategy
        symbol = self.config.get("instrument")
        
        whitelists = {
            "vwap": ["HDFCBANK", "ICICIBANK", "RELIANCE", "TCS", "INFY", "HCLTECH"],
            "gap": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"],
            "squeeze": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"],
            "mtf": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"],
            "pairs": ["TCS", "INFY"]
        }
        
        for name, strat in self.children.items():
            if symbol not in whitelists.get(name, []):
                continue
                
            sig = strat.on_candle(candle)
            if sig is not None:
                has_position = (hasattr(strat, "state") and 
                                hasattr(strat.state, "position") and 
                                strat.state.position is not None and 
                                strat.state.position.is_open)
                
                # Check if this signal is squaring off an existing position
                is_exit = False
                if has_position:
                    is_exit = True
                
                mult = 1.0 if is_exit else (self.state.capital_primary if name == primary_name else self.state.capital_secondary)
                
                if is_exit or name == primary_name or name == secondary_name:
                    self._process_child_signal(sig, mult, signals)
                
        if not signals:
            return None
        return signals if len(signals) > 1 else signals[0]

    def _process_child_signal(self, sig_or_list, multiplier: float, accumulator: list):
        if isinstance(sig_or_list, list):
            for sig in sig_or_list:
                sig.quantity = int(sig.quantity * multiplier)
                sig.strategy_name = f"{self.name}:{sig.strategy_name}"
                accumulator.append(sig)
        else:
            sig = sig_or_list
            sig.quantity = int(sig.quantity * multiplier)
            sig.strategy_name = f"{self.name}:{sig.strategy_name}"
            accumulator.append(sig)

    def on_tick(self, tick: dict) -> Optional[Union[Signal, List[Signal]]]:
        # Route tick monitoring to whitelisted child strategies only
        signals = []
        whitelists = {
            "vwap": ["HDFCBANK", "ICICIBANK", "RELIANCE", "TCS", "INFY", "HCLTECH"],
            "gap": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"],
            "squeeze": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"],
            "mtf": ["BEL", "DLF", "RECLTD", "INDIGO", "COCHINSHIP", "ABB", "BRITANNIA"],
            "pairs": ["TCS", "INFY"]
        }
        symbol = self.config.get("instrument")
        
        for name, strat in self.children.items():
            if symbol not in whitelists.get(name, []):
                continue
            sig = strat.on_tick(tick)
            if sig is not None:
                # Use default 1.0 multiplier for exit signals
                self._process_child_signal(sig, 1.0, signals)
        if not signals:
            return None
        return signals if len(signals) > 1 else signals[0]
