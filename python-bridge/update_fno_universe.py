import os
import re
import json
import sqlite3
import requests
import io
import pandas as pd
from datetime import datetime
from logger import get_logger

log = get_logger("fno_sync", tag="SYNC")

# Setup paths relative to the script directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(SCRIPT_DIR, "cache.db")
STATIC_FNO_PATH = os.path.abspath(os.path.join(SCRIPT_DIR, "../data/fno_stocks.ts"))
STATIC_SECTOR_PATH = os.path.abspath(os.path.join(SCRIPT_DIR, "../data/sectorConstituents.ts"))

OUTPUT_FNO_JSON = os.path.join(SCRIPT_DIR, "fno_stocks_generated.json")
OUTPUT_SECTOR_JSON = os.path.join(SCRIPT_DIR, "sector_constituents_generated.json")

# NSE Index constituent CSV URLs
INDEX_URLS = {
    "AUTO": "https://archives.nseindia.com/content/indices/ind_niftyautolist.csv",
    "BANK": "https://archives.nseindia.com/content/indices/ind_niftybanklist.csv",
    "FMCG": "https://archives.nseindia.com/content/indices/ind_niftyfmcglist.csv",
    "IT": "https://archives.nseindia.com/content/indices/ind_niftyitlist.csv",
    "METAL": "https://archives.nseindia.com/content/indices/ind_niftymetallist.csv",
    "PHARMA": "https://archives.nseindia.com/content/indices/ind_niftypharmalist.csv",
    "REALTY": "https://archives.nseindia.com/content/indices/ind_niftyrealtylist.csv",
    "FIN SERVICE": "https://archives.nseindia.com/content/indices/ind_niftyfinancelist.csv",
    "HEALTHCARE": "https://archives.nseindia.com/content/indices/ind_niftyhealthcarelist.csv",
    "MEDIA": "https://archives.nseindia.com/content/indices/ind_niftymedialist.csv",
    "PSU BANK": "https://archives.nseindia.com/content/indices/ind_niftypsubanklist.csv",
    "PVT BANK": "https://archives.nseindia.com/content/indices/ind_niftyprivatebanklist.csv",
    "OIL & GAS": "https://archives.nseindia.com/content/indices/ind_niftyoilgaslist.csv",
    "CAP GOODS": "https://archives.nseindia.com/content/indices/ind_niftycapitalgoodslist.csv",
    "SERVICES": "https://archives.nseindia.com/content/indices/ind_niftyservicessectorlist.csv",
    "DEFENSE": "https://archives.nseindia.com/content/indices/ind_niftyindiadefencelist.csv",
    "NIFTY 50": "https://archives.nseindia.com/content/indices/ind_nifty50list.csv",
    "NIFTY NEXT 50": "https://archives.nseindia.com/content/indices/ind_niftynext50list.csv",
    "NIFTY MID SELECT": "https://archives.nseindia.com/content/indices/ind_niftymidcap50list.csv"
}

# Standard browser headers to bypass simple user-agent blocks
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def parse_static_fno_stocks():
    """Parses existing fno_stocks.ts to load manual/static mappings as fallback"""
    fallback_map = {}
    if not os.path.exists(STATIC_FNO_PATH):
        log.warning("Static F&O file not found at: %s", STATIC_FNO_PATH)
        return fallback_map

    try:
        with open(STATIC_FNO_PATH, "r", encoding="utf-8") as f:
            content = f.read()
        
        # Match symbol: 'XYZ', sector: 'ABC'
        pattern = r"symbol:\s*['\"]([A-Z0-9&-]+)['\"],\s*sector:\s*['\"]([^'\"]+)['\"]"
        matches = re.findall(pattern, content)
        for symbol, sector in matches:
            fallback_map[symbol.strip().upper()] = sector.strip().upper()
        
        log.info("Loaded %d fallback symbols from static fno_stocks.ts", len(fallback_map))
    except Exception as e:
        log.error("Failed to parse static fno_stocks.ts: %s", e)
    return fallback_map

def parse_static_sector_constituents():
    """Parses existing sectorConstituents.ts to load baseline lists"""
    fallback_sectors = {}
    if not os.path.exists(STATIC_SECTOR_PATH):
        log.warning("Static sector constituents not found at: %s", STATIC_SECTOR_PATH)
        return fallback_sectors

    try:
        with open(STATIC_SECTOR_PATH, "r", encoding="utf-8") as f:
            content = f.read()

        # Extract blocks: 'IT': [ ... ]
        pattern = r"['\"]([^'\"]+)['\"]\s*:\s*\[([^\]]+)\]"
        matches = re.findall(pattern, content)
        for sector, symbols_str in matches:
            # Clean symbols
            symbols = [s.strip().replace("'", "").replace('"', '').upper() 
                       for s in symbols_str.split(",") if s.strip()]
            fallback_sectors[sector.strip().upper()] = symbols
        log.info("Loaded %d sector lists from static constituents", len(fallback_sectors))
    except Exception as e:
        log.error("Failed to parse static sectorConstituents.ts: %s", e)
    return fallback_sectors

def get_active_fno_universe():
    """Extracts all active F&O underlying stock symbols from Upstox cache table"""
    fno_symbols = set()
    if not os.path.exists(DB_FILE):
        log.warning("SQLite cache database not found at %s", DB_FILE)
        return fno_symbols

    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Check if table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='upstox_instruments'")
        if not cursor.fetchone():
            log.info("upstox_instruments table does not exist yet. Running sync...")
            # We import and run the Upstox sync function if table is missing
            from upstox import download_and_sync_instruments
            download_and_sync_instruments()
            
        cursor.execute("SELECT DISTINCT symbol FROM upstox_instruments WHERE exchange = 'NSE_FO'")
        rows = cursor.fetchall()
        
        for row in rows:
            full_symbol = row[0]
            parts = full_symbol.split()
            if parts:
                underlying = parts[0].upper().strip()
                # Exclude indices
                if underlying not in ('NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'CNX100'):
                    fno_symbols.add(underlying)
                    
        conn.close()
        log.info("Extracted %d active F&O symbols from Upstox database cache", len(fno_symbols))
    except Exception as e:
        log.error("Failed to extract active F&O symbols from DB: %s", e)
    return fno_symbols

def download_nse_constituents():
    """Downloads all sectoral constituent lists from NSE and parses symbols"""
    parsed_indices = {}
    for name, url in INDEX_URLS.items():
        try:
            log.info("Downloading constituents for %s index...", name)
            r = requests.get(url, headers=HEADERS, timeout=10)
            if r.status_code != 200:
                log.warning("Failed to download index %s (Status code %d)", name, r.status_code)
                continue
            
            # Read CSV with latin1 to handle any non-standard chars
            df = pd.read_csv(io.BytesIO(r.content), encoding="latin1")
            
            # Find the symbol column (usually titled 'Symbol')
            symbol_col = None
            for col in df.columns:
                if col.strip().upper() == "SYMBOL":
                    symbol_col = col
                    break
            
            if not symbol_col:
                # Fallback to column containing 'symbol' or index 2
                for col in df.columns:
                    if "SYMBOL" in col.upper():
                        symbol_col = col
                        break
            
            if symbol_col:
                symbols = df[symbol_col].dropna().apply(lambda x: str(x).strip().upper()).tolist()
                # Clean symbols (remove spaces/newlines)
                symbols = [s for s in symbols if s and s != "SYMBOL"]
                parsed_indices[name] = symbols
                log.info("Successfully parsed %d symbols for %s", len(symbols), name)
            else:
                log.warning("No Symbol column found in %s CSV", name)
        except Exception as e:
            log.error("Failed to parse constituents for index %s: %s", name, e)
            
    return parsed_indices

def run_sync():
    """Main function to download, map, and output F&O sectoral mapping files"""
    log.info("Beginning F&O sectoral mapping sync...")
    
    # 1. Parse existing static declarations as fallbacks
    static_fno = parse_static_fno_stocks()
    static_sectors = parse_static_sector_constituents()
    
    # 2. Get active F&O underlyings from Upstox instruments SQLite DB
    fno_universe = get_active_fno_universe()
    if not fno_universe:
        log.error("Active F&O universe is empty! Sync cannot proceed.")
        return False
        
    # 3. Download active index constituents from NSE
    downloaded_sectors = download_nse_constituents()
    
    # Merge downloaded sectors with static sectors to maintain manual lists (e.g. CEMENT, SENSEX, etc.)
    all_sectors = {}
    
    # Copy static ones first
    for sect, syms in static_sectors.items():
        all_sectors[sect] = set(syms)
        
    # Overwrite/extend with downloaded ones
    for sect, syms in downloaded_sectors.items():
        if sect in all_sectors:
            # Union to keep manually added stocks if they aren't in official CSV for some reason, 
            # or just overwrite. Let's merge them!
            all_sectors[sect].update(syms)
        else:
            all_sectors[sect] = set(syms)
            
    # Now, filter the sector lists so they ONLY contain active F&O stocks (except for indices like NIFTY 50, SENSEX, NIFTY MID SELECT)
    # wait! The dashboard quote polling ONLY requests quotes for F&O universe.
    # So filtering sector constituents by F&O universe is very important to avoid pulling invalid quotes.
    sector_constituents_generated = {}
    for sect, syms in all_sectors.items():
        # Keep index lists as-is or filter? Let's check:
        # If it's a sector, filter by F&O universe. If it's a major index, we also filter by F&O or keep all?
        # Fallback to static sector constituents to prevent blank sectors (e.g. MEDIA during bans)
        filtered_syms = [s for s in syms if s in fno_universe or s in static_sectors.get(sect, [])]
        
        # Guard: If filtering yields fewer than static baseline, preserve static constituents
        static_baseline = static_sectors.get(sect, [])
        if len(filtered_syms) < len(static_baseline):
            filtered_syms = list(set(filtered_syms + static_baseline))
            
        # If it's NIFTY 50 or SENSEX, keep them intact
        if sect in ("NIFTY 50", "SENSEX"):
            filtered_syms = list(syms)
            
        sector_constituents_generated[sect] = sorted(list(set(filtered_syms)))
        log.info("Sector %s has %d active F&O constituents", sect, len(sector_constituents_generated[sect]))

    # 4. Generate the master fno_stocks mapping (Each F&O stock mapped to one primary sector)
    # Order of priority to assign primary sector
    sector_priority = [
        "BANK", "IT", "AUTO", "METAL", "OIL & GAS", "FMCG", "REALTY", 
        "PHARMA", "HEALTHCARE", "MEDIA", "FIN SERVICE", "CEMENT", "CAP GOODS", "SERVICES"
    ]
    
    fno_stocks_generated = []
    for symbol in sorted(list(fno_universe)):
        assigned_sector = None
        
        # Check downloaded sectors in priority order
        for sect in sector_priority:
            if sect in downloaded_sectors and symbol in downloaded_sectors[sect]:
                assigned_sector = sect
                break
                
        # If not found in downloaded sectors, check other downloaded sectors (like PVT BANK, PSU BANK -> BANK)
        if not assigned_sector:
            if "PVT BANK" in downloaded_sectors and symbol in downloaded_sectors["PVT BANK"]:
                assigned_sector = "BANK"
            elif "PSU BANK" in downloaded_sectors and symbol in downloaded_sectors["PSU BANK"]:
                assigned_sector = "BANK"
                
        # Fall back to static fno_stocks.ts mapping
        if not assigned_sector and symbol in static_fno:
            assigned_sector = static_fno[symbol]
            
        # Fall back to static sectorConstituents mapping
        if not assigned_sector:
            for sect in sector_priority:
                if sect in static_sectors and symbol in static_sectors[sect]:
                    assigned_sector = sect
                    break
                    
        # Final fallback
        if not assigned_sector:
            assigned_sector = "OTHERS"
            
        fno_stocks_generated.append({
            "symbol": symbol,
            "sector": assigned_sector
        })
        
    # Write outputs as JSON
    try:
        with open(OUTPUT_FNO_JSON, "w", encoding="utf-8") as f:
            json.dump(fno_stocks_generated, f, indent=4)
        log.info("Successfully wrote %s", OUTPUT_FNO_JSON)
        
        with open(OUTPUT_SECTOR_JSON, "w", encoding="utf-8") as f:
            json.dump(sector_constituents_generated, f, indent=4)
        log.info("Successfully wrote %s", OUTPUT_SECTOR_JSON)
        
        # Automatically update static TS source files on disk to stay in sync
        write_ts_fno_stocks(fno_stocks_generated)
        write_ts_sector_constituents(sector_constituents_generated)
        
        return True
    except Exception as e:
        log.error("Failed to write output files: %s", e)
        return False

def write_ts_fno_stocks(fno_stocks_list):
    content = """export interface FnoStock {
    symbol: string;
    sector: string;
}

export const FNO_STOCKS: FnoStock[] = [
"""
    from collections import defaultdict
    by_sector = defaultdict(list)
    for item in fno_stocks_list:
        by_sector[item["sector"]].append(item["symbol"])
        
    for sector in sorted(by_sector.keys()):
        content += f"    // {sector}\n"
        for symbol in sorted(by_sector[sector]):
            content += f"    {{ symbol: '{symbol}', sector: '{sector}' }},\n"
        content += "\n"
        
    content = content.rstrip() + "\n];\n"
    
    with open(STATIC_FNO_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    log.info("Automatically updated static TS source file: %s", STATIC_FNO_PATH)

def write_ts_sector_constituents(sector_constituents_dict):
    content = "export const SECTOR_CONSTITUENTS: Record<string, string[]> = {\n"
    for sector in sorted(sector_constituents_dict.keys()):
        symbols = sorted(sector_constituents_dict[sector])
        content += f"  '{sector}': [\n"
        chunks = [symbols[i:i+8] for i in range(0, len(symbols), 8)]
        for chunk in chunks:
            symbols_str = ", ".join(f"'{s}'" for s in chunk)
            content += f"    {symbols_str},\n"
        content = content.rstrip(",\n") + "\n  ],\n"
        
    content = content.rstrip(",\n") + "\n};\n"
    
    with open(STATIC_SECTOR_PATH, "w", encoding="utf-8") as f:
        f.write(content)
    log.info("Automatically updated static TS source file: %s", STATIC_SECTOR_PATH)

if __name__ == "__main__":
    run_sync()
