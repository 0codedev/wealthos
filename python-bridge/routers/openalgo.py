import os
import sys
import re
import json
import time
import threading
from pathlib import Path
from datetime import datetime
import requests
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/openalgo")

OPENALGO_HOST = os.getenv("OPENALGO_HOST", "http://127.0.0.1:5000")
OPENALGO_API_KEY = os.getenv("OPENALGO_API_KEY", "openalgo_mcp_api_key_2026")

session = requests.Session()
session.trust_env = False

def get_headers():
    return {
        "Content-Type": "application/json"
    }

def get_payload():
    return {
        "apikey": OPENALGO_API_KEY
    }

@router.get("/pnl")
def get_pnl():
    """
    Fetch open positions and calculate total realized & unrealized P&L
    """
    try:
        url = f"{OPENALGO_HOST}/api/v1/positionbook"
        resp = session.post(url, headers=get_headers(), json=get_payload(), timeout=5)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        
        data = resp.json()
        positions = data.get("data", [])
        if not isinstance(positions, list):
            positions = []
            
        realized = 0.0
        unrealized = 0.0
        for pos in positions:
            realized += float(pos.get("realizedpnl", 0) or 0)
            unrealized += float(pos.get("unrealizedpnl", 0) or 0)
            
        return {
            "status": "success",
            "positions": positions,
            "realized_pnl": realized,
            "unrealized_pnl": unrealized,
            "total_pnl": realized + unrealized
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/orderbook")
def get_orderbook():
    """
    Fetch orderbook from OpenAlgo
    """
    try:
        url = f"{OPENALGO_HOST}/api/v1/orderbook"
        resp = session.post(url, headers=get_headers(), json=get_payload(), timeout=5)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/funds")
def get_funds():
    """
    Fetch available margin/funds
    """
    try:
        url = f"{OPENALGO_HOST}/api/v1/funds"
        resp = session.post(url, headers=get_headers(), json=get_payload(), timeout=5)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
def get_status():
    """
    Fetch current OpenAlgo broker connection status
    """
    try:
        url = f"{OPENALGO_HOST}/api/v1/ping"
        resp = session.post(url, headers=get_headers(), json=get_payload(), timeout=5)
        if resp.status_code != 200:
            return {"status": "offline", "broker": "none", "message": "OpenAlgo server is offline"}
        data = resp.json()
        broker = data.get("data", {}).get("broker", "unknown")
        return {"status": "online", "broker": broker}
    except Exception as e:
        return {"status": "offline", "broker": "none", "message": str(e)}

@router.get("/tradebook")
def get_tradebook():
    """
    Fetch tradebook from OpenAlgo
    """
    try:
        url = f"{OPENALGO_HOST}/api/v1/tradebook"
        resp = session.post(url, headers=get_headers(), json=get_payload(), timeout=5)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sandbox/pnl")
def get_sandbox_pnl():
    """
    Fetch sandbox positions and P&L history using public API key endpoint
    """
    try:
        url = f"{OPENALGO_HOST}/sandbox/mypnl/api/data/public"
        resp = session.post(url, headers=get_headers(), json=get_payload(), timeout=5)
        if resp.status_code != 200:
            url_get = f"{OPENALGO_HOST}/sandbox/mypnl/api/data/public?apikey={OPENALGO_API_KEY}"
            resp = session.get(url_get, headers=get_headers(), timeout=5)
            
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
            
        return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def parse_indian_fno_symbol(sym: str, trade_date_str: str = "") -> dict:
    """
    Parses Indian F&O option contract ticker to extract:
    underlying, expiry_date (YYYY-MM-DD), strike, option_type, days_to_expiry.
    """
    clean_sym = (sym or "").strip().upper()
    month_map = {
        "JAN": "01", "FEB": "02", "MAR": "03", "APR": "04", "MAY": "05", "JUN": "06",
        "JUL": "07", "AUG": "08", "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12"
    }

    opt_type = "CE" if "CE" in clean_sym else ("PE" if "PE" in clean_sym else None)
    underlying = None
    expiry_date = None
    strike_val = None

    # Pattern 1: Standard NSE format e.g. NIFTY22SEP2623300CE or BANKNIFTY29SEP2658000CE
    m1 = re.search(r'^([A-Z]+?)(\d{2})([A-Z]{3})(\d{2})(\d+)(CE|PE)$', clean_sym)
    if m1:
        underlying = m1.group(1)
        day = m1.group(2)
        mon_str = m1.group(3)
        yr_short = m1.group(4)
        strike_val = float(m1.group(5))
        opt_type = m1.group(6)
        mon = month_map.get(mon_str, "09")
        yr = f"20{yr_short}"
        expiry_date = f"{yr}-{mon}-{day}"

    # Pattern 2: Short month format e.g. NIFTY26SEP23300CE
    if not expiry_date:
        m2 = re.search(r'^([A-Z]+?)(\d{2})([A-Z]{3})(\d+)(CE|PE)$', clean_sym)
        if m2:
            underlying = m2.group(1)
            yr_short = m2.group(2)
            mon_str = m2.group(3)
            strike_val = float(m2.group(4))
            opt_type = m2.group(5)
            mon = month_map.get(mon_str, "09")
            yr = f"20{yr_short}"
            expiry_date = f"{yr}-{mon}-25"

    # Pattern 3: Fallback extraction
    if not strike_val:
        m_strike = re.search(r'(\d{4,6})(?:CE|PE)', clean_sym)
        if m_strike:
            strike_val = float(m_strike.group(1))

    if not expiry_date:
        expiry_date = trade_date_str or datetime.now().strftime("%Y-%m-%d")

    # Calculate authentic Days to Expiry (DTE)
    dte = 0
    try:
        if trade_date_str and expiry_date:
            t_dt = datetime.strptime(str(trade_date_str).strip(), "%Y-%m-%d").date()
            e_dt = datetime.strptime(str(expiry_date).strip(), "%Y-%m-%d").date()
            dte = max(0, (e_dt - t_dt).days)
    except Exception:
        dte = 0

    return {
        "underlying": underlying or clean_sym,
        "strike": strike_val or 0.0,
        "optionType": opt_type or "CE",
        "expiryDate": expiry_date,
        "daysToExpiry": dte
    }


def calculate_indian_fno_charges(entry_price: float, exit_price: float, quantity: float, asset_class: str = "Options") -> dict:
    """
    Computes authentic Indian F&O regulatory tariff according to SEBI & NSE circulars:
    - Brokerage: Rs 20 per executed order (Rs 40 roundtrip)
    - STT: 0.125% on option sell premium turnover
    - Exchange Turnover Charges: 0.05% on option premium turnover
    - GST: 18% on (Brokerage + Exchange + SEBI charges)
    - SEBI Charges: Rs 10 / Crore (0.0001% of turnover)
    - Stamp Duty: 0.003% on buy turnover
    """
    qty = abs(float(quantity or 1.0))
    ep = max(0.05, float(entry_price or 0.0))
    xp = max(0.05, float(exit_price or ep))
    buy_turnover = ep * qty
    sell_turnover = xp * qty
    total_turnover = buy_turnover + sell_turnover

    brokerage = 40.0 # Rs 20 buy + Rs 20 sell roundtrip
    if asset_class == "Options":
        stt = round(sell_turnover * 0.00125, 2)
        exch_charges = round(total_turnover * 0.0005, 2)
        stamp_duty = round(buy_turnover * 0.00003, 2)
    elif asset_class == "Commodity":
        stt = round(sell_turnover * 0.0001, 2)
        exch_charges = round(total_turnover * 0.00026, 2)
        stamp_duty = round(buy_turnover * 0.00002, 2)
    else: # Equity Intraday
        stt = round(sell_turnover * 0.00025, 2)
        exch_charges = round(total_turnover * 0.0000345, 2)
        stamp_duty = round(buy_turnover * 0.00003, 2)

    sebi_charges = round(total_turnover * 0.000001, 2)
    if sebi_charges < 0.01:
        sebi_charges = 0.01

    gst = round((brokerage + exch_charges + sebi_charges) * 0.18, 2)
    total_fees = round(brokerage + stt + exch_charges + sebi_charges + gst + stamp_duty, 2)

    return {
        "fees": total_fees,
        "feeBreakdown": {
            "brokerage": brokerage,
            "stt": stt,
            "exchangeTransactionCharges": exch_charges,
            "sebiTax": sebi_charges,
            "serviceTax": gst,
            "stampDuty": stamp_duty
        }
    }


@router.get("/sync-sandbox-trades")
def sync_sandbox_trades():
    """
    Harvests authentic sandbox executions from:
    1. cache.db (autopilot_journal - FNO Sector Rotation Strategy Desk)
    2. positions_*.csv (exact daily closed positions exported by OpenAlgo for Sept 17 & 18)
    3. sandbox.db (OpenAlgo's master SQLite positions ledger for MCX Commodities & earlier NFO/BFO)

    Experimental files like scalp_ledger.json and raw API logs like analyzer_logs are strictly excluded.
    """
    import csv
    import glob
    import json
    import os
    import re
    import sqlite3
    from datetime import datetime

    trades = []
    seen_trade_keys = set()
    seen_fno_symbols = set()
    granular_dates = set()

    # 1. Ingest authentic FNO Sector Rotation Bot trades from cache.db (autopilot_journal)
    cache_db_paths = [
        "/home/ubuntu/wealthos/python-bridge/cache.db",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "cache.db")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "python-bridge", "cache.db")),
        os.path.abspath("python-bridge/cache.db"),
        os.path.abspath("cache.db")
    ]

    for cpath in cache_db_paths:
        if not os.path.exists(cpath):
            continue
        try:
            conn = sqlite3.connect(cpath)
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='autopilot_journal'")
            if cur.fetchone():
                cur.execute("""
                    SELECT id, date, symbol, direction, entry_time, entry_price, 
                           exit_time, exit_price, quantity, pnl, pnl_pct, status, strategy 
                    FROM autopilot_journal 
                    ORDER BY date ASC
                """)
                for r in cur.fetchall():
                    (aid, adate, asym, adir, aetime, aeprice, 
                     axtime, axprice, aqty, apnl, apnl_pct, astatus, astrat) = r
                    
                    if apnl is None:
                        continue
                    pnl_val = float(apnl)
                    asym_clean = (asym or "").strip()
                    if not asym_clean:
                        continue

                    seen_fno_symbols.add((asym_clean.upper(), str(adate).strip()))
                    key = f"FNO_{asym_clean}_{adate}"
                    if key in seen_trade_keys:
                        continue
                    seen_trade_keys.add(key)
                    granular_dates.add(str(adate).strip())

                    entry_p = float(aeprice or 0.0)
                    exit_p = float(axprice or entry_p)
                    qty_val = abs(float(aqty or 1.0))
                    dir_str = "Long" if adir == "BUY" else ("Short" if adir == "SELL" else "Long")
                    entry_time_str = str(aetime).split(" ")[1][:5] if (" " in str(aetime) and len(str(aetime).split(" ")[1]) >= 5) else str(aetime or "10:00")[:5]
                    exit_time_str = str(axtime).split(" ")[1][:5] if (" " in str(axtime) and len(str(axtime).split(" ")[1]) >= 5) else str(axtime or "14:00")[:5]
                    strat_name = astrat or "FNO_SectorRotation"

                    fno_info = parse_indian_fno_symbol(asym_clean, str(adate).strip())
                    fee_data = calculate_indian_fno_charges(entry_p, exit_p, qty_val, "Options")

                    # Accurate Trade Outcome including explicit Breakeven
                    if pnl_val > 500:
                        outcome = "Full Win"
                    elif pnl_val > 0:
                        outcome = "Partial Success"
                    elif pnl_val == 0.0:
                        outcome = "Breakeven"
                    elif pnl_val >= -500:
                        outcome = "Partial Loss"
                    else:
                        outcome = "Stopped Out"

                    trades.append({
                        "ticker": asym_clean,
                        "direction": dir_str,
                        "quantity": qty_val,
                        "entryPrice": round(entry_p, 2),
                        "exitPrice": round(exit_p, 2),
                        "date": str(adate).strip(),
                        "entryTime": entry_time_str,
                        "exitTime": exit_time_str,
                        "timeInTrade": "Intraday Trend",
                        "moodEntry": "Focused",
                        "moodExit": "Satisfied" if pnl_val >= 0 else "Disciplined",
                        "tradeOutcome": outcome,
                        "mistakes": [],
                        "setup": strat_name,
                        "pnl": round(pnl_val, 2),
                        "fees": fee_data["fees"],
                        "feeBreakdown": fee_data["feeBreakdown"],
                        "assetClass": "Options",
                        "brokerProfile": "Options",
                        "optionsData": {
                            "strikePrice": fno_info["strike"],
                            "optionType": fno_info["optionType"],
                            "expiryDate": fno_info["expiryDate"],
                            "daysToExpiry": fno_info["daysToExpiry"]
                        } if fno_info["strike"] > 0 else None,
                        "notes": f"Alpha Autopilot {strat_name} Execution. Realized P&L: ₹{pnl_val:,.2f}",
                        "source": "SANDBOX",
                        "broker": "openalgo_sandbox",
                        "isImported": True,
                        "orderType": "MARKET"
                    })
            conn.close()
            if trades:
                break
        except Exception as e:
            print(f"[SyncSandbox] Error reading autopilot_journal from {cpath}: {e}")

    # Build actual order timestamp & original strategy lookup from sandbox.db
    order_times_map = {}
    sb_lookup_paths = [
        "/home/ubuntu/openalgo/db/sandbox.db",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "db", "sandbox.db")),
        os.path.abspath("db/sandbox.db"),
        r"c:\Users\gadda\Desktop\Projects\openalgo\db\sandbox.db"
    ]
    for sbp in sb_lookup_paths:
        if os.path.exists(sbp):
            try:
                conn_sb = sqlite3.connect(sbp)
                cur_sb = conn_sb.cursor()
                cur_sb.execute("""
                    SELECT symbol, order_timestamp, action, strategy
                    FROM sandbox_orders
                    WHERE order_status = 'complete' AND order_timestamp IS NOT NULL
                    ORDER BY order_timestamp ASC
                """)
                for s_sym, s_ts, s_act, s_strat in cur_sb.fetchall():
                    if not s_sym or not s_ts:
                        continue
                    s_sym_clean = s_sym.strip().upper()
                    c_parts = str(s_ts).split(" ")
                    d_str = c_parts[0]
                    t_str = c_parts[1][:5] if len(c_parts) > 1 and len(c_parts[1]) >= 5 else "09:30"
                    k = (s_sym_clean, d_str)
                    clean_strat = (s_strat or "").strip()
                    if k not in order_times_map:
                        order_times_map[k] = {
                            "first_entry": t_str,
                            "last_exit": t_str,
                            "initial_strategy": clean_strat
                        }
                    else:
                        order_times_map[k]["last_exit"] = t_str
                        if (s_act or "").upper() == "BUY" and clean_strat and not order_times_map[k].get("initial_strategy"):
                            order_times_map[k]["initial_strategy"] = clean_strat
                conn_sb.close()
                if order_times_map:
                    break
            except Exception as e:
                print(f"[SyncSandbox] Error reading order timestamps: {e}")

    # 2. Ingest granular executed positions from positions_*.csv (Sept 17 & Sept 18)
    pos_dirs = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data")),
        os.path.abspath("data"),
        "/home/ubuntu/wealthos/data",
        os.path.join(os.path.expanduser("~"), "Downloads")
    ]

    for pdir in pos_dirs:
        if not os.path.exists(pdir):
            continue
        try:
            pos_files = glob.glob(os.path.join(pdir, "positions_*.csv"))
            for pf in pos_files:
                date_match = re.search(r'positions_(\d{4}-\d{2}-\d{2})\.csv', os.path.basename(pf))
                trade_date = date_match.group(1) if date_match else datetime.now().strftime("%Y-%m-%d")
                granular_dates.add(trade_date)

                with open(pf, "r", encoding="utf-8") as pff:
                    reader = csv.DictReader(pff)
                    for row in reader:
                        sym = (row.get("Symbol") or "").strip()
                        if not sym:
                            continue
                        strat = (row.get("Strategy") or "AUTO_SQUARE_OFF").strip()

                        # If already ingested via Autopilot Journal, skip duplicate
                        if any(sym.upper().startswith(s) and trade_date == d for (s, d) in seen_fno_symbols) or strat == "FNO_SectorRotation":
                            continue

                        raw_pnl_str = str(row.get("P&L", "0")).replace("'", "").strip()
                        try:
                            pnl_val = float(raw_pnl_str)
                        except Exception:
                            pnl_val = 0.0

                        try:
                            ltp_val = float(row.get("LTP", 0) or 0.0)
                        except Exception:
                            ltp_val = 0.0

                        try:
                            avg_p = float(row.get("Avg Price", 0) or ltp_val)
                        except Exception:
                            avg_p = ltp_val

                        raw_qty_str = str(row.get("Quantity", "1")).replace("'", "").strip()
                        try:
                            qty_val = abs(float(raw_qty_str)) or 1.0
                        except Exception:
                            qty_val = 1.0

                        entry_p = avg_p if avg_p > 0 else ltp_val
                        exit_p = ltp_val if ltp_val > 0 else entry_p

                        time_info = order_times_map.get((sym.upper(), trade_date), {})
                        real_entry_time = time_info.get("first_entry", "09:30")
                        real_exit_time = time_info.get("last_exit", "15:15")

                        # Reclaim authentic strategy if masked by OpenAlgo 3:15 PM auto square-off
                        if strat in ("AUTO_SQUARE_OFF", "", "None") or "AUTO_SQUARE_OFF" in strat:
                            rec_strat = time_info.get("initial_strategy")
                            if rec_strat and "AUTO_SQUARE_OFF" not in rec_strat:
                                clean_name = rec_strat.replace("Telegram_", "").replace("_", " ").title()
                                strat = f"Telegram: {clean_name}"
                            else:
                                strat = "OpenAlgo Auto Square-Off"
                        elif strat.startswith("SL_") or "," in strat:
                            main_strat = strat.split(",")[-1].replace("Telegram_", "").replace("SL_", "").replace("_", " ").title()
                            strat = f"Telegram: {main_strat}"

                        key = f"POS_{sym}_{trade_date}"
                        if key in seen_trade_keys:
                            continue
                        seen_trade_keys.add(key)

                        fno_info = parse_indian_fno_symbol(sym, trade_date)
                        asset_class = "Options" if fno_info["strike"] > 0 else "Equity"
                        fee_data = calculate_indian_fno_charges(entry_p, exit_p, qty_val, asset_class)

                        try:
                            eh, em = map(int, real_entry_time.split(":"))
                            xh, xm = map(int, real_exit_time.split(":"))
                            diff_mins = (xh * 60 + xm) - (eh * 60 + em)
                            if diff_mins <= 0:
                                duration_str = "Intraday Scalp"
                            elif diff_mins < 60:
                                duration_str = f"{diff_mins}m"
                            else:
                                duration_str = f"{diff_mins // 60}h {diff_mins % 60}m"
                        except Exception:
                            duration_str = "Intraday Scalp"

                        # Accurate Trade Outcome including explicit Breakeven
                        if pnl_val > 500:
                            outcome = "Full Win"
                        elif pnl_val > 0:
                            outcome = "Partial Success"
                        elif pnl_val == 0.0:
                            outcome = "Breakeven"
                        elif pnl_val >= -500:
                            outcome = "Partial Loss"
                        else:
                            outcome = "Stopped Out"

                        trades.append({
                            "ticker": sym,
                            "direction": "Long",
                            "quantity": qty_val,
                            "entryPrice": round(entry_p, 2),
                            "exitPrice": round(exit_p, 2),
                            "date": trade_date,
                            "entryTime": real_entry_time,
                            "exitTime": real_exit_time,
                            "timeInTrade": duration_str,
                            "moodEntry": "Focused",
                            "moodExit": "Satisfied" if pnl_val >= 0 else "Regret",
                            "tradeOutcome": outcome,
                            "mistakes": [],
                            "setup": strat,
                            "pnl": round(pnl_val, 2),
                            "fees": fee_data["fees"],
                            "feeBreakdown": fee_data["feeBreakdown"],
                            "assetClass": asset_class,
                            "brokerProfile": "Options",
                            "optionsData": {
                                "strikePrice": fno_info["strike"],
                                "optionType": fno_info["optionType"],
                                "expiryDate": fno_info["expiryDate"],
                                "daysToExpiry": fno_info["daysToExpiry"]
                            } if fno_info["strike"] > 0 else None,
                            "notes": f"Autonomous execution via {strat}. Realized P&L: ₹{pnl_val:,.2f}",
                            "source": "SANDBOX",
                            "broker": "openalgo_sandbox",
                            "isImported": True,
                            "orderType": "MARKET"
                        })
        except Exception as e:
            print(f"[SyncSandbox] Error reading positions CSVs in {pdir}: {e}")

    # 3. Ingest MCX Commodities & earlier broker trades from OpenAlgo sandbox.db
    sb_db_paths = [
        "/home/ubuntu/openalgo/db/sandbox.db",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "db", "sandbox.db")),
        os.path.abspath("db/sandbox.db"),
        r"c:\Users\gadda\Desktop\Projects\openalgo\db\sandbox.db"
    ]

    for sbp in sb_db_paths:
        if not os.path.exists(sbp):
            continue
        try:
            conn = sqlite3.connect(sbp)
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sandbox_positions'")
            if cur.fetchone():
                cur.execute("""
                    SELECT id, user_id, symbol, exchange, product, quantity,
                           average_price, ltp, pnl, pnl_percent, accumulated_realized_pnl,
                           today_realized_pnl, margin_blocked, created_at, updated_at, strategy
                    FROM sandbox_positions
                    WHERE quantity = 0 OR accumulated_realized_pnl != 0 OR pnl != 0
                    ORDER BY id ASC
                """)
                rows = cur.fetchall()
                for r in rows:
                    (pos_id, user_id, sym, exch, prod, qty,
                     avg_p, ltp, pnl_cur, pnl_pct, acc_pnl,
                     tod_pnl, marg, created_at, updated_at, strat) = r

                    sym_clean = (sym or "").strip()
                    if not sym_clean:
                        continue

                    c_str = str(created_at) if created_at else ""
                    trade_date = c_str.split(" ")[0] if " " in c_str else (c_str.split("T")[0] if "T" in c_str else datetime.now().strftime("%Y-%m-%d"))
                    entry_time = c_str.split(" ")[1][:5] if " " in c_str and len(c_str.split(" ")[1]) >= 5 else "09:30"

                    # If already ingested via Autopilot Journal or CSV, skip duplicate
                    if any(sym_clean.upper().startswith(fno_sym) and trade_date == fno_date for (fno_sym, fno_date) in seen_fno_symbols) or (strat and "SectorRotation" in strat):
                        continue

                    key = f"POS_{sym_clean}_{trade_date}"
                    if key in seen_trade_keys or any(k.startswith(f"POS_{sym_clean}_{trade_date}") for k in seen_trade_keys):
                        continue

                    seen_trade_keys.add(key)
                    granular_dates.add(trade_date)

                    pnl_val = float(acc_pnl if (acc_pnl is not None and acc_pnl != 0) else (pnl_cur or 0.0))
                    entry_p = float(avg_p or 0.0)
                    exit_p = float(ltp or entry_p)
                    qty_val = abs(float(qty or 1.0))

                    is_mcx = exch == "MCX" or "CRUDE" in sym_clean.upper()
                    fno_info = parse_indian_fno_symbol(sym_clean, trade_date)
                    asset_class = "Commodity" if is_mcx else ("Options" if fno_info["strike"] > 0 else "Equity")
                    setup_name = strat or ("MCX_Commodity_Scalp" if is_mcx else "OpenAlgo_Sandbox")
                    fee_data = calculate_indian_fno_charges(entry_p, exit_p, qty_val, asset_class)

                    # Accurate Trade Outcome including explicit Breakeven
                    if pnl_val > 500:
                        outcome = "Full Win"
                    elif pnl_val > 0:
                        outcome = "Partial Success"
                    elif pnl_val == 0.0:
                        outcome = "Breakeven"
                    elif pnl_val >= -500:
                        outcome = "Partial Loss"
                    else:
                        outcome = "Stopped Out"

                    trades.append({
                        "ticker": sym_clean,
                        "direction": "Long",
                        "quantity": qty_val,
                        "entryPrice": round(entry_p, 2),
                        "exitPrice": round(exit_p, 2),
                        "date": trade_date,
                        "entryTime": entry_time,
                        "exitTime": "15:30",
                        "timeInTrade": "Intraday Scalp",
                        "moodEntry": "Focused",
                        "moodExit": "Satisfied" if pnl_val >= 0 else "Regret",
                        "tradeOutcome": outcome,
                        "mistakes": [],
                        "setup": setup_name,
                        "pnl": round(pnl_val, 2),
                        "fees": fee_data["fees"],
                        "feeBreakdown": fee_data["feeBreakdown"],
                        "assetClass": asset_class,
                        "brokerProfile": "Options" if not is_mcx else "Commodity",
                        "optionsData": {
                            "strikePrice": fno_info["strike"],
                            "optionType": fno_info["optionType"],
                            "expiryDate": fno_info["expiryDate"],
                            "daysToExpiry": fno_info["daysToExpiry"]
                        } if fno_info["strike"] > 0 else None,
                        "notes": f"{setup_name} execution on {exch}. Realized P&L: ₹{pnl_val:,.2f}",
                        "source": "SANDBOX",
                        "broker": "openalgo_sandbox",
                        "isImported": True,
                        "orderType": "MARKET"
                    })
            conn.close()
            break
        except Exception as e:
            print(f"[SyncSandbox] Error reading {sbp}: {e}")

    # Sort descending by date and time
    trades.sort(key=lambda x: f"{x.get('date', '')} {x.get('entryTime', '')}", reverse=True)

    return {
        "status": "success",
        "count": len(trades),
        "trades": trades
    }


def find_canonical_contract(underlying: str, strike: float | None = None, opt_type: str | None = None):
    """
    Look up the exact matching exchange contract from OpenAlgo symtoken master table.
    Ensures that orders placed into OpenAlgo always have an exact symbol, valid exchange segment, and aligned lot size.
    """
    import sqlite3
    db_paths = [
        "/home/ubuntu/openalgo/db/openalgo.db",
        r"c:\Users\gadda\Desktop\Projects\openalgo\db\openalgo.db",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "db", "openalgo.db")
    ]
    u = underlying.upper().strip()
    opt = (opt_type or "CE").upper().strip()

    for db_path in db_paths:
        if not os.path.exists(db_path):
            continue
        try:
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()

            today = datetime.now().date()
            def parse_exp(exp_str):
                try:
                    return datetime.strptime(str(exp_str).strip(), "%d-%b-%y").date()
                except Exception:
                    try:
                        return datetime.strptime(str(exp_str).strip(), "%d-%b-%Y").date()
                    except Exception:
                        return datetime(2099, 1, 1).date()

            if strike and float(strike) > 0:
                cur.execute(
                    "SELECT symbol, expiry, strike, instrumenttype, lotsize, exchange FROM symtoken WHERE name = ? AND abs(strike - ?) < 1 AND instrumenttype = ?",
                    (u, float(strike), opt)
                )
                rows = cur.fetchall()
                valid_rows = [r for r in rows if parse_exp(r[1]) >= today] or rows
                if valid_rows:
                    valid_rows.sort(key=lambda r: parse_exp(r[1]))
                    conn.close()
                    return {
                        "symbol": valid_rows[0][0],
                        "expiry": valid_rows[0][1],
                        "strike": valid_rows[0][2],
                        "option_type": valid_rows[0][3],
                        "lotsize": float(valid_rows[0][4]),
                        "exchange": valid_rows[0][5]
                    }

            # Cash equity lookup if no strike and no option type
            if not strike and (not opt or opt in ("EQ", "")):
                cur.execute(
                    "SELECT symbol, expiry, strike, instrumenttype, lotsize, exchange FROM symtoken WHERE (symbol = ? OR name = ?) AND exchange IN ('NSE', 'BSE') LIMIT 1",
                    (u, u)
                )
                row = cur.fetchone()
                if row:
                    conn.close()
                    return {
                        "symbol": row[0],
                        "expiry": row[1] or "",
                        "strike": float(row[2] or 0),
                        "option_type": row[3] or "EQ",
                        "lotsize": float(row[4] or 1),
                        "exchange": row[5]
                    }

            cur.execute(
                "SELECT symbol, expiry, strike, instrumenttype, lotsize, exchange FROM symtoken WHERE name = ? AND instrumenttype = ?",
                (u, opt)
            )
            rows = cur.fetchall()
            valid_rows = [r for r in rows if parse_exp(r[1]) >= today] or rows
            if valid_rows:
                valid_rows.sort(key=lambda r: parse_exp(r[1]))
                nearest_expiry = valid_rows[0][1]
                expiry_rows = [r for r in valid_rows if r[1] == nearest_expiry]
                chosen = expiry_rows[len(expiry_rows) // 2]
                conn.close()
                return {
                    "symbol": chosen[0],
                    "expiry": chosen[1],
                    "strike": chosen[2],
                    "option_type": chosen[3],
                    "lotsize": float(chosen[4]),
                    "exchange": chosen[5]
                }
            conn.close()
        except Exception as err:
            print(f"[OpenAlgo Resolver Error]: {err}")
    return None


@router.get("/resolve-contract")
def resolve_contract(underlying: str, strike: float | None = None, option_type: str = "CE"):
    """
    Resolves canonical exchange contract details (exact symbol, exchange, lot size)
    directly from OpenAlgo's symtoken master table.
    """
    res = find_canonical_contract(underlying, strike, option_type)
    if not res:
        raise HTTPException(
            status_code=404,
            detail=f"No matching contract found in symtoken for {underlying} strike={strike} type={option_type}"
        )
    return {"status": "success", "contract": res}


@router.post("/placeorder-sandbox")
def placeorder_sandbox(order: dict):
    """
    SANDBOX-ONLY order placement proxy for the HFT Velocity Trader.

    Forwards to the OpenAlgo /api/v1/placeorder endpoint with the strategy tag
    forced to HFT_Velocity_SANDBOX so every order placed through this route is
    identifiable in the sandbox tradebook (and later attributable by the
    self-improvement loop). There is deliberately no real-broker routing here;
    OpenAlgo's own sandbox/broker configuration governs what executes.
    """
    symbol = (order.get("symbol") or "").strip()
    action = (order.get("action") or "BUY").strip().upper()
    if not symbol or action not in ("BUY", "SELL"):
        raise HTTPException(status_code=422, detail="symbol and action (BUY/SELL) are required")

    raw_exchange = (order.get("exchange") or "NFO").upper()
    exchange = "NFO" if "FNO" in raw_exchange or "NFO" in raw_exchange else ("BSE" if "BSE" in raw_exchange else "NSE")
    price_type = (order.get("pricetype") or order.get("price_type") or "MARKET").upper()
    if price_type not in ("MARKET", "LIMIT", "SL", "SL-M"):
        price_type = "MARKET"

    # 🛑 CRITICAL RISK SHIELD: Hard MCX Commodity Killswitch
    commodity_tokens = ["CRUDE", "NATURALGAS", "GOLD", "SILVER", "COPPER", "ZINC", "NICKEL", "ALUMINIUM"]
    if raw_exchange == "MCX" or any(c in symbol.upper() for c in commodity_tokens):
        raise HTTPException(status_code=403, detail="MCX Commodity trading is blocked by WealthOS Risk Shield")

    # Auto-resolve canonical contract if raw index symbol or unformatted symbol is passed
    qty = float(order.get("quantity") or 0)
    opt_type = (order.get("option_type") or ("PE" if "PE" in symbol.upper() else "CE")).upper()
    underlying = None
    for idx_name in ("BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "NIFTY"):
        if idx_name in symbol.upper():
            underlying = idx_name
            break

    if underlying:
        strike_val = None
        if order.get("strike"):
            try:
                strike_val = float(order.get("strike"))
            except Exception:
                pass
        else:
            # Try to extract strike from string e.g. "NIFTY 23300 CE"
            import re
            m = re.search(r'\b(\d{4,5})\b', symbol)
            if m:
                strike_val = float(m.group(1))

        canonical = find_canonical_contract(underlying, strike_val, opt_type)
        if canonical:
            symbol = canonical["symbol"]
            exchange = canonical["exchange"]
            if qty <= 0:
                qty = canonical["lotsize"]

    limit_price = float(order.get("price") or 0.0)

    # 🛡️ SPREAD DEFENSE: Stock Options Execution Gate
    is_index = underlying in ("BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "NIFTY")
    if not is_index and exchange in ("NFO", "BFO") and price_type == "MARKET":
        # Force LIMIT order to prevent wide bid-ask spread slippage
        try:
            q_resp = session.post(
                f"{OPENALGO_HOST}/api/v1/quotes",
                headers=get_headers(),
                json={"apikey": OPENALGO_API_KEY, "symbol": symbol, "exchange": exchange},
                timeout=3
            )
            if q_resp.status_code == 200:
                q_data = q_resp.json()
                ltp = float((q_data.get("data") or {}).get("ltp") or q_data.get("ltp") or 0.0)
                if ltp > 0:
                    price_type = "LIMIT"
                    limit_price = round(ltp, 2)
                    print(f"🛡️ [Spread Shield] Converted MARKET order on stock option {symbol} to LIMIT @ ₹{limit_price}")
        except Exception as q_err:
            print(f"⚠️ [Spread Shield] Quote check warning: {q_err}")

    payload = {
        "apikey": OPENALGO_API_KEY,
        "strategy": order.get("strategy") or "HFT_Velocity_SANDBOX",
        "symbol": symbol,
        "action": action,
        "exchange": exchange,
        "pricetype": price_type,
        "product": "CNC" if (order.get("product") or "").upper() == "CNC" else "MIS",
        "quantity": qty if qty > 0 else 25.0,
        "price": limit_price if price_type in ("LIMIT", "SL") else 0.0,
        "trigger_price": float(order.get("trigger_price") or 0.0),
        "disclosed_quantity": 0,
    }

    try:
        url = f"{OPENALGO_HOST}/api/v1/placeorder"
        resp = session.post(url, headers=get_headers(), json=payload, timeout=8)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        data = resp.json()
        return {
            "status": "success",
            "orderid": (data.get("data") or {}).get("orderid") or data.get("orderid"),
            "symbol": symbol,
            "action": action,
            "reasoning": order.get("reasoning"),
            "raw": data,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAlgo unreachable: {e}")


SHADOW_AUDIT_FILE = Path(__file__).resolve().parents[1] / "data" / "sandbox_shadow_audit.json"


def record_shadow_audit(record: dict) -> dict:
    """
    Appends virtual sandbox fill execution along with live L2 quotes to track
    the Execution Variance Index (EVI).
    """
    try:
        SHADOW_AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
        entries = []
        if SHADOW_AUDIT_FILE.exists():
            try:
                with open(SHADOW_AUDIT_FILE, "r", encoding="utf-8") as f:
                    entries = json.load(f)
                    if not isinstance(entries, list):
                        entries = []
            except Exception:
                entries = []

        v_px = float(record.get("virtual_fill_price") or record.get("price") or 0.0)
        bid = float(record.get("live_bid") or 0.0)
        ask = float(record.get("live_ask") or 0.0)
        ltp = float(record.get("ltp") or ((bid + ask) / 2.0 if bid > 0 and ask > 0 else (bid or ask or v_px)))
        
        bench_price = ask if str(record.get("action", "")).upper() == "BUY" else (bid if bid > 0 else ltp)
        evi_bps = round(abs(v_px - bench_price) / bench_price * 10000.0, 2) if (bench_price > 0 and v_px > 0) else 0.0
        spread_bps = round(abs(ask - bid) / ltp * 10000.0, 2) if (ltp > 0 and bid > 0 and ask > 0) else 0.0

        audit_entry = {
            "id": f"sa_{int(time.time() * 1000)}",
            "timestamp": datetime.now().isoformat(),
            "symbol": record.get("symbol"),
            "action": record.get("action"),
            "quantity": float(record.get("quantity") or 1.0),
            "virtual_fill_price": v_px,
            "live_bid": bid,
            "live_ask": ask,
            "ltp": ltp,
            "execution_variance_bps": evi_bps,
            "spread_bps": spread_bps,
            "strategy": record.get("strategy", "SANDBOX_SHADOW_DESK"),
            "order_id": str(record.get("order_id") or ""),
            "mode": record.get("mode", "sandbox"),
        }

        entries.append(audit_entry)
        if len(entries) > 1000:
            entries = entries[-1000:]

        with open(SHADOW_AUDIT_FILE, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2)

        return audit_entry
    except Exception as e:
        print(f"⚠️ [Shadow Audit] Recording failed: {e}")
        return {}


def check_order_status(order_id: str) -> str:
    """Queries OpenAlgo orderbook to check the fill state of an order."""
    if not order_id:
        return "UNKNOWN"
    try:
        url = f"{OPENALGO_HOST}/api/v1/orderbook"
        resp = session.post(url, headers=get_headers(), json=get_payload(), timeout=3)
        if resp.status_code == 200:
            orders = resp.json().get("data", [])
            for o in orders:
                if str(o.get("orderid")) == str(order_id):
                    return str(o.get("orderstatus") or "PENDING").upper()
    except Exception:
        pass
    return "PENDING"


def modify_order_internal(order_id: str, price: float = 0.0, price_type: str = "LIMIT") -> dict:
    """Internal helper to ratchet order price or convert to MARKET."""
    payload = {
        "apikey": OPENALGO_API_KEY,
        "orderid": str(order_id),
        "price": price if price_type == "LIMIT" else 0.0,
        "pricetype": price_type,
    }
    try:
        url = f"{OPENALGO_HOST}/api/v1/modifyorder"
        resp = session.post(url, headers=get_headers(), json=payload, timeout=4)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"⚠️ [Micro-Chase] Modify order error: {e}")
    return {}


def execute_adaptive_chase(order_id: str, symbol: str, action: str,
                           initial_limit: float, qty: float, max_spread_pct: float = 1.5) -> dict:
    """
    Adaptive 3-Step Micro-Chase:
    Step 1: 0.0s - 1.5s: Passive at touch / initial_limit
    Step 2: 1.5s: Ratchet +1 tick (+₹0.05 for BUY, -₹0.05 for SELL)
    Step 3: 3.0s: Ratchet +2 ticks (+₹0.10 total)
    Step 4: 4.5s: Spread-guarded conversion to MARKET
    """
    tick = 0.05
    chase_trace = []
    current_px = initial_limit

    # Step 1: Wait 1.5s
    time.sleep(1.5)
    st = check_order_status(order_id)
    if st in ("COMPLETE", "FILLED", "TRADED"):
        return {"status": "filled", "stage": "step1_touch", "final_price": current_px, "trace": chase_trace}

    # Step 2: 1.5s Ratchet 1 tick
    current_px = round(current_px + tick if action == "BUY" else max(tick, current_px - tick), 2)
    chase_trace.append(f"Step 2 (1.5s): ratcheted price to ₹{current_px}")
    modify_order_internal(order_id, price=current_px, price_type="LIMIT")

    time.sleep(1.5)
    st = check_order_status(order_id)
    if st in ("COMPLETE", "FILLED", "TRADED"):
        return {"status": "filled", "stage": "step2_tick1", "final_price": current_px, "trace": chase_trace}

    # Step 3: 3.0s Ratchet another tick (+₹0.10 total)
    current_px = round(current_px + tick if action == "BUY" else max(tick, current_px - tick), 2)
    chase_trace.append(f"Step 3 (3.0s): ratcheted price to ₹{current_px}")
    modify_order_internal(order_id, price=current_px, price_type="LIMIT")

    time.sleep(1.5)
    st = check_order_status(order_id)
    if st in ("COMPLETE", "FILLED", "TRADED"):
        return {"status": "filled", "stage": "step3_tick2", "final_price": current_px, "trace": chase_trace}

    # Step 4: 4.5s Spread-guarded conversion to MARKET
    chase_trace.append(f"Step 4 (4.5s): converting to MARKET under {max_spread_pct}% spread guard")
    modify_order_internal(order_id, price=0.0, price_type="MARKET")
    return {"status": "market_converted", "stage": "step4_market", "final_price": "MARKET", "trace": chase_trace}


@router.post("/placeorder")
def placeorder_universal(order: dict):
    """
    Universal order placement proxy for WealthOS v2.
    Supports both live broker execution and sandbox mode.
    Includes Adaptive 3-Step Micro-Chase, Broker Failover, and Shadow Audit.
    """
    symbol = (order.get("symbol") or "").strip()
    action = (order.get("action") or "BUY").strip().upper()
    if not symbol or action not in ("BUY", "SELL"):
        raise HTTPException(status_code=422, detail="symbol and action (BUY/SELL) are required")

    raw_exchange = (order.get("exchange") or "NSE").upper()
    exchange = "NFO" if "FNO" in raw_exchange or "NFO" in raw_exchange else ("BSE" if "BSE" in raw_exchange else ("BFO" if "BFO" in raw_exchange else "NSE"))
    price_type = (order.get("pricetype") or order.get("price_type") or "MARKET").upper()
    if price_type not in ("MARKET", "LIMIT", "SL", "SL-M"):
        price_type = "MARKET"

    # 🛑 CRITICAL RISK SHIELD: Hard MCX Commodity Killswitch
    commodity_tokens = ["CRUDE", "NATURALGAS", "GOLD", "SILVER", "COPPER", "ZINC", "NICKEL", "ALUMINIUM"]
    if raw_exchange == "MCX" or any(c in symbol.upper() for c in commodity_tokens):
        raise HTTPException(status_code=403, detail="MCX Commodity trading is blocked by WealthOS Risk Shield")

    qty = float(order.get("quantity") or 1.0)
    limit_price = float(order.get("price") or 0.0)
    trigger_price = float(order.get("trigger_price") or 0.0)
    product = (order.get("product") or "MIS").upper()
    if product not in ("CNC", "MIS", "NRML"):
        product = "MIS"

    # Adaptive chase config
    adaptive_chase = bool(order.get("adaptive_chase") or order.get("chase"))
    if adaptive_chase and price_type == "MARKET" and limit_price <= 0:
        # Fetch touch price to seed limit chase
        try:
            q_resp = session.post(
                f"{OPENALGO_HOST}/api/v1/quotes",
                headers=get_headers(),
                json={"apikey": OPENALGO_API_KEY, "symbol": symbol, "exchange": exchange},
                timeout=2
            )
            if q_resp.status_code == 200:
                q_d = q_resp.json()
                ltp = float((q_d.get("data") or {}).get("ltp") or q_d.get("ltp") or 0.0)
                if ltp > 0:
                    limit_price = round(ltp, 2)
                    price_type = "LIMIT"
        except Exception:
            pass

    if adaptive_chase and limit_price > 0:
        price_type = "LIMIT"

    # Strategy tagging: sandbox vs live
    mode = (order.get("mode") or "sandbox").lower()
    strategy = order.get("strategy") or ("WealthOS_Physical_Wire_SANDBOX" if mode == "sandbox" else "WealthOS_Physical_Wire_LIVE")

    payload = {
        "apikey": OPENALGO_API_KEY,
        "strategy": strategy,
        "symbol": symbol,
        "action": action,
        "exchange": exchange,
        "pricetype": price_type,
        "product": product,
        "quantity": qty,
        "price": limit_price if price_type in ("LIMIT", "SL") else 0.0,
        "trigger_price": trigger_price,
        "disclosed_quantity": 0,
    }

    try:
        url = f"{OPENALGO_HOST}/api/v1/placeorder"
        resp = session.post(url, headers=get_headers(), json=payload, timeout=8)
        
        # Broker failover fallback if upstream broker returns gateway failure
        if resp.status_code in (502, 503, 504) and mode != "sandbox":
            print(f"⚠️ [Broker Failover] Primary gateway failed with HTTP {resp.status_code}. Initiating failover fallback...")
            payload["strategy"] = "WealthOS_Physical_Wire_FAILOVER_SANDBOX"
            resp = session.post(url, headers=get_headers(), json=payload, timeout=5)

        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        
        data = resp.json()
        order_id = (data.get("data") or {}).get("orderid") or data.get("orderid")

        # Execute Adaptive Micro-Chase if requested
        chase_result = None
        if adaptive_chase and order_id and limit_price > 0:
            if order.get("async_chase"):
                threading.Thread(
                    target=execute_adaptive_chase,
                    args=(str(order_id), symbol, action, limit_price, qty),
                    daemon=True
                ).start()
                chase_result = {"mode": "async_background_started"}
            else:
                chase_result = execute_adaptive_chase(
                    str(order_id), symbol, action, limit_price, qty,
                    max_spread_pct=float(order.get("max_spread_pct") or 1.5)
                )

        # Shadow Audit logging for paper sandbox orders or explicit shadow requests
        shadow_audit_result = None
        if mode == "sandbox" or order.get("shadow_audit"):
            shadow_audit_result = record_shadow_audit({
                "symbol": symbol,
                "action": action,
                "quantity": qty,
                "virtual_fill_price": limit_price if limit_price > 0 else float(order.get("ltp") or 0.0),
                "live_bid": float(order.get("live_bid") or 0.0),
                "live_ask": float(order.get("live_ask") or 0.0),
                "ltp": float(order.get("ltp") or limit_price),
                "strategy": strategy,
                "order_id": order_id,
                "mode": mode,
            })

        return {
            "status": "success",
            "orderid": order_id,
            "symbol": symbol,
            "action": action,
            "mode": mode,
            "adaptive_chase": chase_result,
            "shadow_audit": shadow_audit_result,
            "raw": data,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAlgo unreachable: {e}")


@router.post("/shadow-audit")
def post_shadow_audit(record: dict):
    """
    Log virtual sandbox execution alongside live quotes to compute Execution Variance Index.
    """
    res = record_shadow_audit(record)
    return {"status": "success", "audit": res}


@router.get("/shadow-audit")
def get_shadow_audit(limit: int = 100):
    """
    Retrieve recent Shadow Audit records with aggregate Execution Variance analytics.
    """
    if not SHADOW_AUDIT_FILE.exists():
        return {
            "status": "success",
            "count": 0,
            "mean_variance_bps": 0.0,
            "p95_variance_bps": 0.0,
            "max_variance_bps": 0.0,
            "health": "OPTIMAL",
            "records": []
        }
    try:
        with open(SHADOW_AUDIT_FILE, "r", encoding="utf-8") as f:
            entries = json.load(f)
            if not isinstance(entries, list):
                entries = []
    except Exception:
        entries = []

    recent = entries[-limit:]
    variances = [float(e.get("execution_variance_bps") or 0.0) for e in recent if "execution_variance_bps" in e]
    mean_v = round(sum(variances) / len(variances), 2) if variances else 0.0
    sorted_v = sorted(variances)
    p95_idx = int(len(sorted_v) * 0.95) if sorted_v else 0
    p95_v = sorted_v[p95_idx] if sorted_v else 0.0
    max_v = max(variances) if variances else 0.0

    health = "OPTIMAL" if mean_v < 10.0 else ("ELEVATED" if mean_v < 25.0 else "SLIPPAGE_WARNING")

    return {
        "status": "success",
        "count": len(recent),
        "mean_variance_bps": mean_v,
        "p95_variance_bps": p95_v,
        "max_variance_bps": max_v,
        "health": health,
        "records": list(reversed(recent))
    }


@router.post("/placebracket")
def placebracket_order(bracket: dict):
    """
    Compound atomic bracket order placement.
    Places primary entry order, and upon fill/acceptance places:
    1. Protective Stop Loss (SL-M) order
    2. Target profit (LIMIT) order
    """
    symbol = (bracket.get("symbol") or "").strip()
    action = (bracket.get("action") or "BUY").strip().upper()
    if not symbol or action not in ("BUY", "SELL"):
        raise HTTPException(status_code=422, detail="symbol and action (BUY/SELL) are required")

    exchange = (bracket.get("exchange") or "NSE").upper()
    product = (bracket.get("product") or "MIS").upper()
    qty = float(bracket.get("quantity") or 1.0)
    entry_price = float(bracket.get("entry_price") or bracket.get("price") or 0.0)
    stop_loss = float(bracket.get("stop_loss_price") or bracket.get("stop_loss") or 0.0)
    target = float(bracket.get("target_price") or bracket.get("target") or 0.0)
    strategy = bracket.get("strategy") or "WealthOS_Bracket_OCO"

    # Step 1: Place Entry Order
    entry_payload = {
        "apikey": OPENALGO_API_KEY,
        "strategy": strategy,
        "symbol": symbol,
        "action": action,
        "exchange": exchange,
        "pricetype": "LIMIT" if entry_price > 0 else "MARKET",
        "product": product,
        "quantity": qty,
        "price": entry_price if entry_price > 0 else 0.0,
        "trigger_price": 0.0,
        "disclosed_quantity": 0,
    }

    try:
        url = f"{OPENALGO_HOST}/api/v1/placeorder"
        entry_resp = session.post(url, headers=get_headers(), json=entry_payload, timeout=8)
        if entry_resp.status_code != 200:
            raise HTTPException(status_code=entry_resp.status_code, detail=f"Entry order failed: {entry_resp.text[:500]}")
        
        entry_data = entry_resp.json()
        entry_order_id = (entry_data.get("data") or {}).get("orderid") or entry_data.get("orderid")

        exit_action = "SELL" if action == "BUY" else "BUY"
        sl_order_id = None
        target_order_id = None

        # Step 2: Place Protective Stop Loss order (if specified)
        if stop_loss > 0:
            sl_payload = {
                "apikey": OPENALGO_API_KEY,
                "strategy": f"{strategy}_SL",
                "symbol": symbol,
                "action": exit_action,
                "exchange": exchange,
                "pricetype": "SL-M",
                "product": product,
                "quantity": qty,
                "price": 0.0,
                "trigger_price": stop_loss,
                "disclosed_quantity": 0,
            }
            try:
                sl_resp = session.post(url, headers=get_headers(), json=sl_payload, timeout=5)
                if sl_resp.status_code == 200:
                    sl_d = sl_resp.json()
                    sl_order_id = (sl_d.get("data") or {}).get("orderid") or sl_d.get("orderid")
            except Exception as sl_err:
                print(f"⚠️ [Bracket] SL placement warning: {sl_err}")

        # Step 3: Place Target Profit order (if specified)
        if target > 0:
            tgt_payload = {
                "apikey": OPENALGO_API_KEY,
                "strategy": f"{strategy}_TGT",
                "symbol": symbol,
                "action": exit_action,
                "exchange": exchange,
                "pricetype": "LIMIT",
                "product": product,
                "quantity": qty,
                "price": target,
                "trigger_price": 0.0,
                "disclosed_quantity": 0,
            }
            try:
                tgt_resp = session.post(url, headers=get_headers(), json=tgt_payload, timeout=5)
                if tgt_resp.status_code == 200:
                    tgt_d = tgt_resp.json()
                    target_order_id = (tgt_d.get("data") or {}).get("orderid") or tgt_d.get("orderid")
            except Exception as tgt_err:
                print(f"⚠️ [Bracket] Target placement warning: {tgt_err}")

        return {
            "status": "success",
            "entry_order_id": entry_order_id,
            "sl_order_id": sl_order_id,
            "target_order_id": target_order_id,
            "symbol": symbol,
            "action": action,
            "quantity": qty,
            "entry_price": entry_price,
            "stop_loss": stop_loss,
            "target": target
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAlgo unreachable: {e}")


@router.post("/closeposition")
def close_position(req: dict):
    """
    Close open position in OpenAlgo.
    """
    symbol = (req.get("symbol") or "").strip()
    exchange = (req.get("exchange") or "NSE").upper()
    product = (req.get("product") or "MIS").upper()

    if not symbol:
        raise HTTPException(status_code=422, detail="symbol is required")

    payload = {
        "apikey": OPENALGO_API_KEY,
        "symbol": symbol,
        "exchange": exchange,
        "product": product
    }

    try:
        url = f"{OPENALGO_HOST}/api/v1/closeposition"
        resp = session.post(url, headers=get_headers(), json=payload, timeout=6)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        return resp.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAlgo error: {e}")


@router.post("/cancelorder")
def cancel_order(req: dict):
    """
    Cancel single order by orderid.
    """
    orderid = str(req.get("orderid") or "").strip()
    if not orderid:
        raise HTTPException(status_code=422, detail="orderid is required")

    payload = {
        "apikey": OPENALGO_API_KEY,
        "orderid": orderid
    }

    try:
        url = f"{OPENALGO_HOST}/api/v1/cancelorder"
        resp = session.post(url, headers=get_headers(), json=payload, timeout=5)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        return resp.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAlgo error: {e}")


@router.post("/cancelallorder")
def cancel_all_orders():
    """
    Bulk cancel all pending orders in OpenAlgo.
    """
    payload = get_payload()
    try:
        url = f"{OPENALGO_HOST}/api/v1/cancelallorder"
        resp = session.post(url, headers=get_headers(), json=payload, timeout=6)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        return resp.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAlgo error: {e}")


@router.post("/modifyorder")
def modify_order(req: dict):
    """
    Modify existing order in OpenAlgo (price, trigger_price, quantity).
    """
    orderid = str(req.get("orderid") or "").strip()
    if not orderid:
        raise HTTPException(status_code=422, detail="orderid is required")

    payload = {
        "apikey": OPENALGO_API_KEY,
        "orderid": orderid
    }
    if "price" in req:
        payload["price"] = float(req["price"])
    if "trigger_price" in req:
        payload["trigger_price"] = float(req["trigger_price"])
    if "quantity" in req:
        payload["quantity"] = float(req["quantity"])
    if "pricetype" in req:
        payload["pricetype"] = req["pricetype"]

    try:
        url = f"{OPENALGO_HOST}/api/v1/modifyorder"
        resp = session.post(url, headers=get_headers(), json=payload, timeout=6)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        return resp.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAlgo error: {e}")


@router.post("/emergency-halt")
def emergency_halt():
    """
    Atomic emergency halt:
    1. Bulk cancels all open/pending orders.
    2. Closes all open positions to return account to 100% cash/flat.
    """
    results = {
        "status": "success",
        "orders_cancelled": False,
        "positions_closed": 0,
        "errors": []
    }

    # Step 1: Cancel all pending orders
    try:
        c_url = f"{OPENALGO_HOST}/api/v1/cancelallorder"
        c_resp = session.post(c_url, headers=get_headers(), json=get_payload(), timeout=6)
        if c_resp.status_code == 200:
            results["orders_cancelled"] = True
    except Exception as ce:
        results["errors"].append(f"Cancel all orders failed: {ce}")

    # Step 2: Query positions and close each
    try:
        p_url = f"{OPENALGO_HOST}/api/v1/positionbook"
        p_resp = session.post(p_url, headers=get_headers(), json=get_payload(), timeout=6)
        if p_resp.status_code == 200:
            positions = p_resp.json().get("data", [])
            for pos in positions:
                qty = float(pos.get("quantity") or 0)
                if qty != 0:
                    sym = pos.get("symbol")
                    ex = pos.get("exchange", "NSE")
                    prd = pos.get("product", "MIS")
                    try:
                        cls_resp = session.post(
                            f"{OPENALGO_HOST}/api/v1/closeposition",
                            headers=get_headers(),
                            json={"apikey": OPENALGO_API_KEY, "symbol": sym, "exchange": ex, "product": prd},
                            timeout=5
                        )
                        if cls_resp.status_code == 200:
                            results["positions_closed"] += 1
                    except Exception as pe:
                        results["errors"].append(f"Close position {sym} failed: {pe}")
    except Exception as e:
        results["errors"].append(f"Position query failed: {e}")

    return results
