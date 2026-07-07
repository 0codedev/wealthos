import unittest
import os
import sys
import time

# Ensure python-bridge folder is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from upstox import RateLimiter, UpstoxClient
from fastapi import HTTPException

class TestUpstoxClient(unittest.TestCase):
    def test_rate_limiter_basic(self):
        # Create a fast rate limiter: max 5 requests per 1 second
        limiter = RateLimiter(max_requests=5, period=1.0)
        
        start_time = time.time()
        for i in range(5):
            limiter.record_and_throttle()
            
        duration = time.time() - start_time
        # Under 5 requests, it should run instantly (0s wait)
        self.assertLess(duration, 0.2)

    def test_rate_limiter_throttling(self):
        # Create a tiny rate limiter: max 2 requests per 0.5 second
        limiter = RateLimiter(max_requests=2, period=0.5)
        
        start_time = time.time()
        # First 2 requests go immediately
        limiter.record_and_throttle()
        limiter.record_and_throttle()
        
        # 3rd request should trigger sleep/throttle
        limiter.record_and_throttle()
        duration = time.time() - start_time
        
        # Should have slept for at least 0.4 seconds
        self.assertGreaterEqual(duration, 0.4)

    def test_authorization_url_generation(self):
        old_key = os.environ.get("UPSTOX_API_KEY")
        try:
            os.environ["UPSTOX_API_KEY"] = "mock_key"
            client = UpstoxClient()
            client.api_key = "mock_key"
            auth_url = client.get_authorization_url(redirect_uri="http://localhost:5173/auth/callback")
            
            self.assertIn("client_id=mock_key", auth_url)
            self.assertIn("redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fauth%2Fcallback", auth_url)
            self.assertIn("response_type=code", auth_url)
        finally:
            if old_key is not None:
                os.environ["UPSTOX_API_KEY"] = old_key
            else:
                os.environ.pop("UPSTOX_API_KEY", None)


    def test_resolve_ttl_settings(self):
        client = UpstoxClient()
        
        # Market quotes: 10s
        self.assertEqual(client.resolve_ttl("market-quote/quotes"), 10)
        
        # Historical candle: 24 hours (86400s)
        self.assertEqual(client.resolve_ttl("historical-candle/NSE_EQ/1D"), 86400)
        
        # Option contract: 1 hour (3600s)
        self.assertEqual(client.resolve_ttl("option/contract"), 3600)
        
        # Default endpoint: 30s
        self.assertEqual(client.resolve_ttl("random/endpoint"), 30)

if __name__ == "__main__":
    unittest.main()
