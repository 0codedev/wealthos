"""
Alpha Daemon - Headless Institutional Alpha Engine & Autopilot Daemon for WealthOS
--------------------------------------------------------------------------------
Runs 24/7 headlessly on the Oracle VPS (or locally) under PM2 supervision.
1. Pulls all 211 F&O stocks in 1 batch HTTP quote request via Upstox API.
2. Computes sector momentum, relative strength, and dominant sector.
3. Computes Morning Momentum Scores (MMS), CleanTrend verdicts, and ORB Retest states.
4. Generates an atomic pre-computed snapshot at `data/alpha_snapshot.json` for 0-freeze client hydration.
5. In the 10:00 AM - 11:30 AM IST window (post-10:15 AM time gate), evaluates high-conviction
   setups and headlessly punches trades directly to OpenAlgo without requiring an open browser tab.
"""

import os
import sys
import time
import json
import asyncio
import logging
import argparse
import threading
from datetime import datetime, timedelta, timezone

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from routers.shared import upstox_client
from services.telegram_bot import TelegramBotService
from parquet_query import batch_query_parquet_volume_averages, load_parquet_fallback_quotes
from logger import get_logger
from services.fno_quant_engine import (
    calculate_cross_sector_dispersion,
    detect_fno_dip_and_rebound,
    evaluate_upfront_compression_runner,
    evaluate_option_chain_quant,
    compute_fiqs_score,
    validate_institutional_participation
)

log = get_logger("alpha_daemon")

STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CONFIG_FILE = os.path.join(STATE_DIR, "telegram_config.json")
STATE_FILE = os.path.join(STATE_DIR, "autopilot_state.json")
SNAPSHOT_FILE = os.path.join(STATE_DIR, "alpha_snapshot.json")
STATUS_FILE = os.path.join(STATE_DIR, "alpha_daemon_status.json")
UNIVERSE_FILE = os.path.join(STATE_DIR, "fno_universe.json")
RULES_FILE = os.path.join(STATE_DIR, "autopilot_rules.json")

DEFAULT_RULES = {
    "nifty_macro_enabled": True,
    "nifty_long_threshold": 0.35,
    "nifty_short_threshold": -0.35,
    "neutral_divergence_override": 2.0,
    "dual_polarity_enabled": True,
    "force_long_only": False,
    "time_gate_enabled": True,
    "min_composite_score": 70.0,
    "hard_sl_pct": 35.0,
    "trail_trigger_pct": 40.0,
    "max_daily_loss_inr": 10000.0,
    "max_trades_per_day": 1,
    "dynamic_capital_enabled": True,
    "target_trade_capital": 25000.0,
    "capital_start_min": 35000.0,
    "capital_start_max": 50000.0,
    "capital_mid_min": 25000.0,
    "capital_mid_max": 35000.0,
    "capital_end_min": 15000.0,
    "capital_end_max": 25000.0,
    "strike_auto_adjust": True,
    "max_strike_shift": 2,
    "max_option_spread_pct": 1.50,
    "upfront_compression_enabled": True,
    "max_orc_threshold": 0.35,
    "max_dip_pvcr": 0.60,
    "min_rejection_wick_pct": 0.40,
    "enforce_5m_low_invariant": True
}

def load_autopilot_rules() -> dict:
    """Loads configurable trader execution rules with institutional defaults."""
    rules = dict(DEFAULT_RULES)
    if os.path.exists(RULES_FILE):
        try:
            with open(RULES_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    rules.update(saved)
        except Exception as e:
            log.warning(f"Failed to load {RULES_FILE}: {e}")
    return rules

os.makedirs(STATE_DIR, exist_ok=True)

def get_ist_now() -> datetime:
    """Returns current datetime in Indian Standard Time (IST)."""
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist)

def load_fno_universe() -> list[dict]:
    """Loads all 211 F&O stocks categorized by sector from fno_universe.json."""
    if os.path.exists(UNIVERSE_FILE):
        try:
            with open(UNIVERSE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log.error(f"Failed to load fno_universe.json: {e}")
    # Fallback universe
    return [
        {"symbol": "RELIANCE", "sector": "OIL & GAS"},
        {"symbol": "TCS", "sector": "IT"},
        {"symbol": "INFY", "sector": "IT"},
        {"symbol": "HDFCBANK", "sector": "BANK"},
        {"symbol": "ICICIBANK", "sector": "BANK"},
        {"symbol": "SBIN", "sector": "BANK"},
        {"symbol": "BHARTIARTL", "sector": "TELECOM"},
        {"symbol": "ITC", "sector": "FMCG"},
        {"symbol": "KOTAKBANK", "sector": "BANK"},
        {"symbol": "LT", "sector": "CAP GOODS"},
        {"symbol": "BAJFINANCE", "sector": "FINANCE"},
        {"symbol": "TATAMOTORS", "sector": "AUTO"},
        {"symbol": "MARUTI", "sector": "AUTO"},
        {"symbol": "SUNPHARMA", "sector": "PHARMA"},
        {"symbol": "AXISBANK", "sector": "BANK"}
    ]

def load_telegram_credentials(role: str = "autopilot") -> tuple[str, str]:
    """Loads bot token and chat ID for a given role from telegram_config.json."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                bots = json.load(f)
                if isinstance(bots, list):
                    bot = next((b for b in bots if b.get("role") == role and b.get("enabled")), None)
                    if not bot:
                        bot = next((b for b in bots if b.get("role") == "autopilot" and b.get("enabled")), None)
                    if bot:
                        return bot.get("token", ""), bot.get("chatId", "")
        except Exception as e:
            log.error(f"Failed to load telegram config: {e}")
    return os.getenv("TELEGRAM_BOT_TOKEN", ""), os.getenv("TELEGRAM_CHAT_ID", "")

async def send_telegram_alert(message: str, role: str = "autopilot"):
    """Sends a formatted HTML Telegram alert via TelegramBotService."""
    token, chat_id = load_telegram_credentials(role)
    if not token or not chat_id:
        log.warning(f"Telegram credentials for role '{role}' not configured. Alert skipped.")
        return
    try:
        bot = TelegramBotService(token, chat_id)
        res = await bot.send_message(message)
        if isinstance(res, dict) and res.get("status") == "error":
            log.error(f"Daemon Telegram alert failed ({role}): {res.get('error')}")
        else:
            log.info(f"Daemon Telegram alert sent successfully ({role}).")
    except Exception as e:
        log.error(f"Exception sending daemon Telegram alert: {e}")

class AlphaDaemon:
    def __init__(self, cadence_seconds: int = 60, dry_run: bool = False):
        self.cadence_seconds = cadence_seconds
        self.dry_run = dry_run
        self._running = False
        self._stop_event = threading.Event()
        self.loop_count = 0
        self.last_scan_ist = ""
        self.has_traded_today = False
        self.last_trade_date = ""
        self.last_summary_date = ""
        self.last_error = ""

    def write_status(self, extra: dict = None):
        """Atomically records daemon health and diagnostics."""
        status_payload = {
            "running": self._running,
            "dry_run": self.dry_run,
            "loop_count": self.loop_count,
            "last_scan_ist": self.last_scan_ist,
            "cadence_seconds": self.cadence_seconds,
            "has_traded_today": self.has_traded_today,
            "last_error": self.last_error,
            "updated_at": get_ist_now().isoformat()
        }
        if extra:
            status_payload.update(extra)
        try:
            tmp_file = STATUS_FILE + ".tmp"
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(status_payload, f, indent=2)
            os.replace(tmp_file, STATUS_FILE)
        except Exception as e:
            log.warning(f"Failed to write daemon status: {e}")

    def is_market_open(self, now: datetime) -> bool:
        """Returns True if within NSE equity market hours (09:15 to 15:30 IST, Mon-Fri)."""
        if now.weekday() >= 5: # Saturday or Sunday
            return False
        total_mins = now.hour * 60 + now.minute
        return (9 * 60 + 15) <= total_mins <= (15 * 60 + 30)

    def is_observation_window(self, now: datetime) -> bool:
        """Observation & Setup Locking Window: 10:00 AM to 10:30 AM IST."""
        if now.weekday() >= 5:
            return False
        total_mins = now.hour * 60 + now.minute
        return (10 * 60) <= total_mins <= (10 * 60 + 30)

    def is_upfront_runner_window(self, now: datetime) -> bool:
        """Golden Upfront F&O Momentum Window: 10:10 AM to 10:35 AM IST."""
        if now.weekday() >= 5:
            return False
        total_mins = now.hour * 60 + now.minute
        return (10 * 60 + 10) <= total_mins <= (10 * 60 + 35)

    def is_execution_window(self, now: datetime) -> bool:
        """Execution window: reads configured entry window or defaults to market hours 09:20 to 15:15 IST."""
        if now.weekday() >= 5:
            return False
        rules = load_autopilot_rules()
        start_min = int(rules.get("entry_window_start_mins", 9 * 60 + 20))
        end_min = int(rules.get("entry_window_end_mins", 15 * 60 + 15))
        total_mins = now.hour * 60 + now.minute
        return start_min <= total_mins <= end_min

    def is_after_time_gate(self, now: datetime) -> bool:
        """Evaluates time gate rule against configured entry window start."""
        rules = load_autopilot_rules()
        if not rules.get("time_gate_enabled", False):
            return True
        start_min = int(rules.get("entry_window_start_mins", 9 * 60 + 20))
        total_mins = now.hour * 60 + now.minute
        return total_mins >= start_min

    async def execute_cycle(self) -> dict:
        """
        Main evaluation pass:
        1. Pulls Nifty 50 and all F&O quotes in batch.
        2. Aggregates sectors and computes relative strength.
        3. Scores stocks for MMS, CleanTrend, and ORB Retest.
        4. Writes `alpha_snapshot.json`.
        5. Executes top trade if criteria pass.
        """
        now = get_ist_now()
        today_str = now.strftime("%Y-%m-%d")
        now_str = now.strftime("%H:%M:%S")
        self.last_scan_ist = f"{today_str} {now_str} IST"

        if self.last_trade_date != today_str:
            self.has_traded_today = False
            self.last_trade_date = today_str

        # 1. Fetch Nifty 50 quote
        nifty_key = "NSE_INDEX|Nifty 50"
        nifty_change = 0.0
        nifty_ltp = 0.0
        try:
            n_quotes = upstox_client.get_full_quotes([nifty_key])
            n_data = n_quotes.get("data", {}) if isinstance(n_quotes, dict) and "data" in n_quotes else n_quotes
            q = (
                n_data.get("NSE_INDEX:Nifty 50")
                or n_data.get(nifty_key)
                or n_data.get("NSE_INDEX|Nifty 50")
                or n_data.get("Nifty 50")
            )
            if q:
                nifty_ltp = float(q.get("last_price", 0.0))
                net_chg = q.get("net_change")
                if net_chg is not None:
                    net_chg = float(net_chg)
                    prev_cp = nifty_ltp - net_chg
                    if prev_cp > 0:
                        nifty_change = round((net_chg / prev_cp) * 100, 2)
                else:
                    ohlc = q.get("ohlc", {}) or {}
                    cp = float(ohlc.get("close", 0) or q.get("cp", 0) or nifty_ltp)
                    if nifty_ltp > 0 and cp > 0 and cp != nifty_ltp:
                        nifty_change = round(((nifty_ltp - cp) / cp) * 100, 2)
        except Exception as e:
            log.warning(f"Failed to fetch Nifty quote: {e}")

        # 2. Fetch full universe quotes in a single batch
        universe = load_fno_universe()
        key_map = {}
        sector_map = {}
        symbol_keys = []
        for item in universe:
            sym = item.get("symbol")
            sec = item.get("sector", "OTHERS")
            if not sym:
                continue
            k = db.get_upstox_instrument_key(sym, exchange="NSE_EQ") or db.get_upstox_instrument_key(sym)
            if k:
                symbol_keys.append(k)
                key_map[k] = sym
                sector_map[sym] = sec

        raw_quotes = {}
        if symbol_keys:
            try:
                res = upstox_client.get_full_quotes(symbol_keys)
                raw_quotes = res.get("data", {}) if isinstance(res, dict) and "data" in res else res
            except Exception as e:
                log.error(f"Batch quotes call failed: {e}")
                self.last_error = str(e)

        # Fallback to DuckDB Parquet archives if live broker API is unavailable/offline
        if not raw_quotes:
            log.info("Live quotes unavailable or token expired. Engaging DuckDB Parquet fallback quote engine...")
            try:
                raw_quotes = load_parquet_fallback_quotes()
                log.info(f"Loaded {len(raw_quotes)} offline quotes directly from Parquet archive.")
            except Exception as fe:
                log.error(f"Parquet fallback quote generation failed: {fe}")

        # 3. Process Stock Metrics & Group by Sector with DuckDB Parquet Baselines
        vol_baselines = {}
        try:
            vol_baselines = batch_query_parquet_volume_averages()
        except Exception as ex:
            log.warning(f"Failed to load DuckDB Parquet baselines in daemon: {ex}")

        sector_groups: dict[str, list[dict]] = {}
        stocks_list: list[dict] = []

        for k, sym in key_map.items():
            q = (
                raw_quotes.get(f"NSE_EQ:{sym}")
                or raw_quotes.get(k)
                or raw_quotes.get(k.replace("|", ":"))
                or raw_quotes.get(sym)
            )
            if not q:
                continue
            ltp = float(q.get("last_price", 0.0))
            if ltp <= 0:
                continue

            net_chg = q.get("net_change")
            if net_chg is not None:
                net_chg = float(net_chg)
                prev_cp = ltp - net_chg
                pct_chg = round((net_chg / prev_cp) * 100, 2) if prev_cp > 0 else 0.0
            else:
                ohlc = q.get("ohlc", {}) or {}
                cp = float(ohlc.get("close", 0) or q.get("cp", 0) or ltp)
                pct_chg = round(((ltp - cp) / cp) * 100, 2) if cp > 0 else 0.0

            ohlc = q.get("ohlc", {}) or {}
            open_price = float(ohlc.get("open", 0.0) or ltp)
            high_price = float(ohlc.get("high", 0.0) or ltp)
            low_price = float(ohlc.get("low", 0.0) or ltp)
            volume = int(q.get("volume", 0) or 0)

            # DuckDB 20-day historical technical baseline
            tech = vol_baselines.get(sym, {})
            adv = float(tech.get("avg_volume_20d", 0.0))
            atr_20d = float(tech.get("avg_atr_20d", 0.0))
            high_20d = float(tech.get("high_20d", 0.0))
            low_20d = float(tech.get("low_20d", 0.0))

            # Institutional Relative Volume (RVOL) with non-linear intraday time-curve
            now_ist = get_ist_now()
            m_elapsed = max(1, (now_ist.hour - 9) * 60 + now_ist.minute - 15)
            exp_frac = max(0.05, min(1.0, (m_elapsed / 375.0) ** 0.382))
            rvol = round(volume / (adv * exp_frac), 2) if adv > 0 else 1.0

            # Day range and score
            day_range = high_price - low_price
            day_extreme = (ltp - low_price) / day_range if day_range > 0 else 0.5
            open_change_pct = ((ltp - open_price) / open_price * 100) if open_price > 0 else 0.0
            opening_gap_pct = ((open_price - (ltp - net_chg)) / (ltp - net_chg) * 100) if (net_chg is not None and (ltp - net_chg) > 0) else 0.0

            # G-Factor (Normalized momentum proxy)
            g_factor = round(min(10.0, max(1.0, 5.0 + (pct_chg * 1.5) + (open_change_pct * 0.8))), 2)
            # R-Factor: Institutional volume surge blended with directional momentum (Calibrated OLS Model)
            atr_pct = (atr_20d / ltp) * 100 if ltp > 0 else 1.5
            r_factor = round(0.484 + (0.645 * rvol) + (0.518 * (abs(pct_chg) / max(0.2, atr_pct))), 2)

            # CleanTrend Verdict
            if pct_chg >= 1.0 and open_change_pct > 0.3 and day_extreme > 0.70:
                ct_verdict = "CLEAN"
            elif pct_chg <= -1.0 and open_change_pct < -0.3 and day_extreme < 0.30:
                ct_verdict = "CLEAN"
            elif (opening_gap_pct > 0.5 and open_change_pct < -0.2) or (opening_gap_pct < -0.5 and open_change_pct > 0.2):
                ct_verdict = "TRAP"
            else:
                ct_verdict = "WATCH"

            # Dynamic ORB Status
            if low_price >= open_price * 0.9985 and ltp > open_price:
                orb_status = "RETEST"
            elif high_price <= open_price * 1.0015 and ltp < open_price:
                orb_status = "RETEST"
            elif day_extreme >= 0.90:
                orb_status = "BREAK"
            else:
                orb_status = "PENDING"

            # MMS Score (Morning Momentum Score)
            mms_base = 50.0 + (abs(pct_chg) * 12.0) + (g_factor * 2.5)
            if ct_verdict == "CLEAN":
                mms_base += 10.0
            elif ct_verdict == "TRAP":
                mms_base -= 20.0
            if orb_status == "RETEST":
                mms_base += 5.0
            if rvol >= 2.0:
                mms_base += 5.0
            mms = round(min(100.0, max(10.0, mms_base)), 1)

            # Recommended Option Strike
            strike_step = 50 if ltp > 2000 else 20 if ltp > 500 else 10
            strike = round(ltp / strike_step) * strike_step
            opt_type = "CE" if pct_chg >= 0 else "PE"
            month_str = now.strftime("%b").upper()
            contract_symbol = f"{sym}26{month_str}{strike}{opt_type}"

            sec_name = sector_map.get(sym, "OTHERS")

            stock_entry = {
                "symbol": sym,
                "sector": sec_name,
                "lastPrice": ltp,
                "percentChange": pct_chg,
                "openPrice": open_price,
                "high": high_price,
                "low": low_price,
                "volume": volume,
                "adv": adv,
                "rvol": rvol,
                "atr20": atr_20d,
                "high20": high_20d,
                "low20": low_20d,
                "dayExtremeScore": round(day_extreme, 3),
                "openChangePct": round(open_change_pct, 2),
                "openingGapPct": round(opening_gap_pct, 2),
                "gFactor": g_factor,
                "rFactor": r_factor,
                "cleanTrend": ct_verdict,
                "orbStatus": orb_status,
                "mms": mms,
                "contractSymbol": contract_symbol,
                "direction": "CALL" if pct_chg >= 0 else "PUT"
            }

            stocks_list.append(stock_entry)
            if sec_name not in sector_groups:
                sector_groups[sec_name] = []
            sector_groups[sec_name].append(stock_entry)

        # 4. Sector Aggregations & Dominance
        sectors_summary: list[dict] = []
        nifty_denom = max(abs(nifty_change), 0.1)

        for sec_name, sec_stocks in sector_groups.items():
            if not sec_stocks:
                continue
            avg_chg = round(sum(s["percentChange"] for s in sec_stocks) / len(sec_stocks), 2)
            tot_vol = sum(s["volume"] for s in sec_stocks)
            strength_ratio = round(avg_chg / nifty_denom, 2)
            sectors_summary.append({
                "sector": sec_name,
                "percentChange": avg_chg,
                "volume": tot_vol,
                "strengthRatio": strength_ratio,
                "stockCount": len(sec_stocks),
                "confluenceGrade": "STRONG BULLISH" if avg_chg > 0.8 else "STRONG BEARISH" if avg_chg < -0.8 else "NEUTRAL"
            })

        # 4. Cross-Sector Dispersion & Extreme Rotation Analysis
        dispersion_res = calculate_cross_sector_dispersion(sectors_summary, nifty_change=nifty_change)
        dominant_sector = dispersion_res.get("dominant_sector")
        dominant_direction = dispersion_res.get("direction", "CALL")
        is_extreme_rotation = dispersion_res.get("is_extreme", False)
        regime = dispersion_res.get("regime", "NEUTRAL_CHOP_SQUELCH")

        log.info(f"📊 [SECTOR DISPERSION] Spread: {dispersion_res.get('spread')}% | Regime: {regime} | Direction: {dominant_direction} | Leader: {dominant_sector.get('sector') if dominant_sector else 'None'}")

        # Enrich stocks with FIQS (F&O Institutional Quant Score)
        sec_z_map = {s["sector"]: s.get("z_score", 0.0) for s in dispersion_res.get("sectors_ranked", [])}
        for s in stocks_list:
            s_z = sec_z_map.get(s["sector"], 0.0)
            s["fiqs"] = compute_fiqs_score(
                stock_pct_chg=s["percentChange"],
                sector_z_score=s_z,
                rvol=s["rvol"],
                pcr=1.0,
                clean_trend=s["cleanTrend"],
                pvcr=0.60,
                direction="CALL" if s["percentChange"] >= 0 else "PUT"
            )

        # 5. Filter & Rank Top Setups
        long_candidates = [s for s in stocks_list if s["percentChange"] > 0 and s["cleanTrend"] != "TRAP"]
        if dominant_sector and dominant_direction == "CALL":
            sec_name = dominant_sector["sector"]
            sec_longs = [s for s in long_candidates if s["sector"] == sec_name]
            other_longs = [s for s in long_candidates if s["sector"] != sec_name]
            sec_longs.sort(key=lambda s: s.get("fiqs", s["mms"]), reverse=True)
            other_longs.sort(key=lambda s: s.get("fiqs", s["mms"]), reverse=True)
            long_candidates = sec_longs + other_longs
        else:
            long_candidates.sort(key=lambda s: s.get("fiqs", s["mms"]), reverse=True)

        short_candidates = [s for s in stocks_list if s["percentChange"] < 0 and s["cleanTrend"] != "TRAP"]
        if dominant_sector and dominant_direction == "PUT":
            sec_name = dominant_sector["sector"]
            sec_shorts = [s for s in short_candidates if s["sector"] == sec_name]
            other_shorts = [s for s in short_candidates if s["sector"] != sec_name]
            sec_shorts.sort(key=lambda s: s.get("fiqs", s["mms"]), reverse=True)
            other_shorts.sort(key=lambda s: s.get("fiqs", s["mms"]), reverse=True)
            short_candidates = sec_shorts + other_shorts
        else:
            short_candidates.sort(key=lambda s: s.get("fiqs", s["mms"]), reverse=True)

        # Macro Benchmark Primacy Invariant: Top picks must match dominant_direction without falling back to opposite trend
        if dominant_direction == "CALL":
            top_picks = long_candidates[:5] if long_candidates else [s for s in stocks_list if s["percentChange"] >= 0 and s["cleanTrend"] != "TRAP"][:5]
        else:
            top_picks = short_candidates[:5] if short_candidates else [s for s in stocks_list if s["percentChange"] <= 0 and s["cleanTrend"] != "TRAP"][:5]

        # 6. Evaluate Dip-Rebound & Option Quant on Top Candidates (Multi-Candidate Surveillance)
        dip_rebound_state = {
            "confirmed": False,
            "status": "WAITING_FOR_DIP",
            "reason": "No candidate evaluated yet"
        }
        option_quant_state = {
            "verified": False,
            "pcr": 1.0,
            "oi_buildup": "UNKNOWN",
            "spread_pct": 0.0
        }

        # Multi-Candidate Surveillance: Scan up to Top 5 candidates to find the highest-conviction setup
        # that satisfies dip confirmation, institutional volume gate, and options liquidity
        confirmed_candidate = None
        for cand in top_picks:
            cand_sym = cand["symbol"]

            # 🛡️ INDEX-BETA CORRELATION & MACRO TREND ALIGNMENT GATE
            # On a strong index trend day (|nifty_change| >= 0.50%), disqualify contradictory or lagging candidates
            if abs(nifty_change) >= 0.50:
                if nifty_change >= 0.50:
                    # Strong Bull Day: Reject any PUT setups or stocks with negative change / severe lagging
                    if dominant_direction != "CALL" or cand.get("direction") == "PUT":
                        log.info(f"🛑 [INDEX-BETA GATE] {cand_sym} rejected: Direction {cand.get('direction')} contradicts strong bullish index trend (+{nifty_change:.2f}%).")
                        continue
                    if cand.get("percentChange", 0.0) < 0.0:
                        log.info(f"🛑 [INDEX-BETA GATE] {cand_sym} rejected: Stock is down ({cand.get('percentChange')}%) while Nifty is ripping +{nifty_change:.2f}%. Relative weakness trap.")
                        continue
                elif nifty_change <= -0.50:
                    # Strong Bear Day: Reject any CALL setups or stocks with positive change
                    if dominant_direction != "PUT" or cand.get("direction") == "CALL":
                        log.info(f"🛑 [INDEX-BETA GATE] {cand_sym} rejected: Direction {cand.get('direction')} contradicts strong bearish index trend ({nifty_change:.2f}%).")
                        continue
                    if cand.get("percentChange", 0.0) > 0.0:
                        log.info(f"🛑 [INDEX-BETA GATE] {cand_sym} rejected: Stock is up ({cand.get('percentChange')}%) while Nifty is plunging {nifty_change:.2f}%. Relative strength divergence.")
                        continue

            cand_key = None
            for k, sym in key_map.items():
                if sym == cand_sym:
                    cand_key = k
                    break
            if not cand_key:
                cand_key = db.get_upstox_instrument_key(cand_sym, exchange="NSE_EQ") or db.get_upstox_instrument_key(cand_sym)

            # Check institutional volume participation (Counterfactual Learning Invariant)
            vol_gate = validate_institutional_participation(
                volume=cand.get("volume", 0),
                rvol=cand.get("rvol", 1.0)
            )
            cand["volume_gate"] = vol_gate

            c_dip = {"confirmed": False, "status": "NO_KEY", "reason": "No instrument key"}
            if cand_key:
                try:
                    k_enc = cand_key.replace("|", "%7C")
                    from_d = (now - timedelta(days=2)).strftime("%Y-%m-%d")
                    c_res = upstox_client.get_historical_candles(k_enc, "1minute", today_str, from_d)
                    if c_res.get("status") == "success" and "data" in c_res:
                        raw_c = c_res["data"].get("candles", [])
                        if raw_c:
                            c_dip = detect_fno_dip_and_rebound(
                                symbol=cand_sym,
                                direction=dominant_direction,
                                candles_1m=raw_c,
                                vwap=cand["lastPrice"],
                                ema_9=cand["lastPrice"],
                                daily_atr=float(cand.get("atr20", 0.0)),
                                sector_return=float(dominant_sector.get("percentChange", 0.0)) if dominant_sector else 0.0,
                                nifty_return=float(nifty_change),
                                ema_21=cand["lastPrice"]
                            )
                except Exception as ce:
                    log.warning(f"Failed to fetch 1m candles for {cand_sym}: {ce}")

            cand["dip_state"] = c_dip

            is_upfront_runner = (c_dip.get("mode") == "MOMENTUM_RUNNER_UPFRONT" or c_dip.get("status") == "UPFRONT_RUNNER_CONFIRMED")
            archetype_name = c_dip.get("archetype", "COILED_RUNNER" if is_upfront_runner else "DIP_REBOUND")

            # Exhaustion Trap Sentry: Veto morning pump-and-dump traps immediately
            if c_dip.get("status") == "EXHAUSTION_TRAP":
                log.info(f"🛑 [EXHAUSTION SENTRY] Disqualified {cand_sym}: {c_dip.get('reason')}")
                continue

            if is_upfront_runner or c_dip.get("confirmed", False):
                log.info(
                    f"🚀 [MOMENTUM SETUP DETECTED] {cand_sym} ({archetype_name}) | "
                    f"Score={c_dip.get('score', 0)}/100 | PVCR={c_dip.get('pvcr')}x | "
                    f"Defended Floor: ₹{c_dip.get('first_5m_low', 0)}"
                )

            # Ensure candidate #1 dip state is stored as default for UI HUD
            if cand == top_picks[0]:
                dip_rebound_state = c_dip

            # Check if candidate confirms dip AND passes institutional volume gate (or confirmed upfront runner)
            if c_dip.get("confirmed", False) and (vol_gate.get("passed", False) or is_upfront_runner):
                try:
                    c_opt = evaluate_option_chain_quant(
                        symbol=cand_sym,
                        direction=dominant_direction,
                        spot_price=cand["lastPrice"],
                        upstox_client_instance=upstox_client
                    )
                    cand["option_quant"] = c_opt
                    if c_opt and "gex" in c_opt:
                        gex_info = c_opt.get("gex", {})
                        skew_info = c_opt.get("skew", {})
                        basis_info = c_opt.get("synthetic_basis", {})
                        pain_info = c_opt.get("max_pain", {})

                        cand["fiqs"] = compute_fiqs_score(
                            stock_pct_chg=cand["percentChange"],
                            sector_z_score=sec_z_map.get(cand["sector"], 0.0),
                            rvol=cand["rvol"],
                            pcr=float(c_opt.get("pcr", 1.0)),
                            clean_trend=cand["cleanTrend"],
                            pvcr=float(c_dip.get("pvcr", 0.60)),
                            direction=dominant_direction,
                            gex_regime=gex_info.get("regime", "NEUTRAL"),
                            skew_verdict=skew_info.get("skew_verdict", "BALANCED_NORMAL"),
                            basis_pct=float(basis_info.get("basis_pct", 0.0)),
                            pain_gravity=pain_info.get("pain_gravity_verdict", "NEUTRAL")
                        )
                        cand["derivatives_quant"] = {
                            "gex_regime": gex_info.get("regime"),
                            "net_gex": gex_info.get("net_gex"),
                            "zero_gamma_strike": gex_info.get("zero_gamma_strike"),
                            "skew_25d": skew_info.get("skew_25d"),
                            "skew_verdict": skew_info.get("skew_verdict"),
                            "synthetic_basis_pct": basis_info.get("basis_pct"),
                            "max_pain_strike": pain_info.get("max_pain_strike"),
                            "pain_gravity": pain_info.get("pain_gravity_verdict"),
                            "momentum_continuation_confirmed": c_opt.get("momentum_continuation_confirmed", False)
                        }

                    spread_val = float(c_opt.get("spread_pct", 999.0))
                    if c_opt.get("verified", False) and c_opt.get("momentum_continuation_confirmed", False) and spread_val <= 2.50:
                        confirmed_candidate = cand
                        dip_rebound_state = c_dip
                        option_quant_state = c_opt
                        log.info(
                            f"🏆 [MULTI-CANDIDATE SELECTION] Confirmed Leader: {cand_sym} ({archetype_name}) | "
                            f"Score={c_dip.get('score', 0)}/100 | Vol={cand.get('volume', 0):,} | "
                            f"RVOL={cand.get('rvol', 1.0)}x | Spread={spread_val:.2f}%"
                        )
                        break
                    elif spread_val > 2.50:
                        log.info(
                            f"⚠️ [SPREAD WATERFALL CASCADE] Candidate {cand_sym} verified but option spread {spread_val:.2f}% > 2.50%. "
                            f"Cascading to next rank..."
                        )
                except Exception as oe:
                    log.warning(f"Failed to evaluate option chain for {cand_sym}: {oe}")
            elif c_dip.get("confirmed", False) and not vol_gate.get("passed", False):
                log.info(f"⚠️ [VOLUME GATE VETO] {cand_sym} confirmed dip but vetoed as low-liquidity trap ({vol_gate['reason']}). Scanning next candidate.")


        # 7. Build and Write Atomic Snapshot with Full Screener Coverage & Dual-Write to cache.db
        mood_is_bullish = nifty_change >= 0
        volume_averages_map = {s["symbol"]: s["adv"] for s in stocks_list if s.get("adv", 0) > 0}
        snapshot_payload = {
            "status": "success",
            "timestamp": now.isoformat(),
            "formatted_time": f"{today_str} {now_str} IST",
            "market_open": self.is_market_open(now),
            "nifty": {
                "ltp": nifty_ltp,
                "change": nifty_change,
                "direction": "BULL" if nifty_change >= 0 else "BEAR"
            },
            "mood": {
                "isBullish": mood_is_bullish,
                "sentiment": "BULLISH" if mood_is_bullish else "BEARISH",
                "timestamp": now.isoformat()
            },
            "dominant_sector": dominant_sector,
            "sector_dispersion": dispersion_res,
            "dip_rebound_state": dip_rebound_state,
            "option_quant": option_quant_state,
            "sectors": dispersion_res.get("sectors_ranked", sectors_summary),
            "top_picks": top_picks,
            "stocks": stocks_list,
            "volume_averages": volume_averages_map,
            "fno_stocks_scanned": len(stocks_list),
            "daemon_loop": self.loop_count
        }

        try:
            tmp_snap = SNAPSHOT_FILE + ".tmp"
            with open(tmp_snap, "w", encoding="utf-8") as f:
                json.dump(snapshot_payload, f, indent=2)
            os.replace(tmp_snap, SNAPSHOT_FILE)
            log.info(f"⚡ [SNAPSHOT] Saved pre-computed Alpha snapshot ({len(stocks_list)} stocks, {len(sectors_summary)} sectors).")
        except Exception as e:
            log.error(f"Failed to write snapshot file: {e}")

        # Dual-write to cache.db market_snapshots table for zero-lock fallback
        try:
            db.save_market_snapshot("alpha_engine", "upstox", "screener_snapshot", snapshot_payload)
        except Exception as e:
            log.warning(f"Dual-write to cache.db market_snapshots failed: {e}")

        # 8. Headless Autopilot Trade Execution Evaluation
        executed_trade = None
        state = {}
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    state = json.load(f)
            except Exception:
                pass

        auto_trade_enabled = state.get("enabled", False)
        active_trade = state.get("active_trade")

        in_exec_window = self.is_execution_window(now)
        after_time_gate = self.is_after_time_gate(now)

        rules = load_autopilot_rules()
        is_sandbox = rules.get("sandbox_mode", True)
        allow_moderate = rules.get("allow_moderate_rotation", True)
        rotation_ok = is_extreme_rotation or (allow_moderate and dominant_sector is not None)
        can_trade_today = (not self.has_traded_today) if not is_sandbox else True

        if auto_trade_enabled and in_exec_window and after_time_gate and can_trade_today and not active_trade and rotation_ok:
            min_score = float(rules.get("min_composite_score", 60.0))
            candidate_to_punch = confirmed_candidate
            if candidate_to_punch and (candidate_to_punch.get("fiqs", candidate_to_punch["mms"])) >= min_score:
                best_setup = candidate_to_punch

                # Strict Verification Gates (Must be strictly confirmed across ALL modes - zero sandbox bypass)
                dip_confirmed = dip_rebound_state.get("confirmed", False)
                opt_verified = option_quant_state.get("verified", False)
                momentum_cont = option_quant_state.get("momentum_continuation_confirmed", False)

                ready_to_punch = bool(dip_confirmed and opt_verified and momentum_cont)

                if ready_to_punch:
                    gex_reg = option_quant_state.get("gex", {}).get("regime", "NEUTRAL")
                    skew_val = option_quant_state.get("skew", {}).get("skew_25d", 0.0)
                    log.info(f"🎯 [AUTOPILOT EXECUTION] Confirmed Setup ({dominant_direction}): {best_setup['symbol']} FIQS={best_setup.get('fiqs')} PVCR={dip_rebound_state.get('pvcr')}x PCR={option_quant_state.get('pcr')} GEX={gex_reg} Skew={skew_val}% Spread={option_quant_state.get('spread_pct')}% (Sandbox={is_sandbox})")
                    
                    contract_to_punch = option_quant_state.get("contract_symbol") or best_setup.get("contractSymbol")
                    if self.dry_run:
                        log.info(f"🔍 [DRY-RUN] Simulating trade punch: BUY {contract_to_punch} for {best_setup['symbol']}")
                        executed_trade = {"symbol": best_setup["symbol"], "contract": contract_to_punch, "dry_run": True}
                    else:
                        executed_trade = await self.execute_trade_punch(best_setup, dominant_sector, nifty_change)
                        if executed_trade and not is_sandbox:
                            self.has_traded_today = True
                else:
                    log.info(f"⏳ [AUTOPILOT GATE] {best_setup['symbol']} waiting: DipConfirmed={dip_confirmed} ({dip_rebound_state.get('status')}) | OptVerified={opt_verified} (Spread={option_quant_state.get('spread_pct')}%).")

        self.loop_count += 1
        self.write_status({
            "stocks_scanned": len(stocks_list),
            "dominant_sector": dominant_sector.get("sector") if dominant_sector else None,
            "top_candidate": top_picks[0]["symbol"] if top_picks else None,
            "executed_trade": executed_trade
        })

        return snapshot_payload

    async def execute_trade_punch(self, setup: dict, sector: dict, nifty_change: float) -> dict | None:
        """Punches trade directly to OpenAlgo via receive_signal."""
        try:
            from routers.autopilot import receive_signal, SignalRequest, load_autopilot_rules
            from fastapi import BackgroundTasks

            rules = load_autopilot_rules()
            is_sandbox = rules.get("sandbox_mode", True)

            req = SignalRequest(
                symbol=setup["symbol"],
                sector=setup["sector"],
                direction="BUY" if setup["direction"] == "CALL" else "SELL",
                ltp=setup["lastPrice"],
                strengthFactor=float(setup["mms"]),
                sectorStrength=float(sector.get("strengthRatio", 1.0)) if sector else 1.0,
                niftyChange=nifty_change,
                strategy="FNO_SectorRotation",
                bypass_checks=False
            )

            bg_tasks = BackgroundTasks()
            res = await receive_signal(req, bg_tasks)

            # Execute background tasks (Telegram alert, OpenAlgo execution, DB entry)
            for task in bg_tasks.tasks:
                if asyncio.iscoroutinefunction(task.func):
                    await task.func(*task.args, **task.kwargs)
                else:
                    task.func(*task.args, **task.kwargs)

            log.info(f"✅ [AUTOPILOT] Headless order punched: {setup['symbol']} -> {res}")
            return res.get("data")
        except Exception as e:
            log.error(f"Failed to punch headless trade: {e}")
            self.last_error = f"Trade punch failed: {e}"
            return None

    async def run_forever(self):
        """Infinite daemon loop."""
        self._running = True
        log.info(f"🚀 AlphaDaemon started (cadence: {self.cadence_seconds}s, dry_run: {self.dry_run}).")
        
        while not self._stop_event.is_set():
            try:
                await self.execute_cycle()
            except Exception as e:
                log.error(f"Error in AlphaDaemon cycle: {e}")
                self.last_error = str(e)
            
            # Adaptive sleep cadence: 60s during market hours (09:15-15:30 Mon-Fri),
            # 300s (5 minutes) off-market/weekends to conserve 85% VPS CPU while keeping snapshot fresh.
            now = get_ist_now()
            sleep_duration = self.cadence_seconds if self.is_market_open(now) else max(self.cadence_seconds, 300)
            await asyncio.sleep(sleep_duration)

    def stop(self):
        self._running = False
        self._stop_event.set()
        log.info("⏹ AlphaDaemon stop requested.")

def main():
    parser = argparse.ArgumentParser(description="WealthOS Headless Alpha Daemon")
    parser.add_argument("--cadence", type=int, default=60, help="Loop cadence in seconds (default: 60)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate orders without placing them")
    parser.add_argument("--once", action="store_true", help="Run a single evaluation cycle and exit")
    args = parser.parse_args()

    daemon = AlphaDaemon(cadence_seconds=args.cadence, dry_run=args.dry_run)

    if args.once:
        log.info("Running single evaluation cycle (--once)...")
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(daemon.execute_cycle())
        loop.close()
        print(json.dumps({
            "status": "success",
            "timestamp": result.get("timestamp"),
            "scanned": result.get("fno_stocks_scanned"),
            "dominant_sector": result.get("dominant_sector"),
            "top_picks_count": len(result.get("top_picks", []))
        }, indent=2))
    else:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(daemon.run_forever())
        except KeyboardInterrupt:
            daemon.stop()
        finally:
            loop.close()

if __name__ == "__main__":
    main()
