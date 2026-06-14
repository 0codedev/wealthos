import os
import sys
import time
import base64
import hashlib
import hmac
import struct
import requests
from logger import get_logger

log = get_logger("dhan_client", tag="DHAN")
from datetime import datetime

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.credential_store import SecureCredentialStore

class DhanClient:
    API_BASE_URL = "https://api.dhan.co"
    AUTH_BASE_URL = "https://auth.dhan.co"

    def __init__(self):
        self.last_auth_attempt = 0
        self.auth_cooldown = 130  # seconds
        self.session = requests.Session()
        self.session.trust_env = True

    def generate_totp(self) -> str:
        """
        Generates standard 6-digit TOTP code from stored secret.
        Self-contained, requires no external dependencies.
        """
        secret = SecureCredentialStore.get_credential("dhan_totp_secret")
        if not secret:
            return ""
        
        try:
            secret = secret.replace(" ", "").replace("-", "").upper()
            padding = len(secret) % 8
            if padding != 0:
                secret += "=" * (8 - padding)
                
            key = base64.b32decode(secret)
            counter = int(time.time() / 30)
            msg = struct.pack(">Q", counter)
            
            digest = hmac.new(key, msg, hashlib.sha1).digest()
            offset = digest[-1] & 0x0f
            binary = struct.unpack(">I", digest[offset:offset+4])[0] & 0x7fffffff
            otp = binary % 1000000
            return f"{otp:06d}"
        except Exception as e:
            log.info(f"TOTP generation failed: {e}")
            return ""

    def authenticate(self) -> bool:
        """
        Calls generateAccessToken on Dhan Auth server using PIN + TOTP.
        """
        client_id = SecureCredentialStore.get_credential("dhan_client_id")
        pin = SecureCredentialStore.get_credential("dhan_pin")
        totp = self.generate_totp()

        if not client_id or not pin or not totp:
            log.info("Missing credentials or TOTP. Skipping authentication.")
            return False

        now = time.time()
        if now - self.last_auth_attempt < self.auth_cooldown:
            log.info(f"Auth cooldown active. Try again in {int(self.auth_cooldown - (now - self.last_auth_attempt))}s.")
            return False
        
        self.last_auth_attempt = now

        try:
            url = f"{self.AUTH_BASE_URL}/app/generateAccessToken"
            params = {
                "dhanClientId": client_id,
                "pin": pin,
                "totp": totp
            }
            res = self.session.post(url, params=params, headers={"Accept": "application/json"}, timeout=(2.5, 5.0))
            data = res.json()

            if res.status_code == 200 and "data" in data and "accessToken" in data["data"]:
                token = data["data"]["accessToken"]
                SecureCredentialStore.set_credential("dhan_access_token", token)
                log.info("Auto-login successful. Access token updated.")
                return True
            else:
                log.info(f"Authentication failed: {data}")
                return False
        except Exception as e:
            log.info(f"Network error during auth: {e}")
            return False

    def get_headers(self) -> dict:
        client_id = SecureCredentialStore.get_credential("dhan_client_id")
        access_token = SecureCredentialStore.get_credential("dhan_access_token")
        return {
            "client-id": client_id or "",
            "access-token": access_token or "",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

    def request_with_retry(self, method: str, path: str, **kwargs) -> requests.Response:
        """
        Handles requests with automatic renewal on 401.
        """
        url = f"{self.API_BASE_URL}{path}"
        headers = self.get_headers()
        
        # Merge headers
        if "headers" in kwargs:
            headers.update(kwargs["headers"])
        kwargs["headers"] = headers

        if "timeout" not in kwargs:
            kwargs["timeout"] = (2.5, 5.0)

        try:
            res = self.session.request(method, url, **kwargs)
            # Dhan sometimes returns 400 with DH-906 "Invalid Token" instead of 401 Unauthorized
            is_invalid_token = res.status_code == 401 or (
                res.status_code == 400 and ("DH-906" in res.text or "Invalid Token" in res.text)
            )
            if is_invalid_token:
                log.info("Token expired or invalid (401/400 DH-906). Retrying auth...")
                if self.authenticate():
                    # Update token header and retry
                    kwargs["headers"] = self.get_headers()
                    res = self.session.request(method, url, **kwargs)
            return res
        except Exception as e:
            log.info(f"Request exception for {path}: {e}")
            raise e

    def get_holdings(self) -> list:
        try:
            res = self.request_with_retry("GET", "/v2/holdings")
            if res.status_code == 200:
                data = res.json()
                return data if isinstance(data, list) else data.get("data", [])
            return []
        except Exception:
            return []

    def get_positions(self) -> list:
        try:
            res = self.request_with_retry("GET", "/v2/positions")
            if res.status_code == 200:
                data = res.json()
                return data if isinstance(data, list) else data.get("data", [])
            return []
        except Exception:
            return []

    def get_trades(self) -> list:
        try:
            res = self.request_with_retry("GET", "/v2/trades")
            if res.status_code == 200:
                data = res.json()
                return data if isinstance(data, list) else data.get("data", [])
            return []
        except Exception:
            return []

    def get_ltp(self, request_body: dict) -> dict:
        """
        Fetches LTP for a set of security ids.
        Format of request_body: { "NSE_EQ": [2885, 11536], "IDX_I": [13, 25] }
        """
        try:
            res = self.request_with_retry("POST", "/v2/marketfeed/ltp", json=request_body)
            if res.status_code == 200:
                return res.json().get("data", {})
            return {}
        except Exception:
            return {}

    def get_ohlc(self, request_body: dict) -> dict:
        try:
            res = self.request_with_retry("POST", "/v2/marketfeed/ohlc", json=request_body)
            if res.status_code == 200:
                return res.json().get("data", {})
            return {}
        except Exception:
            return {}

    def place_order(self, order_req: dict) -> dict:
        try:
            res = self.request_with_retry("POST", "/v2/orders", json=order_req)
            return res.json()
        except Exception as e:
            return {"status": "failure", "remarks": str(e)}

    def modify_order(self, order_id: str, order_req: dict) -> dict:
        try:
            res = self.request_with_retry("PUT", f"/v2/orders/{order_id}", json=order_req)
            return res.json()
        except Exception as e:
            return {"status": "failure", "remarks": str(e)}

    def cancel_order(self, order_id: str) -> dict:
        try:
            res = self.request_with_retry("DELETE", f"/v2/orders/{order_id}")
            return res.json()
        except Exception as e:
            return {"status": "failure", "remarks": str(e)}

dhan_client = DhanClient()
