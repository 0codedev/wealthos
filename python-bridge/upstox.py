import requests
import os
import time
import gzip
import json
import threading
import random
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
from collections import deque
from datetime import datetime, timedelta
from fastapi import HTTPException
from dotenv import load_dotenv

# Load environment variables from parent directory .env
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dotenv_path = os.path.join(parent_dir, ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path)
else:
    load_dotenv() # Fallback

from logger import get_logger
log = get_logger("upstox", tag="UPSTOX")

TOKEN_FILE = os.path.join(os.path.dirname(__file__), "upstox_token.txt")

class RateLimiter:
    def __init__(self, max_requests: int = 450, period: float = 60.0):
        self.max_requests = max_requests
        self.period = period
        self.requests = deque()
        self.lock = threading.Lock()

    def record_and_throttle(self):
        """
        Thread-safe sliding window rate-limiter to prevent exceeding Upstox limits
        without generating heavy SQLite read/write overhead on every query.
        """
        now = time.time()
        with self.lock:
            # Clear old entries outside sliding window
            while self.requests and now - self.requests[0] > self.period:
                self.requests.popleft()

            # Throttle if approaching limit
            if len(self.requests) >= self.max_requests:
                oldest_request = self.requests[0]
                sleep_time = self.period - (now - oldest_request) + 0.1
                sleep_time = max(sleep_time, 0.5)
                log.debug("Sliding window rate limit threshold approached (%d requests/minute). Throttling for %.2fs...", len(self.requests), sleep_time)
                
                # Release lock to avoid blocking other concurrent readers during sleep
                self.lock.release()
                time.sleep(sleep_time)
                self.lock.acquire()
                
                # Re-clean after sleep
                now = time.time()
                while self.requests and now - self.requests[0] > self.period:
                    self.requests.popleft()

            self.requests.append(time.time())

upstox_rate_limiter = RateLimiter(max_requests=450, period=60.0)

# In-memory cache for short-lived requests (TTL <= 60 seconds)
upstox_mem_cache = {}
mem_cache_lock = threading.Lock()

class UpstoxClient:
    BASE_URL = "https://api.upstox.com/v2"

    def __init__(self):
        self.api_key = os.getenv("UPSTOX_API_KEY", "")
        self.api_secret = os.getenv("UPSTOX_API_SECRET", "")
        self.redirect_uri = os.getenv("UPSTOX_REDIRECT_URI", "")
        self.token = self.load_token()
        self.analytics_token = self.load_analytics_token()
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
        active_token = self.token if self.token else self.analytics_token
        if active_token:
            self.headers["Authorization"] = f"Bearer {active_token}"
        self.session = requests.Session()
        self.session.trust_env = False
        self.in_flight_requests = {}
        self.in_flight_lock = threading.Lock()

    def set_credentials(self, api_key: str = None, api_secret: str = None, redirect_uri: str = None):
        if api_key:
            self.api_key = api_key
            os.environ["UPSTOX_API_KEY"] = api_key
        if api_secret:
            self.api_secret = api_secret
            os.environ["UPSTOX_API_SECRET"] = api_secret
        if redirect_uri:
            self.redirect_uri = redirect_uri
            os.environ["UPSTOX_REDIRECT_URI"] = redirect_uri
        log.info("Upstox credentials updated dynamically in memory.")

    def get_authorization_url(self, redirect_uri: str = None) -> str:
        """Generates the OAuth login dialog URL for Upstox re-authentication."""
        client_id = self.api_key or os.getenv("UPSTOX_API_KEY")
        if not redirect_uri:
            redirect_uri = self.redirect_uri or os.getenv("UPSTOX_REDIRECT_URI", "http://localhost:3000/upstox/callback")
        
        import urllib.parse
        encoded_redirect = urllib.parse.quote(redirect_uri, safe='')
        return f"https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id={client_id}&redirect_uri={encoded_redirect}"

    def load_token(self) -> str:
        """Loads Upstox daily interactive token from local file or env"""
        if os.path.exists(TOKEN_FILE):
            try:
                with open(TOKEN_FILE, "r") as f:
                    return f.read().strip()
            except Exception as e:
                log.error("Error reading token file: %s", e)
        try:
            return os.getenv("UPSTOX_ACCESS_TOKEN", "")
        except Exception as e:
            log.warning("Failed to read env: %s", e)
            return ""

    def load_analytics_token(self) -> str:
        """Loads Upstox 1-year analytics token from env"""
        try:
            return os.getenv("UPSTOX_ANALYTICS_TOKEN", "")
        except Exception as e:
            log.warning("Failed to read analytics env: %s", e)
            return ""

    def set_token(self, token: str):
        """Saves daily interactive token and updates headers"""
        self.token = token
        self.headers["Authorization"] = f"Bearer {token}"
        try:
            with open(TOKEN_FILE, "w") as f:
                f.write(token)
            log.info("Token updated successfully.")
        except Exception as e:
            log.error("Failed to write token file: %s", e)

    def is_indian_market_open(self) -> bool:
        from datetime import datetime, timedelta, timezone
        utc_now = datetime.now(timezone.utc)
        ist_now = utc_now + timedelta(hours=5, minutes=30)
        
        # Weekends
        if ist_now.weekday() >= 5:
            return False
            
        market_start = ist_now.replace(hour=9, minute=15, second=0, microsecond=0)
        market_end = ist_now.replace(hour=15, minute=30, second=0, microsecond=0)
        
        return market_start <= ist_now <= market_end

    def resolve_ttl(self, endpoint: str) -> int:
        endpoint_lower = endpoint.lower()
        
        if "login/authorization/token" in endpoint_lower:
            return 0
            
        if "intraday" in endpoint_lower:
            if not self.is_indian_market_open():
                return 86400  # 24 hours if market is closed (candles are finalized)
            return 60  # 60 seconds (intraday candles during market hours)
            
        if "market-quote/quotes" in endpoint_lower:
            return 10  # 10 seconds
            
        if "market-quote/ltp" in endpoint_lower or "market-quote/ohlc" in endpoint_lower:
            return 10  # 10 seconds
            
        if "historical-candle" in endpoint_lower:
            return 86400  # 24 hours
            
        if "option/chain" in endpoint_lower:
            return 30  # 30 seconds
            
        if "option/contract" in endpoint_lower:
            return 3600  # 1 hour
            
        if "market/fii" in endpoint_lower or "market/dii" in endpoint_lower:
            return 86400  # 24 hours
            
        if "market/oi" in endpoint_lower or "market/change-oi" in endpoint_lower:
            return 30  # 30 seconds
            
        if "market/max-pain" in endpoint_lower or "market/pcr" in endpoint_lower:
            return 30  # 30 seconds
            
        if "market/status" in endpoint_lower:
            return 30  # 30 seconds
            
        if "market/holidays" in endpoint_lower:
            return 86400  # 24 hours
            
        if "fundamentals" in endpoint_lower:
            return 2592000  # 30 days (highly optimized cache for company financials)
            
        if "smartlist" in endpoint_lower:
            return 3600  # 1 hour
            
        if "market/timings" in endpoint_lower:
            return 86400  # 24 hours
            
        if "instruments/expiry" in endpoint_lower or "instruments/expiries" in endpoint_lower or "instruments/options/contract" in endpoint_lower or "instruments/future/contract" in endpoint_lower:
            return 86400  # 24 hours
            
        if "ipo" in endpoint_lower:
            return 2592000  # 30 days (semi-permanent local cache unless force refreshed)
            
        if "news" in endpoint_lower:
            return 900  # 15 minutes
            
        return 30

    def request(self, method: str, endpoint: str, params: dict = None, data: dict = None, retries: int = 3, backoff: float = 1.0, bypass_cache: bool = False, token_mode: str = None) -> dict:
        """Sends HTTP request to Upstox with caching, rate-limit throttling, retry, and fallbacks"""
        
        # 1. Resolve TTL
        ttl = self.resolve_ttl(endpoint)
        
        # We only cache if it's a GET request and TTL > 0
        use_cache = method.upper() == "GET" and ttl > 0 and not bypass_cache
        
        # Make a copy of params to avoid mutation issues
        cache_params = params.copy() if params else {}
        cache_params_str = json.dumps(cache_params, sort_keys=True) if cache_params else "{}"
        
        cached_entry = None
        if use_cache:
            if ttl <= 60:
                with mem_cache_lock:
                    mem_entry = upstox_mem_cache.get((endpoint, cache_params_str))
                if mem_entry:
                    import copy
                    fetched_at = mem_entry["fetched_at"]
                    is_expired = (datetime.now() - fetched_at).total_seconds() > ttl
                    cached_entry = {
                        "data": copy.deepcopy(mem_entry["data"]),
                        "is_expired": is_expired,
                        "fetched_at": fetched_at.isoformat(),
                        "source": "mem_cache"
                    }
            else:
                import db
                cached_entry = db.get_cached_upstox_response(endpoint, cache_params)
                if cached_entry:
                    cached_entry["source"] = "db_cache"
            
            if cached_entry and not cached_entry['is_expired']:
                import copy
                # Return fresh cache response
                response_data = copy.deepcopy(cached_entry['data'])
                if isinstance(response_data, dict):
                    response_data["_cache_meta"] = {
                        "fetched_at": cached_entry["fetched_at"],
                        "source": cached_entry.get("source", "cache"),
                        "is_expired": False
                    }
                return response_data

            # Deduplication Layer
            cache_key = (endpoint, cache_params_str)
            wait_on_in_flight = False
            in_flight_event = None
            
            with self.in_flight_lock:
                if cache_key in self.in_flight_requests:
                    wait_on_in_flight = True
                    in_flight_event = self.in_flight_requests[cache_key]
                else:
                    in_flight_event = threading.Event()
                    self.in_flight_requests[cache_key] = in_flight_event
            
            if wait_on_in_flight:
                log.debug("Request for %s with %s is already in-flight. Waiting...", endpoint, cache_params_str)
                in_flight_event.wait(timeout=15.0)
                
                # Re-check cache
                if ttl <= 60:
                    with mem_cache_lock:
                        mem_entry = upstox_mem_cache.get((endpoint, cache_params_str))
                    if mem_entry:
                        import copy
                        fetched_at = mem_entry["fetched_at"]
                        is_expired = (datetime.now() - fetched_at).total_seconds() > ttl
                        cached_entry = {
                            "data": copy.deepcopy(mem_entry["data"]),
                            "is_expired": is_expired,
                            "fetched_at": fetched_at.isoformat(),
                            "source": "mem_cache"
                        }
                else:
                    import db
                    cached_entry = db.get_cached_upstox_response(endpoint, cache_params)
                    if cached_entry:
                        cached_entry["source"] = "db_cache"
                        
                if cached_entry and not cached_entry['is_expired']:
                    import copy
                    response_data = copy.deepcopy(cached_entry['data'])
                    if isinstance(response_data, dict):
                        response_data["_cache_meta"] = {
                            "fetched_at": cached_entry["fetched_at"],
                            "source": cached_entry.get("source", "cache_dedup"),
                            "is_expired": False
                        }
                    return response_data
                
                # If the other request failed, we proceed to fetch it ourselves
                with self.in_flight_lock:
                    in_flight_event = threading.Event()
                    self.in_flight_requests[cache_key] = in_flight_event
            
            try:
                return self._do_request_live(method, endpoint, params, data, retries, backoff, token_mode, ttl, cache_params, cache_params_str, cached_entry)
            finally:
                with self.in_flight_lock:
                    self.in_flight_requests.pop(cache_key, None)
                in_flight_event.set()
                
        return self._do_request_live(method, endpoint, params, data, retries, backoff, token_mode, ttl, cache_params, cache_params_str, cached_entry)

    def _do_request_live(self, method: str, endpoint: str, params: dict, data: dict, retries: int, backoff: float, token_mode: str, ttl: int, cache_params: dict, cache_params_str: str, cached_entry: dict) -> dict:
        # 2. In-Memory Sliding-Window Rate Limiting (Thread-Safe & 0-write)
        if ttl > 0:
            upstox_rate_limiter.record_and_throttle()
                
        # 3. Call Live API
        if endpoint.startswith("v3/") or endpoint.startswith("v2/"):
            url = f"https://api.upstox.com/{endpoint}"
        else:
            url = f"{self.BASE_URL}/{endpoint.lstrip('/')}"
        
        import urllib.parse
        if params and method.upper() == "GET":
            query_string = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
            url = f"{url}?{query_string}"
            params = None
        
        # Determine token to use based on endpoint type
        is_token_exchange = "login/authorization/token" in endpoint
        is_expired_endpoint = "expired-instruments" in endpoint
        token_to_use = None
        
        if not is_token_exchange:
            if is_expired_endpoint:
                if self.token:
                    token_to_use = self.token
                else:
                    # Serve stale cache as a last resort
                    if cached_entry:
                        import db
                        db.log_upstox_error(endpoint, 401, "Interactive token missing for expired endpoint. Served stale cache.", "stale_cache")
                        response_data = cached_entry['data']
                        if isinstance(response_data, dict):
                            response_data["_cache_meta"] = {
                                "fetched_at": cached_entry["fetched_at"],
                                "source": "cache",
                                "is_expired": True
                            }
                        return response_data
                    
                    auth_url = self.get_authorization_url()
                    raise HTTPException(
                        status_code=401, 
                        detail={
                            "error": "auth_required", 
                            "message": "Daily Interactive Login is required to access expired F&O data.",
                            "auth_url": auth_url
                        }
                    )
            else:
                if token_mode == "analytics" and self.analytics_token:
                    token_to_use = self.analytics_token
                elif token_mode == "interactive":
                    if self.token:
                        token_to_use = self.token
                    else:
                        token_to_use = None
                else:
                    if self.token:
                        token_to_use = self.token
                    elif self.analytics_token:
                        token_to_use = self.analytics_token
                    else:
                        # Serve stale cache as a last resort
                        if cached_entry:
                            import db
                            db.log_upstox_error(endpoint, 401, "Tokens missing. Served stale cache.", "stale_cache")
                            response_data = cached_entry['data']
                            if isinstance(response_data, dict):
                                response_data["_cache_meta"] = {
                                    "fetched_at": cached_entry["fetched_at"],
                                    "source": "cache",
                                    "is_expired": True
                                }
                            return response_data
                        
                        auth_url = self.get_authorization_url()
                        raise HTTPException(
                            status_code=401, 
                            detail={
                                "error": "auth_required", 
                                "message": "Upstox Access Token and Analytics Token are both missing. Authentication required.",
                                "auth_url": auth_url
                            }
                        )

        # Build request headers dynamically
        request_headers = self.headers.copy()
        if token_to_use:
            request_headers["Authorization"] = f"Bearer {token_to_use}"

        _proxies = None

        for attempt in range(retries):
            t_start = time.perf_counter()
            try:
                try:
                    if method.upper() == "GET":
                        resp = self.session.get(url, headers=request_headers, params=params, timeout=(2.5, 5.0), proxies=_proxies)
                    elif method.upper() == "POST":
                        if is_token_exchange:
                            headers = {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"}
                            resp = self.session.post(url, headers=headers, data=data, timeout=(5.0, 10.0), proxies=_proxies)
                        else:
                            resp = self.session.post(url, headers=request_headers, json=data, timeout=(2.5, 5.0), proxies=_proxies)
                    else:
                        raise ValueError(f"Unsupported HTTP method: {method}")
                except requests.exceptions.SSLError:
                    log.debug("SSL verification failed for %s. Retrying with verify=False", url)
                    if method.upper() == "GET":
                        resp = self.session.get(url, headers=request_headers, params=params, timeout=(3.0, 6.0), verify=False, proxies=_proxies)
                    elif method.upper() == "POST":
                        if is_token_exchange:
                            headers = {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"}
                            resp = self.session.post(url, headers=headers, data=data, timeout=(5.0, 10.0), verify=False, proxies=_proxies)
                        else:
                            resp = self.session.post(url, headers=request_headers, json=data, timeout=(3.0, 6.0), verify=False, proxies=_proxies)

                latency = time.perf_counter() - t_start
                if latency > 1.5:
                    log.debug("Slow external request to %s: %.2fs", url, latency)

                # Handle token exchange errors immediately
                if is_token_exchange and resp.status_code != 200:
                    try:
                        err_json = resp.json()
                    except Exception:
                        err_json = {}
                    err_msg = err_json.get("error_description") or err_json.get("message") or "OAuth code invalid, expired, or already used."
                    raise HTTPException(
                        status_code=resp.status_code,
                        detail={
                            "error": "invalid_code",
                            "message": f"Token exchange failed: {err_msg}"
                        }
                    )

                # Handle token expiration (401)
                if resp.status_code == 401:
                    # Check if it is a read-only token limitation
                    try:
                        error_json = resp.json()
                        errors = error_json.get("errors", [])
                        if errors and errors[0].get("errorCode") == "UDAPI100067":
                            raise HTTPException(
                                status_code=403,
                                detail={
                                    "error": "forbidden_read_only",
                                    "message": errors[0].get("message", "The API you are trying to access is not permitted with a read only token.")
                                }
                            )
                    except HTTPException:
                        raise
                    except (ValueError, KeyError, IndexError, TypeError):
                        pass

                    log.warning("401 Unauthorized. Token might be expired.")

                    # If this is a non-expired endpoint, and we used self.token, and self.analytics_token exists,
                    # automatically fall back to the analytics token for retry
                    if not is_expired_endpoint and token_to_use == self.token and self.analytics_token:
                        log.info("401 on interactive token for non-expired endpoint. Falling back to analytics token.")
                        token_to_use = self.analytics_token
                        request_headers["Authorization"] = f"Bearer {token_to_use}"
                        if attempt < retries - 1:
                            continue

                    if attempt == retries - 1:
                        if cached_entry:
                            import db
                            db.log_upstox_error(endpoint, 401, "Unauthorized (expired token). Served stale cache.", "stale_cache")
                            response_data = cached_entry['data']
                            if isinstance(response_data, dict):
                                response_data["_cache_meta"] = {
                                    "fetched_at": cached_entry["fetched_at"],
                                    "source": "cache",
                                    "is_expired": True
                                }
                            return response_data
                        
                        auth_url = self.get_authorization_url()
                        raise HTTPException(
                            status_code=401, 
                            detail={
                                "error": "auth_required", 
                                "message": "Upstox Access Token is invalid or expired. Re-authentication required.",
                                "auth_url": auth_url
                            }
                        )

                # Handle Rate Limiting (429) specifically with a longer backoff window to reset the 60s sliding window
                if resp.status_code == 429:
                    if attempt < retries - 1:
                        sleep_time = 30.0 if attempt == 0 else 60.0
                        log.warning("Hit 429 Too Many Requests. Cooling down for %.1fs to reset limit window before retrying...", sleep_time)
                        time.sleep(sleep_time)
                        continue

                # Handle Server Errors (5xx)
                if resp.status_code >= 500:
                    if attempt < retries - 1:
                        sleep_time = (2.0 ** attempt) + 0.5
                        log.warning("Request failed with %d. Retrying in %.2fs...", resp.status_code, sleep_time)
                        time.sleep(sleep_time)
                        continue
                
                resp.raise_for_status()
                response_data = resp.json()
                
                # Save to cache if successful
                if method.upper() == "GET" and ttl > 0:
                    if ttl <= 60:
                        import copy
                        with mem_cache_lock:
                            # size cap at 500 entries
                            if len(upstox_mem_cache) >= 500:
                                oldest_key = next(iter(upstox_mem_cache))
                                upstox_mem_cache.pop(oldest_key, None)
                            upstox_mem_cache[(endpoint, cache_params_str)] = {
                                "data": copy.deepcopy(response_data),
                                "fetched_at": datetime.now()
                            }
                    else:
                        import db
                        db.set_cached_upstox_response(endpoint, cache_params, response_data, ttl)
                
                # Add cache meta
                if isinstance(response_data, dict):
                    response_data["_cache_meta"] = {
                        "fetched_at": datetime.now().isoformat(),
                        "source": "live",
                        "is_expired": False
                    }
                return response_data

            except requests.exceptions.RequestException as e:
                if attempt == retries - 1:
                    # Serve stale cache on failure as a fallback
                    if cached_entry:
                        log.info("Upstox live call for %s failed (%s). Serving cached fallback.", endpoint, e)
                        import db
                        db.log_upstox_error(endpoint, 200, f"Request failed: {str(e)}. Served stale cache.", "stale_cache")
                        response_data = cached_entry['data']
                        if isinstance(response_data, dict):
                            response_data["_cache_meta"] = {
                                "fetched_at": cached_entry["fetched_at"],
                                "source": "cache",
                                "is_expired": True
                            }
                        return response_data
                    
                    log.warning("Request to %s failed: %s", url, e)
                    import db
                    db.log_upstox_error(endpoint, 500, str(e), "none")
                    raise HTTPException(status_code=500, detail=f"Upstox API request failed: {str(e)}")
                time.sleep(backoff ** attempt)

        # Fallback if attempt loop finishes
        if cached_entry:
            import db
            db.log_upstox_error(endpoint, 500, "Unknown request failure. Served stale cache.", "stale_cache")
            response_data = cached_entry['data']
            if isinstance(response_data, dict):
                response_data["_cache_meta"] = {
                    "fetched_at": cached_entry["fetched_at"],
                    "source": "cache",
                    "is_expired": True
                }
            return response_data
        raise HTTPException(status_code=500, detail="Upstox API request failed.")

    def token_exchange(self, code: str, redirect_uri: str) -> str:
        """Exchanges OAuth authorization code for access token"""
        client_id = self.api_key or os.getenv("UPSTOX_API_KEY")
        client_secret = self.api_secret or os.getenv("UPSTOX_API_SECRET")
        r_uri = redirect_uri or self.redirect_uri or os.getenv("UPSTOX_REDIRECT_URI", "http://localhost:3000/upstox/callback")

        if not client_id or not client_secret:
            raise HTTPException(status_code=400, detail="UPSTOX_API_KEY or UPSTOX_API_SECRET not set in environment or store.")

        data = {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": r_uri,
            "grant_type": "authorization_code"
        }

        # Call OAuth token endpoint
        log.info(f"📡 [UPSTOX-API] Calling Upstox login/authorization/token with client_id={client_id[:6]}... redirect_uri={r_uri}")
        res = self.request("POST", "login/authorization/token", data=data)
        log.info(f"📡 [UPSTOX-API] Upstox raw response keys: {list(res.keys()) if isinstance(res, dict) else type(res)}")
        access_token = res.get("access_token") or (res.get("data", {}).get("access_token") if isinstance(res.get("data"), dict) else None)
        if access_token:
            self.set_token(access_token)
            log.info("✅ [UPSTOX-API] Token exchange successful! Access token updated in memory and file.")
            return access_token
        raise HTTPException(status_code=400, detail="Token exchange succeeded but no access_token in response.")

    def get_full_quotes(self, instrument_keys: list[str]) -> dict:
        """Fetches full market quotes for up to 500 instruments"""
        # Upstox quote endpoint limit is 500 per call
        # Batch into groups of 500 if needed
        all_data = {}
        for i in range(0, len(instrument_keys), 500):
            chunk = instrument_keys[i:i+500]
            keys_str = ",".join(chunk)
            res = self.request("GET", "market-quote/quotes", params={"instrument_key": keys_str})
            if res.get("status") == "success" and "data" in res:
                chunk_data = res["data"]
                for key, quote in chunk_data.items():
                    if isinstance(quote, dict):
                        depth = quote.get("depth", {}) or {}
                        buy_list = depth.get("buy", []) or []
                        sell_list = depth.get("sell", []) or []
                        
                        total_buy = sum(item.get("quantity", 0) for item in buy_list if isinstance(item, dict))
                        total_sell = sum(item.get("quantity", 0) for item in sell_list if isinstance(item, dict))
                        
                        if total_sell > 0:
                            dai = round(total_buy / total_sell, 3)
                        elif total_buy > 0:
                            dai = 999.0
                        else:
                            dai = 1.0
                            
                        pressure = "BUY_SIDE" if dai > 1.5 else "SELL_SIDE" if dai < 0.67 else "NEUTRAL"
                        quote["dai"] = dai
                        quote["depth_pressure"] = pressure
                all_data.update(chunk_data)
        return all_data

    def get_historical_candles(self, instrument_key: str, interval: str, to_date: str, from_date: str) -> dict:
        """Fetches historical candle data using Upstox V3 and auto-saves to local Parquet cache"""
        key = instrument_key.replace('|', '%7C')
        
        # Parse interval to V3 unit and numeric interval (e.g. "5minute" -> "minutes/5")
        import re
        interval_clean = interval.lower().strip()
        
        if interval_clean in ["day", "days"]:
            unit = "days"
            val = 1
        elif interval_clean in ["week", "weeks"]:
            unit = "weeks"
            val = 1
        elif interval_clean in ["month", "months"]:
            unit = "months"
            val = 1
        elif interval_clean in ["minute", "minutes"]:
            unit = "minutes"
            val = 1
        elif interval_clean in ["hour", "hours"]:
            unit = "hours"
            val = 1
        else:
            match = re.match(r"(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months)", interval_clean)
            if match:
                val = int(match.group(1))
                unit_raw = match.group(2)
                if unit_raw.startswith("minute"):
                    unit = "minutes"
                elif unit_raw.startswith("hour"):
                    unit = "hours"
                elif unit_raw.startswith("week"):
                    unit = "weeks"
                elif unit_raw.startswith("month"):
                    unit = "months"
                else:
                    unit = "days"
            else:
                # Fallbacks
                if "minute" in interval_clean:
                    unit = "minutes"
                    val = 5
                elif "hour" in interval_clean:
                    unit = "hours"
                    val = 1
                elif "week" in interval_clean:
                    unit = "weeks"
                    val = 1
                elif "month" in interval_clean:
                    unit = "months"
                    val = 1
                else:
                    unit = "days"
                    val = 1
                 
        # Determine max chunk days allowed by Upstox V3 limits (OpenAlgo standard)
        if unit == "minutes":
            chunk_days = 30 if val <= 15 else 90
        elif unit == "hours":
            chunk_days = 90
        elif unit == "days":
            chunk_days = 3650
        else:
            chunk_days = 7300

        try:
            d_to = datetime.strptime(to_date, "%Y-%m-%d").date()
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date()
        except Exception:
            # Direct fallback if date strings cannot be parsed
            endpoint = f"v3/historical-candle/{key}/{unit}/{val}/{to_date}/{from_date}"
            return self.request("GET", endpoint)

        # Single chunk path if within allowed span
        if (d_to - d_from).days <= chunk_days:
            endpoint = f"v3/historical-candle/{key}/{unit}/{val}/{to_date}/{from_date}"
            res = self.request("GET", endpoint)
            if res.get("status") == "success" and "data" in res and "candles" in res["data"]:
                candles = res["data"]["candles"]
                if candles:
                    try:
                        import parquet_query
                        clean_key = instrument_key.replace("%7C", "|")
                        parquet_query.save_candles_to_parquet_by_key(clean_key, interval, candles)
                    except Exception as save_err:
                        log.warning("Failed to auto-save to Parquet: %s", save_err)
            return res

        # Multi-chunk retrieval: query backwards from to_date to from_date
        log.info(f"Chunking historical request for {instrument_key} ({interval}) across {(d_to - d_from).days} days in {chunk_days}-day slices...")
        all_candles = []
        cur_to = d_to
        while cur_to >= d_from:
            cur_from = max(d_from, cur_to - timedelta(days=chunk_days - 1))
            c_to_str = cur_to.strftime("%Y-%m-%d")
            c_from_str = cur_from.strftime("%Y-%m-%d")
            endpoint = f"v3/historical-candle/{key}/{unit}/{val}/{c_to_str}/{c_from_str}"
            try:
                res = self.request("GET", endpoint)
                if res.get("status") == "success" and "data" in res and "candles" in res["data"]:
                    c_data = res["data"]["candles"]
                    if c_data:
                        all_candles.extend(c_data)
            except Exception as e:
                log.warning(f"Chunk {c_from_str} to {c_to_str} failed for {key}: {e}")
            cur_to = cur_from - timedelta(days=1)

        # Deduplicate and sort candles by timestamp (newest first to match Upstox convention)
        unique_candles = {}
        for c in all_candles:
            if isinstance(c, list) and len(c) > 0:
                ts = c[0]
                if ts not in unique_candles:
                    unique_candles[ts] = c
        sorted_candles = sorted(unique_candles.values(), key=lambda x: x[0], reverse=True)

        if sorted_candles:
            try:
                import parquet_query
                clean_key = instrument_key.replace("%7C", "|")
                parquet_query.save_candles_to_parquet_by_key(clean_key, interval, sorted_candles)
            except Exception as save_err:
                log.warning("Failed to auto-save chunked candles to Parquet: %s", save_err)

        return {
            "status": "success",
            "data": {
                "candles": sorted_candles
            }
        }

    def get_option_chain(self, instrument_key: str, expiry_date: str) -> dict:
        """Fetches option chain for an underlying instrument and expiry date"""
        params = {
            "instrument_key": instrument_key,
            "expiry_date": expiry_date
        }
        return self.request("GET", "option/chain", params=params)

    def get_option_contracts(self, instrument_key: str) -> dict:
        """Fetches expiries and strikes for an underlying instrument"""
        params = {"instrument_key": instrument_key}
        return self.request("GET", "option/contract", params=params)

    def get_fii_data(self, data_type: str = "NSE_FO|INDEX_FUTURES", interval: str = "1D") -> dict:
        """Fetches FII activity data"""
        params = {"data_type": data_type, "interval": interval}
        return self.request("GET", "market/fii", params=params)

    def get_dii_data(self, data_type: str = "NSE_EQ|CASH", interval: str = "1D") -> dict:
        """Fetches DII activity data"""
        params = {"data_type": data_type, "interval": interval}
        return self.request("GET", "market/dii", params=params)

    def get_oi(self, instrument_key: str, expiry: str, date: str = None) -> dict:
        """Fetches total Call and Put Open Interest per strike"""
        if not date:
            date = datetime.now().strftime("%Y-%m-%d")
        params = {"instrument_key": instrument_key, "expiry": expiry, "date": date}
        return self.request("GET", "market/oi", params=params)

    def get_oi_change(self, instrument_key: str, expiry: str, date: str = None, interval: int = 15) -> dict:
        """Fetches intraday Call and Put OI changes per strike"""
        if not date:
            date = datetime.now().strftime("%Y-%m-%d")
        params = {
            "instrument_key": instrument_key,
            "expiry": expiry,
            "date": date,
            "interval": int(interval)
        }
        return self.request("GET", "market/change-oi", params=params)

    def get_max_pain(self, instrument_key: str) -> dict:
        """Fetches Max Pain strike level"""
        params = {"instrument_key": instrument_key}
        return self.request("GET", "market/max-pain", params=params)

    def get_pcr(self, instrument_key: str) -> dict:
        """Fetches Put-Call Ratio with automatic expiry resolution and option chain calculation fallback"""
        nearest_expiry = None
        try:
            contracts_data = self.get_option_contracts(instrument_key)
            if contracts_data.get("status") == "success" and isinstance(contracts_data.get("data"), list):
                expiries = sorted(list(set(c.get("expiry") for c in contracts_data["data"] if c.get("expiry"))))
                if expiries:
                    nearest_expiry = expiries[0]
        except Exception as e:
            log.warning("Failed to resolve expiry for PCR: %s", e)
        
        if nearest_expiry:
            today_str = datetime.now().strftime("%Y-%m-%d")
            try:
                params = {
                    "instrument_key": instrument_key,
                    "expiry": nearest_expiry,
                    "date": today_str,
                    "bucket_interval": 60
                }
                res = self.request("GET", "market/pcr", params=params)
                if res.get("status") == "success" and "data" in res:
                    return res
            except Exception as e:
                log.warning("Upstox market/pcr failed: %s. Falling back to option chain PCR calculation.", e)
            
            # Fallback: calculate PCR from option chain
            try:
                chain_res = self.get_option_chain(instrument_key, nearest_expiry)
                if chain_res.get("status") == "success" and isinstance(chain_res.get("data"), list):
                    total_put_oi = 0.0
                    total_call_oi = 0.0
                    for opt in chain_res["data"]:
                        call_data = opt.get("call_options")
                        put_data = opt.get("put_options")
                        if call_data:
                            total_call_oi += float(call_data.get("market_data", {}).get("oi", 0.0))
                        if put_data:
                            total_put_oi += float(put_data.get("market_data", {}).get("oi", 0.0))
                    pcr_calc = total_put_oi / total_call_oi if total_call_oi > 0 else 0.0
                    return {
                        "status": "success",
                        "data": {
                            "instrument_key": instrument_key,
                            "expiry_date": nearest_expiry,
                            "pcr": pcr_calc,
                            "spot_closing_price": 0.0,
                            "insights": []
                        }
                    }
            except Exception as e:
                log.error("Fallback option chain PCR calculation failed: %s", e)

        # Final fallback default
        return {
            "status": "success",
            "data": {
                "instrument_key": instrument_key,
                "expiry_date": nearest_expiry or "",
                "pcr": 1.0,
                "spot_closing_price": 0.0,
                "insights": []
            }
        }

    def get_market_status(self, segment: str = "NSE_CM") -> dict:
        """Fetches exchange market status (open/close/pre-open)"""
        # Map segment names to the exchange codes expected by Upstox API
        segment_upper = segment.upper()
        mapping = {
            "NSE_CM": "NSE",
            "NSE_FO": "NFO",
            "BSE_CM": "BSE",
            "BSE_FO": "BFO",
            "MCX": "MCX",
        }
        exchange = mapping.get(segment_upper, segment_upper)
        return self.request("GET", f"market/status/{exchange}")

    def get_market_holidays(self) -> dict:
        """Fetches holiday calendar"""
        return self.request("GET", "market/holidays")

    def get_company_profile(self, isin: str) -> dict:
        """Fetches company metadata by ISIN"""
        return self.request("GET", f"fundamentals/{isin}/profile")

    def get_key_ratios(self, isin: str) -> dict:
        """Fetches key financial ratios by ISIN"""
        return self.request("GET", f"fundamentals/{isin}/key-ratios")

    def get_shareholdings(self, isin: str) -> dict:
        """Fetches quarterly shareholding pattern by ISIN"""
        return self.request("GET", f"fundamentals/{isin}/share-holdings")

    def get_corporate_actions(self, isin: str) -> dict:
        """Fetches corporate actions (dividends, splits) by ISIN"""
        return self.request("GET", f"fundamentals/{isin}/corporate-actions")

    def get_competitors(self, isin: str) -> dict:
        """Fetches competitor keys by ISIN using resolved instrument key"""
        import db
        # Resolve ISIN to instrument key first
        conn = db.get_db_connection()
        cursor = conn.cursor()
        instrument_key = None
        try:
            cursor.execute("SELECT instrument_key FROM upstox_instruments WHERE isin = ? LIMIT 1", (isin,))
            row = cursor.fetchone()
            if row:
                instrument_key = row["instrument_key"]
        except Exception as e:
            log.error("Error resolving ISIN to instrument key: %s", e)
        finally:
            conn.close()
            
        if not instrument_key:
            # Fallback to standard ISIN (might fail)
            instrument_key = isin
            
        # Replace '|' with '%7C' to prevent URL path encoding issues
        key_encoded = instrument_key.replace("|", "%7C")
        return self.request("GET", f"fundamentals/{key_encoded}/competitors")

    # --- Phase 1: Complete Fundamentals ---
    def get_balance_sheet(self, isin: str) -> dict:
        """Fetches quarterly balance sheet (assets, liabilities) by ISIN"""
        return self.request("GET", f"fundamentals/{isin}/balance-sheet")

    def get_cash_flow(self, isin: str) -> dict:
        """Fetches quarterly cash flow statement by ISIN"""
        return self.request("GET", f"fundamentals/{isin}/cash-flow")

    def get_income_statement(self, isin: str) -> dict:
        """Fetches quarterly income statement (revenue, EBITDA, net profit) by ISIN"""
        return self.request("GET", f"fundamentals/{isin}/income-statement")

    # --- Phase 2: Intraday Candles + Lightweight Quotes ---
    def get_intraday_candles(self, instrument_key: str, interval: str = "5minute") -> dict:
        """Fetches today's intraday OHLC candles. Intervals: 1minute, 5minute, 15minute, 30minute, 1hour"""
        key = instrument_key.replace("|", "%7C")
        
        # Parse interval to V3 unit and numeric interval (e.g. "5minute" -> "minutes/5")
        import re
        match = re.match(r"(\d+)\s*(minute|minutes|hour|hours|day|days)", interval.lower())
        if match:
            val = int(match.group(1))
            unit_raw = match.group(2)
            if unit_raw.startswith("minute"):
                unit = "minutes"
            elif unit_raw.startswith("hour"):
                unit = "hours"
            else:
                unit = "days"
        else:
            # Fallbacks
            if "minute" in interval.lower():
                unit = "minutes"
                val = 5
            elif "hour" in interval.lower():
                unit = "hours"
                val = 1
            else:
                unit = "days"
                val = 1
                
        res = self.request("GET", f"v3/historical-candle/intraday/{key}/{unit}/{val}")
        
        # If market is closed, save/merge finalized candles to Parquet archive
        if not self.is_indian_market_open() and res and res.get("status") == "success" and "data" in res:
            try:
                candles = res["data"].get("candles", [])
                if candles:
                    import parquet_query
                    clean_key = instrument_key.replace("%7C", "|").replace("%7c", "|")
                    # Clean up interval representation to match standard formats (e.g. "5minute")
                    clean_interval = f"{val}minute" if unit == "minutes" else f"{val}hour" if unit == "hours" else f"{val}day"
                    parquet_query.save_candles_to_parquet_by_key(clean_key, clean_interval, candles)
                    log.info("Finalized after-market intraday candles saved for %s (%s)", instrument_key, clean_interval)
            except Exception as save_err:
                log.warning("Failed to auto-save post-market intraday to Parquet: %s", save_err)
                
        return res

    def get_ltp_quotes(self, instrument_keys: list[str]) -> dict:
        """Fetches ultra-lightweight LTP-only quotes (just last price + change). Much cheaper than full quotes."""
        all_data = {}
        for i in range(0, len(instrument_keys), 500):
            chunk = instrument_keys[i:i+500]
            keys_str = ",".join(chunk)
            res = self.request("GET", "v3/market-quote/ltp", params={"instrument_key": keys_str})
            if res.get("status") == "success" and "data" in res:
                all_data.update(res["data"])
        return all_data

    def get_ohlc_quotes(self, instrument_keys: list[str], interval: str = "1d") -> dict:
        """Fetches OHLC-only quotes (open, high, low, close + LTP). Lighter than full quotes."""
        all_data = {}
        for i in range(0, len(instrument_keys), 500):
            chunk = instrument_keys[i:i+500]
            keys_str = ",".join(chunk)
            res = self.request("GET", "v3/market-quote/ohlc", params={"instrument_key": keys_str, "interval": interval})
            if res.get("status") == "success" and "data" in res:
                all_data.update(res["data"])
        return all_data

    # --- Phase 3: Market Information Extras ---
    def get_options_smartlist(self, asset_type: str, category: str, page_number: int = None, page_size: int = None) -> dict:
        """Most actively traded options instruments"""
        import db
        cap = db.get_provider_capability("upstox", "options_smartlist")
        if cap and cap.get("state") == "entitlement_required":
            return {
                "status": "error",
                "error": "entitlement_required",
                "message": cap.get("diagnostic") or "Upstox Plus entitlement required"
            }
        params = {"asset_type": asset_type, "category": category}
        if page_number is not None:
            params["page_number"] = page_number
        if page_size is not None:
            params["page_size"] = page_size
        return self.request("GET", "v2/market/smartlist/options", params=params)

    def get_futures_smartlist(self, asset_type: str, category: str, page_number: int = None, page_size: int = None) -> dict:
        """Most actively traded futures instruments"""
        import db
        cap = db.get_provider_capability("upstox", "futures_smartlist")
        if cap and cap.get("state") == "entitlement_required":
            return {
                "status": "error",
                "error": "entitlement_required",
                "message": cap.get("diagnostic") or "Upstox Plus entitlement required"
            }
        params = {"asset_type": asset_type, "category": category}
        if page_number is not None:
            params["page_number"] = page_number
        if page_size is not None:
            params["page_size"] = page_size
        return self.request("GET", "v2/market/smartlist/futures", params=params)

    def get_mtf_smartlist(self, page_number: int = None, page_size: int = None) -> dict:
        """Instruments eligible for Margin Trading Facility"""
        import db
        cap = db.get_provider_capability("upstox", "mtf_smartlist")
        if cap and cap.get("state") == "entitlement_required":
            return {
                "status": "error",
                "error": "entitlement_required",
                "message": cap.get("diagnostic") or "Upstox Plus entitlement required"
            }
        params = {}
        if page_number is not None:
            params["page_number"] = page_number
        if page_size is not None:
            params["page_size"] = page_size
        return self.request("GET", "v2/market/smartlist/mtf", params=params)

    def get_market_timings(self, date: str) -> dict:
        """Market session timings for a given date (YYYY-MM-DD)"""
        return self.request("GET", f"v2/market/timings/{date}")

    # --- Phase 4: Expired Instruments ---
    def get_expiries(self, instrument_key: str, segment: str = "options") -> dict:
        """Fetches list of past expiry dates for backtesting"""
        return self.request("GET", "v2/expired-instruments/expiries", params={
            "instrument_key": instrument_key
        })

    def get_expired_option_contracts(self, instrument_key: str, expiry_date: str) -> dict:
        """Fetches list of expired option contracts by underlying and expiry date"""
        return self.request("GET", "v2/expired-instruments/option/contract", params={
            "instrument_key": instrument_key,
            "expiry_date": expiry_date
        })

    def get_expired_future_contracts(self, instrument_key: str, expiry_date: str) -> dict:
        """Fetches list of expired future contracts by underlying and expiry date"""
        return self.request("GET", "v2/expired-instruments/future/contract", params={
            "instrument_key": instrument_key,
            "expiry_date": expiry_date
        })

    def get_expired_historical_candles(self, instrument_key: str, interval: str, to_date: str, from_date: str) -> dict:
        """Fetches historical candles for an expired contract"""
        key = instrument_key.replace("|", "%7C")
        return self.request("GET", f"v2/expired-instruments/historical-candle/{key}/{interval}/{to_date}/{from_date}")

    # --- Phase 5: IPO Tracker ---
    def get_ipos(self, status: str = "upcoming", bypass_cache: bool = False) -> dict:
        """Fetches IPO list. Status: upcoming, open, closed, listed"""
        return self.request("GET", "v2/ipos", params={"status": status}, bypass_cache=bypass_cache)

    def get_ipo_details(self, ipo_id: str, bypass_cache: bool = False) -> dict:
        """Fetches detailed IPO info by ID"""
        return self.request("GET", f"v2/ipos/{ipo_id}", bypass_cache=bypass_cache)

    def get_news(self, category: str, instrument_keys: list[str] = None) -> dict:
        """Fetches news by category and optional list of instrument keys"""
        # If instrument_keys are provided, category must be "instrument_keys" according to Upstox API spec
        cat_to_use = "instrument_keys" if instrument_keys else category
        if cat_to_use not in ["instrument_keys", "positions", "holdings"]:
            cat_to_use = "holdings"
            
        params = {"category": cat_to_use}
        if instrument_keys:
            params["instrument_keys"] = ",".join(instrument_keys)
        return self.request("GET", "v2/news", params=params)

    def get_option_greek(self, instrument_keys: list[str]) -> dict:
        """
        GET /v3/market-quote/option-greek
        Returns live delta, theta, gamma, vega, rho per option contract.
        Max 500 instruments per call. Requires V3 scope.
        """
        keys_str = ",".join(instrument_keys[:500])
        return self.request("GET", "v3/market-quote/option-greek", 
                             params={"instrument_key": keys_str})

    # --- Phase 2: GTT Orders ---
    def get_gtt_orders(self, gtt_order_id: str = None) -> dict:
        """GET /v3/order/gtt — Fetch all active GTT orders or details of a specific GTT order"""
        params = {}
        if gtt_order_id:
            params["gtt_order_id"] = gtt_order_id
        return self.request("GET", "v3/order/gtt", params=params)

    def place_gtt_order(self, payload: dict) -> dict:
        """POST /v3/order/gtt/place — Create a new GTT trigger"""
        return self.request("POST", "v3/order/gtt/place", data=payload)

    def modify_gtt_order(self, payload: dict) -> dict:
        """PUT /v3/order/gtt/modify — Modify an existing GTT"""
        return self.request("PUT", "v3/order/gtt/modify", data=payload)

    def cancel_gtt_order(self, gtt_order_id: str) -> dict:
        """DELETE /v3/order/gtt/cancel — Cancel a GTT"""
        return self.request("DELETE", "v3/order/gtt/cancel",
                             params={"gtt_order_id": gtt_order_id})

    # --- Phase 3: Brokerage & Margin Calculators ---
    def get_brokerage(self, instrument_token: str, quantity: int,
                      product: str, transaction_type: str, price: float) -> dict:
        """GET /v2/charges/brokerage — Compute exact brokerage for a potential trade"""
        return self.request("GET", "charges/brokerage", params={
            "instrument_token": instrument_token,
            "quantity": int(quantity),
            "product": product,
            "transaction_type": transaction_type,
            "price": float(price)
        })

    def calculate_margin(self, orders: list) -> dict:
        """POST /v2/charges/margin — Compute margin for a basket of orders"""
        return self.request("POST", "charges/margin", data={"orders": orders})

    def get_historical_trades(self, segment: str, start_date: str, 
                              end_date: str, page_number: int = 1, 
                              page_size: int = 50) -> dict:
        """GET /v2/charges/historical-trades — Trade history with charges"""
        return self.request("GET", "charges/historical-trades", params={
            "segment": segment,
            "start_date": start_date,
            "end_date": end_date,
            "page_number": int(page_number),
            "page_size": int(page_size)
        })

    # --- Phase 4: Trade P&L Mining ---
    def get_trade_pnl_metadata(self) -> dict:
        """GET /v2/trade/profit-loss/metadata — Available years/months for P&L"""
        return self.request("GET", "trade/profit-loss/metadata")

    def get_trade_pnl_data(self, segment: str, financial_year: str,
                            page_number: int = 1, page_size: int = 50) -> dict:
        """GET /v2/trade/profit-loss/data — P&L broken down by trade"""
        return self.request("GET", "trade/profit-loss/data", params={
            "segment": segment,
            "financial_year": financial_year,
            "page_number": int(page_number),
            "page_size": int(page_size)
        })

    def get_trade_pnl_charges(self, segment: str, financial_year: str,
                               page_number: int = 1, page_size: int = 50) -> dict:
        """GET /v2/trade/profit-loss/charges — Per-trade charges breakdown"""
        return self.request("GET", "trade/profit-loss/charges", params={
            "segment": segment,
            "financial_year": financial_year,
            "page_number": int(page_number),
            "page_size": int(page_size)
        })

    # --- Phase 5 & 10: User Account Diagnostics & Safety ---
    def get_user_profile(self) -> dict:
        """GET /v2/user/profile — Account name, ID, tier"""
        return self.request("GET", "user/profile")

    def get_funds_and_margin(self, segment: str = None) -> dict:
        """GET /v2/user/get-funds-and-margin — Available funds and margin"""
        params = {"segment": segment} if segment else {}
        return self.request("GET", "user/get-funds-and-margin", params=params)

    def get_funds_and_margin_v3(self, segment: str = None) -> dict:
        """GET /v3/user/get-funds-and-margin — V3 version with MTF data"""
        params = {"segment": segment} if segment else {}
        return self.request("GET", "v3/user/get-funds-and-margin", params=params)

    def get_holdings(self) -> dict:
        """GET /v2/portfolio/long-term-holdings — Upstox-side holdings"""
        return self.request("GET", "portfolio/long-term-holdings")

    def get_positions(self) -> dict:
        """GET /v2/portfolio/short-term-positions — Upstox-side positions"""
        return self.request("GET", "portfolio/short-term-positions")

    def get_mtf_positions(self) -> dict:
        """GET /v3/portfolio/mtf-positions — Margin Trade Funding positions"""
        return self.request("GET", "v3/portfolio/mtf-positions")

    def get_kill_switch_status(self) -> dict:
        """GET /v2/user/kill-switch — Check if kill switch is active"""
        return self.request("GET", "user/kill-switch")

    def activate_kill_switch(self, kill_switch_status: str) -> dict:
        """POST /v2/user/kill-switch — Activate or deactivate kill switch"""
        return self.request("POST", "user/kill-switch", 
                             params={"kill_switch_status": kill_switch_status})

    def get_ip_whitelist(self) -> dict:
        """GET /v2/user/ip — Get whitelisted IPs"""
        return self.request("GET", "user/ip")

    def update_ip_whitelist(self, payload: dict) -> dict:
        """PUT /v2/user/ip — Update whitelisted IPs"""
        return self.request("PUT", "user/ip", data=payload)

    # --- Phase 6: Portfolio Stream Feed ---
    def get_portfolio_stream_authorize(self, update_types: list[str] = None) -> dict:
        """
        GET /v2/feed/portfolio-stream-feed/authorize
        Returns a WebSocket URI for portfolio event streaming.
        update_types: ["order_updates", "position_updates", "holdings_updates"]
        """
        params = {}
        if update_types:
            params["update_types"] = ",".join(update_types)
        return self.request("GET", "feed/portfolio-stream-feed/authorize", params=params)




# Singleton Upstox Client
upstox_client = UpstoxClient()

# Global state for bulk volume avg progress tracking
bulk_vol_progress = {
    "is_scanning": False,
    "total": 0,
    "current": 0,
    "current_symbol": "",
    "error_count": 0,
    "last_completed": None
}

def download_and_sync_instruments():
    """Downloads exchange instrument master GZ file (complete across all exchanges) and caches in local SQLite DB (OpenAlgo standard)"""
    import db
    log.info("Starting download of complete instrument master from Upstox (OpenAlgo standard)...")
    url = "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
    INDEX_ALIASES = {
        "NIFTY 50": "NIFTY",
        "NIFTY NEXT 50": "NIFTYNXT50",
        "NIFTY FIN SERVICE": "FINNIFTY",
        "NIFTY BANK": "BANKNIFTY",
        "NIFTY MID SELECT": "MIDCPNIFTY",
        "INDIA VIX": "INDIAVIX",
        "BSE SENSEX": "SENSEX",
        "SENSEX 50": "SENSEX50",
        "BANKEX": "BANKEX",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=60.0)
        resp.raise_for_status()
        log.info("Decompressing complete master JSON...")
        content = gzip.decompress(resp.content).decode('utf-8')
        items = json.loads(content)
        log.info("Parsed %d total items from complete.json.gz. Preparing database batch...", len(items))

        batch = []
        total_saved = 0
        for item in items:
            symbol = item.get("trading_symbol")
            instrument_key = item.get("instrument_key")
            if not symbol or not instrument_key:
                continue
            segment = item.get("segment", "NSE_EQ")
            batch.append({
                "symbol": symbol,
                "isin": item.get("isin", ""),
                "instrument_key": instrument_key,
                "exchange": segment,
                "lot_size": int(item.get("lot_size", 1))
            })
            if symbol in INDEX_ALIASES:
                batch.append({
                    "symbol": INDEX_ALIASES[symbol],
                    "isin": item.get("isin", ""),
                    "instrument_key": instrument_key,
                    "exchange": segment,
                    "lot_size": int(item.get("lot_size", 1))
                })

            if len(batch) >= 5000:
                db.save_upstox_instruments(batch)
                total_saved += len(batch)
                batch = []

        if batch:
            db.save_upstox_instruments(batch)
            total_saved += len(batch)

        log.info("Successfully synced complete Upstox master: %d instruments saved/updated.", total_saved)
        return total_saved
    except Exception as e:
        log.error("Failed to sync complete master: %s", e)
        raise e

def update_historical_volume_avg(symbol: str, days: int = 20) -> dict:
    """Fetches daily candles, calculates average volume and absolute change %, and caches to DB"""
    symbol_upper = symbol.upper().strip()
    
    # Check if we already have a valid cached entry for today in SQLite
    import db
    cached = db.get_upstox_volume_avg(symbol_upper)
    if cached:
        today_str = datetime.now().strftime("%Y-%m-%d")
        if cached.get("updated_at") == today_str and cached.get("candle_count", 0) >= days and cached.get("avg_abs_change_20d") is not None:
            return {
                "symbol": symbol_upper,
                "avg_volume_20d": cached["avg_volume_20d"],
                "avg_abs_change_20d": cached["avg_abs_change_20d"],
                "candle_count": cached["candle_count"],
                "updated_at": cached["updated_at"]
            }

    key = db.get_upstox_instrument_key(symbol_upper, exchange="NSE_EQ")
    if not key:
        key = db.get_upstox_instrument_key(symbol_upper)
    
    if not key:
        raise ValueError(f"Instrument key not found for symbol: {symbol_upper}")
        
    end_date = datetime.now().strftime("%Y-%m-%d")
    # Fetch 40 calendar days back to cover 20 trading days
    start_date = (datetime.now() - timedelta(days=40)).strftime("%Y-%m-%d")
    
    endpoint = f"v2/historical-candle/{key.replace('|', '%7C')}/day/{end_date}/{start_date}"
    res = upstox_client.request("GET", endpoint)
    
    if res.get("status") == "success" and "data" in res and "candles" in res["data"]:
        candles = res["data"]["candles"]
        # Take the first N candles (newest first)
        volumes = []
        abs_changes = []
        for candle in candles[:days]:
            volumes.append(float(candle[5] or 0))
            c_open = float(candle[1] or 0)
            c_close = float(candle[4] or 0)
            abs_chg = abs((c_close - c_open) / c_open) * 100 if c_open else 0.0
            abs_changes.append(abs_chg)
            
        if not volumes:
            raise ValueError(f"No candle data returned for key: {key}")
            
        avg_vol = sum(volumes) / len(volumes)
        avg_abs_chg = sum(abs_changes) / len(abs_changes) if abs_changes else 1.0
        db.save_upstox_volume_avg(symbol_upper, avg_vol, avg_abs_chg, len(volumes))
        return {
            "symbol": symbol_upper,
            "avg_volume_20d": avg_vol,
            "avg_abs_change_20d": avg_abs_chg,
            "candle_count": len(volumes),
            "updated_at": datetime.now().strftime("%Y-%m-%d")
        }
    else:
        raise ValueError(f"Upstox returned unsuccessful state for historical candles: {res}")

def update_bulk_volume_averages(symbols: list, days: int = 20):
    """Loops and stores 20-day volume average for a list of symbols"""
    global bulk_vol_progress
    bulk_vol_progress["is_scanning"] = True
    bulk_vol_progress["total"] = len(symbols)
    bulk_vol_progress["current"] = 0
    bulk_vol_progress["error_count"] = 0
    bulk_vol_progress["last_completed"] = None
    
    for symbol in symbols:
        if not bulk_vol_progress["is_scanning"]:
            log.info("Cancelled bulk volume scanning.")
            break
        symbol = symbol.upper().strip()
        bulk_vol_progress["current_symbol"] = symbol
        try:
            update_historical_volume_avg(symbol, days)
            time.sleep(0.1) # 100ms rate friendliness
        except Exception as e:
            log.error("Bulk volume average update failed for %s: %s", symbol, e)
            bulk_vol_progress["error_count"] += 1
        bulk_vol_progress["current"] += 1
        
    bulk_vol_progress["is_scanning"] = False
    bulk_vol_progress["current_symbol"] = ""
    bulk_vol_progress["last_completed"] = datetime.now().isoformat()
    log.info("Completed volume average update.")
