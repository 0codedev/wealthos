"""
cash_day_replay.py - Deterministic Day-by-Day Cash Segment Replay & Backtest Engine
-----------------------------------------------------------------------------------
Replays historical market sessions day-by-day across the Curated Liquid Cash Universe (~650 stocks)
under the 3 Mutually Exclusive Market Archetypes:

1. 🟢 TYPE 1: SILENT ACCUMULATOR (Upper Circuit Hunter)
   - 3-5d VCP compression base (comp_3d <= 3.2%).
   - Flat open (-0.5% to +2.0%), Low = Open defense invariant (lod_diff <= 0.15%).
   - Controlled RVOL (1.5x - 4.5x), avoiding retail climax.
   - 15m ORB High Breakout with Upper Circuit Headroom >= 8.0%.
   - Rides intraday momentum to +10% / +20% Upper Circuit freeze or EOD 15:15 PM.

2. 🟠 TYPE 2: PULLBACK & CONTINUE (9-EMA / VWAP Dip Buyer)
   - Morning expansion surge (+1.5% to +6.0%).
   - Orderly low-volume pullback (PVCR <= 0.70) testing 9-EMA or VWAP.
   - Reversal bounce candle confirmation.
   - Target: Prior High of Day retest + 1.272 Fib extension.

3. ⛔ TYPE 3: EXHAUSTION TRAP & COUNTER-TREND FADE SCALP
   - Climax gap (> 4.0%) or volume explosion (RVOL >= 5.0x).
   - Upper wick rejection (UWRR >= 35%), failing to hold peak HOD.
   - HARD BUY BLOCK (Zero retail FOMO top buying).
   - Counter-trend MIS Short Scalp targeting VWAP / 9-EMA mean reversion.

Microstructure Modeling:
- MIS 5x Intraday Margin on Sovereign ₹10 Lakh Capital Base (1% Risk = ₹10,000).
- Real Cash Slippage: 0.10% (10 bps) on both entry and exit.
- Date-Aware Statutory Taxes: Union Budget 2024 Regime via CostModel (0.025% STT on sell, ₹20 Brokerage cap, SEBI, GST).
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

from services.backtest.costs import CostModel, ASSET_EQ

log = logging.getLogger("cash_day_replay")


class CashDayReplayEngine:
    """
    Deterministic Two-Tier Vectorized Replay Engine for Equity Cash Segment.
    """

    def __init__(
        self,
        data_dir: Optional[str] = None,
        initial_capital: float = 1_000_000.0,  # ₹10 Lakh Sovereign Base
        risk_pct: float = 0.01,                 # 1.0% risk per trade = ₹10,000
        slippage_bps: float = 3.0,              # 3 bps (0.03%) calibrated NSE equity slippage
        max_leverage: float = 2.0,              # Conservative 2x cap on ₹10L (₹20L max notional)
        allow_short: bool = False               # False = Type 3 acts strictly as Hard Buy Shield
    ):
        self.data_dir = data_dir or os.path.join(BRIDGE_DIR, "data")
        self.initial_capital = initial_capital
        self.risk_pct = risk_pct
        self.slippage_bps = slippage_bps
        self.max_leverage = max_leverage
        self.allow_short = allow_short
        self.conn = duckdb.connect()

        self.universe_file = os.path.join(self.data_dir, "liquid_cash_universe.json")
        self.daily_summary_file = os.path.join(self.data_dir, "cash_universe", "cash_daily_summary.parquet")
        self.underlying_dir = os.path.join(self.data_dir, "underlying")

        # Load liquid cash universe metadata
        self.universe_metadata = {}
        if os.path.exists(self.universe_file):
            try:
                with open(self.universe_file, "r") as f:
                    u_list = json.load(f)
                    for item in u_list:
                        self.universe_metadata[item["symbol"]] = item
            except Exception as e:
                log.warning(f"Error loading universe json: {e}")

        # Cost model instance for cash intraday equity
        self.cost_model = CostModel(
            asset_class=ASSET_EQ,
            delivery=False,
            lot_size=1,
            slippage_bps=self.slippage_bps
        )

        # Pre-verify or build daily summary
        if not os.path.exists(self.daily_summary_file):
            self._ensure_daily_summary()

    def _ensure_daily_summary(self):
        """Ensures the DuckDB daily summary parquet is available."""
        os.makedirs(os.path.dirname(self.daily_summary_file), exist_ok=True)
        query = f"""
        COPY (
            WITH raw AS (
                SELECT 
                    regexp_extract(filename, 'underlying[\\\\/]([^\\\\/]+)[\\\\/]5minute', 1) as symbol,
                    strftime(strptime(substring(timestamp, 1, 10), '%Y-%m-%d'), '%Y-%m-%d') as date,
                    substring(timestamp, 12, 5) as time_str,
                    timestamp,
                    open,
                    high,
                    low,
                    close,
                    volume
                FROM read_parquet('{self.underlying_dir}/*/5minute/data.parquet', filename=true)
            ),
            ordered AS (
                SELECT 
                    symbol,
                    date,
                    time_str,
                    open,
                    high,
                    low,
                    close,
                    volume,
                    row_number() OVER (PARTITION BY symbol, date ORDER BY time_str ASC) as rn_asc,
                    row_number() OVER (PARTITION BY symbol, date ORDER BY time_str DESC) as rn_desc,
                    CASE WHEN time_str <= '09:25' THEN high ELSE NULL END as h15,
                    CASE WHEN time_str <= '09:25' THEN low ELSE NULL END as l15,
                    CASE WHEN time_str <= '09:25' THEN volume ELSE 0 END as v15
                FROM raw
            )
            SELECT 
                symbol,
                date,
                max(CASE WHEN rn_asc = 1 THEN open END) as day_open,
                max(high) as day_high,
                min(low) as day_low,
                max(CASE WHEN rn_desc = 1 THEN close END) as day_close,
                sum(volume) as day_volume,
                max(h15) as first_15m_high,
                min(l15) as first_15m_low,
                sum(v15) as first_15m_vol
            FROM ordered
            GROUP BY symbol, date
        ) TO '{self.daily_summary_file}' (FORMAT PARQUET)
        """
        self.conn.execute(query)

    def scan_day_candidates(self, target_date: str) -> Dict[str, List[Dict[str, Any]]]:
        """
        Fast Tier 1 Vectorized DuckDB screener for a single date across all 3 archetypes.
        Returns: { 'type1': [...], 'type2': [...], 'type3': [...] }
        """
        query = f"""
        WITH metrics AS (
            SELECT 
                symbol,
                date,
                day_open,
                day_high,
                day_low,
                day_close,
                day_volume,
                first_15m_high,
                first_15m_low,
                first_15m_vol,
                lag(day_close, 1) OVER (PARTITION BY symbol ORDER BY date) as prev_close,
                lag(day_close, 2) OVER (PARTITION BY symbol ORDER BY date) as prev2_close,
                lag(day_close, 3) OVER (PARTITION BY symbol ORDER BY date) as prev3_close,
                (
                    (lag(day_high, 1) OVER (PARTITION BY symbol ORDER BY date) - lag(day_low, 1) OVER (PARTITION BY symbol ORDER BY date)) / NULLIF(lag(day_close, 1) OVER (PARTITION BY symbol ORDER BY date), 0) +
                    (lag(day_high, 2) OVER (PARTITION BY symbol ORDER BY date) - lag(day_low, 2) OVER (PARTITION BY symbol ORDER BY date)) / NULLIF(lag(day_close, 2) OVER (PARTITION BY symbol ORDER BY date), 0) +
                    (lag(day_high, 3) OVER (PARTITION BY symbol ORDER BY date) - lag(day_low, 3) OVER (PARTITION BY symbol ORDER BY date)) / NULLIF(lag(day_close, 3) OVER (PARTITION BY symbol ORDER BY date), 0)
                ) / 3.0 * 100.0 as avg_range_3d_pct,
                avg(day_volume) OVER (PARTITION BY symbol ORDER BY date ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING) as adv_20d
            FROM '{self.daily_summary_file}'
        ),
        screened AS (
            SELECT 
                *,
                (day_open - prev_close) / NULLIF(prev_close, 0) * 100.0 as gap_pct,
                (day_open - first_15m_low) / NULLIF(day_open, 0) * 100.0 as low_open_diff_pct,
                CASE WHEN adv_20d > 0 THEN first_15m_vol / (adv_20d / 25.0) ELSE 1.0 END as rvol_15m,
                (first_15m_high - day_open) / NULLIF(day_open, 0) * 100.0 as morning_push_pct,
                (prev_close * 1.20 - first_15m_high) / NULLIF(first_15m_high, 0) * 100.0 as headroom_20pct
            FROM metrics
            WHERE date = '{target_date}'
              AND prev_close IS NOT NULL 
              AND prev_close >= 20.0 AND prev_close <= 3500.0
              AND adv_20d >= 25000
        )
        SELECT 
            symbol,
            date,
            prev_close,
            day_open,
            day_high,
            day_low,
            day_close,
            first_15m_high,
            first_15m_low,
            first_15m_vol,
            gap_pct,
            low_open_diff_pct,
            avg_range_3d_pct,
            rvol_15m,
            morning_push_pct,
            headroom_20pct
        FROM screened
        """
        df = self.conn.execute(query).df()
        if df.empty:
            return {"type1": [], "type2": [], "type3": []}

        # Market Breadth Gate (Captain's Rule: Match trade direction with broader market)
        # If over 58% of stocks open gap down, squelch long breakouts to avoid market drag
        advance_ratio = float((df["gap_pct"] >= -0.1).mean())
        if advance_ratio < 0.42:
            return {
                "type1": [], 
                "type2": [], 
                "type3": [],
                "market_breadth": advance_ratio,
                "regime": "BROADER_MARKET_DUMP_SQUELCH"
            }

        # Defensive mega-caps to exclude from Type 1 circuit hunting
        DEFENSIVE_MEGACAPS = {
            "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "WIPRO", 
            "MARICO", "ASIANPAINT", "SUNPHARMA", "ITC", "LT", "KOTAKBANK", 
            "SBIN", "HINDUNILVR", "BHARTIARTL", "NTPC", "POWERGRID"
        }

        # Commodity cyclicals driven by global futures (not domestic momentum accumulation)
        COMMODITY_CYCLICALS = {
            "TATASTEEL", "JINDALSTEL", "JINDALSTE", "JSWSTEEL", "HINDALCO", 
            "VEDL", "HINDZINC", "NMDC", "SAIL", "NATIONALUM", "IOC", "BPCL", 
            "HINDPETRO", "PETRONET", "GAIL", "OIL", "ONGC", "COALINDIA"
        }

        EXCLUDED_STOCKS = DEFENSIVE_MEGACAPS.union(COMMODITY_CYCLICALS)

        # Archetype 1: Silent Accumulator (Circuit Hunter)
        # Empirical Sweet Spot: 3d range 1.4% to 3.5%, RVOL 1.5x to 3.8x, Low=Open <= 0.12%, Headroom >= 8%
        t1_mask = (
            (df["avg_range_3d_pct"].between(1.4, 3.5)) &
            (df["gap_pct"].between(-0.5, 2.0)) &
            (df["low_open_diff_pct"] <= 0.12) &
            (df["rvol_15m"].between(1.5, 3.8)) &
            (df["headroom_20pct"] >= 8.0) &
            (~df["symbol"].isin(EXCLUDED_STOCKS))
        )
        t1_df = df[t1_mask].copy()
        if not t1_df.empty:
            # Score: Sweet spot RVOL (centered around 2.8x) + Sweet spot compression (~2.2%) + Open Defense
            rvol_score = 3.0 - (t1_df["rvol_15m"] - 2.8).abs()
            comp_score = 3.0 - (t1_df["avg_range_3d_pct"] - 2.2).abs()
            lod_score = (1.0 - t1_df["low_open_diff_pct"] / 0.12) * 2.5
            headroom_score = (t1_df["headroom_20pct"] / 20.0) * 1.5

            # Sector Alpha Bonus: CASH_ALPHA high-beta growth stocks get a decisive +3.5 point momentum boost
            sector_bonus = t1_df["symbol"].apply(
                lambda s: 3.5 if self.universe_metadata.get(s, {}).get("sector") == "CASH_ALPHA" else 0.0
            )

            t1_df["score"] = rvol_score * 2.5 + comp_score * 2.0 + lod_score + headroom_score + sector_bonus
            t1_df = t1_df.sort_values(by="score", ascending=False)

        # Archetype 2: Pullback & Continue (9-EMA Dip Buyer)
        # Morning push (+1.5% to +6.0%), moderate gap (<= 3.5%), RVOL >= 1.5x
        t2_mask = (
            (df["morning_push_pct"].between(1.5, 6.0)) &
            (df["gap_pct"].between(-1.0, 3.5)) &
            (df["rvol_15m"] >= 1.5) &
            (~df["symbol"].isin(EXCLUDED_STOCKS))
        )
        t2_df = df[t2_mask].copy()
        if not t2_df.empty:
            sector_bonus_t2 = t2_df["symbol"].apply(
                lambda s: 2.0 if self.universe_metadata.get(s, {}).get("sector") == "CASH_ALPHA" else 0.0
            )
            t2_df["score"] = t2_df["morning_push_pct"] * 1.5 + t2_df["rvol_15m"] + sector_bonus_t2
            t2_df = t2_df.sort_values(by="score", ascending=False)

        # Archetype 3: Exhaustion Trap (Climax Gap > 4% or RVOL >= 5.0x) - Used as Buy Shield
        t3_mask = (
            (df["gap_pct"] >= 4.0) |
            (df["rvol_15m"] >= 5.0)
        )
        t3_df = df[t3_mask].copy()
        if not t3_df.empty:
            t3_df["score"] = t3_df["gap_pct"] + t3_df["rvol_15m"] * 2.0
            t3_df = t3_df.sort_values(by="score", ascending=False)

        return {
            "type1": t1_df.to_dict(orient="records"),
            "type2": t2_df.to_dict(orient="records"),
            "type3": t3_df.to_dict(orient="records")
        }

    def _load_intraday_candles(self, symbol: str, target_date: str) -> pd.DataFrame:
        """Loads 5m candles for a specific symbol on target_date."""
        parquet_path = os.path.join(self.underlying_dir, symbol, "5minute", "data.parquet")
        if not os.path.exists(parquet_path):
            return pd.DataFrame()

        query = f"""
        SELECT 
            timestamp,
            substring(timestamp, 12, 5) as time_str,
            open,
            high,
            low,
            close,
            volume
        FROM read_parquet('{parquet_path}')
        WHERE timestamp >= '{target_date}T09:15:00+05:30' 
          AND timestamp <= '{target_date}T15:30:00+05:30'
        ORDER BY timestamp ASC
        """
        try:
            return self.conn.execute(query).df()
        except Exception:
            return pd.DataFrame()

    def simulate_type1_trade(self, candidate: Dict[str, Any], date_str: str) -> Optional[Dict[str, Any]]:
        """
        Chronological 5m state-machine simulation for Type 1 (Silent Accumulator / Circuit Hunter).
        """
        symbol = candidate["symbol"]
        candles = self._load_intraday_candles(symbol, date_str)
        if len(candles) < 6:
            return None

        orb_high = candidate["first_15m_high"]
        orb_low = candidate["first_15m_low"]
        day_open = candidate["day_open"]
        prev_close = candidate["prev_close"]
        upper_circuit = round(prev_close * 1.20, 2)  # 20% limit band

        # Sizing calculations: technical stop at low of 15m or 1.5% below orb_high
        stop_loss_initial = round(max(orb_low, orb_high * 0.985), 2)
        risk_per_share = max(1.0, orb_high - stop_loss_initial)
        target_risk_rupees = self.initial_capital * self.risk_pct  # ₹10,000

        # Quantity sizing: Cap notional per trade at ₹5,00,000 (0.5x capital) to optimize turnover & friction
        max_notional = min(self.initial_capital * self.max_leverage, 500_000.0)
        qty = math.floor(target_risk_rupees / risk_per_share)
        max_shares = math.floor(max_notional / orb_high)
        qty = max(2, min(qty, max_shares))
        qty_leg1 = qty // 2
        qty_leg2 = qty - qty_leg1

        in_trade = False
        entry_price = 0.0
        entry_time = ""
        current_sl = stop_loss_initial
        highest_price = 0.0
        lowest_adverse = 999999.0
        circuit_hit = False

        leg1_done = False
        leg1_exit_price = 0.0
        leg2_exit_price = 0.0
        exit_time = ""
        exit_reason = ""

        # Loop through 5m bars starting at 09:30 (bar index 3 onwards)
        for i in range(3, len(candles)):
            row = candles.iloc[i]
            prev_row = candles.iloc[i - 1]
            c_open = row["open"]
            c_high = row["high"]
            c_low = row["low"]
            c_close = row["close"]
            vol = row["volume"]
            t_str = row["time_str"]

            if not in_trade:
                # Authentic Entry: 5m candle CLOSE above ORB High with green body & volume expansion
                if c_close >= orb_high and c_close > c_open and vol >= prev_row["volume"] * 1.05 and t_str <= "10:15":
                    in_trade = True
                    entry_price = round(c_close * (1.0 + self.slippage_bps / 10000.0), 2)
                    entry_time = t_str
                    highest_price = max(c_high, entry_price)
                    lowest_adverse = min(c_low, entry_price)
                continue

            # In trade tracking
            highest_price = max(highest_price, c_high)
            lowest_adverse = min(lowest_adverse, c_low)

            # Check Upper Circuit Lock (touches within 0.5% of upper band)
            if c_high >= upper_circuit * 0.995:
                circuit_hit = True

            gain_pct = (highest_price - entry_price) / entry_price * 100.0

            # Target 1 (T1) Hit: Bank 50% at +2.5% (High-probability cash alpha)
            target1_price = round(entry_price * 1.025, 2)
            if not leg1_done and c_high >= target1_price:
                leg1_done = True
                leg1_exit_price = round(target1_price * (1.0 - self.slippage_bps / 10000.0), 2)
                # Immediately move SL to Risk-Free Breakeven + fee buffer (+0.3%)
                current_sl = max(current_sl, entry_price * 1.003)

            # Dynamic Profit-Protection Trailing Ratchet for Leg 2 Runner
            if gain_pct >= 10.0:
                current_sl = max(current_sl, entry_price * 1.075) # Lock +7.5%
            elif gain_pct >= 6.0:
                current_sl = max(current_sl, entry_price * 1.04)  # Lock +4.0%
            elif gain_pct >= 4.0:
                current_sl = max(current_sl, entry_price * 1.025) # Lock +2.5%
            elif gain_pct >= 2.0 and not leg1_done:
                current_sl = max(current_sl, entry_price * 1.003) # Breakeven

            # Check Stop Loss Breach
            if c_low <= current_sl:
                sl_fill = round(current_sl * (1.0 - self.slippage_bps / 10000.0), 2)
                if not leg1_done:
                    leg1_exit_price = sl_fill
                leg2_exit_price = sl_fill
                exit_time = t_str
                exit_reason = "TRAILING_SL" if current_sl > entry_price else "INITIAL_SL"
                break

            # Check EOD Cutoff at 15:15 PM
            if t_str >= "15:15":
                eod_fill = round(c_close * (1.0 - self.slippage_bps / 10000.0), 2)
                if not leg1_done:
                    leg1_exit_price = eod_fill
                leg2_exit_price = eod_fill
                exit_time = t_str
                exit_reason = "CIRCUIT_LOCK_EOD" if circuit_hit else "EOD_SQUAREOFF"
                break

        if not in_trade or leg2_exit_price == 0.0:
            return None

        # Blended Exit Price across Leg 1 & Leg 2
        blended_exit_price = round(
            (leg1_exit_price * qty_leg1 + leg2_exit_price * qty_leg2) / qty, 2
        )

        # Statutory Costs & Friction
        trade_dt = dt.datetime.strptime(date_str, "%Y-%m-%d").date()
        cost_breakdown = self.cost_model.round_trip_breakdown(
            entry=entry_price,
            exit=blended_exit_price,
            qty=qty,
            trade_date=trade_dt
        )

        gross_pnl = (blended_exit_price - entry_price) * qty
        statutory_friction = cost_breakdown.total
        net_pnl = gross_pnl - statutory_friction

        mfe_pct = (highest_price - entry_price) / entry_price * 100.0
        mae_pct = (lowest_adverse - entry_price) / entry_price * 100.0
        pnl_pct = (blended_exit_price - entry_price) / entry_price * 100.0

        # Duration
        t_entry_dt = dt.datetime.strptime(f"{date_str} {entry_time}", "%Y-%m-%d %H:%M")
        t_exit_dt = dt.datetime.strptime(f"{date_str} {exit_time}", "%Y-%m-%d %H:%M")
        duration_mins = int((t_exit_dt - t_entry_dt).total_seconds() / 60)

        sector = self.universe_metadata.get(symbol, {}).get("sector", "CASH_ALPHA")

        return {
            "date": date_str,
            "symbol": symbol,
            "strategy": "Type 1: Silent Accumulator",
            "archetype": "TYPE_1_CIRCUIT_HUNTER",
            "direction": "BUY",
            "sector": sector,
            "entry_time": entry_time,
            "exit_time": exit_time,
            "duration_mins": duration_mins,
            "quantity": qty,
            "entry_price": entry_price,
            "exit_price": blended_exit_price,
            "highest_price": highest_price,
            "lowest_price": lowest_adverse,
            "stop_loss": stop_loss_initial,
            "pnl_pct": round(pnl_pct, 2),
            "gross_pnl": round(gross_pnl, 2),
            "statutory_friction": round(statutory_friction, 2),
            "net_pnl": round(net_pnl, 2),
            "mfe_pct": round(mfe_pct, 2),
            "mae_pct": round(mae_pct, 2),
            "circuit_hit": circuit_hit,
            "exit_reason": exit_reason,
            "rvol_15m": round(candidate["rvol_15m"], 2),
            "comp_3d_pct": round(candidate["avg_range_3d_pct"], 2),
            "gap_pct": round(candidate["gap_pct"], 2)
        }

    def simulate_type2_trade(self, candidate: Dict[str, Any], date_str: str) -> Optional[Dict[str, Any]]:
        """
        Chronological 5m state-machine simulation for Type 2 (Pullback & Continue / 9-EMA Dip Buyer).
        """
        symbol = candidate["symbol"]
        candles = self._load_intraday_candles(symbol, date_str)
        if len(candles) < 8:
            return None

        # Calculate chronological 9-EMA and cumulative VWAP
        candles["ema9"] = candles["close"].ewm(span=9, adjust=False).mean()
        candles["pv"] = candles["close"] * candles["volume"]
        candles["vwap"] = candles["pv"].cumsum() / candles["volume"].cumsum()

        in_trade = False
        entry_price = 0.0
        entry_time = ""
        current_sl = 0.0
        target_price = 0.0
        highest_price = 0.0
        lowest_adverse = 999999.0
        qty = 0
        exit_price = 0.0
        exit_time = ""
        exit_reason = ""

        # Scan for dip between 09:45 and 11:30 (indices 6 to 25)
        for i in range(6, len(candles)):
            row = candles.iloc[i]
            prev_row = candles.iloc[i - 1]
            c_high = row["high"]
            c_low = row["low"]
            c_close = row["close"]
            c_open = row["open"]
            ema9 = row["ema9"]
            vwap = row["vwap"]
            t_str = row["time_str"]

            if not in_trade:
                if t_str > "12:00":
                    break

                # Dip condition: price tests 9-EMA or VWAP (within 0.8%) and prints green reversal
                dist_ema = abs(c_low - ema9) / ema9 * 100.0
                dist_vwap = abs(c_low - vwap) / vwap * 100.0
                is_near_support = (dist_ema <= 0.8 or dist_vwap <= 0.8) and c_close >= vwap
                is_green_reversal = c_close > c_open and c_close > prev_row["high"]

                if is_near_support and is_green_reversal:
                    # Morning High to retest
                    morning_high = candles.iloc[:i]["high"].max()
                    runway = (morning_high - c_close) / c_close * 100.0
                    if runway >= 1.2:
                        in_trade = True
                        entry_price = round(c_close * (1.0 + self.slippage_bps / 10000.0), 2)
                        entry_time = t_str
                        current_sl = round(min(c_low, ema9) * 0.997, 2)
                        target_price = round(morning_high * 1.01, 2)
                        highest_price = entry_price
                        lowest_adverse = entry_price

                        risk_per_share = max(1.0, entry_price - current_sl)
                        target_risk = self.initial_capital * self.risk_pct
                        qty = math.floor(target_risk / risk_per_share)
                        max_shares = math.floor((self.initial_capital * self.max_leverage) / entry_price)
                        qty = max(1, min(qty, max_shares))
                continue

            highest_price = max(highest_price, c_high)
            lowest_adverse = min(lowest_adverse, c_low)

            # Target hit (Retest of HOD + extension)
            if c_high >= target_price:
                exit_price = round(target_price * (1.0 - self.slippage_bps / 10000.0), 2)
                exit_time = t_str
                exit_reason = "PROFIT_TARGET_T2"
                break

            # Stop loss hit
            if c_low <= current_sl:
                exit_price = round(current_sl * (1.0 - self.slippage_bps / 10000.0), 2)
                exit_time = t_str
                exit_reason = "TRAILING_SL" if current_sl > entry_price else "INITIAL_SL"
                break

            # Trail stop if 50% to target reached
            if highest_price >= entry_price + (target_price - entry_price) * 0.6:
                current_sl = max(current_sl, entry_price * 1.005)

            # EOD square off
            if t_str >= "15:15":
                exit_price = round(c_close * (1.0 - self.slippage_bps / 10000.0), 2)
                exit_time = t_str
                exit_reason = "EOD_SQUAREOFF"
                break

        if not in_trade or exit_price == 0.0 or qty == 0:
            return None

        trade_dt = dt.datetime.strptime(date_str, "%Y-%m-%d").date()
        cost_breakdown = self.cost_model.round_trip_breakdown(
            entry=entry_price, exit=exit_price, qty=qty, trade_date=trade_dt
        )
        gross_pnl = (exit_price - entry_price) * qty
        statutory_friction = cost_breakdown.total
        net_pnl = gross_pnl - statutory_friction

        t_entry_dt = dt.datetime.strptime(f"{date_str} {entry_time}", "%Y-%m-%d %H:%M")
        t_exit_dt = dt.datetime.strptime(f"{date_str} {exit_time}", "%Y-%m-%d %H:%M")
        duration_mins = int((t_exit_dt - t_entry_dt).total_seconds() / 60)

        sector = self.universe_metadata.get(symbol, {}).get("sector", "CASH_ALPHA")

        return {
            "date": date_str,
            "symbol": symbol,
            "strategy": "Type 2: Pullback & Continue",
            "archetype": "TYPE_2_PULLBACK_BUYER",
            "direction": "BUY",
            "sector": sector,
            "entry_time": entry_time,
            "exit_time": exit_time,
            "duration_mins": duration_mins,
            "quantity": qty,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "highest_price": highest_price,
            "lowest_price": lowest_adverse,
            "stop_loss": current_sl,
            "pnl_pct": round((exit_price - entry_price) / entry_price * 100.0, 2),
            "gross_pnl": round(gross_pnl, 2),
            "statutory_friction": round(statutory_friction, 2),
            "net_pnl": round(net_pnl, 2),
            "mfe_pct": round((highest_price - entry_price) / entry_price * 100.0, 2),
            "mae_pct": round((lowest_adverse - entry_price) / entry_price * 100.0, 2),
            "circuit_hit": False,
            "exit_reason": exit_reason,
            "rvol_15m": round(candidate["rvol_15m"], 2),
            "comp_3d_pct": round(candidate["avg_range_3d_pct"], 2),
            "gap_pct": round(candidate["gap_pct"], 2)
        }

    def simulate_type3_trade(self, candidate: Dict[str, Any], date_str: str) -> Optional[Dict[str, Any]]:
        """
        Chronological 5m state-machine simulation for Type 3 (Exhaustion Trap Fade Short).
        """
        symbol = candidate["symbol"]
        candles = self._load_intraday_candles(symbol, date_str)
        if len(candles) < 8:
            return None

        candles["pv"] = candles["close"] * candles["volume"]
        candles["vwap"] = candles["pv"].cumsum() / candles["volume"].cumsum()

        in_trade = False
        entry_price = 0.0
        entry_time = ""
        current_sl = 0.0
        target_vwap = 0.0
        lowest_price = 999999.0
        highest_adverse = 0.0
        qty = 0
        exit_price = 0.0
        exit_time = ""
        exit_reason = ""

        # Check first 6 bars (09:15 to 09:45) for upper wick exhaustion rejection
        for i in range(2, min(10, len(candles))):
            row = candles.iloc[i]
            c_high = row["high"]
            c_low = row["low"]
            c_close = row["close"]
            c_open = row["open"]
            c_range = c_high - c_low
            vwap = row["vwap"]
            t_str = row["time_str"]

            if c_range > 0:
                upper_wick = c_high - max(c_open, c_close)
                wick_ratio = upper_wick / c_range * 100.0
                # Rejection wick >= 35% with peak decay
                if wick_ratio >= 35.0 and c_close < c_open:
                    in_trade = True
                    entry_price = round(c_close * (1.0 - self.slippage_bps / 10000.0), 2)
                    entry_time = t_str
                    current_sl = round(c_high * 1.003, 2)
                    target_vwap = round(vwap, 2)
                    lowest_price = entry_price
                    highest_adverse = entry_price

                    risk_per_share = max(1.0, current_sl - entry_price)
                    target_risk = self.initial_capital * self.risk_pct
                    qty = math.floor(target_risk / risk_per_share)
                    max_shares = math.floor((self.initial_capital * self.max_leverage) / entry_price)
                    qty = max(1, min(qty, max_shares))
                    start_bar = i + 1
                    break

        if not in_trade:
            return None

        # Manage short trade
        for i in range(start_bar, len(candles)):
            row = candles.iloc[i]
            c_high = row["high"]
            c_low = row["low"]
            c_close = row["close"]
            vwap = row["vwap"]
            t_str = row["time_str"]

            lowest_price = min(lowest_price, c_low)
            highest_adverse = max(highest_adverse, c_high)

            # Target VWAP hit
            if c_low <= vwap:
                exit_price = round(vwap * (1.0 + self.slippage_bps / 10000.0), 2)
                exit_time = t_str
                exit_reason = "VWAP_MEAN_REVERSION_T3"
                break

            # Stop loss hit
            if c_high >= current_sl:
                exit_price = round(current_sl * (1.0 + self.slippage_bps / 10000.0), 2)
                exit_time = t_str
                exit_reason = "INITIAL_SL"
                break

            # EOD square off
            if t_str >= "15:15":
                exit_price = round(c_close * (1.0 + self.slippage_bps / 10000.0), 2)
                exit_time = t_str
                exit_reason = "EOD_SQUAREOFF"
                break

        if exit_price == 0.0 or qty == 0:
            return None

        trade_dt = dt.datetime.strptime(date_str, "%Y-%m-%d").date()
        cost_breakdown = self.cost_model.round_trip_breakdown(
            entry=entry_price, exit=exit_price, qty=qty, trade_date=trade_dt
        )
        # Short PnL = (Entry - Exit) * Qty
        gross_pnl = (entry_price - exit_price) * qty
        statutory_friction = cost_breakdown.total
        net_pnl = gross_pnl - statutory_friction

        t_entry_dt = dt.datetime.strptime(f"{date_str} {entry_time}", "%Y-%m-%d %H:%M")
        t_exit_dt = dt.datetime.strptime(f"{date_str} {exit_time}", "%Y-%m-%d %H:%M")
        duration_mins = int((t_exit_dt - t_entry_dt).total_seconds() / 60)

        sector = self.universe_metadata.get(symbol, {}).get("sector", "CASH_ALPHA")

        return {
            "date": date_str,
            "symbol": symbol,
            "strategy": "Type 3: Exhaustion Trap Fade",
            "archetype": "TYPE_3_EXHAUSTION_FADE",
            "direction": "SELL",
            "sector": sector,
            "entry_time": entry_time,
            "exit_time": exit_time,
            "duration_mins": duration_mins,
            "quantity": qty,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "highest_price": highest_adverse,
            "lowest_price": lowest_price,
            "stop_loss": current_sl,
            "pnl_pct": round((entry_price - exit_price) / entry_price * 100.0, 2),
            "gross_pnl": round(gross_pnl, 2),
            "statutory_friction": round(statutory_friction, 2),
            "net_pnl": round(net_pnl, 2),
            "mfe_pct": round((entry_price - lowest_price) / entry_price * 100.0, 2),
            "mae_pct": round((entry_price - highest_adverse) / entry_price * 100.0, 2),
            "circuit_hit": False,
            "exit_reason": exit_reason,
            "rvol_15m": round(candidate["rvol_15m"], 2),
            "comp_3d_pct": round(candidate["avg_range_3d_pct"], 2),
            "gap_pct": round(candidate["gap_pct"], 2)
        }

    def replay_single_day(self, target_date: str) -> Dict[str, Any]:
        """
        Replays a single market date under the 1-Trade-Per-Day Capital Governor
        and records multi-candidate counterfactual learning diagnostics.
        """
        candidates = self.scan_day_candidates(target_date)
        t1_cands = candidates["type1"]
        t2_cands = candidates["type2"]
        t3_cands = candidates["type3"]

        chosen_trade = None
        chosen_cand = None
        strategy_name = ""

        # Evaluate top Type 1 and Type 2 candidates
        evaluated_trades = []
        if t1_cands:
            for cand in t1_cands[:3]:
                t = self.simulate_type1_trade(cand, target_date)
                if t:
                    evaluated_trades.append((t, cand, cand.get("score", 0.0) + 1.0))
                    break

        if t2_cands:
            for cand in t2_cands[:3]:
                t = self.simulate_type2_trade(cand, target_date)
                if t:
                    evaluated_trades.append((t, cand, cand.get("score", 0.0)))
                    break

        if evaluated_trades:
            # Sort by conviction score
            evaluated_trades.sort(key=lambda x: x[2], reverse=True)
            chosen_trade, chosen_cand, _ = evaluated_trades[0]
            strategy_name = chosen_trade["strategy"]

        # Priority 3: Type 3 Exhaustion Fade Scalp (Optional shorting, default False = Hard Buy Shield)
        if not chosen_trade and t3_cands and self.allow_short:
            for cand in t3_cands[:2]:
                t = self.simulate_type3_trade(cand, target_date)
                if t:
                    chosen_trade = t
                    chosen_cand = cand
                    strategy_name = "Type 3: Exhaustion Trap Fade"
                    break

        # If no setup triggered on that date
        if not chosen_trade:
            reason = "No candidate triggered valid technical breakout/bounce"
            if t3_cands and not self.allow_short:
                reason = f"Type 3 Exhaustion Trap Shield active ({t3_cands[0]['symbol']} gap/spike blocked from buying)"
            return {
                "date": target_date,
                "status": "SQUELCH",
                "reason": reason,
                "net_pnl": 0.0,
                "gross_pnl": 0.0,
                "statutory_friction": 0.0,
                "best_counterfactual": None,
                "alpha_gap": 0.0
            }

        # Multi-Candidate Counterfactual Post-Mortem
        # Simulate runner-up candidates to capture Alpha Gap
        best_counterfactual = None
        alpha_gap = 0.0
        learning_diagnosis = ""

        if chosen_trade["strategy"].startswith("Type 1") and len(t1_cands) > 1:
            for alt_cand in t1_cands[1:3]:
                alt_trade = self.simulate_type1_trade(alt_cand, target_date)
                if alt_trade and alt_trade["net_pnl"] > chosen_trade["net_pnl"]:
                    gap = alt_trade["net_pnl"] - chosen_trade["net_pnl"]
                    if gap > alpha_gap:
                        alpha_gap = gap
                        best_counterfactual = alt_trade
                        learning_diagnosis = (
                            f"Runner-up {alt_trade['symbol']} outperformed primary by ₹{gap:,.0f}. "
                            f"Alt RVOL: {alt_trade['rvol_15m']}x vs Primary: {chosen_trade['rvol_15m']}x. "
                            f"Alt Compression: {alt_trade['comp_3d_pct']}% vs Primary: {chosen_trade['comp_3d_pct']}%."
                        )

        chosen_trade["status"] = "WIN" if chosen_trade["net_pnl"] > 0 else "LOSS"
        chosen_trade["best_counterfactual"] = best_counterfactual
        chosen_trade["alpha_gap"] = round(alpha_gap, 2)
        chosen_trade["learning_diagnosis"] = learning_diagnosis

        return chosen_trade

    def replay_date_range(self, from_date: str, to_date: str) -> Dict[str, Any]:
        """
        Executes full multi-year backtest across a date range.
        Returns comprehensive KPI summary, daily ledger, and serialized trade dataset.
        """
        # Get unique trading dates from daily summary
        query = f"""
        SELECT DISTINCT date 
        FROM '{self.daily_summary_file}'
        WHERE date >= '{from_date}' AND date <= '{to_date}'
        ORDER BY date ASC
        """
        dates = [r[0] for r in self.conn.execute(query).fetchall()]

        log.info(f"Starting Cash Day Replay across {len(dates)} sessions ({from_date} to {to_date})...")

        daily_ledger = []
        executed_trades = []
        running_equity = self.initial_capital
        equity_curve = []
        drawdowns = []
        peak_equity = self.initial_capital

        circuit_locks = 0
        winning_trades = 0
        losing_trades = 0
        total_gross_pnl = 0.0
        total_friction = 0.0
        total_net_pnl = 0.0

        for d in dates:
            day_res = self.replay_single_day(d)
            daily_ledger.append(day_res)

            if day_res.get("status") in ["WIN", "LOSS"]:
                executed_trades.append(day_res)
                net = day_res["net_pnl"]
                gross = day_res["gross_pnl"]
                fric = day_res["statutory_friction"]

                total_net_pnl += net
                total_gross_pnl += gross
                total_friction += fric

                running_equity += net
                peak_equity = max(peak_equity, running_equity)
                dd = (peak_equity - running_equity) / peak_equity * 100.0
                drawdowns.append(dd)

                if day_res.get("circuit_hit"):
                    circuit_locks += 1

                if net > 0:
                    winning_trades += 1
                else:
                    losing_trades += 1

            equity_curve.append({
                "date": d,
                "equity": round(running_equity, 2),
                "peak": round(peak_equity, 2),
                "drawdown_pct": round((peak_equity - running_equity) / peak_equity * 100.0, 2)
            })

        active_count = len(executed_trades)
        win_rate = round(winning_trades / active_count * 100.0, 2) if active_count > 0 else 0.0

        gross_wins = sum(t["gross_pnl"] for t in executed_trades if t["gross_pnl"] > 0)
        gross_losses = abs(sum(t["gross_pnl"] for t in executed_trades if t["gross_pnl"] < 0))
        profit_factor = round(gross_wins / gross_losses, 2) if gross_losses > 0 else 999.0

        max_dd_pct = round(max(drawdowns), 2) if drawdowns else 0.0
        circuit_rate = round(circuit_locks / active_count * 100.0, 2) if active_count > 0 else 0.0

        summary = {
            "total_calendar_sessions": len(dates),
            "active_trades": active_count,
            "filtered_sessions": len(dates) - active_count,
            "winning_trades": winning_trades,
            "losing_trades": losing_trades,
            "win_rate_pct": win_rate,
            "profit_factor": profit_factor,
            "gross_pnl": round(total_gross_pnl, 2),
            "total_statutory_friction": round(total_friction, 2),
            "net_pnl": round(total_net_pnl, 2),
            "total_return_pct": round(total_net_pnl / self.initial_capital * 100.0, 2),
            "max_drawdown_pct": max_dd_pct,
            "circuit_locks": circuit_locks,
            "circuit_lock_rate_pct": circuit_rate,
            "final_equity": round(running_equity, 2)
        }

        # Serialize results to data folder
        out_dir = os.path.join(self.data_dir, "cash_backtest_results")
        os.makedirs(out_dir, exist_ok=True)

        json_path = os.path.join(out_dir, "cash_replay_trades_master.json")
        with open(json_path, "w") as f:
            json.dump(executed_trades, f, indent=2)

        if executed_trades:
            parquet_path = os.path.join(out_dir, "cash_replay_trades_master.parquet")
            t_df = pd.DataFrame(executed_trades)
            # Remove complex nested objects before parquet serialization
            if "best_counterfactual" in t_df.columns:
                t_df["best_counterfactual"] = t_df["best_counterfactual"].apply(
                    lambda x: x.get("symbol") if isinstance(x, dict) else "-"
                )
            t_df.to_parquet(parquet_path, index=False)

        return {
            "summary": summary,
            "daily_ledger": daily_ledger,
            "trades": executed_trades,
            "equity_curve": equity_curve
        }
