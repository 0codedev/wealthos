import unittest
import os
import sqlite3
import tempfile
import time
import sys

# Ensure python-bridge folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db

class TestDatabaseOperations(unittest.TestCase):
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
            # Clean WAL logs if created
            for suffix in ("-wal", "-shm", "-journal"):
                if os.path.exists(self.temp_db_path + suffix):
                    os.remove(self.temp_db_path + suffix)
        except OSError:
            pass

    def test_init_db(self):
        conn = db.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        self.assertIn("upstox_cache", tables)
        self.assertIn("delivery_history", tables)
        self.assertIn("upstox_instruments", tables)
        self.assertIn("upstox_errors", tables)

    def test_cache_set_and_get(self):
        endpoint = "test/endpoint"
        params = {"sym": "SBIN", "type": "CE"}
        data = {"price": 570.40, "volume": 1200000}
        ttl = 10 # seconds

        # Set cache
        db.set_cached_upstox_response(endpoint, params, data, ttl)

        # Retrieve cache (fresh)
        cache_entry = db.get_cached_upstox_response(endpoint, params)
        self.assertIsNotNone(cache_entry)
        self.assertFalse(cache_entry["is_expired"])
        self.assertEqual(cache_entry["data"]["price"], 570.40)

        # Retrieve cache with non-matching params should be None
        self.assertIsNone(db.get_cached_upstox_response(endpoint, {"sym": "RELIANCE"}))

    def test_expired_cache(self):
        endpoint = "test/expired"
        params = {}
        data = {"expired": True}
        ttl = -1 # Expired instantly

        db.set_cached_upstox_response(endpoint, params, data, ttl)

        # Retrieve cache
        cache_entry = db.get_cached_upstox_response(endpoint, params)
        self.assertIsNotNone(cache_entry)
        self.assertTrue(cache_entry["is_expired"])

    def test_cleanup_expired_caches(self):
        # Set a fresh entry and an expired entry
        db.set_cached_upstox_response("endpoint/fresh", {}, {"val": 1}, 100)
        db.set_cached_upstox_response("endpoint/expired", {}, {"val": 2}, -10)
        
        stats_before = db.get_upstox_cache_stats()
        self.assertEqual(stats_before["total_items"], 2)

        # Clean up
        db.cleanup_expired_caches()

        stats_after = db.get_upstox_cache_stats()
        self.assertEqual(stats_after["total_items"], 1)
        self.assertEqual(stats_after["fresh_items"], 1)

    def test_db_write_transaction_decorator(self):
        @db.db_write_transaction
        def dummy_write(symbol, val):
            conn = db.get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO upstox_volume_avg (symbol, avg_volume_20d, candle_count, updated_at) VALUES (?, ?, ?, ?)",
                (symbol, val, 20, "2026-05-29")
            )
            conn.commit()
            conn.close()

        dummy_write("SBIN", 5000000.0)
        
        # Verify write succeeded
        vol_avg = db.get_upstox_volume_avg("SBIN")
        self.assertIsNotNone(vol_avg)
        self.assertEqual(vol_avg["avg_volume_20d"], 5000000.0)

    def test_active_subscriptions(self):
        # 1. Initially empty
        self.assertEqual(db.get_all_aggregated_subscriptions(), {})

        # 2. Save active subscription for client1
        db.save_active_subscription("client1", "NSE_EQ|INE062A01020", "ltpc")
        # Save active subscription for client2 with higher mode
        db.save_active_subscription("client2", "NSE_EQ|INE062A01020", "full")
        
        # Aggregated should show the highest mode (full)
        aggr = db.get_all_aggregated_subscriptions()
        self.assertEqual(aggr, {"NSE_EQ|INE062A01020": "full"})

        # 3. Add client3 with full_d30
        db.save_active_subscription("client3", "NSE_EQ|INE062A01020", "full_d30")
        aggr = db.get_all_aggregated_subscriptions()
        self.assertEqual(aggr, {"NSE_EQ|INE062A01020": "full_d30"})

        # 4. Remove active subscription for client3
        db.remove_active_subscription("client3", "NSE_EQ|INE062A01020")
        aggr = db.get_all_aggregated_subscriptions()
        self.assertEqual(aggr, {"NSE_EQ|INE062A01020": "full"})

        # 5. Remove all client2 subscriptions
        db.remove_all_client_subscriptions("client2")
        aggr = db.get_all_aggregated_subscriptions()
        self.assertEqual(aggr, {"NSE_EQ|INE062A01020": "ltpc"})

        # 6. Remove all client1 subscriptions
        db.remove_all_client_subscriptions("client1")
        self.assertEqual(db.get_all_aggregated_subscriptions(), {})

if __name__ == "__main__":
    unittest.main()
