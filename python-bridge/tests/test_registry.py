import unittest
import os
import sys
from datetime import datetime, timedelta

# Ensure python-bridge folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from services.capability_registry import record_capability, get_capability, should_retry, get_all_capabilities
from services.instrument_registry import resolve_symbol, get_sync_status, sync_instrument_registry

import tempfile

class TestRegistryAndCapabilities(unittest.TestCase):
    def setUp(self):
        # Override DB file to a temporary one for testing
        self.original_db_file = db.DB_FILE
        self.temp_db_fd, self.temp_db_path = tempfile.mkstemp(suffix=".db")
        db.DB_FILE = self.temp_db_path
        db.init_db()

    def tearDown(self):
        db.DB_FILE = self.original_db_file
        os.close(self.temp_db_fd)
        try:
            os.remove(self.temp_db_path)
            for suffix in ("-wal", "-shm", "-journal"):
                if os.path.exists(self.temp_db_path + suffix):
                    os.remove(self.temp_db_path + suffix)
        except OSError:
            pass

    def test_record_and_get_capability(self):
        record_capability("upstox", "quotes", "analytics", "available", "All operational")
        cap = get_capability("upstox", "quotes")
        
        self.assertEqual(cap["provider"], "upstox")
        self.assertEqual(cap["capability"], "quotes")
        self.assertEqual(cap["auth_mode"], "analytics")
        self.assertEqual(cap["state"], "available")
        self.assertEqual(cap["needs_reauth"], False)

    def test_capability_staleness_flag(self):
        # Insert capability withchecked_at older than 24 hours
        old_time = (datetime.now() - timedelta(hours=25)).isoformat()
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO provider_capabilities (provider, capability, auth_mode, state, checked_at, diagnostic)
            VALUES (?, ?, ?, ?, ?, ?)
        """, ("upstox", "quotes", "analytics", "available", old_time, "Old check"))
        conn.commit()
        conn.close()

        cap = get_capability("upstox", "quotes")
        self.assertEqual(cap["needs_reauth"], True)
        self.assertIn("Session is old", cap["diagnostic"])

    def test_capability_should_retry(self):
        # Available should retry
        record_capability("upstox", "quotes", "analytics", "available")
        self.assertTrue(should_retry("upstox", "quotes"))

        # Unavailable within 1 hour should NOT retry
        recent_time = (datetime.now() - timedelta(minutes=10)).isoformat()
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO provider_capabilities (provider, capability, auth_mode, state, checked_at, diagnostic)
            VALUES (?, ?, ?, ?, ?, ?)
        """, ("upstox", "quotes", "analytics", "unavailable", recent_time, "Service dead"))
        conn.commit()
        conn.close()

        self.assertFalse(should_retry("upstox", "quotes"))

        # Unavailable after 1 hour SHOULD retry
        old_time = (datetime.now() - timedelta(minutes=61)).isoformat()
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO provider_capabilities (provider, capability, auth_mode, state, checked_at, diagnostic)
            VALUES (?, ?, ?, ?, ?, ?)
        """, ("upstox", "quotes", "analytics", "unavailable", old_time, "Service dead"))
        conn.commit()
        conn.close()

        self.assertTrue(should_retry("upstox", "quotes"))

    def test_get_all_capabilities(self):
        record_capability("upstox", "quotes", "analytics", "available")
        all_caps = get_all_capabilities()
        
        # Ensure we have default set populated
        self.assertGreaterEqual(len(all_caps), 12)
        
        upstox_quotes = next((c for c in all_caps if c["provider"] == "upstox" and c["capability"] == "quotes"), None)
        self.assertIsNotNone(upstox_quotes)
        self.assertEqual(upstox_quotes["state"], "available")

    def test_resolve_predefined_indices(self):
        nifty = resolve_symbol("NIFTY 50")
        self.assertEqual(nifty["canonical_id"], "NSE:NIFTY_50")
        self.assertEqual(nifty["yahoo_ticker"], "^NSEI")
        self.assertEqual(nifty["upstox_key"], "NSE_INDEX|Nifty 50")

        banknifty = resolve_symbol("NIFTY BANK")
        self.assertEqual(banknifty["canonical_id"], "NSE:NIFTY_BANK")
        self.assertEqual(banknifty["yahoo_ticker"], "^NSEBANK")

    def test_resolve_fallback(self):
        unknown = resolve_symbol("MOCKSYMBOL")
        self.assertEqual(unknown["canonical_id"], "NSE:MOCKSYMBOL")
        self.assertEqual(unknown["yahoo_ticker"], "MOCKSYMBOL.NS")
        self.assertEqual(unknown["supported_providers"], "yahoo")

if __name__ == "__main__":
    unittest.main()
