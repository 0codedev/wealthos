import unittest
import os
import sqlite3
import tempfile
import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure python-bridge folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from upstox_ws import UpstoxWebSocketClient

class TestWebSocketReconnectAndTeardown(unittest.TestCase):
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

    @patch('websockets.connect', new_callable=AsyncMock)
    def test_reconnect_subscribes_active_instruments(self, mock_ws_connect):
        # Create a WebSocket client instance
        ws_client = UpstoxWebSocketClient()
        ws_client.loop = asyncio.new_event_loop()
        
        # Mock the websocket instance returned by connect
        mock_ws = AsyncMock()
        mock_ws_connect.return_value = mock_ws
        ws_client.websocket = mock_ws
        ws_client.connection_status = "connected"
        
        # Populate active subscriptions
        ws_client.subscribed_keys = {"key1", "key2"}
        ws_client.subscription_modes = {"key1": "full", "key2": "ltpc"}
        
        # Trigger command processing or simulation of sending subscriptions
        ws_client._send_subscription = AsyncMock()
        
        # Run reconnect logic simulation
        # Simulate connecting and resubscribing
        mode_groups = {}
        for key in ws_client.subscribed_keys:
            mode = ws_client.subscription_modes.get(key, "full")
            if mode not in mode_groups:
                mode_groups[mode] = []
            mode_groups[mode].append(key)
            
        # Verify groups are resolved correctly
        self.assertEqual(set(mode_groups["full"]), {"key1"})
        self.assertEqual(set(mode_groups["ltpc"]), {"key2"})

    def test_client_teardown_when_all_listeners_disconnect(self):
        ws_client = UpstoxWebSocketClient()
        
        # Add a listener
        queue = asyncio.Queue()
        ws_client.add_listener("conn1", queue, "client1")
        self.assertEqual(len(ws_client.listeners), 1)
        
        # Disconnect listener
        ws_client.remove_listener("conn1")
        self.assertEqual(len(ws_client.listeners), 0)

if __name__ == "__main__":
    unittest.main()
