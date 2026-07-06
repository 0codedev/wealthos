import os
import sys
import json
import asyncio

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.telegram_bot import TelegramBotService

async def main():
    bridge_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config_file = os.path.join(bridge_dir, "data", "telegram_config.json")
    
    if not os.path.exists(config_file):
        print("Config file not found:", config_file)
        return

    with open(config_file, "r") as f:
        bots = json.load(f)

    bot_cfg = next((b for b in bots if b.get("role") == "pnl_report" and b.get("enabled")), None)
    if not bot_cfg:
        print("Error: No bot configured for 'pnl_report' role in data/telegram_config.json")
        return

    chat_id = bot_cfg["chatId"]  # -1004326362283#22
    print(f"Sending test daily PnL summary to Daily PnL Reports Topic ({chat_id})...")
    bot = TelegramBotService(bot_cfg["token"], chat_id)
    
    msg = (
        f"💰 <b>WEALTHOS — DAILY P&L SUMMARY REPORT</b>\n"
        f"📅 <b>Date:</b> <code>2026-07-25</code>\n"
        f"═════════════════════════════\n"
        f"🔢 <b>Total Trades Executed:</b> 2\n"
        f"🎯 <b>Winning Trades:</b> 2 | <b>Losing Trades:</b> 0\n"
        f"⚡ <b>Latest Symbol:</b> <code>MANAPPURAM</code> (P&L: +₹1,950.00)\n\n"
        f"💰 <b>TOTAL DAY REALIZED P&L:</b>\n"
        f"<code>+₹5,825.00</code> 💰\n"
        f"═════════════════════════════\n"
        f"🏛️ <i>WealthOS Autopilot Ground-Truth Journal</i>"
    )
    
    res = await bot.send_message(msg)
    print("Daily PnL Report Card test result:", res.get("status"))

if __name__ == "__main__":
    asyncio.run(main())
