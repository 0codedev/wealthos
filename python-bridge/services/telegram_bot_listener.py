import os
import json
import asyncio
import httpx
import logging
import threading
import time
import requests

log = logging.getLogger("telegram_listener")

BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BRIDGE_DIR, "data", "telegram_config.json")
OPENALGO_HOST = os.getenv("OPENALGO_HOST", "http://127.0.0.1:5000")
OPENALGO_API_KEY = os.getenv("OPENALGO_API_KEY", "openalgo_mcp_api_key_2026")

oa_session = requests.Session()
oa_session.trust_env = False

def load_telegram_config():
    """Load the bot token and allowed chat ID dynamically."""
    if not os.path.exists(CONFIG_PATH):
        return None, None, None
    try:
        with open(CONFIG_PATH, "r") as f:
            bots = json.load(f)
            # Find enabled bot
            active_bot = next((b for b in bots if b.get("enabled")), None)
            if active_bot:
                # Find bot details
                token = active_bot.get("token")
                chat_id = active_bot.get("chatId")
                # Strip thread ID Delimiter if present
                clean_chat_id = chat_id
                thread_id = None
                if chat_id and "#" in str(chat_id):
                    parts = str(chat_id).split("#", 1)
                    clean_chat_id = parts[0]
                    try:
                        thread_id = int(parts[1])
                    except ValueError:
                        pass
                return token, clean_chat_id, thread_id
    except Exception as e:
        log.warning(f"Error loading telegram config: {e}")
    return None, None, None

async def send_reply(token: str, chat_id: str, thread_id: int, reply_text: str):
    """Send HTML reply back to the user/supergroup."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": reply_text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    if thread_id is not None:
        payload["message_thread_id"] = thread_id

    try:
        async with httpx.AsyncClient(timeout=10.0, trust_env=False) as client:
            response = await client.post(url, json=payload)
            if response.status_code != 200:
                log.error(f"Failed to send reply: {response.text}")
    except Exception as e:
        log.error(f"Error sending reply message: {e}")

def get_openalgo_status():
    """Retrieve OpenAlgo ping status."""
    try:
        url = f"{OPENALGO_HOST}/api/v1/ping"
        payload = {"apikey": OPENALGO_API_KEY}
        resp = oa_session.post(url, json=payload, timeout=3)
        if resp.status_code == 200:
            data = resp.json()
            broker = data.get("data", {}).get("broker", "unknown")
            return f"🟢 <b>Online</b> (Broker: <code>{broker}</code>)"
        return "🔴 <b>Offline</b> (Ping failed)"
    except Exception:
        return "🔴 <b>Offline</b> (Server unreachable)"

def get_positions_summary():
    """Fetch and format open positions."""
    try:
        url = f"{OPENALGO_HOST}/api/v1/positionbook"
        payload = {"apikey": OPENALGO_API_KEY}
        resp = oa_session.post(url, json=payload, timeout=3)
        if resp.status_code != 200:
            return "❌ Failed to fetch positions (OpenAlgo Offline)"
        
        data = resp.json()
        positions = data.get("data", [])
        if not positions or not isinstance(positions, list):
            return "ℹ️ No open positions found."
        
        lines = ["📋 <b>Active Open Positions:</b>\n"]
        for pos in positions:
            ticker = pos.get("symbol", "UNKNOWN")
            qty = pos.get("quantity", 0)
            avg_price = pos.get("buyprice", 0.0) or pos.get("averageprice", 0.0)
            pnl = pos.get("unrealizedpnl", 0.0)
            pnl_emoji = "🟢" if float(pnl) >= 0 else "🔴"
            lines.append(
                f"• <b>{ticker}</b>: {qty} Qty @ ₹{float(avg_price):,.2f}\n"
                f"  └ PnL: {pnl_emoji} ₹{float(pnl):+,.2f}\n"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"❌ Error fetching positions: {str(e)}"

def get_pnl_summary():
    """Get live PnL and Sandbox PnL."""
    live_pnl = "N/A"
    sandbox_pnl = "N/A"
    
    # 1. Fetch Live PnL
    try:
        url = f"{OPENALGO_HOST}/api/v1/positionbook"
        payload = {"apikey": OPENALGO_API_KEY}
        resp = oa_session.post(url, json=payload, timeout=3)
        if resp.status_code == 200:
            positions = resp.json().get("data", [])
            total = 0.0
            for pos in positions:
                total += float(pos.get("unrealizedpnl", 0.0) or 0.0)
                total += float(pos.get("realizedpnl", 0.0) or 0.0)
            live_emoji = "🟢" if total >= 0 else "🔴"
            live_pnl = f"{live_emoji} <b>₹{total:+,.2f}</b>"
    except Exception:
        pass

    # 2. Fetch Sandbox PnL
    try:
        url = f"{OPENALGO_HOST}/sandbox/mypnl/api/data/public"
        payload = {"apikey": OPENALGO_API_KEY}
        resp = oa_session.post(url, json=payload, timeout=3)
        if resp.status_code == 200:
            data = resp.json()
            total = float(data.get("total_pnl", 0.0))
            sand_emoji = "🟢" if total >= 0 else "🔴"
            sandbox_pnl = f"{sand_emoji} <b>₹{total:+,.2f}</b>"
    except Exception:
        pass

    return (
        f"📊 <b>PnL Ledger Status</b>\n\n"
        f"💰 <b>Live Net PnL:</b> {live_pnl}\n"
        f"🧪 <b>Sandbox Net PnL:</b> {sandbox_pnl}"
    )

def execute_cancel_all():
    """Cancel all pending limit orders on OpenAlgo."""
    try:
        url = f"{OPENALGO_HOST}/api/v1/cancel_all_order"
        payload = {"apikey": OPENALGO_API_KEY}
        resp = oa_session.post(url, json=payload, timeout=3)
        if resp.status_code == 200:
            return "🚨 <b>Emergency Action:</b> Sent request to cancel all pending limit orders. Status: <b>SUCCESS</b>!"
        return f"❌ Failed to cancel orders. OpenAlgo returned: {resp.text}"
    except Exception as e:
        return f"❌ Failed to trigger cancel all: {str(e)}"

async def handle_inline_query_update(token: str, query_id: str, query_text: str):
    """Answer inline queries with stock quote data."""
    if not query_text:
        results = [{
            "type": "article",
            "id": "help",
            "title": "🔍 Search Stock Quotes",
            "description": "Type an NSE symbol (e.g. RELIANCE, TCS)",
            "input_message_content": {
                "message_text": "To get a stock quote, type: <code>@wealthos_alerts_bot SYMBOL</code>",
                "parse_mode": "HTML"
            }
        }]
    else:
        symbol = query_text.upper()
        try:
            from services.nse_provider import get_quote
            quote = get_quote(symbol)
        except Exception as e:
            log.warning(f"Error fetching inline quote: {e}")
            quote = None
            
        if not quote or not quote.get("ltp"):
            results = [{
                "type": "article",
                "id": f"not_found_{symbol}",
                "title": f"❌ Symbol '{symbol}' not found",
                "description": "Please check the spelling (e.g. RELIANCE, TCS)",
                "input_message_content": {
                    "message_text": f"❌ Stock symbol <b>{symbol}</b> was not found on NSE.",
                    "parse_mode": "HTML"
                }
            }]
        else:
            ltp = quote["ltp"]
            change = quote.get("change", 0.0) or 0.0
            pchange = quote.get("pChange", 0.0) or 0.0
            direction = "📈" if change >= 0 else "📉"
            
            msg_text = (
                f"<b>{direction} Stock Quote: {symbol}</b>\n\n"
                f"💰 <b>LTP:</b> <code>₹{float(ltp):,.2f}</code> ({change:+.2f} / {pchange:+.2f}%)\n"
                f"🏠 <b>Open:</b> <code>₹{float(quote.get('open') or 0):,.2f}</code>\n"
                f"🔺 <b>High:</b> <code>₹{float(quote.get('high') or 0):,.2f}</code>\n"
                f"🔻 <b>Low:</b> <code>₹{float(quote.get('low') or 0):,.2f}</code>\n"
                f"📦 <b>Close:</b> <code>₹{float(quote.get('close') or 0):,.2f}</code>\n\n"
                f"<i>Source: NSE India via WealthOS</i>"
            )
            
            results = [{
                "type": "article",
                "id": f"quote_{symbol}",
                "title": f"📊 {symbol}: ₹{float(ltp):,.2f}",
                "description": f"LTP: ₹{float(ltp):,.2f} ({change:+.2f}%) | High: ₹{quote.get('high')} | Low: {quote.get('low')}",
                "input_message_content": {
                    "message_text": msg_text,
                    "parse_mode": "HTML"
                }
            }]
            
    url = f"https://api.telegram.org/bot{token}/answerInlineQuery"
    payload = {
        "inline_query_id": query_id,
        "results": results,
        "cache_time": 5
    }
    try:
        async with httpx.AsyncClient(timeout=10.0, trust_env=False) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                log.error(f"Failed to answer inline query: {resp.text}")
    except Exception as e:
        log.error(f"Error answering inline query: {e}")

async def start_bot_polling_loop():
    """Poller loop to pull getUpdates from Bot API."""
    log.info("Starting Telegram Bot updates listener...")
    last_update_id = 0
    
    while True:
        token, chat_id, thread_id = load_telegram_config()
        if not token or not chat_id:
            # Sleep and wait for config to be synced/configured
            await asyncio.sleep(5.0)
            continue
            
        url = f"https://api.telegram.org/bot{token}/getUpdates"
        params = {
            "offset": last_update_id + 1,
            "timeout": 15
        }
        
        try:
            async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
                resp = await client.get(url, params=params)
                if resp.status_code == 200:
                    updates = resp.json().get("result", [])
                    for update in updates:
                        last_update_id = max(last_update_id, update.get("update_id", 0))
                        
                        # Handle Inline Query
                        inline_query = update.get("inline_query")
                        if inline_query:
                            query_id = inline_query.get("id")
                            query_text = inline_query.get("query", "").strip()
                            await handle_inline_query_update(token, query_id, query_text)
                            continue
                            
                        message = update.get("message") or update.get("edited_message")
                        if not message:
                            continue
                            
                        # Ensure message is from target Chat ID (Security Check)
                        msg_chat_id = str(message.get("chat", {}).get("id"))
                        if msg_chat_id != str(chat_id):
                            continue
                            
                        text = message.get("text", "").strip()
                        if not text.startswith("/"):
                            continue
                            
                        # If command explicitly targets a bot (e.g. /status@wealthos_pc_agent_bot), ensure it targets us
                        parts = text.split(maxsplit=1)[0].split("@")
                        cmd = parts[0].lower()
                        target_bot_tag = parts[1].lower() if len(parts) > 1 else None
                        
                        # If user targeted a different bot (e.g. wealthos_pc_agent_bot), do not hijack it
                        if target_bot_tag and target_bot_tag not in ("trade_tigger_bot", "trade_trigger_bot", "wealthos_alerts_bot"):
                            continue
                        
                        # Reply in the thread/topic where the message was typed
                        incoming_thread_id = message.get("message_thread_id") or thread_id
                        
                        log.info(f"Received Telegram Bot command: {cmd} in thread {incoming_thread_id}")
                        
                        reply = None
                        if cmd == "/dashboard":
                            bot_username = "wealthos_alerts_bot"
                            reply = (
                                f"🔗 <b>WealthOS Mini App Dashboard:</b>\n"
                                f"Open the native client terminal directly inside Telegram here:\n"
                                f"👉 t.me/{bot_username}/dashboard"
                            )
                        elif cmd == "/status":
                            oa_status = get_openalgo_status()
                            reply = (
                                f"🤖 <b>WealthOS System Status</b>\n\n"
                                f"📡 <b>OpenAlgo API:</b> {oa_status}\n"
                                f"⚡ <b>FastAPI Bridge:</b> 🟢 <b>Active</b>\n"
                                f"🎧 <b>Advisory Ears:</b> 🟢 <b>Listening</b>"
                            )
                        elif cmd == "/positions":
                            reply = get_positions_summary()
                        elif cmd == "/pnl":
                            reply = get_pnl_summary()
                        elif cmd == "/cancel_all":
                            reply = execute_cancel_all()
                            
                        if reply:
                            await send_reply(token, chat_id, incoming_thread_id, reply)
                            
        except httpx.RequestError as re:
            # Network glitches, silent ignore
            pass
        except Exception as e:
            log.error(f"Error in Telegram Bot Poller: {e}")
            
        await asyncio.sleep(1.0)

def run_listener():
    """Entrypoint to run the poller inside a synchronous background thread."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(start_bot_polling_loop())
