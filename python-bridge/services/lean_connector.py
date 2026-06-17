"""
lean_connector.py
QuantConnect LEAN compatible historical data exporter.
Allows syncing our DuckDB/yfinance OHLCV cache into LEAN formats.
"""
import os
import csv
import logging
from typing import List, Dict, Any

log = logging.getLogger("lean_connector")

# Standalone LEAN data directory path within python-bridge workspace
LEAN_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 
    "data", "lean-data"
)

def export_to_lean_csv(symbol: str, candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Format OHLCV candle list into standard LEAN daily CSV format:
    Format: yyyymmdd hh:mm, open, high, low, close, volume
    """
    symbol = symbol.upper()
    dest_dir = os.path.join(LEAN_DATA_DIR, "equity", "india", "daily")
    os.makedirs(dest_dir, exist_ok=True)
    
    file_path = os.path.join(dest_dir, f"{symbol.lower()}.csv")
    
    lines_written = 0
    try:
        with open(file_path, "w", newline="") as csvfile:
            writer = csv.writer(csvfile)
            for c in candles:
                # Expecting keys: date/timestamp, open, high, low, close, volume
                dt = c.get("date", c.get("timestamp", ""))
                # Convert 'YYYY-MM-DD' to 'YYYYMMDD 00:00'
                if "-" in dt:
                    formatted_dt = dt.replace("-", "") + " 00:00"
                else:
                    formatted_dt = dt
                    
                writer.writerow([
                    formatted_dt,
                    round(float(c.get("open", 0.0)), 4),
                    round(float(c.get("high", 0.0)), 4),
                    round(float(c.get("low", 0.0)), 4),
                    round(float(c.get("close", 0.0)), 4),
                    int(c.get("volume", 0))
                ])
                lines_written += 1
                
        return {
            "status": "success",
            "file_path": file_path,
            "lines_written": lines_written,
            "message": f"Exported {lines_written} candles to QuantConnect LEAN format."
        }
    except Exception as e:
        log.error(f"Failed to export LEAN data for {symbol}: {e}")
        return {"status": "error", "message": str(e)}
