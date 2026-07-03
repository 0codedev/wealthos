"""CC53: bootstrap test for the MF NAV tables helper."""
import sqlite3


def test_ensure_mf_tables_creates_four_tables():
    """_ensure_mf_tables must create mf_nav_history, mf_nav_latest, mf_refresh_state, mf_realized_txns."""
    from db_stabilized import _ensure_mf_tables
    conn = sqlite3.connect(":memory:")
    _ensure_mf_tables(conn)
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mf_%'"
    ).fetchall()}
    assert tables == {"mf_nav_history", "mf_nav_latest", "mf_refresh_state", "mf_realized_txns"}
    # composite PK on history (scheme_code, date)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(mf_nav_history)").fetchall()}
    assert {"scheme_code", "date", "nav", "fetched_at"}.issubset(cols)
    conn.close()


def test_ensure_mf_tables_is_idempotent():
    """Calling _ensure_mf_tables twice must not raise."""
    from db_stabilized import _ensure_mf_tables
    conn = sqlite3.connect(":memory:")
    _ensure_mf_tables(conn)
    _ensure_mf_tables(conn)  # second call should be a no-op
    count = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'mf_%'"
    ).fetchone()[0]
    assert count == 4
    conn.close()
