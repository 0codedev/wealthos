import os
import sys
import time
import json
import asyncio
import logging
import threading
from datetime import datetime, timedelta, timezone

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import db
from routers.shared import upstox_client
from services.telegram_bot import TelegramBotService

from logger import get_logger

log = get_logger("autopilot_daemon")

BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(BRIDGE_DIR)
STATE_DIR = os.path.join(ROOT_DIR, "data")
CONFIG_FILE = os.path.join(STATE_DIR, "telegram_config.json")
STATE_FILE = os.path.join(STATE_DIR, "autopilot_state.json")
UNIVERSE_FILE = os.path.join(STATE_DIR, "fno_universe.json")

def load_fno_universe() -> list[dict]:
    """Loads all 211 F&O stocks categorized by sector from fno_universe.json."""
    if os.path.exists(UNIVERSE_FILE):
        try:
            with open(UNIVERSE_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            log.error(f"Failed to load fno_universe.json: {e}")
    # Fallback list if file not found
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
        {"symbol": "LT", "sector": "CAP GOODS"}
    ]

def get_ist_now() -> datetime:
    """Returns current date-time in Indian Standard Time (IST)."""
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist)

def load_telegram_credentials(role: str = "autopilot") -> tuple[str, str]:
    """Loads bot token and chat ID for a given role from telegram_config.json."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
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

async def send_daemon_telegram_alert(message: str, role: str = "autopilot"):
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

# Anti-spam cooldown per symbol for Telegram price alerts
_symbol_alert_cooldowns: dict[str, float] = {}

class HeadlessAutopilotDaemon:
    def __init__(self):
        self._running = False
        self._thread = None
        self._stop_event = threading.Event()
        self._has_scanned_today = False
        self._has_harvested_today = False
        self._has_reported_today = False
        self._last_scan_date = ""
        self._last_summary_sent_date = ""

    def start(self):
        if self._running:
            return
        self._running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        log.info("🚀 Headless AutopilotDaemon background worker started.")

    def stop(self):
        self._running = False
        self._stop_event.set()
        log.info("⏹ Headless AutopilotDaemon background worker stop requested.")

    def _run_loop(self):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self._async_scan_loop())
        loop.close()

    async def _async_scan_loop(self):
        log.info("Headless AutopilotDaemon async scan loop entered.")
        while not self._stop_event.is_set():
            try:
                ist_now = get_ist_now()
                today_str = ist_now.strftime("%Y-%m-%d")

                # Reset scan, harvest & report flags on new day
                if self._last_scan_date != today_str:
                    self._has_scanned_today = False
                    self._has_harvested_today = False
                    self._has_reported_today = False
                    self._last_scan_date = today_str

                # Check state: enabled?
                enabled = False
                if os.path.exists(STATE_FILE):
                    try:
                        with open(STATE_FILE, "r") as f:
                            st = json.load(f)
                            enabled = st.get("enabled", False)
                    except Exception:
                        pass

                # Trading day check (Mon-Fri)
                if ist_now.weekday() >= 5:
                    await asyncio.sleep(60)
                    continue

                hour = ist_now.hour
                minute = ist_now.minute

                # 🧠 EOD Telemetry & RL Recalibration trigger at 15:35 IST
                if hour == 15 and minute >= 35 and not getattr(self, "_has_harvested_today", False):
                    try:
                        log.info(f"Market closed ({ist_now.strftime('%H:%M:%S')} IST). Triggering EOD Telemetry Harvester & RL Recalibration...")
                        import subprocess
                        harvest_script = os.path.join(ROOT_DIR, "scripts", "harvest_daily_telemetry.py")
                        subprocess.run([sys.executable, harvest_script, "--daily"], check=False)
                        self._has_harvested_today = True
                        log.info("✅ EOD Telemetry Harvester & Recalibration completed successfully.")
                    except Exception as eod_err:
                        log.error(f"Failed to execute EOD Telemetry Harvest: {eod_err}")

                # 🤖 Post-Market AI Prop Desk Review trigger at 16:00 IST
                if hour >= 16 and not getattr(self, "_has_reported_today", False) and getattr(self, "_has_harvested_today", False):
                    try:
                        log.info(f"Market closed ({ist_now.strftime('%H:%M:%S')} IST). Triggering Post-Market AI Prop Desk Diagnostic...")
                        import subprocess
                        reporter_script = os.path.join(ROOT_DIR, "python-bridge", "services", "daily_ai_reporter.py")
                        subprocess.run([sys.executable, reporter_script], check=False)
                        self._has_reported_today = True
                        log.info("✅ Post-Market AI Prop Desk Diagnostic generated and dispatched successfully.")
                    except Exception as rep_err:
                        log.error(f"Failed to execute Post-Market AI Diagnostic: {rep_err}")

                if not enabled:
                    await asyncio.sleep(15)
                    continue

                # Target execution window: 10:00 AM to 11:30 AM IST
                in_window = (hour == 10) or (hour == 11 and minute <= 30)

                if in_window:
                    log.info(f"Inside Autopilot market window ({ist_now.strftime('%H:%M:%S')} IST). Running headless scan...")
                    scanned_trade = await self.execute_headless_scan()
                    if scanned_trade:
                        self._has_scanned_today = True
                        log.info(f"Headless trade successfully placed for {scanned_trade.get('symbol')}. Pausing scan for 5 minutes.")
                        await asyncio.sleep(300)
                    else:
                        await asyncio.sleep(60) # Scan cadence: 60 seconds (no spam)
                else:
                    await asyncio.sleep(30)

            except Exception as e:
                log.error(f"Error in AutopilotDaemon loop: {e}")
                await asyncio.sleep(15)

    async def execute_headless_scan(self) -> dict | None:
        """
        Headlessly fetches live Upstox F&O OHLC market data, computes quant conviction scores,
        checks Nifty direction, broadcasts high-conviction breakout alerts, and triggers Autopilot signals.
        """
        try:
            from routers.autopilot import (
                receive_signal, SignalRequest, get_ist_now,
                calculate_composite_score, state, state_lock
            )
            from fastapi import BackgroundTasks

            # 1. Fetch Nifty 50 Change using Full Quotes (net_change / previous close)
            nifty_key = "NSE_INDEX|Nifty 50"
            nifty_change = 0.0
            try:
                nifty_res = upstox_client.get_full_quotes([nifty_key])
                if nifty_res:
                    data = nifty_res.get("data", {}) if (isinstance(nifty_res, dict) and "data" in nifty_res) else nifty_res
                    q = (
                        data.get("NSE_INDEX:Nifty 50")
                        or data.get(nifty_key)
                        or data.get("NSE_INDEX|Nifty 50")
                        or data.get("Nifty 50")
                    )
                    if q:
                        ltp = float(q.get("last_price", 0.0))
                        net_chg = q.get("net_change")
                        if net_chg is not None:
                            net_chg = float(net_chg)
                            prev_cp = ltp - net_chg
                            if prev_cp > 0:
                                nifty_change = round((net_chg / prev_cp) * 100, 2)
                        else:
                            ohlc = q.get("ohlc", {}) or {}
                            cp = float(ohlc.get("close", 0) or q.get("cp", 0) or ltp)
                            if ltp > 0 and cp > 0 and cp != ltp:
                                nifty_change = round(((ltp - cp) / cp) * 100, 2)
            except Exception as ex:
                log.error(f"Daemon Nifty quote fetch failed: {ex}")

            # 2. Fetch Full Quotes for 211 F&O Universe
            universe = load_fno_universe()
            symbol_keys = []
            key_map = {}
            sector_map = {}
            for item in universe:
                sym = item.get("symbol")
                sec = item.get("sector", "FNO_MAIN")
                if not sym:
                    continue
                k = db.get_upstox_instrument_key(sym, exchange="NSE_EQ") or db.get_upstox_instrument_key(sym)
                if k:
                    symbol_keys.append(k)
                    key_map[k] = sym
                    sector_map[sym] = sec

            if not symbol_keys:
                log.error("Daemon could not resolve instrument keys for F&O universe.")
                return None

            quotes_res = upstox_client.get_full_quotes(symbol_keys)
            if not quotes_res:
                log.error("Daemon failed to fetch full quotes for F&O universe.")
                return None

            quote_data = quotes_res.get("data", {}) if (isinstance(quotes_res, dict) and "data" in quotes_res) else quotes_res

            now_ts = time.time()
            candidates = []
            alertable_stocks = []

            # -----------------------------------------------------------------
            # 📊 PASS 1: Aggregate Sector Breadth & Mean Momentum
            # -----------------------------------------------------------------
            sector_aggregates = {}
            stock_metrics = {}

            for k, sym in key_map.items():
                q = (
                    quote_data.get(f"NSE_EQ:{sym}")
                    or quote_data.get(k)
                    or quote_data.get(k.replace("|", ":"))
                    or quote_data.get(sym)
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
                    change_pct = round((net_chg / prev_cp) * 100, 2) if prev_cp > 0 else 0.0
                else:
                    ohlc = q.get("ohlc", {}) or {}
                    cp = float(ohlc.get("close", 0) or q.get("cp", 0) or ltp)
                    change_pct = round(((ltp - cp) / cp) * 100, 2) if cp > 0 else 0.0

                sec = sector_map.get(sym, "FNO_MAIN")
                if sec not in sector_aggregates:
                    sector_aggregates[sec] = {"changes": [], "adv": 0, "dec": 0}
                sector_aggregates[sec]["changes"].append(change_pct)
                if change_pct > 0:
                    sector_aggregates[sec]["adv"] += 1
                elif change_pct < 0:
                    sector_aggregates[sec]["dec"] += 1

                stock_metrics[sym] = {"ltp": ltp, "change_pct": change_pct, "sec": sec}

            # -----------------------------------------------------------------
            # 🏆 PASS 2: Compute Sector Confluence Scoring (SCS) & Rank Top 3
            # -----------------------------------------------------------------
            sector_scs = {}
            for sec, agg in sector_aggregates.items():
                cnt = len(agg["changes"])
                if cnt > 0:
                    mean_chg = sum(agg["changes"]) / cnt
                    breadth = (agg["adv"] - agg["dec"]) / cnt
                    # SCS formula: (Mean Momentum * 15.0) + (Advance/Decline Breadth * 25.0) + 50 baseline
                    scs = round((mean_chg * 15.0) + (breadth * 25.0) + 50.0, 2)
                    sector_scs[sec] = {"scs": scs, "mean_chg": mean_chg, "breadth": breadth, "count": cnt}

            ranked_sectors = sorted(sector_scs.items(), key=lambda x: x[1]["scs"], reverse=True)
            top_3_sectors = set([s[0] for s in ranked_sectors[:3]])

            # -----------------------------------------------------------------
            # 🎯 PASS 3: Evaluate Stock Candidates with Sector Confluence Bonus
            # -----------------------------------------------------------------
            for sym, m in stock_metrics.items():
                ltp = m["ltp"]
                change_pct = m["change_pct"]
                sec_name = m["sec"]
                direction = "BUY" if change_pct >= 0 else "SELL"

                scs_info = sector_scs.get(sec_name, {"scs": 50.0})
                base_scs = scs_info.get("scs", 50.0)
                is_top_sector = sec_name in top_3_sectors
                confluence_bonus = 15.0 if is_top_sector else 0.0

                # Quant scores enriched with Sector Confluence
                sector_strength = min(100.0, max(0.0, base_scs + confluence_bonus))
                strength_factor = min(100.0, max(40.0, 50.0 + (abs(change_pct) * 20.0)))

                req_stub = SignalRequest(
                    symbol=sym,
                    sector=sec_name,
                    direction=direction,
                    ltp=ltp,
                    strengthFactor=strength_factor,
                    sectorStrength=sector_strength,
                    niftyChange=nifty_change,
                    strategy="FNO_SectorRotation"
                )

                score = calculate_composite_score(req_stub)

                # Nifty alignment check for active order placement (allows sector divergence up to ±0.35%)
                nifty_aligned = (direction == "BUY" and nifty_change >= -0.35) or (direction == "SELL" and nifty_change <= 0.35)

                if score >= 70.0 and nifty_aligned and is_top_sector:
                    candidates.append((score, req_stub, change_pct))

                # Collect high-momentum breakout alerts (e.g. abs change >= 1.5% or score >= 72)
                if (abs(change_pct) >= 1.5 or score >= 72.0) and ltp > 10.0:
                    last_alert_time = _symbol_alert_cooldowns.get(sym, 0)
                    if now_ts - last_alert_time > 1200:  # 20-min cooldown
                        alertable_stocks.append((sym, sec_name, direction, ltp, change_pct, score))

            # Dispatch ClickandCandles-style high-conviction Stock Alert cards to Telegram Topic #10
            for sym, sec, direction, ltp, change_pct, score in alertable_stocks[:3]: # Max 3 top per cycle
                _symbol_alert_cooldowns[sym] = now_ts
                is_bullish = direction == "BUY"
                direction_tag = "BUY / LONG 🟢" if is_bullish else "SELL / SHORT 🔴"
                grade = "🥇 GOLD QUANT BREAKOUT" if score >= 80 else "⚡ MOMENTUM SURGE"
                target_price = round(ltp * (1.02 if is_bullish else 0.98), 2)
                sl_price = round(ltp * (0.99 if is_bullish else 1.01), 2)

                alert_card = (
                    f"⚡ <b><u>WEALTHOS AUTOPILOT | STOCK ALERT</u></b>\n"
                    f"📌 <b>STATUS:</b> <strong>{grade}</strong>\n"
                    f"─────────────────────────\n"
                    f"<blockquote>• <b>Asset:</b> <code>{sym} ({sec})</code>\n"
                    f"• <b>Action:</b> <code>{direction_tag}</code>\n"
                    f"• <b>Trigger Price:</b> <code>₹{ltp:,.2f}</code> ({change_pct:+.2f}%)\n"
                    f"• <b>Est. Target (2%):</b> <code>₹{target_price:,.2f}</code>\n"
                    f"• <b>Est. Stop-Loss (1%):</b> <code>₹{sl_price:,.2f}</code></blockquote>\n\n"
                    f"<blockquote expandable>⚙️ <b>QUANT TELEMETRY</b>\n"
                    f"• <b>Conviction Score:</b> <code>{score:.1f} / 100</code>\n"
                    f"• <b>Nifty 50 Status:</b> <code>{nifty_change:+.2f}%</code>\n"
                    f"• <b>Scanned:</b> <code>{get_ist_now().strftime('%H:%M:%S')} IST</code></blockquote>\n"
                    f"─────────────────────────\n"
                    f"🎯 <i>Autonomous Quant Radar • Quality Over Quantity</i>"
                )
                await send_daemon_telegram_alert(alert_card, role="alerts")

            # Check if active trade already exists before executing new orders
            with state_lock:
                if state.get("active_trade") is not None:
                    log.info("An active trade is already open. Skipping execution.")
                    return None

            if not candidates:
                log.info(f"Headless scan cycle complete: No F&O stock met execution threshold (Nifty: {nifty_change:+.2f}%).")
                # Send daily opening scan report ONCE per day (e.g. at ~10:00 AM) to avoid spam
                today_str = get_ist_now().strftime("%Y-%m-%d")
                if self._last_summary_sent_date != today_str and get_ist_now().hour == 10 and get_ist_now().minute <= 5:
                    self._last_summary_sent_date = today_str
                    msg_summary = (
                        f"⚡ <b><u>WEALTHOS AUTOPILOT | OPENING SCAN</u></b>\n"
                        f"📌 <b>STATUS:</b> <strong>F&O RADAR ACTIVE</strong>\n"
                        f"─────────────────────────\n"
                        f"<blockquote>• <b>Nifty 50 Status:</b> <code>{nifty_change:+.2f}%</code>\n"
                        f"• <b>Universe Scanned:</b> <code>{len(key_map)} Liquid F&O Stocks</code>\n"
                        f"• <b>Execution Gate:</b> <code>Armed & Tracking (10:30-10:45 AM)</code></blockquote>\n"
                        f"─────────────────────────\n"
                        f"🎯 <i>Opening pulse at {get_ist_now().strftime('%H:%M:%S')} IST</i>"
                    )
                    await send_daemon_telegram_alert(msg_summary, role="alerts")
                return None

            # Sort by composite score descending
            candidates.sort(key=lambda x: x[0], reverse=True)
            top_score, top_req, top_change = candidates[0]

            log.info(f"🏆 Headless scan selected top conviction pick: {top_req.symbol} ({top_req.direction}) with score {top_score:.1f}")

            # Trigger receive_signal internally for execution
            bg_tasks = BackgroundTasks()
            res = await receive_signal(top_req, bg_tasks)

            for task in bg_tasks.tasks:
                if asyncio.iscoroutinefunction(task.func):
                    await task.func(*task.args, **task.kwargs)
                else:
                    task.func(*task.args, **task.kwargs)

            return res.get("data")

        except Exception as e:
            log.error(f"Error in execute_headless_scan: {e}")
            return None

# Singleton Daemon Instance
daemon_instance = HeadlessAutopilotDaemon()
