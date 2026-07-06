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

    bot_cfg = next((b for b in bots if b.get("role") == "alerts" and b.get("enabled")), None)
    if not bot_cfg:
        print("Error: No bot configured for 'alerts' role in data/telegram_config.json")
        return

    bot = TelegramBotService(bot_cfg["token"], bot_cfg["chatId"])
    msg = (
        f"🔥 <b>WEALTHOS QUANT ENGINE — ALERT</b>\n"
        f"🏆 <b>Grade:</b> <code>🥇 GOLD QUANT ACCELERATION</code>\n"
        f"═════════════════════════════\n"
        f"🎯 <b>Stock:</b> <code>TATAMOTORS</code>\n"
        f"📊 <b>Condition:</b> <code>Gamma Expansion & Delta-PCR Divergence</code> (BUY / LONG 🟢)\n"
        f"💰 <b>Current Price:</b> <code>₹985.40</code>\n"
        f"⭐ <b>Quant Composite Score:</b> <code>89.4 / 100</code>\n"
        f"🧠 <b>Conviction Index (CI):</b> <code>+3.45</code>\n"
        f"⚖️ <b>Delta-Weighted PCR:</b> <code>1.68</code>\n"
        f"🌊 <b>GEX Regime:</b> <code>TRENDING (Gamma Expansion)</code>\n"
        f"🎯 <b>Calculated Target:</b> <code>₹1,012.00</code>\n"
        f"🛡️ <b>Calculated SL:</b> <code>₹974.50</code>\n"
        f"📝 <b>Quant Note:</b> <i>Institutional Call delta accumulation with negative GEX expansion.</i>\n"
        f"⏱️ <b>Timeframe:</b> <code>5m</code>\n"
        f"═════════════════════════════\n"
        f"<i>Multi-Factor Quant Confluence • Quality Over Quantity</i>"
    )
    res = await bot.send_message(msg)
    print("Quant Alert Card test result:", res.get("status"))

if __name__ == "__main__":
    asyncio.run(main())
