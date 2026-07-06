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
        f"🚀 <b>WEALTHOS AUTOPILOT — ENTRY TRIGGERED</b>\n"
        f"═════════════════════════════\n"
        f"🎯 <b>Underlying:</b> <code>HAVELLS</code> <i>(Spot: ₹1,214.50)</i>\n"
        f"⚡ <b>Option Contract:</b> <code>HAVELLS28JUL261210CE</code>\n"
        f"📦 <b>Lot Size:</b> <code>500</code> | <b>Exchange:</b> NFO\n\n"
        f"💰 <b>Entry Premium:</b> ₹22.75\n"
        f"🛡️ <b>Initial SL:</b> ₹21.36 <i>(ATR Offset: ₹1.39)</i>\n"
        f"📊 <b>Quant Composite Score:</b> <code>85.5 / 100</code> 🟢\n"
        f"🧠 <b>Strategy:</b> <code>FNO_SectorRotation</code>\n"
        f"🆔 <b>Order ID:</b> <code>MOCK_ORDER_101</code>\n"
        f"═════════════════════════════\n"
        f"⏰ <i>Executed at 10:48:12 AM IST</i>"
    )
    res = await bot.send_message(msg)
    print("Trade Entry Card test result:", res.get("status"))

if __name__ == "__main__":
    asyncio.run(main())
