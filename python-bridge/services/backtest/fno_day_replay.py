"""
fno_day_replay.py - Deterministic Day-by-Day F&O Replay & Backtest Engine
-------------------------------------------------------------------------
Replays historical market sessions day-by-day using local Parquet archives
under the Unified Sovereign Trade Architecture:
1. 09:15 - 10:30 AM: Cross-Sector Dispersion (CSD) & Extreme Sector Outlier Selection.
2. 10:30 - 10:45 AM: 1m Candlestick Dip & Rebound Validator with Volume Expansion (>= 1.15x).
3. Strike Selection: ATM Delta ~0.50 via real option contract Parquet (or Black-76 pricer).
4. Sovereign Runner Protocol:
   - Pre-T1: Technical Stop Loss (no premature 0.70R breakeven snap; absorbs noise wicks).
   - T1 Hit: Lock Risk-Free (entry + 1.0 pt).
     - Multi-Lot (>= 2 lots): Banks 50% at T1, trails 50% remainder.
     - Single-Lot (= 1 lot): No T1 limit dump; trails dynamically post-T1.
   - Post-T1 Trailing Ratchet: 25% retrace cushion (min 12-point buffer below peak LTP).
   - 14:00 PM Afternoon Cutoff Runner Immunity: Profitable positions (>= 1.05x entry) ride the afternoon squeeze.
   - 15:15 PM EOD Square-Off.
5. Statutory Friction Model:
   - Full date-aware Union Budget 2024 rates (0.10% options STT, 0.02% futures STT, SEBI True-to-Label txn fees).
"""

import os
import sys
import json
import math
import logging
import datetime as dt
from typing import Dict, List, Optional, Any, Tuple
import duckdb
import pandas as pd
import numpy as np

# Ensure python-bridge root is in sys.path
BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if BRIDGE_DIR not in sys.path:
    sys.path.append(BRIDGE_DIR)

from services.backtest.costs import CostModel, ASSET_OPT, ASSET_EQ
from services.fno_quant_engine import (
    calculate_cross_sector_dispersion,
    detect_fno_dip_and_rebound
)
from services.derivatives_quant_math import black76_price_and_greeks

log = logging.getLogger("fno_day_replay")


class FnoDayReplayEngine:
    """
    Deterministic Day-by-Day Replay Engine for Unified WealthOS F&O Architecture.
    """

    def __init__(
        self,
        data_dir: Optional[str] = None,
        lots: int = 1,
        slippage_bps: float = 75.0,  # 0.75% option premium bid-ask spread / fill slippage
        max_capital_per_trade: float = 60000.0
    ):
        self.data_dir = data_dir or os.path.join(BRIDGE_DIR, "data")
        self.lots = max(1, lots)
        self.slippage_bps = slippage_bps
        self.max_capital = max_capital_per_trade
        self.conn = duckdb.connect()

        # Load Universe & Sector Mappings
        self.fno_stocks_file = os.path.join(BRIDGE_DIR, "fno_stocks_generated.json")
        self.sector_map_file = os.path.join(BRIDGE_DIR, "sector_constituents_generated.json")
        self.fno_symbols = self._load_json(self.fno_stocks_file, default=[])
        self.sector_map = self._load_json(self.sector_map_file, default={})

        # Symbol to sector index
        self.sym_to_sector = {}
        for item in self.fno_symbols:
            self.sym_to_sector[item["symbol"]] = item.get("sector", "GENERAL")

        # Reverse sector map
        for sec, syms in self.sector_map.items():
            for s in syms:
                if s not in self.sym_to_sector:
                    self.sym_to_sector[s] = sec

        # Load official exchange lot sizes from cache.db (upstox_instruments)
        self.lot_map = {}
        cache_db_path = os.path.join(BRIDGE_DIR, "cache.db")
        if os.path.exists(cache_db_path):
            try:
                import sqlite3
                sconn = sqlite3.connect(cache_db_path)
                srows = sconn.execute("SELECT symbol, lot_size FROM upstox_instruments WHERE lot_size > 0").fetchall()
                for s, l in srows:
                    base = s.split()[0].upper()
                    if base not in self.lot_map:
                        self.lot_map[base] = int(l)
                sconn.close()
                log.info(f"Loaded {len(self.lot_map)} exchange contract lot sizes from cache.db")
            except Exception as e:
                log.warning(f"Could not load lot sizes from cache.db: {e}")

    def _load_json(self, path: str, default: Any = None) -> Any:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                log.warning(f"Failed loading {path}: {e}")
        return default

    def get_available_trading_days(
        self,
        symbol: str = "TCS",
        from_date: str = "2026-06-01",
        to_date: str = "2026-09-29"
    ) -> List[str]:
        """Queries distinct calendar trading dates available in the underlying archive."""
        fp = os.path.join(self.data_dir, "underlying", symbol, "1minute", "data.parquet").replace("\\", "/")
        if not os.path.exists(fp):
            # Fallback to day parquet
            fp = os.path.join(self.data_dir, "underlying", symbol, "day", "data.parquet").replace("\\", "/")
            if not os.path.exists(fp):
                return []

        q = f"""
            SELECT DISTINCT substr(timestamp, 1, 10) as dt
            FROM '{fp}'
            WHERE substr(timestamp, 1, 10) >= '{from_date}' AND substr(timestamp, 1, 10) <= '{to_date}'
            ORDER BY dt ASC
        """
        rows = self.conn.execute(q).fetchall()
        return [r[0] for r in rows]

    def _get_symbol_lot_size(self, symbol: str) -> int:
        """Determines official exchange lot size for underlying contracts."""
        s = symbol.upper()
        if s in self.lot_map:
            return self.lot_map[s]
        if "BANKNIFTY" in s:
            return 30
        if "NIFTY" in s:
            return 65
        if "FINNIFTY" in s:
            return 65
        if "MIDCPNIFTY" in s:
            return 120
        return 250

    def evaluate_daily_candidate(self, date_str: str) -> Dict[str, Any]:
        """
        Calculates morning returns (09:15 to 10:30 AM) across universe,
        evaluates Cross-Sector Dispersion (CSD) and selects dominant outlier.
        """
        sector_returns = {}
        stock_stats = []

        # Iterate over universe symbols with 1m data
        for item in self.fno_symbols:
            sym = item["symbol"]
            fp = os.path.join(self.data_dir, "underlying", sym, "1minute", "data.parquet").replace("\\", "/")
            if not os.path.exists(fp):
                continue

            # Query 09:15 to 10:30 bars for date_str
            q = f"""
                SELECT timestamp, open, high, low, close, volume
                FROM '{fp}'
                WHERE substr(timestamp, 1, 10) = '{date_str}'
                  AND substr(timestamp, 12, 5) >= '09:15'
                  AND substr(timestamp, 12, 5) <= '10:30'
                ORDER BY timestamp ASC
            """
            bars = self.conn.execute(q).fetchall()
            if len(bars) < 20:
                continue

            open_p = float(bars[0][1])
            curr_p = float(bars[-1][4])
            if open_p <= 0:
                continue

            pct_chg = round(((curr_p - open_p) / open_p) * 100, 2)
            tot_vol = sum(float(b[5]) for b in bars)
            turnover_cr = round((curr_p * tot_vol) / 10000000.0, 2)
            sec = self.sym_to_sector.get(sym, "GENERAL")

            if sec not in sector_returns:
                sector_returns[sec] = []
            sector_returns[sec].append(pct_chg)

            stock_stats.append({
                "symbol": sym,
                "sector": sec,
                "pct_chg": pct_chg,
                "volume": tot_vol,
                "turnover_cr": turnover_cr,
                "open": open_p,
                "close": curr_p
            })

        if not sector_returns or len(sector_returns) < 3:
            return {
                "status": "INSUFFICIENT_SECTOR_DATA",
                "date": date_str,
                "regime": "NEUTRAL_CHOP_SQUELCH",
                "candidate": None
            }

        # Calculate mean return for each sector
        sectors_summary = []
        for sec, returns in sector_returns.items():
            if len(returns) >= 2:
                mean_sec = sum(returns) / len(returns)
                sectors_summary.append({
                    "sectorName": sec,
                    "percentChange": round(mean_sec, 2),
                    "stockCount": len(returns)
                })

        # Calculate Cross-Sector Dispersion
        csd = calculate_cross_sector_dispersion(sectors_summary)
        regime = csd.get("regime")
        dom_sector = None
        direction = "CALL"

        if regime and regime != "NEUTRAL_CHOP_SQUELCH" and csd.get("dominant_sector"):
            dom_sector = csd["dominant_sector"]["sectorName"]
            direction = csd["direction"]
        else:
            # Sector-average returns were compressed towards 0. Check for:
            # A. Extreme Outlier Sector (|Z| >= 1.25)
            outlier_sector = None
            if csd.get("sectors_ranked"):
                for sec_item in csd["sectors_ranked"]:
                    z = sec_item.get("z_score", 0.0)
                    chg = sec_item.get("percentChange", 0.0)
                    if abs(z) >= 1.25 and abs(chg) >= 0.50:
                        outlier_sector = sec_item
                        break

            if outlier_sector:
                dom_sector = outlier_sector["sectorName"]
                direction = "CALL" if outlier_sector["z_score"] > 0 else "PUT"
                regime = "OUTLIER_SECTOR_ROTATION"
            else:
                # B. Stock Momentum Leader: Individual stock breaking out/down >= 1.20%
                best_bull = max(stock_stats, key=lambda x: x["pct_chg"]) if stock_stats else None
                best_bear = min(stock_stats, key=lambda x: x["pct_chg"]) if stock_stats else None

                bull_strength = best_bull["pct_chg"] if best_bull else 0.0
                bear_strength = abs(best_bear["pct_chg"]) if best_bear else 0.0

                if bull_strength >= 1.20 and bull_strength >= bear_strength:
                    dom_sector = best_bull["sector"]
                    direction = "CALL"
                    regime = "STOCK_MOMENTUM_LEADER"
                    bull_cands = [dict(s, direction="CALL") for s in stock_stats if s["pct_chg"] > 0]
                    bull_cands.sort(key=lambda x: (x["pct_chg"], x["volume"]), reverse=True)
                    top_candidates = bull_cands[:5]
                    return {
                        "status": "CANDIDATE_SELECTED",
                        "date": date_str,
                        "regime": regime,
                        "spread": csd.get("spread", 0.0),
                        "dominant_sector": dom_sector,
                        "direction": direction,
                        "candidate": top_candidates[0],
                        "candidates": top_candidates
                    }
                elif bear_strength >= 1.20 and bear_strength > bull_strength:
                    dom_sector = best_bear["sector"]
                    direction = "PUT"
                    regime = "STOCK_MOMENTUM_LEADER"
                    bear_cands = [dict(s, direction="PUT") for s in stock_stats if s["pct_chg"] < 0]
                    bear_cands.sort(key=lambda x: (x["pct_chg"], -x["volume"]))
                    top_candidates = bear_cands[:5]
                    return {
                        "status": "CANDIDATE_SELECTED",
                        "date": date_str,
                        "regime": regime,
                        "spread": csd.get("spread", 0.0),
                        "dominant_sector": dom_sector,
                        "direction": direction,
                        "candidate": top_candidates[0],
                        "candidates": top_candidates
                    }
                else:
                    # True dead market: no sector outlier, no stock moved >= 1.20%
                    return {
                        "status": "SQUELCH",
                        "date": date_str,
                        "regime": "NEUTRAL_CHOP_SQUELCH",
                        "spread": csd.get("spread", 0.0),
                        "reason": f"Chop Market: Sector spread ({csd.get('spread', 0.0)}%) < 1.80% and max stock momentum < 1.20%.",
                        "candidate": None,
                        "candidates": []
                    }

        # Filter stocks in the dominant sector and combine with leaders
        sector_cands = [dict(s, direction=direction) for s in stock_stats if s["sector"] == dom_sector]
        if direction == "CALL":
            sector_cands.sort(key=lambda x: (x["pct_chg"], x["volume"]), reverse=True)
            other_cands = [dict(s, direction="CALL") for s in stock_stats if s["sector"] != dom_sector and s["pct_chg"] > 0]
            other_cands.sort(key=lambda x: (x["pct_chg"], x["volume"]), reverse=True)
        else:
            sector_cands.sort(key=lambda x: (x["pct_chg"], -x["volume"]))
            other_cands = [dict(s, direction="PUT") for s in stock_stats if s["sector"] != dom_sector and s["pct_chg"] < 0]
            other_cands.sort(key=lambda x: (x["pct_chg"], -x["volume"]))

        all_cands = sector_cands + other_cands
        top_candidates = all_cands[:5]
        return {
            "status": "CANDIDATE_SELECTED",
            "date": date_str,
            "regime": regime,
            "spread": csd.get("spread", 0.0),
            "dominant_sector": dom_sector,
            "direction": direction,
            "candidate": top_candidates[0],
            "candidates": top_candidates
        }

    def evaluate_dip_rebound_trigger(
        self,
        date_str: str,
        symbol: str,
        direction: str
    ) -> Dict[str, Any]:
        """
        Tests 1-minute bars between 09:30 and 11:30 AM for confirmed dip & rebound.
        """
        fp = os.path.join(self.data_dir, "underlying", symbol, "1minute", "data.parquet").replace("\\", "/")
        if not os.path.exists(fp):
            return {"confirmed": False, "reason": "No parquet file"}

        q = f"""
            SELECT timestamp, open, high, low, close, volume
            FROM '{fp}'
            WHERE substr(timestamp, 1, 10) = '{date_str}'
              AND substr(timestamp, 12, 5) >= '09:15'
              AND substr(timestamp, 12, 5) <= '11:30'
            ORDER BY timestamp ASC
        """
        bars = self.conn.execute(q).fetchall()
        if len(bars) < 25:
            return {"confirmed": False, "reason": "Insufficient morning bars"}

        # Scan each minute from 09:30 to 11:30
        for i in range(15, len(bars)):
            curr_bar = bars[i]
            time_str = str(curr_bar[0])[11:16]
            if time_str < "09:30" or time_str > "11:30":
                continue

            sub_bars = bars[:i + 1]
            check = detect_fno_dip_and_rebound(
                symbol=symbol,
                direction=direction,
                candles_1m=sub_bars
            )

            if check.get("confirmed", False):
                return {
                    "confirmed": True,
                    "trigger_time": time_str,
                    "trigger_timestamp": str(curr_bar[0]),
                    "spot_price": float(curr_bar[4]),
                    "trigger_bar_idx": i,
                    "all_bars": bars
                }

        return {"confirmed": False, "reason": "No dip & rebound volume expansion break between 09:30-11:30"}

    def resolve_option_bars(
        self,
        date_str: str,
        symbol: str,
        spot_price: float,
        direction: str,
        trigger_time: str
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Resolves 1-minute option premium bars. Queries real option contract parquet
        if available; otherwise uses Black-76 pricer on 1m underlying spot candles.
        """
        # Determine ATM strike
        strike_step = 50.0 if "NIFTY" in symbol else (100.0 if "BANKNIFTY" in symbol else 10.0 if spot_price < 500 else 25.0 if spot_price < 1500 else 50.0)
        atm_strike = round(spot_price / strike_step) * strike_step
        opt_type = "CE" if direction == "CALL" else "PE"

        # Check real option contracts in data/options/
        opt_dir = os.path.join(self.data_dir, "options", symbol)
        if os.path.exists(opt_dir):
            expiries = sorted([d for d in os.listdir(opt_dir) if os.path.isdir(os.path.join(opt_dir, d))])
            # Find closest future or same-day expiry
            valid_expiries = [e for e in expiries if e >= date_str]
            if valid_expiries:
                chosen_exp = valid_expiries[0]
                exp_file = os.path.join(opt_dir, chosen_exp, "data.parquet").replace("\\", "/")
                if os.path.exists(exp_file):
                    # Find nearest strike available for this date and option type
                    strike_q = f"""
                        SELECT strike_price
                        FROM '{exp_file}'
                        WHERE substr(timestamp, 1, 10) = '{date_str}'
                          AND option_type = '{opt_type}'
                        ORDER BY abs(strike_price - {spot_price}) ASC
                        LIMIT 1
                    """
                    try:
                        strike_res = self.conn.execute(strike_q).fetchall()
                        if strike_res:
                            best_strike = float(strike_res[0][0])
                            q = f"""
                                SELECT timestamp, open, high, low, close, volume, open_interest, strike_price, option_type
                                FROM '{exp_file}'
                                WHERE substr(timestamp, 1, 10) = '{date_str}'
                                  AND strike_price = {best_strike}
                                  AND option_type = '{opt_type}'
                                  AND substr(timestamp, 12, 5) >= '{trigger_time}'
                                ORDER BY timestamp ASC
                            """
                            opt_rows = self.conn.execute(q).fetchall()
                            if len(opt_rows) >= 10:
                                bars_dict = []
                                for r in opt_rows:
                                    bars_dict.append({
                                        "timestamp": str(r[0]),
                                        "time": str(r[0])[11:16],
                                        "open": float(r[1]),
                                        "high": float(r[2]),
                                        "low": float(r[3]),
                                        "close": float(r[4]),
                                        "volume": float(r[5])
                                    })
                                contract_info = {
                                    "symbol": symbol,
                                    "strike": best_strike,
                                    "option_type": opt_type,
                                    "expiry": chosen_exp,
                                    "is_real_contract": True
                                }
                                return bars_dict, contract_info
                    except Exception as err:
                        log.warning(f"Error querying real options for {symbol} on {date_str}: {err}")

        # Fallback: Synthetic Black-76 pricer on 1m underlying spot candles
        spot_file = os.path.join(self.data_dir, "underlying", symbol, "1minute", "data.parquet").replace("\\", "/")
        q_spot = f"""
            SELECT timestamp, open, high, low, close, volume
            FROM '{spot_file}'
            WHERE substr(timestamp, 1, 10) = '{date_str}'
              AND substr(timestamp, 12, 5) >= '{trigger_time}'
              AND substr(timestamp, 12, 5) <= '15:15'
            ORDER BY timestamp ASC
        """
        spot_bars = self.conn.execute(q_spot).fetchall()
        bars_dict = []
        iv = 0.16  # Baseline 16% annualized IV
        dte_years = max(1, (dt.date.fromisoformat(date_str) + dt.timedelta(days=7) - dt.date.fromisoformat(date_str)).days) / 365.0

        for r in spot_bars:
            s_open = float(r[1])
            s_high = float(r[2])
            s_low = float(r[3])
            s_close = float(r[4])

            # Vectorized Black-76 option pricing for each component
            g_open = black76_price_and_greeks(s_open, atm_strike, dte_years, 0.07, iv, opt_type)
            g_high = black76_price_and_greeks(s_high if opt_type == "CE" else s_low, atm_strike, dte_years, 0.07, iv, opt_type)
            g_low = black76_price_and_greeks(s_low if opt_type == "CE" else s_high, atm_strike, dte_years, 0.07, iv, opt_type)
            g_close = black76_price_and_greeks(s_close, atm_strike, dte_years, 0.07, iv, opt_type)

            bars_dict.append({
                "timestamp": str(r[0]),
                "time": str(r[0])[11:16],
                "open": round(g_open["price"], 2),
                "high": round(max(g_open["price"], g_high["price"], g_close["price"]), 2),
                "low": round(min(g_open["price"], g_low["price"], g_close["price"]), 2),
                "close": round(g_close["price"], 2),
                "volume": float(r[5])
            })

        contract_info = {
            "symbol": symbol,
            "strike": atm_strike,
            "option_type": opt_type,
            "expiry": "SYNTHETIC_7D",
            "is_real_contract": False
        }
        return bars_dict, contract_info

    def simulate_trade_lifecycle(
        self,
        date_str: str,
        symbol: str,
        direction: str,
        contract_info: Dict[str, Any],
        option_bars: List[Dict[str, Any]],
        lot_size: int
    ) -> Dict[str, Any]:
        """
        Executes trade step-by-step applying the Unified Sovereign Runner Protocol.
        """
        if not option_bars or len(option_bars) < 2:
            return {"status": "NO_OPTION_DATA"}

        # Entry Bar
        entry_bar = option_bars[0]
        raw_entry_price = float(entry_bar["open"])
        if raw_entry_price <= 1.0:
            raw_entry_price = float(entry_bar["close"])
        if raw_entry_price <= 0.5:
            return {"status": "INVALID_ENTRY_PRICE"}

        # Apply slippage on entry (0.75% option bid-ask drag)
        slippage_mult = 1.0 + (self.slippage_bps / 10000.0)
        actual_entry_price = round(raw_entry_price * slippage_mult, 2)

        # Capital & Lot Sizing
        single_lot_capital = actual_entry_price * lot_size
        lot_multiplier = self.lots
        if single_lot_capital * lot_multiplier > self.max_capital:
            lot_multiplier = max(1, int(self.max_capital // single_lot_capital))

        total_qty = lot_size * lot_multiplier

        # Target 1: +40% target move
        target_pts = round(actual_entry_price * 0.40, 2)
        t1_price = round(actual_entry_price + target_pts, 2)

        # Technical Stop Loss: 18% dynamic cushion below entry
        sl_pts = round(actual_entry_price * 0.18, 2)
        initial_sl = round(max(0.50, actual_entry_price - sl_pts), 2)
        current_sl = initial_sl

        # State Variables
        t1_hit = False
        peak_ltp = actual_entry_price
        trough_ltp = actual_entry_price
        exit_time = None
        exit_price = None
        exit_reason = None
        banked_qty = 0
        banked_pnl = 0.0
        remaining_qty = total_qty

        # Replay remaining 1-minute bars
        for bar in option_bars[1:]:
            b_high = float(bar["high"])
            b_low = float(bar["low"])
            b_close = float(bar["close"])
            b_time = bar["time"]

            # Update High-Water Mark and Adverse Trough
            if b_high > peak_ltp:
                peak_ltp = b_high
            if b_low < trough_ltp:
                trough_ltp = b_low

            # Intra-bar check: did both SL and T1 get touched in the same candle?
            both_hit = (b_low <= current_sl) and (b_high >= t1_price and not t1_hit)
            if both_hit:
                # Conservative Institutional Invariant: SL takes precedence!
                exit_time = b_time
                exit_price = current_sl
                exit_reason = "STOP_LOSS (Worst-Case Intra-Bar Ambiguity)"
                break

            # 1. Check Stop Loss trigger
            if b_low <= current_sl:
                exit_time = b_time
                exit_price = current_sl
                exit_reason = "TRAILING_STOP_LOSS" if t1_hit else "TECHNICAL_STOP_LOSS"
                break

            # 2. Check Target 1 trigger
            if b_high >= t1_price and not t1_hit:
                t1_hit = True
                # Lock Risk-Free: Breakeven + 1.0 point
                risk_free_sl = round(actual_entry_price + 1.0, 2)
                current_sl = max(current_sl, risk_free_sl)

                # Institutional Lot Split
                if lot_multiplier >= 2:
                    # Multi-lot: Bank 50% position at Target 1
                    half_lots = lot_multiplier // 2
                    banked_qty = half_lots * lot_size
                    banked_pnl = round(banked_qty * (t1_price - actual_entry_price), 2)
                    remaining_qty = total_qty - banked_qty
                    log.info(f"Target 1 Hit! Banked 50% ({banked_qty} shares) @ {t1_price}. Remaining {remaining_qty} trails.")

            # 3. Post-T1 Trailing Stop Ratchet
            if t1_hit:
                gain_from_entry = peak_ltp - actual_entry_price
                if gain_from_entry > 0:
                    # 25% retrace cushion (min 12 pts below peak)
                    cushion = max(12.0, gain_from_entry * 0.25)
                    runner_sl = round(peak_ltp - cushion, 2)
                    if runner_sl > current_sl:
                        current_sl = runner_sl

            # 4. Check 14:00 PM Afternoon Expiry / Cutoff
            if b_time >= "14:00" and not exit_time:
                # Runner Immunity: if in solid profit (>= 1.05x entry), HOLD through afternoon squeeze!
                if b_close >= (actual_entry_price * 1.05):
                    pass  # Retain runner
                else:
                    exit_time = b_time
                    exit_price = b_close
                    exit_reason = "14:00_CUTOFF (Flat/Loss Position Flattener)"
                    break

            # 5. Check 15:15 PM EOD Square-off
            if b_time >= "15:15":
                exit_time = b_time
                exit_price = b_close
                exit_reason = "EOD_SQUARE_OFF"
                break

        # If day ended without triggered exit
        if not exit_time:
            last_bar = option_bars[-1]
            exit_time = last_bar["time"]
            exit_price = float(last_bar["close"])
            exit_reason = "EOD_SESSION_CLOSE"

        # Apply exit slippage (0.75% option drag on sell)
        exit_slippage_mult = 1.0 - (self.slippage_bps / 10000.0)
        actual_exit_price = round(exit_price * exit_slippage_mult, 2)

        # Calculate Gross PnL
        runner_pnl = round(remaining_qty * (actual_exit_price - actual_entry_price), 2)
        gross_pnl = round(banked_pnl + runner_pnl, 2)

        # Calculate Statutory Friction using CostModel
        trade_date_obj = dt.date.fromisoformat(date_str)
        cost_model = CostModel(asset_class=ASSET_OPT, lot_size=lot_size)
        
        # Sizing legs
        breakdown_rem = cost_model.round_trip_breakdown(
            entry=actual_entry_price,
            exit=actual_exit_price,
            qty=max(1, remaining_qty // lot_size),
            trade_date=trade_date_obj
        )
        total_costs = breakdown_rem.total

        if banked_qty > 0:
            breakdown_banked = cost_model.round_trip_breakdown(
                entry=actual_entry_price,
                exit=t1_price,
                qty=max(1, banked_qty // lot_size),
                trade_date=trade_date_obj
            )
            total_costs += breakdown_banked.total

        net_pnl = round(gross_pnl - total_costs, 2)
        mfe_gain_pct = round(((peak_ltp - actual_entry_price) / actual_entry_price) * 100, 2)
        mae_drop_pct = round(((trough_ltp - actual_entry_price) / actual_entry_price) * 100, 2)
        etd_surrender_pct = round(((peak_ltp - actual_exit_price) / actual_entry_price) * 100, 2)
        capital_deployed = round(actual_entry_price * total_qty, 2)
        realized_return_pct = round((gross_pnl / (actual_entry_price * total_qty)) * 100, 2)

        try:
            h1, m1 = map(int, entry_bar["time"].split(":"))
            h2, m2 = map(int, exit_time.split(":"))
            duration_mins = max(0, (h2 * 60 + m2) - (h1 * 60 + m1))
        except Exception:
            duration_mins = 0

        return {
            "status": "COMPLETED",
            "date": date_str,
            "symbol": symbol,
            "direction": direction,
            "strike": contract_info["strike"],
            "option_type": contract_info["option_type"],
            "is_real_contract": contract_info["is_real_contract"],
            "entry_time": entry_bar["time"],
            "entry_price": actual_entry_price,
            "target_1": t1_price,
            "t1_hit": t1_hit,
            "initial_sl": initial_sl,
            "final_sl": current_sl,
            "peak_ltp": peak_ltp,
            "trough_ltp": trough_ltp,
            "mfe_pct": mfe_gain_pct,
            "mae_pct": mae_drop_pct,
            "etd_pct": etd_surrender_pct,
            "exit_time": exit_time,
            "exit_price": actual_exit_price,
            "exit_reason": exit_reason,
            "total_qty": total_qty,
            "banked_qty": banked_qty,
            "capital_deployed": capital_deployed,
            "duration_mins": duration_mins,
            "gross_pnl": gross_pnl,
            "total_friction": round(total_costs, 2),
            "net_pnl": net_pnl,
            "return_pct": realized_return_pct
        }

    def replay_single_day(self, date_str: str) -> Dict[str, Any]:
        """Runs the complete replay sequence with multi-candidate screening and counterfactual learning."""
        # 1. Candidate Selection
        cand_res = self.evaluate_daily_candidate(date_str)
        if cand_res.get("status") != "CANDIDATE_SELECTED":
            return {
                "date": date_str,
                "status": "SQUELCH",
                "sector": "NONE",
                "symbol": "NONE",
                "direction": "-",
                "reason": cand_res.get("reason", "Choppy market squelched"),
                "net_pnl": 0.0,
                "gross_pnl": 0.0,
                "counterfactuals": []
            }

        candidates = cand_res.get("candidates", [])
        if not candidates and cand_res.get("candidate"):
            candidates = [cand_res["candidate"]]

        dom_sector = cand_res["dominant_sector"]
        default_dir = cand_res["direction"]

        # 2. Multi-Candidate Dip & Rebound Validator across morning window (09:30 to 11:30 AM)
        executed_candidates = []
        for cand in candidates:
            c_sym = cand["symbol"]
            c_dir = cand.get("direction", default_dir)
            c_sec = cand.get("sector", dom_sector)

            dip_res = self.evaluate_dip_rebound_trigger(date_str, c_sym, c_dir)
            if dip_res.get("confirmed", False):
                opt_bars, contract_info = self.resolve_option_bars(
                    date_str=date_str,
                    symbol=c_sym,
                    spot_price=dip_res["spot_price"],
                    direction=c_dir,
                    trigger_time=dip_res["trigger_time"]
                )
                lot_size = self._get_symbol_lot_size(c_sym)
                c_trade = self.simulate_trade_lifecycle(
                    date_str=date_str,
                    symbol=c_sym,
                    direction=c_dir,
                    contract_info=contract_info,
                    option_bars=opt_bars,
                    lot_size=lot_size
                )
                if c_trade.get("status") == "COMPLETED":
                    c_trade["symbol"] = c_sym
                    c_trade["sector"] = c_sec
                    c_trade["trigger_time"] = dip_res["trigger_time"]
                    c_trade["spot_price"] = dip_res["spot_price"]
                    c_trade["morning_pct_chg"] = cand.get("pct_chg", 0.0)
                    c_trade["morning_volume"] = cand.get("volume", 0)
                    c_trade["morning_turnover_cr"] = cand.get("turnover_cr", 0.0)
                    executed_candidates.append(c_trade)

        if not executed_candidates:
            lead_sym = candidates[0]["symbol"] if candidates else "NONE"
            return {
                "date": date_str,
                "status": "FILTERED",
                "sector": dom_sector,
                "symbol": lead_sym,
                "direction": default_dir,
                "reason": "All top candidates failed dip & rebound confirmation",
                "net_pnl": 0.0,
                "gross_pnl": 0.0,
                "counterfactuals": []
            }

        # 1-Trade-Per-Day Rule: Primary trade is the highest-ranked confirming candidate (#1)
        primary_trade = executed_candidates[0]

        # Counterfactual Learning Loop: Analyze unchosen candidates
        counterfactuals = executed_candidates[1:]

        best_cf = None
        alpha_gap = 0.0
        learning_diagnosis = None

        if counterfactuals:
            best_cf = max(counterfactuals, key=lambda x: x.get("net_pnl", 0.0))
            cf_pnl = best_cf.get("net_pnl", 0.0)
            primary_pnl = primary_trade.get("net_pnl", 0.0)
            alpha_gap = round(cf_pnl - primary_pnl, 2)

            if primary_pnl <= 0 and cf_pnl > 0:
                p_sym = primary_trade.get("symbol", "N/A")
                c_sym = best_cf.get("symbol", "N/A")
                learning_diagnosis = (
                    f"Selected {p_sym} lost ₹{abs(primary_pnl):,.2f}, "
                    f"while unchosen {c_sym} gained +₹{cf_pnl:,.2f} (+₹{alpha_gap:,.2f} Left on Table). "
                    f"Structural Difference: {c_sym} Morning Vol={best_cf.get('morning_volume', 0):,.0f} "
                    f"vs {p_sym} Vol={primary_trade.get('morning_volume', 0):,.0f}."
                )

        primary_trade["counterfactuals"] = counterfactuals
        primary_trade["best_counterfactual"] = best_cf
        primary_trade["alpha_gap"] = alpha_gap
        primary_trade["learning_diagnosis"] = learning_diagnosis
        return primary_trade

    def replay_date_range(
        self,
        from_date: str = "2026-06-01",
        to_date: str = "2026-09-29"
    ) -> Dict[str, Any]:
        """Replays all available trading days across the date range."""
        days = self.get_available_trading_days("TCS", from_date, to_date)
        log.info(f"Loaded {len(days)} trading sessions from {from_date} to {to_date}.")

        trades = []
        for d in days:
            try:
                res = self.replay_single_day(d)
                trades.append(res)
            except Exception as e:
                log.error(f"Error replaying date {d}: {e}", exc_info=True)
                trades.append({
                    "date": d,
                    "status": "ERROR",
                    "reason": str(e),
                    "net_pnl": 0.0,
                    "gross_pnl": 0.0
                })

        # Aggregate Metrics
        completed_trades = [t for t in trades if t.get("status") == "COMPLETED"]
        wins = [t for t in completed_trades if t.get("net_pnl", 0) > 0]
        losses = [t for t in completed_trades if t.get("net_pnl", 0) < 0]
        squelches = [t for t in trades if t.get("status") == "SQUELCH"]
        filtered = [t for t in trades if t.get("status") == "FILTERED"]

        tot_gross = sum(t.get("gross_pnl", 0) for t in completed_trades)
        tot_costs = sum(t.get("total_friction", 0) for t in completed_trades)
        tot_net = sum(t.get("net_pnl", 0) for t in completed_trades)

        win_rate = (len(wins) / len(completed_trades) * 100) if completed_trades else 0.0
        tot_profit = sum(t["net_pnl"] for t in wins)
        tot_loss = abs(sum(t["net_pnl"] for t in losses)) if losses else 1.0
        profit_factor = round(tot_profit / tot_loss, 2) if tot_loss > 0 else 99.0

        # Equity Curve & Max Drawdown
        equity = 100000.0  # Rs 1 Lakh starting base
        peak_equity = equity
        max_dd_rupees = 0.0
        max_dd_pct = 0.0
        curve = []

        for t in trades:
            pnl = t.get("net_pnl", 0.0)
            equity += pnl
            if equity > peak_equity:
                peak_equity = equity
            dd = peak_equity - equity
            dd_pct = (dd / peak_equity) * 100 if peak_equity > 0 else 0.0
            if dd > max_dd_rupees:
                max_dd_rupees = dd
                max_dd_pct = dd_pct
            curve.append({"date": t["date"], "equity": round(equity, 2), "pnl": pnl})

        # Runner vs T1 Liquidation Comparison
        # Calculate how much additional PnL the 25% runner cushion captured over capping at T1
        runner_alpha = 0.0
        for t in completed_trades:
            if t.get("t1_hit") and t.get("peak_ltp", 0) > t.get("target_1", 0):
                extra_gain = (t.get("exit_price", 0) - t.get("target_1", 0)) * t.get("total_qty", 0)
                if extra_gain > 0:
                    runner_alpha += extra_gain

        return {
            "summary": {
                "total_calendar_sessions": len(days),
                "active_trades": len(completed_trades),
                "squelched_sessions": len(squelches),
                "filtered_sessions": len(filtered),
                "winning_trades": len(wins),
                "losing_trades": len(losses),
                "win_rate_pct": round(win_rate, 2),
                "profit_factor": profit_factor,
                "gross_pnl": round(tot_gross, 2),
                "total_statutory_friction": round(tot_costs, 2),
                "net_pnl": round(tot_net, 2),
                "starting_capital": 100000.0,
                "ending_capital": round(equity, 2),
                "total_return_pct": round(((equity - 100000.0) / 100000.0) * 100, 2),
                "max_drawdown_rupees": round(max_dd_rupees, 2),
                "max_drawdown_pct": round(max_dd_pct, 2),
                "runner_alpha_captured": round(runner_alpha, 2)
            },
            "equity_curve": curve,
            "daily_ledger": trades
        }
