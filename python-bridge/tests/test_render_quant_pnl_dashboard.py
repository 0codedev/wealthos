import os
import sys
import json
import asyncio

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.quant_pnl_renderer import render_quant_pnl_dashboard
from services.telegram_bot import TelegramBotService

async def main():
    bridge_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_png = os.path.join(bridge_dir, "data", "sample_quant_pnl_dashboard.png")

    # Sample realistic intraday PnL tick series (Time, PnL)
    pnl_ticks = [
        ("09:15", 0.0),
        ("09:45", 0.0),
        ("10:15", 450.0),
        ("10:45", 1250.0),
        ("11:15", 3800.0),
        ("11:45", 2900.0),
        ("12:05", 5710.0),
        ("12:30", 4100.0),
        ("13:00", 3200.0),
        ("13:30", 4800.0),
        ("14:00", 2100.0),
        ("14:30", 3400.0),
        ("15:00", 2532.50)
    ]

    print("Rendering high-definition Quant PnL Dashboard image...")
    render_quant_pnl_dashboard(output_png, pnl_ticks, capital=100000.0)
    print("Dashboard rendered at:", output_png)

    # Load telegram config
    config_file = os.path.join(bridge_dir, "data", "telegram_config.json")
    if not os.path.exists(config_file):
        print("Config file not found")
        return

    with open(config_file, "r") as f:
        bots = json.load(f)

    bot_cfg = next((b for b in bots if b.get("role") == "pnl_report" and b.get("enabled")), None)
    if not bot_cfg:
        print("No pnl_report bot configured")
        return

    chat_id = bot_cfg["chatId"]  # -1004326362283#22
    print(f"Sending Quant PnL Dashboard card photo to Telegram topic ({chat_id})...")

    bot = TelegramBotService(bot_cfg["token"], chat_id)
    caption = (
        f"💰 <b>WEALTHOS — DAILY P&L SUMMARY REPORT</b>\n"
        f"📅 <b>Date:</b> <code>2026-07-25</code>\n"
        f"═════════════════════════════\n"
        f"🔢 <b>Total Trades Executed:</b> 4\n"
        f"🎯 <b>Winning Trades:</b> 3 | <b>Losing Trades:</b> 1\n"
        f"⚡ <b>Max MTM Peak:</b> <code>₹5,710.00 at 12:05</code>\n"
        f"⚠️ <b>Max Drawdown:</b> <code>₹3,815.00 Peak-to-Trough</code>\n\n"
        f"💰 <b>NET REALIZED P&L:</b>\n"
        f"<code>+₹2,532.50 (+2.53%)</code> 💰\n"
        f"═════════════════════════════\n"
        f"🏛️ <i>WealthOS Quant Risk & Performance Intelligence</i>"
    )

    res = await bot.send_photo(output_png, caption=caption)
    print("Telegram sendPhoto result status:", res.get("status"))

if __name__ == "__main__":
    asyncio.run(main())
