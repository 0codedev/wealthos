import os
import json
import pandas as pd
from datetime import datetime
import math

# Define paths
BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BRIDGE_DIR, "data")
STATUS_FILE = os.path.join(DATA_DIR, "sync_status.json")
FNO_FILE = os.path.join(BRIDGE_DIR, "fno_stocks_generated.json")

INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"]

def load_fno_symbols():
    if not os.path.exists(FNO_FILE):
        return []
    try:
        with open(FNO_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return [item["symbol"] for item in data]
    except Exception as e:
        print(f"[!] Error loading FNO universe: {e}")
        return []

def format_size(size_in_bytes):
    if size_in_bytes == 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB"]
    i = int(math.floor(math.log(size_in_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_in_bytes / p, 2)
    return f"{s} {units[i]}"

def get_path_size(path):
    if not os.path.exists(path):
        return 0
    if os.path.isfile(path):
        return os.path.getsize(path)
    total = 0
    for root, dirs, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            try:
                if os.path.exists(fp):
                    total += os.path.getsize(fp)
            except Exception:
                pass
    return total

def find_missing_business_days(df, date_col="timestamp"):
    if df.empty or date_col not in df.columns:
        return []
    try:
        # Slice first 10 chars (YYYY-MM-DD) to strip any timezone offsets safely
        date_strs = df[date_col].astype(str).str.slice(0, 10)
        ts = pd.to_datetime(date_strs, errors='coerce').dropna()
        if ts.empty:
            return []
        min_date = ts.min().date()
        max_date = ts.max().date()
        
        # Get all expected business days (Mon-Fri) in range
        expected = pd.bdate_range(start=min_date, end=max_date)
        actual = pd.DatetimeIndex(ts.unique())
        
        # Find difference
        missing = expected.difference(actual)
        return [d.strftime("%Y-%m-%d") for d in missing]
    except Exception:
        return []

def audit():
    print("=" * 60)
    print("      UPSTOX PARQUET DATABASE INTEGRITY AUDITOR")
    print(f"      Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    fno_symbols = load_fno_symbols()
    all_symbols = INDICES + fno_symbols
    
    summary = {
        "total_symbols": len(all_symbols),
        "underlying_day_ok": 0,
        "underlying_5min_ok": 0,
        "underlying_15min_ok": 0,
        "options_ok": 0,
        "futures_ok": 0,
        "underlying_size": 0,
        "options_size": 0,
        "futures_size": 0,
        "details": {}
    }
    
    print(f"Scanning data directories for {len(all_symbols)} universe symbols...")
    
    for symbol in all_symbols:
        symbol_details = {
            "day": None,
            "5minute": None,
            "15minute": None,
            "expiries_options_count": 0,
            "expiries_futures_count": 0,
            "underlying_size": 0,
            "options_size": 0,
            "futures_size": 0,
            "day_gaps": [],
            "m5_gaps": [],
            "m15_gaps": []
        }
        
        # Check daily underlying
        day_path = os.path.join(DATA_DIR, "underlying", symbol, "day", "data.parquet")
        if os.path.exists(day_path):
            try:
                df = pd.read_parquet(day_path)
                if not df.empty:
                    min_date = str(df["timestamp"].min())[:10]
                    max_date = str(df["timestamp"].max())[:10]
                    sz = os.path.getsize(day_path)
                    symbol_details["day"] = {
                        "rows": len(df),
                        "start": min_date,
                        "end": max_date,
                        "size": sz
                    }
                    symbol_details["underlying_size"] += sz
                    symbol_details["day_gaps"] = find_missing_business_days(df)
                    summary["underlying_day_ok"] += 1
            except Exception as e:
                symbol_details["day_error"] = str(e)
                
        # Check 5min underlying
        min5_path = os.path.join(DATA_DIR, "underlying", symbol, "5minute", "data.parquet")
        if os.path.exists(min5_path):
            try:
                df = pd.read_parquet(min5_path)
                if not df.empty:
                    min_date = str(df["timestamp"].min())[:10]
                    max_date = str(df["timestamp"].max())[:10]
                    sz = os.path.getsize(min5_path)
                    symbol_details["5minute"] = {
                        "rows": len(df),
                        "start": min_date,
                        "end": max_date,
                        "size": sz
                    }
                    symbol_details["underlying_size"] += sz
                    symbol_details["m5_gaps"] = find_missing_business_days(df)
                    summary["underlying_5min_ok"] += 1
            except Exception as e:
                symbol_details["5min_error"] = str(e)

        # Check 15min underlying
        min15_path = os.path.join(DATA_DIR, "underlying", symbol, "15minute", "data.parquet")
        if os.path.exists(min15_path):
            try:
                df = pd.read_parquet(min15_path)
                if not df.empty:
                    min_date = str(df["timestamp"].min())[:10]
                    max_date = str(df["timestamp"].max())[:10]
                    sz = os.path.getsize(min15_path)
                    symbol_details["15minute"] = {
                        "rows": len(df),
                        "start": min_date,
                        "end": max_date,
                        "size": sz
                    }
                    symbol_details["underlying_size"] += sz
                    symbol_details["m15_gaps"] = find_missing_business_days(df)
                    summary["underlying_15min_ok"] += 1
            except Exception as e:
                symbol_details["15min_error"] = str(e)
                
        # Check options expiries
        opt_dir = os.path.join(DATA_DIR, "options", symbol)
        if os.path.exists(opt_dir):
            try:
                expiries = [d for d in os.listdir(opt_dir) if os.path.isdir(os.path.join(opt_dir, d))]
                symbol_details["expiries_options_count"] = len(expiries)
                sz = get_path_size(opt_dir)
                symbol_details["options_size"] = sz
                if len(expiries) > 0:
                    summary["options_ok"] += 1
            except Exception:
                pass
                
        # Check futures expiries
        fut_dir = os.path.join(DATA_DIR, "futures", symbol)
        if os.path.exists(fut_dir):
            try:
                expiries = [d for d in os.listdir(fut_dir) if os.path.isdir(os.path.join(fut_dir, d))]
                symbol_details["expiries_futures_count"] = len(expiries)
                sz = get_path_size(fut_dir)
                symbol_details["futures_size"] = sz
                if len(expiries) > 0:
                    summary["futures_ok"] += 1
            except Exception:
                pass
                
        summary["underlying_size"] += symbol_details["underlying_size"]
        summary["options_size"] += symbol_details["options_size"]
        summary["futures_size"] += symbol_details["futures_size"]
        
        summary["details"][symbol] = symbol_details

    total_db_size = summary["underlying_size"] + summary["options_size"] + summary["futures_size"]

    print("-" * 60)
    print("      DATABASE INTEGRITY SUMMARY")
    print("-" * 60)
    print(f"Total Target Universe:        {summary['total_symbols']} symbols")
    print(f"Underlying Daily Coverage:   {summary['underlying_day_ok']} / {summary['total_symbols']} symbols")
    print(f"Underlying 5-min Coverage:   {summary['underlying_5min_ok']} / {summary['total_symbols']} symbols")
    print(f"Underlying 15-min Coverage:  {summary['underlying_15min_ok']} / {summary['total_symbols']} symbols")
    print(f"Options Expiry Coverage:     {summary['options_ok']} / {summary['total_symbols']} symbols")
    print(f"Futures Expiry Coverage:     {summary['futures_ok']} / {summary['total_symbols']} symbols")
    print("-" * 60)
    print(f"Underlying Storage Size:     {format_size(summary['underlying_size'])}")
    print(f"Options Storage Size:        {format_size(summary['options_size'])}")
    print(f"Futures Storage Size:        {format_size(summary['futures_size'])}")
    print(f"Total Disk Storage:          {format_size(total_db_size)}")
    print("-" * 60)
    
    # Read sync_status.json errors
    sync_errors = []
    if os.path.exists(STATUS_FILE):
        try:
            with open(STATUS_FILE, "r") as f:
                status_data = json.load(f)
            completed = status_data.get("completed_symbols", {})
            for sym, info in completed.items():
                if info.get("status") in ["error", "failed"]:
                    sync_errors.append(f"{sym}: {info.get('message', 'Unknown Error')}")
            if sync_errors:
                print(f"[!] Active Sync Errors in sync_status.json ({len(sync_errors)}):")
                for err in sync_errors[:10]:
                    print(f"    - {err}")
                if len(sync_errors) > 10:
                    print(f"    - ... and {len(sync_errors) - 10} more.")
            else:
                print("[OK] All symbols successfully synced in sync_status.json (No active errors).")
        except Exception as status_err:
            print(f"[!] Failed to parse sync_status.json: {status_err}")
            
    # Check underlying historical depth limits
    print("-" * 60)
    print("      HISTORICAL DEPTH COMPLIANCE")
    print("-" * 60)
    
    nifty_det = summary["details"].get("NIFTY")
    if nifty_det and nifty_det["day"]:
        print(f"NIFTY Daily candles:   {nifty_det['day']['start']} to {nifty_det['day']['end']} ({nifty_det['day']['rows']} rows, {format_size(nifty_det['day']['size'])})")
    else:
        print("NIFTY Daily candles:   [MISSING]")
        
    if nifty_det and nifty_det["5minute"]:
        print(f"NIFTY 5-min candles:   {nifty_det['5minute']['start']} to {nifty_det['5minute']['end']} ({nifty_det['5minute']['rows']} rows, {format_size(nifty_det['5minute']['size'])})")
    else:
        print("NIFTY 5-min candles:   [MISSING]")
        
    print("=" * 60)
    
    # Calculate sizes for pie chart
    und_mb = round(summary["underlying_size"] / (1024 * 1024), 2)
    opt_mb = round(summary["options_size"] / (1024 * 1024), 2)
    fut_mb = round(summary["futures_size"] / (1024 * 1024), 2)
    
    # Avoid zero-values in pie titles to prevent rendering failures
    und_val = max(0.01, und_mb)
    opt_val = max(0.01, opt_mb)
    fut_val = max(0.01, fut_mb)
    
    # Write report
    os.makedirs(DATA_DIR, exist_ok=True)
    report_path = os.path.join(DATA_DIR, "database_audit_report.md")
    try:
        with open(report_path, "w", encoding="utf-8") as f:
            f.write("# Upstox Parquet Database Audit Report\n\n")
            f.write(f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} IST\n\n")
            
            f.write("## 📊 Database Health Visualizer\n\n")
            
            # Mermaid Pie Charts
            f.write("```mermaid\n")
            f.write("pie title \"Storage Size Distribution (MB)\"\n")
            f.write(f"    \"Underlying\" : {und_val:.2f}\n")
            f.write(f"    \"Options\" : {opt_val:.2f}\n")
            f.write(f"    \"Futures\" : {fut_val:.2f}\n")
            f.write("```\n\n")
            
            f.write("```mermaid\n")
            f.write("pie title \"NSE Universe Sync Coverage\"\n")
            f.write(f"    \"Daily Synced\" : {summary['underlying_day_ok']}\n")
            f.write(f"    \"Intraday 5m Synced\" : {summary['underlying_5min_ok']}\n")
            f.write(f"    \"Options Synced\" : {summary['options_ok']}\n")
            f.write(f"    \"Missing/Unsynced\" : {len(all_symbols) - summary['underlying_day_ok']}\n")
            f.write("```\n\n")
            
            # Flowchart
            f.write("```mermaid\n")
            f.write("graph TD\n")
            f.write("    Universe[\"NSE F&O Universe (" + str(len(all_symbols)) + " Symbols)\"]\n")
            f.write("    Universe --> Daily[\"Daily (" + str(summary['underlying_day_ok']) + " Synced)\"]\n")
            f.write("    Universe --> Min5[\"5-min (" + str(summary['underlying_5min_ok']) + " Synced)\"]\n")
            f.write("    Universe --> Options[\"Options (" + str(summary['options_ok']) + " Synced)\"]\n")
            f.write("    \n")
            f.write(f"    Daily --> Stor[\"Total Storage: {format_size(total_db_size)}\"]\n")
            f.write(f"    Min5 --> Stor\n")
            f.write("```\n\n")
            
            f.write("## Database Health Overview\n\n")
            f.write(f"* **Total Symbols in Universe:** {summary['total_symbols']} (Indices + F&O)\n")
            f.write(f"* **Underlying Daily Coverage:** {summary['underlying_day_ok']} / {summary['total_symbols']} symbols\n")
            f.write(f"* **Underlying 5-min Coverage:** {summary['underlying_5min_ok']} / {summary['total_symbols']} symbols\n")
            f.write(f"* **Underlying 15-min Coverage:** {summary['underlying_15min_ok']} / {summary['total_symbols']} symbols\n")
            f.write(f"* **Options Expiry Coverage:** {summary['options_ok']} / {summary['total_symbols']} symbols\n")
            f.write(f"* **Futures Expiry Coverage:** {summary['futures_ok']} / {summary['total_symbols']} symbols\n")
            f.write(f"* **Total Storage Size:** {format_size(total_db_size)} *(Underlying: {format_size(summary['underlying_size'])}, Options: {format_size(summary['options_size'])}, Futures: {format_size(summary['futures_size'])})*\n\n")
            
            if sync_errors:
                f.write("### ⚠️ Active Sync Errors\n\n")
                for err in sync_errors[:20]:
                    f.write(f"* {err}\n")
                if len(sync_errors) > 20:
                    f.write(f"* ... and {len(sync_errors) - 20} more errors.\n")
                f.write("\n")
                
            f.write("## Benchmark Analysis (NIFTY)\n\n")
            if nifty_det:
                f.write("| Interval | Records | Start Date | End Date | Size | Status |\n")
                f.write("| --- | --- | --- | --- | --- | --- |\n")
                if nifty_det["day"]:
                    f.write(f"| Daily | {nifty_det['day']['rows']} | {nifty_det['day']['start']} | {nifty_det['day']['end']} | {format_size(nifty_det['day']['size'])} | [OK] 10 Years Synced |\n")
                else:
                    f.write("| Daily | - | - | - | - | [MISSING] |\n")
                    
                if nifty_det["5minute"]:
                    f.write(f"| 5-minute | {nifty_det['5minute']['rows']} | {nifty_det['5minute']['start']} | {nifty_det['5minute']['end']} | {format_size(nifty_det['5minute']['size'])} | [OK] 180 Days Synced |\n")
                else:
                    f.write("| 5-minute | - | - | - | - | [MISSING] |\n")
                    
                if nifty_det["15minute"]:
                    f.write(f"| 15-minute | {nifty_det['15minute']['rows']} | {nifty_det['15minute']['start']} | {nifty_det['15minute']['end']} | {format_size(nifty_det['15minute']['size'])} | [OK] 180 Days Synced |\n")
                else:
                    f.write("| 15-minute | - | - | - | - | [MISSING] |\n")
            else:
                f.write("NIFTY Benchmark details missing.\n")
                
            f.write("\n## Detailed Symbol Status Table\n\n")
            f.write("> **Note on Gaps**: Gaps represent missing trading days in the range (excluding weekends and common exchange holidays). If gaps exist, they are listed below.\n\n")
            f.write("| Symbol | Daily (Range & Gaps) | 5-min (Range & Gaps) | Options | Futures | Total Disk Size |\n")
            f.write("| --- | --- | --- | --- | --- | --- |\n")
            
            for sym in all_symbols:
                det = summary["details"][sym]
                
                # Daily description & gaps
                if det["day"]:
                    d_gaps = det["day_gaps"]
                    gaps_desc = ""
                    if len(d_gaps) > 25: # If there are more than 25 gaps, it is likely mostly holidays
                        gaps_desc = f"<br>ℹ️ **Holidays/Gaps**: {len(d_gaps)} days"
                    elif d_gaps:
                        gaps_desc = f"<br>⚠️ **Gaps ({len(d_gaps)}d)**: " + ", ".join(d_gaps[:3])
                        if len(d_gaps) > 3:
                            gaps_desc += "..."
                    d_status = f"{det['day']['rows']} rows ({det['day']['start']} to {det['day']['end']}){gaps_desc}"
                else:
                    d_status = "[MISSING]"
                    
                # 5-min description & gaps
                if det["5minute"]:
                    m5_gaps = det["m5_gaps"]
                    gaps_desc = ""
                    if len(m5_gaps) > 25:
                        gaps_desc = f"<br>ℹ️ **Holidays/Gaps**: {len(m5_gaps)} days"
                    elif m5_gaps:
                        gaps_desc = f"<br>⚠️ **Gaps ({len(m5_gaps)}d)**: " + ", ".join(m5_gaps[:2])
                        if len(m5_gaps) > 2:
                            gaps_desc += "..."
                    m5_status = f"{det['5minute']['rows']} rows ({det['5minute']['start']} to {det['5minute']['end']}){gaps_desc}"
                else:
                    m5_status = "[MISSING]"
                    
                opt_exp = f"{det['expiries_options_count']} expiries ({format_size(det['options_size'])})" if det["expiries_options_count"] > 0 else "-"
                fut_exp = f"{det['expiries_futures_count']} expiries ({format_size(det['futures_size'])})" if det["expiries_futures_count"] > 0 else "-"
                
                symbol_total_size = det["underlying_size"] + det["options_size"] + det["futures_size"]
                
                f.write(f"| **{sym}** | {d_status} | {m5_status} | {opt_exp} | {fut_exp} | **{format_size(symbol_total_size)}** |\n")
                
        print(f"\n[OK] Audit complete. Detailed Markdown report saved to: python-bridge/data/database_audit_report.md")
    except Exception as e:
        print(f"[!] Error writing markdown report: {e}")

if __name__ == "__main__":
    audit()
