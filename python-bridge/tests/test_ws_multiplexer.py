"""
CC26 unit tests for ws_multiplexer.

Decoupled from the legacy upstox_ws.py module (which transitively
imports the heavy db.py) so we can exercise the fast decode and the
backoff helper in any environment.
"""

import unittest
import os
import sys
import time

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ws_multiplexer
import MarketDataFeedV3_pb2 as pb


class TestWSMultiplexer(unittest.TestCase):
    def test_compute_backoff_seconds_monotonic_in_range(self):
        seq = [ws_multiplexer.compute_backoff_seconds(i) for i in range(1, 7)]
        for val in seq:
            self.assertLessEqual(val, 60.5)  # cap + jitter
            self.assertGreater(val, 0.0)
        # On average, exponential growth should be visible by run 4
        self.assertGreater(seq[3], seq[0])

    def test_fast_decode_ltpc(self):
        feed = pb.FeedResponse()
        f = feed.feeds["NSE_EQ|INE062A01020"]
        f.ltpc.ltp = 100.5
        f.ltpc.cp = 99.0
        f.ltpc.ltq = 10

        ts = "2026-06-12T00:00:00"
        ticks = ws_multiplexer.fast_decode(feed.SerializeToString(), ts)
        self.assertEqual(len(ticks), 1)
        self.assertEqual(ticks[0]["instrument_key"], "NSE_EQ|INE062A01020")
        self.assertEqual(ticks[0]["ltp"], 100.5)

    def test_fast_decode_skips_empty_feeds(self):
        feed = pb.FeedResponse()
        # Add a feed with no useful data
        feed.feeds["NSE_EQ|EMPTY"]

        ticks = ws_multiplexer.fast_decode(feed.SerializeToString(), "2026-06-12T00:00:00")
        # No usable ltp/close/volume -> skipped
        self.assertEqual(ticks, [])

    def test_internal_multicaster_publish_and_subscribe(self):
        received = []
        unsub = ws_multiplexer.multicaster.subscribe(lambda t: received.extend(t))
        ws_multiplexer.multicaster.publish([{"instrument_key": "X", "ltp": 1.0}])
        time.sleep(0.05)
        self.assertGreaterEqual(len(received), 1)
        unsub()
        ws_multiplexer.multicaster.publish([{"instrument_key": "Y", "ltp": 2.0}])
        time.sleep(0.05)
        # We should not have received the second batch
        self.assertEqual(len(received), 1)


if __name__ == "__main__":
    unittest.main()
