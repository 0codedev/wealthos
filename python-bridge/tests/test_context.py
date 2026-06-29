import unittest
import os
import sys
import tempfile
import json
from datetime import datetime

# Ensure python-bridge root is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from services.credential_store import SecureCredentialStore
from services.market_context import build_market_context, is_market_hours

class TestMarketContext(unittest.TestCase):
    def setUp(self):
        # Override DB_FILE in db to use a temp memory DB or isolated file
        self.db_fd, self.db_path = tempfile.mkstemp()
        db.DB_FILE = self.db_path
        db.init_db()

    def tearDown(self):
        os.close(self.db_fd)
        try:
            os.unlink(self.db_path)
        except OSError:
            pass

    def test_credential_store_fallback(self):
        # Ensure fallback to environment variable works
        os.environ["DHAN_CLIENT_ID"] = "test_client_id"
        val = SecureCredentialStore.get_credential("dhan_client_id")
        self.assertEqual(val, "test_client_id")
        
        # Test setting/deleting
        SecureCredentialStore.set_credential("temp_key", "temp_value")
        self.assertEqual(SecureCredentialStore.get_credential("temp_key"), "temp_value")
        SecureCredentialStore.delete_credential("temp_key")
        self.assertIsNone(SecureCredentialStore.get_credential("temp_key"))

    def test_market_hours_checker(self):
        # We can't guarantee current time, but let's assert it runs and returns bool
        hours = is_market_hours()
        self.assertIsInstance(hours, bool)

    def test_discrepancy_logging(self):
        # Log a dummy discrepancy
        db.log_discrepancy("NSE:RELIANCE", "ltp", 2500.0, 2520.0, 0.008)
        discrepancies = db.get_active_discrepancies()
        self.assertEqual(len(discrepancies), 1)
        self.assertEqual(discrepancies[0]["canonical_id"], "NSE:RELIANCE")
        self.assertEqual(discrepancies[0]["field"], "ltp")
        self.assertEqual(discrepancies[0]["upstox_val"], 2500.0)
        self.assertEqual(discrepancies[0]["dhan_val"], 2520.0)
        self.assertEqual(discrepancies[0]["delta"], 0.008)
        self.assertEqual(discrepancies[0]["resolved"], 0)

        # Resolve discrepancy
        db.resolve_discrepancy("NSE:RELIANCE", "ltp")
        discrepancies_after = db.get_active_discrepancies()
        self.assertEqual(len(discrepancies_after), 0)

    def test_source_health_logging(self):
        db.log_source_health("upstox", 120.0, 0.0, 0.95, 0.0, "CLOSED")
        db.log_source_health("dhan", 150.0, 0.0, 0.90, 0.1, "CLOSED")
        
        health_list = db.get_latest_source_health()
        self.assertEqual(len(health_list), 2)
        
        providers = [h["provider"] for h in health_list]
        self.assertIn("upstox", providers)
        self.assertIn("dhan", providers)

    def test_execution_event_idempotency(self):
        # Save event
        payload = {"order_id": "123", "qty": 10}
        db.save_execution_event("evt_01", "idem_key_01", "order_123", "fill", "2026-06-03T10:00:00", payload)
        
        # Save duplicate event (should be ignored or updated safely without crashing)
        db.save_execution_event("evt_01", "idem_key_01", "order_123", "fill", "2026-06-03T10:00:00", payload)
        
        events = db.get_execution_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event_id"], "evt_01")
        self.assertEqual(events[0]["idempotency_key"], "idem_key_01")
        self.assertEqual(events[0]["raw_payload"]["order_id"], "123")

if __name__ == '__main__':
    unittest.main()
