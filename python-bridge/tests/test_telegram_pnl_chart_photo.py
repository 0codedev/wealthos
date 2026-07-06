import os
import sys
import json
import asyncio
from PIL import Image, ImageDraw

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.telegram_bot import TelegramBotService

def generate_pnl_chart_image(output_path: str, pnl_points: list[float]):
    """Generates a sleek dark-mode quant equity curve image using PIL."""
    width, height = 800, 420
    img = Image.new("RGB", (width, height), color=(15, 23, 42))  # Dark slate background #0F172A
    draw = ImageDraw.Draw(img)

    # Gridlines & Border
    draw.rectangle([(20, 20), (width - 20, height - 20)], outline=(30, 41, 59), width=2)
    for y in range(80, height - 60, 50):
        draw.line([(60, y), (width - 40, y)], fill=(30, 41, 59), width=1)
        
    # Scale points
    min_val = min(min(pnl_points), -500)
    max_val = max(max(pnl_points), 6000)
    val_range = max_val - min_val if max_val != min_val else 1.0

    margin_left, margin_right = 60, width - 40
    margin_top, margin_bottom = 80, height - 60
    plot_w = margin_right - margin_left
    plot_h = margin_bottom - margin_top

    # Zero Line
    zero_norm = (0 - min_val) / val_range
    zero_y = margin_bottom - (zero_norm * plot_h)
    draw.line([(margin_left, zero_y), (margin_right, zero_y)], fill=(71, 85, 105), width=2)

    coords = []
    for i, pnl in enumerate(pnl_points):
        x = margin_left + (i / (len(pnl_points) - 1)) * plot_w
        norm = (pnl - min_val) / val_range
        y = margin_bottom - (norm * plot_h)
        coords.append((x, y))

    # Draw Equity Curve line (glowing emerald green)
    final_pnl = pnl_points[-1]
    line_color = (16, 185, 129) if final_pnl >= 0 else (239, 68, 68)
    for i in range(len(coords) - 1):
        draw.line([coords[i], coords[i+1]], fill=line_color, width=4)

    # Draw final point dot
    last_x, last_y = coords[-1]
    draw.ellipse([last_x - 6, last_y - 6, last_x + 6, last_y + 6], fill=line_color, outline=(255, 255, 255), width=2)

    img.save(output_path)
    return output_path

async def main():
    bridge_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    config_file = os.path.join(bridge_dir, "data", "telegram_config.json")
    
    with open(config_file, "r") as f:
        bots = json.load(f)

    bot_cfg = next((b for b in bots if b.get("role") == "pnl_report" and b.get("enabled")), None)
    if not bot_cfg:
        print("Error: No bot configured for 'pnl_report' role in data/telegram_config.json")
        return

    chat_id = bot_cfg["chatId"]  # -1004326362283#22
    img_path = os.path.join(bridge_dir, "data", "test_pnl_chart.png")
    generate_pnl_chart_image(img_path, [0, 800, 1400, 1100, 2300, 3900, 5825.0])
    
    print(f"Sending test PnL chart photo to Daily PnL Reports Topic ({chat_id})...")
    bot = TelegramBotService(bot_cfg["token"], chat_id)
    
    caption = (
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
    
    res = await bot.send_photo(img_path, caption=caption)
    print("Daily PnL Photo Card test result:", res.get("status"))

if __name__ == "__main__":
    asyncio.run(main())
