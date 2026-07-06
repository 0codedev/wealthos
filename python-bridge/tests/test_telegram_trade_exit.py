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

    bot_cfg = next((b for b in bots if b.get("role") == "autopilot" and b.get("enabled")), None)
    if not bot_cfg:
        print("Error: No bot configured for 'autopilot' role in data/telegram_config.json")
        return

    bot = TelegramBotService(bot_cfg["token"], bot_cfg["chatId"])
    msg = (
        f"🟢 <b>WEALTHOS AUTOPILOT — POSITION CLOSED</b>\n"
        f"═════════════════════════════\n"
        f"📌 <b>Exit Reason:</b> <code>Trailing SL Hit</code>\n"
        f"🔹 <b>Underlying:</b> <code>MANAPPURAM</code>\n"
        f"⚡ <b>Contract:</b> <code>MANAPPURAM28JUL26350CE</code>\n"
        f"📦 <b>Quantity:</b> 3,000 shares\n\n"
        f"📥 <b>Entry Premium:</b> ₹8.00\n"
        f"📤 <b>Exit Premium:</b> ₹8.65\n"
        f"🧠 <b>Strategy:</b> <code>FNO_SectorRotation</code>\n\n"
        f"📊 <b>NET REALIZED P&L:</b>\n"
        f"<code>+₹1,950.00 (+8.12%)</code> 🟢\n"
        f"═════════════════════════════\n"
        f"⏰ <i>Closed at 11:09:42 AM IST</i>"
    )
    res = await bot.send_message(msg)
    print("Trade Exit Card test result:", res.get("status"))

if __name__ == "__main__":
    asyncio.run(main())
