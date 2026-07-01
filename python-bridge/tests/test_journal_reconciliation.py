import unittest
import os
import sys
import tempfile
from datetime import datetime

# Ensure python-bridge root is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from services.reconciliation import project_positions, reconcile_ledger_with_broker
from routers.journal import get_pending_journal_entries

class TestJournalReconciliation(unittest.TestCase):
    def setUp(self):
        # Isolate database for tests
        self.db_fd, self.db_path = tempfile.mkstemp()
        db.DB_FILE = self.db_path
        db.init_db()

    def tearDown(self):
        os.close(self.db_fd)
        try:
            os.unlink(self.db_path)
        except OSError:
            pass

    def test_project_positions(self):
        # Empty events
        self.assertEqual(project_positions([]), {})

        # Add events
        events = [
            {
                "order_id": "ord_1",
                "event_type": "TRADED",
                "raw_payload": {
                    "orderStatus": "TRADED",
                    "tradingSymbol": "RELIANCE",
                    "transactionType": "BUY",
                    "tradedQty": 10
                }
            },
            {
                "order_id": "ord_2",
                "event_type": "TRADED",
                "raw_payload": {
                    "orderStatus": "TRADED",
                    "tradingSymbol": "TCS",
                    "transactionType": "BUY",
                    "tradedQty": 5
                }
            },
            {
                "order_id": "ord_3",
                "event_type": "TRADED",
                "raw_payload": {
                    "orderStatus": "TRADED",
                    "tradingSymbol": "RELIANCE",
                    "transactionType": "SELL",
                    "tradedQty": 4
                }
            }
        ]
        
        projected = project_positions(events)
        self.assertEqual(projected.get("RELIANCE"), 6) # 10 - 4
        self.assertEqual(projected.get("TCS"), 5)

    def test_reconciliation_mismatches(self):
        # Seed events in SQLite DB
        payload1 = {"orderStatus": "TRADED", "tradingSymbol": "RELIANCE", "transactionType": "BUY", "tradedQty": 10}
        db.save_execution_event("evt_1", "idem_1", "ord_1", "TRADED", "2026-06-03T10:00:00", payload1)
        
        # Reconcile when broker has no holdings (mismatch expected)
        res = reconcile_ledger_with_broker()
        self.assertFalse(res["reconciled"])
        self.assertEqual(len(res["mismatches"]), 1)
        self.assertEqual(res["mismatches"][0]["symbol"], "RELIANCE")
        self.assertEqual(res["mismatches"][0]["projected_qty"], 10)
        self.assertEqual(res["mismatches"][0]["broker_qty"], 0)

    def test_pre_post_context_and_journal_pending(self):
        # Capture pre-trade snapshot
        pre_context = {
            "quote": {
                "data": {"last_price": 2500.0}
            }
        }
        db.save_feature_snapshot("NSE:RELIANCE", "pre_trade_context:ord_1", pre_context)
        
        # Trade fill event
        payload = {
            "orderStatus": "TRADED",
            "tradingSymbol": "RELIANCE",
            "transactionType": "BUY",
            "tradedQty": 10,
            "avgTradedPrice": 2505.0,
            "orderType": "LIMIT",
            "productType": "CNC",
            "isin": "INE002A01018"
        }
        db.save_execution_event("evt_1", "idem_1", "ord_1", "TRADED", "2026-06-03T10:05:00", payload)
        
        # Save post-trade snapshot
        post_context = {
            "quote": {
                "data": {"last_price": 2506.0}
            }
        }
        db.save_feature_snapshot("NSE:RELIANCE", "post_trade_context:ord_1", post_context)
        
        # Fetch pending journal entries
        entries = get_pending_journal_entries()
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry["ticker"], "RELIANCE")
        self.assertEqual(entry["entryPrice"], 2505.0)
        self.assertEqual(entry["quantity"], 10)
        self.assertEqual(entry["direction"], "Long")
        self.assertEqual(entry["slippage"], 5.0) # 2505.0 - 2500.0
        self.assertEqual(entry["slippagePct"], 0.2) # (5 / 2500) * 100
        self.assertIsNotNone(entry["preTradeContext"])
        self.assertIsNotNone(entry["postTradeContext"])

if __name__ == '__main__':
    unittest.main()
