"""
quant_pnl_renderer.py
Pure Python Server-Side Quant PnL & Risk Analytics Dashboard Renderer.
Renders high-definition, publication-grade PnL & Drawdown analytical cards
with zero browser/Playwright dependency (100% ARM Cloud & RAM safe).
"""

import os
import math
import logging
from typing import List, Tuple, Dict
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger("quant_pnl_renderer")

def load_font(size: int, bold: bool = False):
    """Try loading clean TrueType font or fallback to PIL default."""
    try:
        font_path = "arialbd.ttf" if bold else "arial.ttf"
        return ImageFont.truetype(font_path, size)
    except Exception:
        try:
            return ImageFont.truetype("DejaVuSans.ttf", size)
        except Exception:
            return ImageFont.load_default()

def build_pnl_ticks_from_candles(candles: List[dict | list], entry_price: float, qty: int) -> List[Tuple[str, float]]:
    """
    Converts 1-minute OHLC candles from Upstox/Broker API into exact timestamped MTM PnL ticks.
    Upstox candle array format: [timestamp, open, high, low, close, volume, open_interest]
    """
    ticks = []
    # Upstox V3 historical candles return newest first, so reverse to chronological
    ordered_candles = list(reversed(candles)) if candles and isinstance(candles[0], (list, tuple)) else candles
    
    for c in ordered_candles:
        if isinstance(c, (list, tuple)):
            raw_ts = c[0]
            close_price = float(c[4] or entry_price)
        elif isinstance(c, dict):
            raw_ts = c.get("timestamp") or c.get("time") or ""
            close_price = float(c.get("close") or entry_price)
        else:
            continue
            
        time_label = "10:00"
        if isinstance(raw_ts, str) and "T" in raw_ts:
            time_label = raw_ts.split("T")[1][:5]
        elif isinstance(raw_ts, str) and " " in raw_ts:
            time_label = raw_ts.split(" ")[1][:5]
        elif isinstance(raw_ts, str):
            time_label = raw_ts[:5]
            
        pnl = (close_price - entry_price) * qty
        ticks.append((time_label, round(pnl, 2)))
        
    return ticks

def render_quant_pnl_dashboard(
    output_path: str,
    pnl_ticks: List[Tuple[str, float]],  # List of (time_str, pnl_value)
    capital: float = 100000.0,
    watermark_text: str = "OpenAlgo"
) -> str:
    """
    Renders the exact OpenAlgo PnL Tracker Dashboard (1200 x 680 px) with 100% real intraday 1-minute MTM & Drawdown curves.
    """
    if not pnl_ticks:
        pnl_ticks = [("09:15", 0.0), ("15:30", 0.0)]
        
    width, height = 1200, 680
    # OpenAlgo Dark Theme Background (#12131C)
    img = Image.new("RGBA", (width, height), color=(18, 19, 28, 255))
    draw = ImageDraw.Draw(img)
    
    font_title = load_font(18, bold=True)
    font_label = load_font(13, bold=False)
    font_val = load_font(22, bold=True)
    font_sub = load_font(12, bold=False)
    font_badge = load_font(12, bold=True)

    # ── 1. Calculate Analytics Metrics ─────────────────────────────────────
    times = [t[0] for t in pnl_ticks]
    pnls = [float(t[1]) for t in pnl_ticks]
    
    current_mtm = pnls[-1]
    current_pct = (current_mtm / capital) * 100.0 if capital > 0 else 0.0
    
    max_mtm = max(pnls)
    max_mtm_idx = pnls.index(max_mtm)
    max_mtm_time = times[max_mtm_idx] if max_mtm_idx < len(times) else "N/A"
    
    min_mtm = min(pnls)
    min_mtm_idx = pnls.index(min_mtm)
    min_mtm_time = times[min_mtm_idx] if min_mtm_idx < len(times) else "N/A"
    
    # Calculate Drawdown curve
    peak = -999999999.0
    drawdowns = []
    max_drawdown = 0.0
    for p in pnls:
        if p > peak:
            peak = p
        dd = p - peak  # negative or 0
        drawdowns.append(dd)
        if abs(dd) > max_drawdown:
            max_drawdown = abs(dd)
            
    current_drawdown = drawdowns[-1]

    # ── 2. Render Top 4 OpenAlgo Metric Cards ──────────────────────────────
    cards_data = [
        {
            "label": "Current MTM",
            "val": f"₹{current_mtm:,.2f}",
            "sub": f"{'+' if current_pct >= 0 else ''}{current_pct:.2f}%",
            "color": (16, 185, 129) if current_mtm >= 0 else (239, 68, 68),
            "icon": "↗" if current_mtm >= 0 else "↘"
        },
        {
            "label": "Max MTM",
            "val": f"₹{max_mtm:,.2f}",
            "sub": f"at {max_mtm_time}",
            "color": (16, 185, 129),
            "icon": "↗"
        },
        {
            "label": "Min MTM",
            "val": f"₹{min_mtm:,.2f}",
            "sub": f"at {min_mtm_time}",
            "color": (239, 68, 68) if min_mtm < 0 else (244, 63, 94),
            "icon": "↘"
        },
        {
            "label": "Max Drawdown",
            "val": f"₹{max_drawdown:,.2f}",
            "sub": "Peak to trough",
            "color": (245, 158, 11),
            "icon": "⚠️"
        }
    ]

    card_w = 270
    card_h = 105
    gap = 20
    start_x = 30
    start_y = 20

    for i, c in enumerate(cards_data):
        cx = start_x + i * (card_w + gap)
        cy = start_y
        
        # Rounded Card Background (#1A1B2D) with subtle border (#2C2E4A)
        draw.rounded_rectangle([(cx, cy), (cx + card_w, cy + card_h)], radius=14, fill=(26, 27, 45, 255), outline=(44, 46, 74, 255), width=1)
        
        # Label
        draw.text((cx + 18, cy + 14), f"{c['icon']}  {c['label']}", fill=(148, 163, 184, 255), font=font_label)
        # Value
        draw.text((cx + 18, cy + 42), c['val'], fill=c['color'], font=font_val)
        # Subtext
        draw.text((cx + 18, cy + 76), c['sub'], fill=(148, 163, 184, 255), font=font_sub)

    # ── 3. Render Main OpenAlgo Chart Container ───────────────────────────
    box_x1, box_y1 = 30, 145
    box_x2, box_y2 = 1170, 655
    draw.rounded_rectangle([(box_x1, box_y1), (box_x2, box_y2)], radius=14, fill=(20, 21, 33, 255), outline=(35, 37, 58, 255), width=1)

    # Header Title & Legend
    draw.text((box_x1 + 24, box_y1 + 20), "Intraday PnL Curve", fill=(248, 250, 252, 255), font=font_title)
    
    # Legend
    leg_x = box_x2 - 250
    draw.ellipse([leg_x, box_y1 + 26, leg_x + 10, box_y1 + 36], fill=(139, 92, 246, 255))
    draw.text((leg_x + 16, box_y1 + 23), "MTM PnL", fill=(148, 163, 184, 255), font=font_sub)
    
    draw.ellipse([leg_x + 100, box_y1 + 26, leg_x + 110, box_y1 + 36], fill=(236, 72, 153, 255))
    draw.text((leg_x + 116, box_y1 + 23), "Drawdown", fill=(148, 163, 184, 255), font=font_sub)

    # Chart Plot Boundaries
    plot_x1, plot_y1 = box_x1 + 30, box_y1 + 70
    plot_x2, plot_y2 = box_x2 - 110, box_y2 - 50
    plot_w = plot_x2 - plot_x1
    plot_h = plot_y2 - plot_y1

    # Watermark (# OpenAlgo / WealthOS)
    watermark_font = load_font(46, bold=True)
    draw.text((plot_x1 + plot_w // 2 - 140, plot_y1 + plot_h // 2 - 25), watermark_text, fill=(35, 37, 58, 220), font=watermark_font)

    # Value Boundaries for Y Axis
    min_chart_val = min(min(pnls), min(drawdowns), -1000.0) * 1.15
    max_chart_val = max(max(pnls), 1000.0) * 1.15
    chart_range = max_chart_val - min_chart_val if max_chart_val != min_chart_val else 1.0

    # Gridlines & Right Y-Axis Grid Labels
    num_y_grid = 5
    for g in range(num_y_grid + 1):
        gy = plot_y1 + (g / num_y_grid) * plot_h
        draw.line([(plot_x1, gy), (plot_x2, gy)], fill=(28, 30, 48, 255), width=1)
        val_g = max_chart_val - (g / num_y_grid) * chart_range
        draw.text((plot_x2 + 12, gy - 7), f"₹{val_g:,.0f}", fill=(80, 95, 120, 255), font=font_sub)

    # Zero Line
    zero_norm = (0 - min_chart_val) / chart_range
    zero_y = plot_y2 - (zero_norm * plot_h)
    draw.line([(plot_x1, zero_y), (plot_x2, zero_y)], fill=(55, 65, 85, 255), width=1)

    # Map Points
    n_points = max(len(pnls), 2)
    pnl_coords = []
    dd_coords = []

    for idx in range(len(pnls)):
        x = plot_x1 + (idx / max(n_points - 1, 1)) * plot_w
        
        # PnL Y
        p_norm = (pnls[idx] - min_chart_val) / chart_range
        py = plot_y2 - (p_norm * plot_h)
        pnl_coords.append((x, py))
        
        # DD Y
        d_norm = (drawdowns[idx] - min_chart_val) / chart_range
        dy = plot_y2 - (d_norm * plot_h)
        dd_coords.append((x, dy))

    # Render Fill Areas (Using Overlay Alpha Layer)
    fill_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    fill_draw = ImageDraw.Draw(fill_layer)

    # 1. PnL Area Fill (Purple #8B5CF6 with alpha)
    if len(pnl_coords) > 1:
        poly_pnl = [(plot_x1, zero_y)] + pnl_coords + [(plot_x2, zero_y)]
        fill_draw.polygon(poly_pnl, fill=(139, 92, 246, 40))

    # 2. Drawdown Area Fill (Magenta #EC4899 with alpha)
    if len(dd_coords) > 1:
        poly_dd = [(plot_x1, zero_y)] + dd_coords + [(plot_x2, zero_y)]
        fill_draw.polygon(poly_dd, fill=(236, 72, 153, 40))

    img = Image.alpha_composite(img, fill_layer)
    draw = ImageDraw.Draw(img)

    # Render Solid Curve Lines
    # 1. Drawdown Line (Magenta)
    for i in range(len(dd_coords) - 1):
        draw.line([dd_coords[i], dd_coords[i+1]], fill=(236, 72, 153, 255), width=3)

    # 2. MTM PnL Line (Violet/Purple)
    for i in range(len(pnl_coords) - 1):
        draw.line([pnl_coords[i], pnl_coords[i+1]], fill=(139, 92, 246, 255), width=3)

    # End Dot Markers & Right Axis Value Badges
    last_px, last_py = pnl_coords[-1]
    draw.ellipse([last_px - 5, last_py - 5, last_px + 5, last_py + 5], fill=(139, 92, 246, 255), outline=(255, 255, 255, 255), width=2)

    # Current PnL Badge Pill (Right Axis)
    badge_text = f"₹{current_mtm:,.2f}"
    draw.rounded_rectangle([(plot_x2 + 4, last_py - 12), (plot_x2 + 105, last_py + 12)], radius=6, fill=(139, 92, 246, 255))
    draw.text((plot_x2 + 10, last_py - 7), badge_text, fill=(255, 255, 255, 255), font=font_badge)

    # Drawdown Badge Pill (Right Axis)
    last_dx, last_dy = dd_coords[-1]
    draw.ellipse([last_dx - 5, last_dy - 5, last_dx + 5, last_dy + 5], fill=(236, 72, 153, 255), outline=(255, 255, 255, 255), width=2)
    dd_badge_text = f"-₹{abs(current_drawdown):,.2f}"
    draw.rounded_rectangle([(plot_x2 + 4, last_dy - 12), (plot_x2 + 105, last_dy + 12)], radius=6, fill=(236, 72, 153, 255))
    draw.text((plot_x2 + 10, last_dy - 7), dd_badge_text, fill=(255, 255, 255, 255), font=font_badge)

    # X Axis Timestamps
    step_x = max(len(times) // 8, 1)
    for i in range(0, len(times), step_x):
        tx = plot_x1 + (i / max(n_points - 1, 1)) * plot_w
        t_str = times[i]
        draw.text((tx - 15, plot_y2 + 12), t_str, fill=(100, 116, 139, 255), font=font_sub)

    # Save output
    img.save(output_path, "PNG")
    logger.info(f"OpenAlgo Quant PnL Dashboard rendered successfully at {output_path}")
    return output_path
