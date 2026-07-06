import os
import sys
import json
import math
import random
import asyncio
from datetime import datetime, timedelta

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.quant_pnl_renderer import render_quant_pnl_dashboard
from services.telegram_bot import TelegramBotService

def generate_high_frequency_intraday_ticks():
    """
    Generates 60 high-frequency 1-minute resolution PnL data points 
    simulating exact 1-minute option candle price movements from 11:30 to 12:30.
    """
    start_dt = datetime.strptime("11:30", "%H:%M")
    ticks = []
    
    current_pnl = 0.0
    
    # 1. Flat initial period (11:30 - 11:35)
    for i in range(5):
        t_str = (start_dt + timedelta(minutes=i)).strftime("%H:%M")
        ticks.append((t_str, 0.0))

    # 2. Rapid Momentum Breakout Spike (11:35 - 12:05) -> PnL rises from 0 to 5710 with sharp micro-swings
    pnl = 0.0
    for i in range(5, 35):
        t_str = (start_dt + timedelta(minutes=i)).strftime("%H:%M")
        # Micro fluctuations: sine trend + random noise
        step = 180 + math.sin(i / 3.0) * 220 + random.uniform(-120, 150)
        pnl = max(0.0, pnl + step)
        if i == 34:
            pnl = 5710.0  # Peak MTM at 12:05
        ticks.append((t_str, round(pnl, 2)))

    # 3. Micro Pullback & Drawdown (12:05 - 12:20) -> Drawdown to 3200
    for i in range(35, 50):
        t_str = (start_dt + timedelta(minutes=i)).strftime("%H:%M")
        pnl = max(1500.0, pnl - random.uniform(100, 300) + math.cos(i / 2.0) * 150)
        ticks.append((t_str, round(pnl, 2)))

    # 4. Final Consolidation & Exit (12:20 - 12:30) -> Exit at 2532.50
    for i in range(50, 60):
        t_str = (start_dt + timedelta(minutes=i)).strftime("%H:%M")
        pnl = 2532.50 + random.uniform(-80, 80)
        if i == 59:
            pnl = 2532.50
        ticks.append((t_str, round(pnl, 2)))

    return ticks

async def main():
    bridge_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_png = os.path.join(bridge_dir, "data", "high_freq_quant_pnl_dashboard.png")

    print("Generating 60-point high-frequency 1-minute intraday PnL series...")
    ticks = generate_high_frequency_intraday_ticks()

    print("Rendering high-resolution Quant PnL Dashboard image...")
    render_quant_pnl_dashboard(output_png, ticks, capital=100000.0, watermark_text="OpenAlgo")
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
    print(f"Sending High-Frequency Quant PnL Dashboard card photo to Telegram topic ({chat_id})...")

    bot = TelegramBotService(bot_cfg["token"], chat_id)
    caption = (
        f"💰 <b>WEALTHOS — HIGH-FREQUENCY DAILY P&L REPORT</b>\n"
        f"📅 <b>Date:</b> <code>2026-07-25</code>\n"
        f"═════════════════════════════\n"
        f"🔢 <b>Total 1-Min Candle Ticks:</b> 60 Ticks\n"
        f"⚡ <b>Max MTM Peak:</b> <code>₹5,710.00 at 12:05</code>\n"
        f"⚠️ <b>Max Drawdown:</b> <code>₹3,815.00 Peak-to-Trough</code>\n\n"
        f"💰 <b>NET REALIZED P&L:</b>\n"
        f"<code>+₹2,532.50 (+2.53%)</code> 💰\n"
        f"═════════════════════════════\n"
        f"🏛️ <i>WealthOS 1-Min High-Frequency Intraday PnL Trajectory</i>"
    )

    res = await bot.send_photo(output_png, caption=caption)
    print("Telegram sendPhoto result status:", res.get("status"))

if __name__ == "__main__":
    asyncio.run(main())
