import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import os
import tempfile

# Isolated SQLite DB for tests
_tmpdir = tempfile.mkdtemp()
os.environ["BHAVCOPY_DB_PATH"] = os.path.join(_tmpdir, "test_bhav.db")

import pytest  # noqa: E402

from services.bhavcopy_surveillance_sieve import (  # noqa: E402
    init_schema, ingest_nse_bhavcopy, ingest_bse_bhavcopy, ingest_price_bands,
    ingest_mwpl_ban_list, ingest_surveillance_list, ingest_settlement_prices,
    get_blacklisted_symbols, is_blacklisted, get_price_band, spot_cushion,
    get_settlement_price, audit_tradebook_fills, run_eod_pipeline,
)

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "bhavcopy")


def test_schema_creates_tables():
    init_schema()
    import sqlite3
    conn = sqlite3.connect(os.environ["BHAVCOPY_DB_PATH"])
    tabs = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    conn.close()
    assert "bhavcopy_eod" in tabs
    assert "surveillance_blacklist" in tabs
    assert "mwpl_ban_list" in tabs
    assert "settlement_prices" in tabs
    assert "eod_reconciliation_results" in tabs


def test_nse_ingestion():
    r = ingest_nse_bhavcopy(os.path.join(FIX, "nse_bhavcopy.csv"), trade_date="2026-10-16")
    assert r.status == "success"
    assert r.rows == 3
    import sqlite3
    conn = sqlite3.connect(os.environ["BHAVCOPY_DB_PATH"])
    rows = conn.execute("SELECT symbol, close_price FROM bhavcopy_eod WHERE exchange='NSE'").fetchall()
    conn.close()
    syms = {r[0] for r in rows}
    assert {"RELIANCE", "TCS", "INFY"} <= syms


def test_bse_ingestion():
    r = ingest_bse_bhavcopy(os.path.join(FIX, "bse_bhavcopy.csv"), trade_date="2026-10-16")
    assert r.status == "success"
    assert r.rows == 2


def test_price_bands_and_cushion():
    r = ingest_price_bands(os.path.join(FIX, "price_bands.csv"), trade_date="2026-10-16")
    assert r.status == "success"
    assert r.rows == 3
    band = get_price_band("RELIANCE", trade_date="2026-10-16")
    assert band is not None
    assert float(band["band_pct"]) == 5.0
    c = spot_cushion("RELIANCE", spot_price=1418.0, trade_date="2026-10-16")
    assert c["band_pct"] == 5.0
    assert c["upper_circuit"] is not None
    assert c["pinned_risk"] in (True, False)


def test_mwpl_ban():
    r = ingest_mwpl_ban_list(os.path.join(FIX, "mwpl.csv"), trade_date="2026-10-16")
    assert r.status == "success"
    assert r.rows == 2
    import sqlite3
    conn = sqlite3.connect(os.environ["BHAVCOPY_DB_PATH"])
    row = conn.execute("SELECT banned FROM mwpl_ban_list WHERE symbol='RELIANCE'").fetchone()
    conn.close()
    assert row[0] == 1  # 96% >= 95


def test_surveillance_blacklist():
    ingest_surveillance_list(os.path.join(FIX, "asm.csv"), measure_type="ASM", trade_date="2026-10-16")
    ingest_surveillance_list(os.path.join(FIX, "gsm.csv"), measure_type="GSM", trade_date="2026-10-16")
    ingest_surveillance_list(os.path.join(FIX, "t2t.csv"), trade_date="2026-10-16")
    bl = get_blacklisted_symbols()
    assert "XYZ" in bl
    assert "ABC" in bl
    assert "PQR" in bl
    assert "BELOW" in bl
    assert "TRADE2T" in bl
    assert is_blacklisted("xyz") is True
    assert is_blacklisted("RELIANCE") is False


def test_settlement_and_reconciliation():
    ingest_settlement_prices(os.path.join(FIX, "settlement.csv"), trade_date="2026-10-16")
    sp = get_settlement_price("RELIANCE", trade_date="2026-10-16")
    assert sp == 1419.5
    fills = [
        {"fill_id": "F1", "symbol": "RELIANCE", "side": "BUY", "quantity": 10, "fill_price": 1418.0,
         "actual_charges": 100.0, "trigger_price": 1418.0},
        {"fill_id": "F2", "symbol": "INFY", "side": "BUY", "quantity": 5, "fill_price": 4030.0},
    ]
    rep = audit_tradebook_fills(fills, trade_date="2026-10-16")
    assert rep.fills_audited == 2
    assert rep.run_id
    # First fill has settlement price; second has no settlement price -> flagged
    r2 = [r for r in rep.results if r["fill_id"] == "F2"][0]
    assert "NO_SETTLEMENT_PRICE" in r2["flags"]


def test_run_eod_pipeline():
    summary = run_eod_pipeline(trade_date="2026-10-16", inputs={
        "nse_bhavcopy": os.path.join(FIX, "nse_bhavcopy.csv"),
        "fills": [{"fill_id": "F3", "symbol": "RELIANCE", "side": "BUY", "quantity": 1, "fill_price": 1418.0}],
    })
    assert "nse_bhavcopy" in summary["results"]
    assert "reconciliation" in summary


def test_dataframe_input():
    import pandas as pd
    df = pd.read_csv(os.path.join(FIX, "nse_bhavcopy.csv"))
    r = ingest_nse_bhavcopy(df, trade_date="2026-10-16")
    assert r.status == "success"
    assert r.rows == 3