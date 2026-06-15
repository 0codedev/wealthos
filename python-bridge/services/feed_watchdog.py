"""
WealthOS Feed Watchdog (Task 2B) — Dead Man's Switch
Monitors Upstox WebSocket tick flow during market hours (9:20 AM - 3:25 PM IST).
Fires Telegram alert via synchronous HTTP REST (httpx) and triggers reconnect on silence.
Fully thread-safe and non-disruptive.
"""

import time
import os
import threading
import logging
from datetime import datetime, timezone, timedelta
import httpx

log = logging.getLogger("feed_watchdog")
IST = timezone(timedelta(hours=5, minutes=30))

SILENCE_THRESHOLD_SECONDS = 120  # 2 minutes of silence during market hours
RECONNECT_COOLDOWN_SECONDS = 600 # 10 minutes between automated watchdog reconnects

_last_tick_time = time.time()
_last_reconnect_trigger_time = 0.0
_lock = threading.Lock()

def record_tick():
    """Thread-safe tick timestamp updater. Called by upstox_ws on every incoming market tick."""
    global _last_tick_time
    with _lock:
        _last_tick_time = time.time()
    try:
        from services.sre_watchdog import record_tick as sre_record_tick
        sre_record_tick()
    except Exception:
        pass

def _send_telegram_alert_sync(message: str):
    """Sends a Telegram alert via synchronous HTTP REST. Never touches the asyncio event loop."""
    try:
        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
        config_file = os.path.join(data_dir, "telegram_config.json")
        token, chat_id = None, None

        if os.path.exists(config_file):
            import json
            with open(config_file, "r") as f:
                bots = json.load(f)
                bot = next((b for b in bots if b.get("role") == "system" and b.get("enabled")), None)
                if not bot:
                    bot = next((b for b in bots if b.get("enabled")), None)
                if bot:
                    token, chat_id = bot.get("token"), bot.get("chatId")

        if not token or not chat_id:
            token = os.getenv("TELEGRAM_BOT_TOKEN")
            chat_id = os.getenv("TELEGRAM_CHAT_ID")

        if not token or not chat_id:
            log.warning("[WATCHDOG] Telegram credentials missing. Alert skipped.")
            return

        target_chat = str(chat_id)
        thread_id = None
        if "#" in target_chat:
            parts = target_chat.split("#", 1)
            target_chat = parts[0]
            try:
                thread_id = int(parts[1])
            except ValueError:
                pass

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = {"chat_id": target_chat, "text": message, "parse_mode": "HTML"}
        if thread_id is not None:
            payload["message_thread_id"] = thread_id

        httpx.post(url, json=payload, timeout=5.0)
        log.info("[WATCHDOG] Telegram alert dispatched via sync HTTP REST.")
    except Exception as e:
        log.error(f"[WATCHDOG] Telegram alert HTTP call failed: {e}")

def _is_active_trading_window() -> bool:
    """Returns True only if current IST time is between 09:20 AM and 15:25 PM Mon-Fri."""
    now_ist = datetime.now(timezone.utc).astimezone(IST)
    if now_ist.weekday() >= 5:  # Saturday/Sunday
        return False
    
    current_minutes = now_ist.hour * 60 + now_ist.minute
    start_minutes = 9 * 60 + 20   # 09:20 AM
    end_minutes = 15 * 60 + 25    # 15:25 PM
    
    return start_minutes <= current_minutes <= end_minutes

def _watchdog_loop():
    global _last_reconnect_trigger_time
    log.info("[WATCHDOG] Feed watchdog loop active.")
    
    while True:
        try:
            time.sleep(30)  # Evaluate silence every 30 seconds
            
            if not _is_active_trading_window():
                continue

            try:
                from routers.shared import is_market_hours
                if not is_market_hours():
                    continue
            except Exception:
                pass

            now = time.time()
            with _lock:
                silence_duration = now - _last_tick_time

            if silence_duration >= SILENCE_THRESHOLD_SECONDS:
                with _lock:
                    time_since_last_trigger = now - _last_reconnect_trigger_time

                if time_since_last_trigger >= RECONNECT_COOLDOWN_SECONDS:
                    log.warning(f"[WATCHDOG] 🚨 Market data silence detected ({silence_duration:.0f}s). Triggering reconnect...")
                    with _lock:
                        _last_reconnect_trigger_time = now

                    # Trigger WebSocket reconnect thread-safely
                    try:
                        from upstox_ws import upstox_ws_client
                        upstox_ws_client.trigger_reconnect()
                    except Exception as e:
                        log.error(f"[WATCHDOG] Failed to trigger reconnect: {e}")

                    # Reconnect silently in background without spamming Telegram alerts
                    enable_telegram_alert = os.getenv("ENABLE_WATCHDOG_TELEGRAM_ALERTS", "false").lower() == "true"
                    if enable_telegram_alert:
                        alert_msg = (
                            f"🛡️ <b><u>WEALTHOS | SYSTEM SENTINEL</u></b>\n"
                            f"⚠️ <b>STATUS:</b> <strong>FEED SILENCE DETECTED</strong>\n"
                            f"─────────────────────────\n"
                            f"<blockquote>• <b>Service:</b> <code>Upstox Market Data Feed</code>\n"
                            f"• <b>Silence Duration:</b> <code>{int(silence_duration)}s without ticks</code>\n"
                            f"• <b>Action:</b> <code>Automated WebSocket reconnection triggered</code></blockquote>\n"
                            f"─────────────────────────\n"
                            f"⚡ <i>Self-Healing Watchdog Daemon Active</i>"
                        )
                        _send_telegram_alert_sync(alert_msg)
                    else:
                        log.info(f"[WATCHDOG] Feed silence ({int(silence_duration)}s). Reconnecting quietly without Telegram alert.")
        except Exception as e:
            log.error(f"[WATCHDOG] Exception in watchdog loop: {e}")

def start_feed_watchdog():
    """Spawns the Feed Watchdog in a dedicated background daemon thread."""
    t = threading.Thread(target=_watchdog_loop, daemon=True, name="FeedWatchdogThread")
    t.start()
    log.info("Feed Watchdog background thread spawned.")
    try:
        from services.sre_watchdog import start_sre_watchdog
        start_sre_watchdog()
        log.info("SRE Watchdog daemon spawned via feed_watchdog initializer.")
    except Exception as e:
        log.error(f"Failed to start SRE Watchdog: {e}")
