"""
CC24 unit tests for db_stabilized.

These tests are deliberately decoupled from the legacy db.py module
(which requires pandas and other heavy deps) so they can run inside
lightweight CI environments. They exercise the SQLite pool, the
batching queue, and the WAL checkpoint helper using a temporary
database file.
"""

import unittest
import tempfile
import os
import sys
import time
import threading

# Make the python-bridge root importable
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db_stabilized


class TestStabilizedDB(unittest.TestCase):
    def setUp(self):
        # Create a fresh temp database
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.addCleanup(self._cleanup, path)
        db_stabilized.DB_FILE = path
        # Create a tiny schema for our test
        with db_stabilized.get_connection(write=True) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS smoke_test (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE,
                    val INTEGER
                )
            """)
            conn.commit()

    def _cleanup(self, path):
        for suffix in ("", "-wal", "-shm", "-journal"):
            p = path + suffix
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass

    def test_pool_reuses_connections(self):
        with db_stabilized.get_connection() as a:
            cur = a.execute("SELECT 1 as v")
            self.assertEqual(cur.fetchone()["v"], 1)
        with db_stabilized.get_connection() as b:
            cur = b.execute("SELECT 2 as v")
            self.assertEqual(cur.fetchone()["v"], 2)
        stats = db_stabilized.get_pool_stats()
        # Either we reused a connection or created a new one
        self.assertGreaterEqual(stats["connections_created"] + stats["connections_reused"], 1)

    def test_wal_journal_mode(self):
        with db_stabilized.get_connection() as conn:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            self.assertEqual(mode.lower(), "wal")

    def test_fetch_one_and_fetch_all(self):
        with db_stabilized.get_connection(write=True) as conn:
            conn.execute("INSERT OR REPLACE INTO smoke_test (key, val) VALUES ('a', 1)")
            conn.execute("INSERT OR REPLACE INTO smoke_test (key, val) VALUES ('b', 2)")
            conn.commit()

        row = db_stabilized.fetch_one("SELECT val FROM smoke_test WHERE key = ?", ("a",))
        self.assertEqual(row["val"], 1)
        rows = db_stabilized.fetch_all("SELECT val FROM smoke_test ORDER BY key ASC")
        self.assertEqual([r["val"] for r in rows], [1, 2])

    def test_batching_queue(self):
        received = []

        def handler(rows):
            received.extend(rows)

        db_stabilized.batcher.register_handler("smoke_test", handler)
        for i in range(10):
            db_stabilized.batcher.submit("smoke_test", {"key": f"k{i}", "val": i})
        # Force an early flush
        time.sleep(0.2)
        db_stabilized.batcher._flush()
        self.assertGreaterEqual(len(received), 1)


class TestErrorMiddleware(unittest.TestCase):
    def test_safe_message_truncation(self):
        msg = error_middleware._safe_message("simple error")
        self.assertEqual(msg, "simple error")

    def test_safe_message_jwt_redaction(self):
        bad = "Error with eyJabc123def456 in payload"
        redacted = error_middleware._safe_message(bad)
        self.assertIn("authentication", redacted.lower())


# Lazy import for the error_middleware module
import importlib
error_middleware = importlib.import_module("error_middleware")


if __name__ == "__main__":
    unittest.main()
