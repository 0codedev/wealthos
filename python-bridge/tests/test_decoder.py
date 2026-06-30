import unittest
import os
import sys

# Ensure python-bridge folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import MarketDataFeedV3_pb2 as pb
from google.protobuf.json_format import MessageToDict

class TestProtobufDecoder(unittest.TestCase):
    def setUp(self):
        self.fixtures_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "fixtures", "ws_frames"
        )

    def test_decode_ltpc_frame(self):
        ltpc_bin_path = os.path.join(self.fixtures_dir, "ltpc.bin")
        self.assertTrue(os.path.exists(ltpc_bin_path), "ltpc.bin fixture missing")

        with open(ltpc_bin_path, "rb") as f:
            binary_data = f.read()

        feed_response = pb.FeedResponse()
        feed_response.ParseFromString(binary_data)
        
        feed_dict = MessageToDict(feed_response, preserving_proto_field_name=True)
        feeds = feed_dict.get("feeds", {})
        
        self.assertIn("NSE_EQ|INE002A01018", feeds)
        feed = feeds["NSE_EQ|INE002A01018"]
        self.assertIn("ltpc", feed)
        self.assertEqual(feed["ltpc"]["ltp"], 570.4)
        self.assertEqual(feed["ltpc"]["cp"], 565.0)

    def test_decode_greeks_frame(self):
        greeks_bin_path = os.path.join(self.fixtures_dir, "greeks.bin")
        self.assertTrue(os.path.exists(greeks_bin_path), "greeks.bin fixture missing")

        with open(greeks_bin_path, "rb") as f:
            binary_data = f.read()

        feed_response = pb.FeedResponse()
        feed_response.ParseFromString(binary_data)
        
        feed_dict = MessageToDict(feed_response, preserving_proto_field_name=True)
        feeds = feed_dict.get("feeds", {})
        
        self.assertIn("NSE_FO|54321", feeds)
        feed = feeds["NSE_FO|54321"]
        self.assertIn("firstLevelWithGreeks", feed)
        flg = feed["firstLevelWithGreeks"]
        self.assertEqual(flg["ltpc"]["ltp"], 15.5)
        self.assertEqual(flg["optionGreeks"]["delta"], 0.45)
        self.assertEqual(flg["iv"], 0.22)

    def test_decode_full_frame(self):
        full_bin_path = os.path.join(self.fixtures_dir, "full.bin")
        self.assertTrue(os.path.exists(full_bin_path), "full.bin fixture missing")

        with open(full_bin_path, "rb") as f:
            binary_data = f.read()

        feed_response = pb.FeedResponse()
        feed_response.ParseFromString(binary_data)
        
        feed_dict = MessageToDict(feed_response, preserving_proto_field_name=True)
        feeds = feed_dict.get("feeds", {})
        
        self.assertIn("NSE_EQ|INE002A01018", feeds)
        feed = feeds["NSE_EQ|INE002A01018"]
        
        # Verify the nested structure of fullFeed -> marketFF
        self.assertIn("fullFeed", feed)
        full_feed = feed["fullFeed"]
        self.assertIn("marketFF", full_feed)
        
        mff = full_feed["marketFF"]
        self.assertEqual(mff["ltpc"]["ltp"], 570.4)
        self.assertEqual(len(mff["marketLevel"]["bidAskQuote"]), 5)
        self.assertEqual(mff["marketOHLC"]["ohlc"][0]["interval"], "1d")
        self.assertEqual(mff["marketOHLC"]["ohlc"][0]["close"], 570.4)

class TestWSClientDecoder(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.fixtures_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "fixtures", "ws_frames"
        )
        from upstox_ws import UpstoxWebSocketClient
        self.client = UpstoxWebSocketClient()

    async def test_client_decode_ltpc(self):
        with open(os.path.join(self.fixtures_dir, "ltpc.bin"), "rb") as f:
            binary_data = f.read()
        await self.client._decode_and_broadcast(binary_data)
        tick = self.client.get_latest_tick("NSE_EQ|INE002A01018")
        self.assertIsNotNone(tick)
        self.assertEqual(tick["ltp"], 570.4)
        self.assertEqual(tick["close"], 565.0)

    async def test_client_decode_greeks(self):
        with open(os.path.join(self.fixtures_dir, "greeks.bin"), "rb") as f:
            binary_data = f.read()
        await self.client._decode_and_broadcast(binary_data)
        tick = self.client.get_latest_tick("NSE_FO|54321")
        self.assertIsNotNone(tick)
        self.assertEqual(tick["ltp"], 15.5)
        self.assertEqual(tick["greeks"]["delta"], 0.45)
        self.assertEqual(tick["oi"], 450000.0)

    async def test_client_decode_full(self):
        with open(os.path.join(self.fixtures_dir, "full.bin"), "rb") as f:
            binary_data = f.read()
        await self.client._decode_and_broadcast(binary_data)
        tick = self.client.get_latest_tick("NSE_EQ|INE002A01018")
        self.assertIsNotNone(tick)
        self.assertEqual(tick["ltp"], 570.4)
        self.assertEqual(tick["volume"], 15000000)
        self.assertEqual(tick["ohlc"]["open"], 567.0)

if __name__ == "__main__":
    unittest.main()
