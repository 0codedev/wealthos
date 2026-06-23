"""
python-bridge/services/vault_client.py — Production Vault & Credential Store Client

Provides zero-risk credential retrieval from HashiCorp Vault (or local Vault dev instance),
with automatic, seamless fallback to process environment variables (os.getenv).
Ensures zero disruption — if Vault is offline or token is unconfigured, the platform
falls back gracefully to environment variables with audit log warnings.
"""

import os
import logging
from typing import Optional

log = logging.getLogger("vault_client")

_hvac_installed = False
try:
    import hvac
    _hvac_installed = True
except ImportError:
    _hvac_installed = False
    log.info("[VAULT] hvac package not installed. Using environment variable fallback.")

class VaultClient:
    def __init__(self):
        self.vault_url = os.getenv("VAULT_URL", "http://127.0.0.1:8200")
        self.vault_token = os.getenv("VAULT_TOKEN", "")
        self.mount_point = os.getenv("VAULT_MOUNT_POINT", "secret")
        self.secret_path = os.getenv("VAULT_SECRET_PATH", "wealthos")
        self._client = None
        self._initialized = False

    def _get_client(self):
        """Lazily connects to HashiCorp Vault instance."""
        if self._initialized:
            return self._client

        self._initialized = True
        if not _hvac_installed or not self.vault_token:
            log.info("[VAULT] Operating in local environment variable fallback mode.")
            return None

        try:
            client = hvac.Client(url=self.vault_url, token=self.vault_token)
            if client.is_authenticated():
                self._client = client
                log.info(f"[VAULT] ✅ Authenticated successfully with Vault server at {self.vault_url}")
            else:
                log.warning("[VAULT] Vault token authentication failed. Falling back to environment variables.")
                self._client = None
        except Exception as e:
            log.warning(f"[VAULT] Failed to connect to Vault at {self.vault_url}: {e}. Operating on fallback.")
            self._client = None

        return self._client

    def get_secret(self, key: str, default: str = "") -> str:
        """
        Retrieves secret value for key.
        1. Checks HashiCorp Vault KV secret store first (if active)
        2. Falls back to os.getenv(key, default) if Vault unavailable or key missing
        """
        client = self._get_client()
        if client is not None:
            try:
                secret_res = client.secrets.kv.v2.read_secret_version(
                    path=self.secret_path,
                    mount_point=self.mount_point
                )
                data = secret_res.get("data", {}).get("data", {})
                if key in data and data[key]:
                    return str(data[key])
            except Exception as e:
                log.debug(f"[VAULT] Vault read error for key '{key}': {e}")

        # Fallback to environment variable
        return os.getenv(key, default)

# Global singleton instance
vault = VaultClient()

def get_secret(key: str, default: str = "") -> str:
    """Convenience helper function for secret retrieval."""
    return vault.get_secret(key, default)
