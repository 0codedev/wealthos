import unittest
import os
import sqlite3
import tempfile
import time
import sys
import asyncio
from datetime import datetime, timedelta

# Ensure python-bridge folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from upstox_ws import upstox_ws_client
from services.subscription_planner import subscription_planner

class TestSubscriptionPlanner(unittest.TestCase):
    def setUp(self):
        # Override DB file to a temporary one for testing
        self.original_db_file = db.DB_FILE
        self.temp_db_fd, self.temp_db_path = tempfile.mkstemp(suffix=".db")
        db.DB_FILE = self.temp_db_path
        db.init_db()
        
        # Point the planner to this temporary DB / loop
        subscription_planner.loop = None
        subscription_planner.downgrade_timeout_seconds = 900
        subscription_planner.delete_timeout_seconds = 1800
        
        # Reset WS client state for test isolation
        upstox_ws_client.subscribed_keys.clear()
        upstox_ws_client.subscription_modes.clear()
        upstox_ws_client.client_subscriptions.clear()

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

    def test_client_registration_and_aggregation(self):
        # Register client1 for key1 as ltpc
        subscription_planner.register_client_subscription("client1", ["key1"], "ltpc")
        
        # WebSocket client should be synced to key1: ltpc
        self.assertEqual(upstox_ws_client.subscription_modes.get("key1"), "ltpc")
        self.assertIn("key1", upstox_ws_client.client_subscriptions.get("client1", set()))

        # Register client2 for key1 as full (higher priority)
        subscription_planner.register_client_subscription("client2", ["key1"], "full")
        self.assertEqual(upstox_ws_client.subscription_modes.get("key1"), "full")
        self.assertIn("key1", upstox_ws_client.client_subscriptions.get("client2", set()))

        # Release client2 subscription
        subscription_planner.release_client_subscriptions("client2", ["key1"])
        # Should degrade back to ltpc (requested by client1)
        self.assertEqual(upstox_ws_client.subscription_modes.get("key1"), "ltpc")

    def test_visibility_based_downgrade(self):
        # Register background client (is_visible=False)
        subscription_planner.register_client_subscription("client1", ["key1"], "full", is_visible=False)
        # Should immediately downgrade to ltpc
        self.assertEqual(upstox_ws_client.subscription_modes.get("key1"), "ltpc")

        # Register focused client (is_visible=True)
        subscription_planner.register_client_subscription("client1", ["key1"], "full", is_visible=True)
        self.assertEqual(upstox_ws_client.subscription_modes.get("key1"), "full")

    def test_budget_enforcement(self):
        # Set a very low budget for full_d30 to test it
        from services.subscription_planner import BUDGETS
        original_d30_budget = BUDGETS["full_d30"]
        BUDGETS["full_d30"] = 3
        
        try:
            # Request 4 keys in full_d30
            # We'll register them sequentially to have different requested times
            keys = ["k1", "k2", "k3", "k4"]
            for i, k in enumerate(keys):
                subscription_planner.register_client_subscription("client1", [k], "full_d30")
                time.sleep(0.01) # ensure distinct timestamps
                
            # Recalculate
            # Out of 4 keys, the 3 most recently requested (k4, k3, k2) should be in full_d30,
            # and k1 (oldest) should be downgraded to full.
            self.assertEqual(upstox_ws_client.subscription_modes.get("k4"), "full_d30")
            self.assertEqual(upstox_ws_client.subscription_modes.get("k3"), "full_d30")
            self.assertEqual(upstox_ws_client.subscription_modes.get("k2"), "full_d30")
            self.assertEqual(upstox_ws_client.subscription_modes.get("k1"), "full")
        finally:
            BUDGETS["full_d30"] = original_d30_budget

    def test_idle_pruning_policy(self):
        # Set short timeouts for test
        subscription_planner.downgrade_timeout_seconds = 1
        subscription_planner.delete_timeout_seconds = 2

        # Register client subscription
        subscription_planner.register_client_subscription("client1", ["key1"], "full")
        self.assertEqual(upstox_ws_client.subscription_modes.get("key1"), "full")

        # Sleep to exceed downgrade timeout (1s)
        time.sleep(1.2)
        
        # Pruning should downgrade to ltpc
        asyncio.run(subscription_planner.prune_and_sync())
        self.assertEqual(upstox_ws_client.subscription_modes.get("key1"), "ltpc")

        # Sleep to exceed delete timeout (2s)
        time.sleep(2.2)
        
        # Pruning should now delete it entirely
        asyncio.run(subscription_planner.prune_and_sync())
        self.assertNotIn("key1", upstox_ws_client.subscription_modes)

if __name__ == "__main__":
    unittest.main()
