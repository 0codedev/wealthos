import os
import sys
import json
import time
from fastapi import APIRouter, Request
from pydantic import BaseModel

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.telegram_bot import TelegramBotService
from services.dhan_alert_manager import dhan_alert_manager

router = APIRouter(prefix="/api/alerts")

def get_telegram_alert_credentials() -> tuple[str | None, str | None]:
    """Helper to fetch bot_token and chat_id for role 'alerts' (Price Alerts Topic #10)."""
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    config_file = os.path.join(data_dir, "telegram_config.json")
    
    if os.path.exists(config_file):
        try:
            with open(config_file, "r") as f:
                bots = json.load(f)
                active_bot = next((b for b in bots if b.get("role") == "alerts" and b.get("enabled")), None)
                if active_bot:
                    return active_bot.get("token"), active_bot.get("chatId")
        except Exception:
            pass
            
    # Fallback to state
    state_file = os.path.join(data_dir, "autopilot_state.json")
    if os.path.exists(state_file):
        try:
            with open(state_file, "r") as f:
                state = json.load(f)
                return state.get("bot_token"), state.get("chat_id")
        except Exception:
            pass
            
    return os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")

class QuantAlphaAlertRequest(BaseModel):
    symbol: str
    direction: str = "BUY"
    ltp: float
    signal_type: str = "Quant Confluence Surge"
    timeframe: str = "5m"
    qcs_score: float = 85.0
    conviction_index: float | None = None
    delta_pcr: float | None = None
    gex_regime: str | None = None
    target: float | None = None
    stop_loss: float | None = None
    notes: str | None = None

_alert_cooldowns: dict[str, float] = {}

@router.post("/dispatch")
async def dispatch_native_alpha_alert(req: QuantAlphaAlertRequest):
    """
    Native Quant Alpha Engine Price Alert Dispatcher.
    Synthesizes Multi-Factor Quant Composite Score (QCS), Options Greeks (GEX, Delta-PCR, CI),
    and Microstructure Order Flow into high-conviction Telegram alert cards.
    Enforces anti-spam cooldown protection (Quality > Quantity).
    """
    now_ts = time.time()
    sym = req.symbol.upper()
    
    # Quality Filter Guard: minimum 70.0 QCS score unless bypass
    if req.qcs_score < 70.0:
        return {"status": "skipped", "reason": f"Signal QCS score ({req.qcs_score:.1f}) below conviction threshold (70.0)"}
    
    # Anti-Spam Cooldown Guard: max 1 alert per symbol every 20 minutes
    last_sent = _alert_cooldowns.get(sym, 0)
    if now_ts - last_sent < 1200:
        return {"status": "skipped", "reason": f"Cooldown active for {sym} ({int(1200 - (now_ts - last_sent))}s remaining)"}
        
    _alert_cooldowns[sym] = now_ts
    
    bot_token, chat_id = get_telegram_alert_credentials()
    if not bot_token or not chat_id:
        return {"status": "error", "error": "Price Alerts Telegram Bot not configured"}
        
    is_bullish = req.direction.upper() in ["BUY", "LONG", "CALL"]
    direction_tag = "BUY / LONG 🟢" if is_bullish else "SELL / SHORT 🔴"
    
    # Quant Grade Badge
    if req.qcs_score >= 85.0:
        grade_badge = "🥇 GOLD QUANT ACCELERATION"
    elif req.qcs_score >= 75.0:
        grade_badge = "🟢 HIGH CONVICTION QUANT"
    else:
        grade_badge = "🟡 QUANT SETUP"
        
    # Risk/Reward computation
    rr_str = None
    if req.target and req.stop_loss and req.ltp > 0:
        risk = abs(req.ltp - req.stop_loss)
        reward = abs(req.target - req.ltp)
        if risk > 0:
            rr_str = f"1:{(reward / risk):.2f}"

    lines = [
        "⚡ <b><u>WEALTHOS QUANT RADAR | PRICE ALERT</u></b>",
        f"📌 <b>STATUS:</b> <strong>{grade_badge}</strong>",
        "─────────────────────────",
        f"<blockquote>• <b>Asset:</b> <code>{sym}</code>",
        f"• <b>Signal:</b> <code>{req.signal_type}</code> ({direction_tag})",
        f"• <b>Trigger Price:</b> <code>₹{req.ltp:,.2f}</code>",
    ]
    if req.target:
        lines.append(f"• <b>Target:</b> <code>₹{req.target:,.2f}</code>")
    if req.stop_loss:
        lines.append(f"• <b>Stop Loss:</b> <code>₹{req.stop_loss:,.2f}</code>")
    if rr_str:
        lines.append(f"• <b>Risk/Reward:</b> <code>{rr_str}</code>")
    lines.append("</blockquote>\n")
    
    # Expandable Quant Telemetry section
    telemetry_items = [
        f"• <b>Composite Score:</b> <code>{req.qcs_score:.1f} / 100</code>"
    ]
    if req.conviction_index is not None:
        telemetry_items.append(f"• <b>Conviction Index (CI):</b> <code>{req.conviction_index:+.2f}</code>")
    if req.delta_pcr is not None:
        telemetry_items.append(f"• <b>Delta-Weighted PCR:</b> <code>{req.delta_pcr:.2f}</code>")
    if req.gex_regime:
        telemetry_items.append(f"• <b>Dealer GEX:</b> <code>{req.gex_regime.upper()}</code>")
    telemetry_items.append(f"• <b>Timeframe:</b> <code>{req.timeframe}</code>")
    if req.notes:
        telemetry_items.append(f"• <b>Quant Note:</b> <i>{req.notes}</i>")
        
    lines.append("<blockquote expandable>⚙️ <b>QUANT TELEMETRY</b>")
    lines.extend(telemetry_items)
    lines.append("</blockquote>")
    lines.append("─────────────────────────")
    lines.append("🎯 <i>Multi-Factor Quant Confluence • Quality Over Quantity</i>")
    
    msg = "\n".join(lines)
    bot = TelegramBotService(bot_token, chat_id)
    return await bot.send_message(msg)

@router.post("/sync")
async def sync_telegram_config(request: Request):
    try:
        body = await request.json()
        bots = body.get("bots", [])
        
        # Ensure data directory exists
        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
        os.makedirs(data_dir, exist_ok=True)
        config_file = os.path.join(data_dir, "telegram_config.json")
        
        with open(config_file, "w") as f:
            json.dump(bots, f, indent=4)
            
        return {"status": "success", "message": "Telegram config synced successfully"}
    except Exception as e:
        return {"status": "error", "error": str(e)}

@router.post("/tradingview")
async def tradingview_webhook(request: Request):
    try:
        payload = await request.json()
        symbol = payload.get("symbol", "").upper()
        timestamp = payload.get("time", "")
        close = payload.get("close", 0.0)
        direction = payload.get("direction", "Buy").upper()
        signal_type = payload.get("signal", "Arrow Triggered")
        
        # Load telegram config
        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
        config_file = os.path.join(data_dir, "telegram_config.json")
        
        bot_token = None
        chat_id = None
        
        if os.path.exists(config_file):
            try:
                with open(config_file, "r") as f:
                    bots = json.load(f)
                    # Find active bot with role 'alerts'
                    active_bot = next((b for b in bots if b.get("role") == "alerts" and b.get("enabled")), None)
                    if active_bot:
                        bot_token = active_bot.get("token")
                        chat_id = active_bot.get("chatId")
            except Exception as e:
                print(f"Error loading telegram config: {e}")
                
        # Fallback to env or global settings if not found in dynamic config
        if not bot_token or not chat_id:
            state_file = os.path.join(data_dir, "autopilot_state.json")
            if os.path.exists(state_file):
                try:
                    with open(state_file, "r") as f:
                        state = json.load(f)
                        bot_token = state.get("bot_token")
                        chat_id = state.get("chat_id")
                except Exception:
                    pass
                    
        if not bot_token or not chat_id:
            return {"status": "error", "error": "No telegram bot configured with 'alerts' role"}
            
        group_name = payload.get("group") or payload.get("alert_group") or "WealthOS Price Alerts"
        timeframe = payload.get("timeframe") or payload.get("tf") or ""
        target_price = payload.get("target") or payload.get("target_price")
        sl_price = payload.get("sl") or payload.get("stop_loss")
        
        is_bullish = direction in ["BUY", "LONG", "CALL"]
        direction_tag = "BUY / LONG 🟢" if is_bullish else "SELL / SHORT 🔴"
        header_emoji = "📈" if is_bullish else "📉"
        
        lines = [
            f"{header_emoji} <b>{group_name}</b>",
            f"═════════════════════════════",
            f"🎯 <b>Stock:</b> <code>{symbol}</code>",
            f"📊 <b>Signal:</b> <code>{signal_type}</code> ({direction_tag})",
            f"💰 <b>Trigger Price:</b> <code>₹{float(close):,.2f}</code>",
        ]
        
        if timeframe:
            lines.append(f"⏱️ <b>Timeframe:</b> <code>{timeframe}</code>")
        if target_price:
            try:
                lines.append(f"🎯 <b>Target Price:</b> <code>₹{float(target_price):,.2f}</code>")
            except Exception:
                pass
        if sl_price:
            try:
                lines.append(f"🛡️ <b>Stop Loss:</b> <code>₹{float(sl_price):,.2f}</code>")
            except Exception:
                pass
            
        if timestamp:
            lines.append(f"⏰ <b>Time:</b> <code>{timestamp}</code>")
            
        lines.append("═════════════════════════════")
        lines.append("<i>Please analyze the chart before taking any trading decisions.</i>")
        lines.append("Educational Purpose Only.")
        
        msg = "\n".join(lines)
        
        bot = TelegramBotService(bot_token, chat_id)
        result = await bot.send_message(msg)
        return result
    except Exception as e:
        return {"status": "error", "error": str(e)}

@router.post("/telegram/send")
async def send_telegram_alert(request: Request):
    try:
        body = await request.json()
        bot_token = body.get("bot_token")
        chat_id = body.get("chat_id")
        message = body.get("message")

        if not all([bot_token, chat_id, message]):
            return {"status": "error", "error": "Missing required fields: bot_token, chat_id, message"}

        bot = TelegramBotService(bot_token, chat_id)
        result = await bot.send_message(message)
        return result
    except Exception as e:
        return {"status": "error", "error": str(e)}

@router.post("/telegram/test")
async def test_telegram_alert(request: Request):
    try:
        body = await request.json()
        bot_token = body.get("bot_token")
        chat_id = body.get("chat_id")

        if not all([bot_token, chat_id]):
            return {"status": "error", "error": "Missing required fields: bot_token, chat_id"}

        bot = TelegramBotService(bot_token, chat_id)
        test_msg = "✅ <b>Wealth Dashboard connected!</b>\nAlerts are active and ready to fire."
        result = await bot.send_message(test_msg)
        return result
    except Exception as e:
        return {"status": "error", "error": str(e)}

@router.get("/telegram/verify")
async def verify_telegram_token(token: str):
    if not token:
        return {"status": "error", "error": "Missing token parameter"}
    
    bot = TelegramBotService(token, "")
    result = await bot.get_bot_details()
    return result

@router.post("/dhan/sync-day-hl")
async def sync_dhan_day_hl_alerts_route(request: Request):
    try:
        watchlist = []
        try:
            body = await request.json()
            if body:
                watchlist = body.get("watchlist", [])
        except Exception:
            pass

        if not watchlist:
            from routers.shared import get_fno_symbols, upstox_client
            import db
            
            symbols = get_fno_symbols()
            if not symbols:
                return {"status": "error", "error": "No F&O symbols found"}

            resolved_keys = []
            symbol_to_key = {}

            conn = db.get_db_connection()
            cursor = conn.cursor()
            for symbol in symbols:
                cursor.execute("SELECT instrument_key FROM upstox_instruments WHERE symbol = ? AND exchange = 'NSE_EQ'", (symbol,))
                row = cursor.fetchone()
                if row:
                    key = row["instrument_key"]
                    resolved_keys.append(key)
                    symbol_to_key[key] = symbol
            conn.close()

            if not resolved_keys:
                return {"status": "error", "error": "Could not resolve instrument keys"}

            batch_size = 100
            for i in range(0, len(resolved_keys), batch_size):
                batch = resolved_keys[i:i + batch_size]
                quotes = upstox_client.get_ohlc_quotes(batch)
                if quotes:
                    for key, data in quotes.items():
                        ohlc = data.get("live_ohlc") or data.get("ohlc") or {}
                        high = ohlc.get("high")
                        low = ohlc.get("low")
                        clean_key = key.replace("|", ":")
                        symbol = clean_key.split(":")[-1]
                        if symbol and high is not None and low is not None:
                            watchlist.append({
                                "symbol": symbol,
                                "security_id": "",
                                "day_high": float(high),
                                "day_low": float(low)
                            })

        if not watchlist:
            return {"status": "error", "error": "No watchlist items to sync"}

        import asyncio
        result = await asyncio.to_thread(dhan_alert_manager.sync_day_high_low_alerts, watchlist)
        synced_symbols = list(set([x.get("symbol") for x in watchlist]))
        
        return {
            "status": "success",
            "count": len(synced_symbols),
            "synced_symbols": synced_symbols,
            "details": result
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}
