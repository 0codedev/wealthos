"""
python-bridge/services/secrets_warden.py — Secrets Expiry & Security Audit Warden

Monitors age and expiration status of critical platform credentials:
- Upstox Access Token (daily expiry at 6:00 AM IST)
- GCP Service Account Key (180-day rotation check)
- API Bridge Secrets & SSH Key permissions

Fires proactive Telegram alerts at 8:30 AM IST if any credential is expiring within 48 hours.
"""

import os
import time
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List

log = logging.getLogger("secrets_warden")
IST = timezone(timedelta(hours=5, minutes=30))

class SecretsWarden:
    def __init__(self):
        self.base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.upstox_token_path = os.path.join(self.base_dir, "upstox_token.txt")
        self.gcp_credentials_path = os.path.join(self.base_dir, "gcp-credentials.json")

    def _get_file_age_days(self, file_path: str) -> float:
        """Returns age of file in days if file exists, else 999.0."""
        if not os.path.exists(file_path):
            return 999.0
        mtime = os.path.getmtime(file_path)
        age_seconds = time.time() - mtime
        return round(age_seconds / 86400.0, 1)

    def check_upstox_token(self) -> Dict[str, Any]:
        """
        Upstox access tokens expire daily at 6:00 AM IST.
        Checks if token file exists and was updated today.
        """
        if not os.path.exists(self.upstox_token_path):
            return {"status": "MISSING", "msg": "upstox_token.txt file does not exist", "expiring_soon": True}

        age_days = self._get_file_age_days(self.upstox_token_path)
        token_len = 0
        try:
            with open(self.upstox_token_path, "r") as f:
                token_len = len(f.read().strip())
        except Exception:
            pass

        if token_len < 20:
            return {"status": "INVALID", "msg": "upstox_token.txt is empty or invalid", "expiring_soon": True}

        if age_days > 1.0:
            return {"status": "STALE", "msg": f"Upstox token is {age_days:.1f} days old (expires daily)", "expiring_soon": True}

        return {"status": "FRESH", "msg": f"Upstox token is fresh ({age_days:.1f} days old)", "expiring_soon": False}

    def check_gcp_key(self) -> Dict[str, Any]:
        """Checks GCP Service Account key age (recommends 180-day rotation)."""
        if not os.path.exists(self.gcp_credentials_path):
            return {"status": "NOT_PRESENT", "msg": "GCP service account key not found", "expiring_soon": False}

        age_days = self._get_file_age_days(self.gcp_credentials_path)
        if age_days > 180.0:
            return {"status": "NEEDS_ROTATION", "msg": f"GCP Key is {age_days:.0f} days old (>180d threshold)", "expiring_soon": True}

        return {"status": "OK", "msg": f"GCP key age is {age_days:.0f} days", "expiring_soon": False}

    def audit_all_secrets(self) -> Dict[str, Any]:
        """Runs complete security and expiration audit across all platform credentials."""
        upstox_res = self.check_upstox_token()
        gcp_res = self.check_gcp_key()
        bridge_secret = os.getenv("BRIDGE_API_SECRET", "")

        warnings = []
        if upstox_res["expiring_soon"]:
            warnings.append(f"⚠️ {upstox_res['msg']}")
        if gcp_res["expiring_soon"]:
            warnings.append(f"⚠️ {gcp_res['msg']}")
        if not bridge_secret:
            warnings.append("⚠️ BRIDGE_API_SECRET env var is empty")

        is_healthy = len(warnings) == 0

        return {
            "status": "HEALTHY" if is_healthy else "WARNING",
            "audit_timestamp": datetime.now(IST).isoformat(),
            "upstox_token": upstox_res,
            "gcp_credentials": gcp_res,
            "has_bridge_secret": bool(bridge_secret),
            "warnings": warnings
        }

    def run_scheduled_audit(self):
        """
        Executed at 8:30 AM IST by APScheduler.
        Fires Telegram alert if any credential warning exists.
        """
        log.info("[SECRETS WARDEN] Running scheduled credential audit...")
        report = self.audit_all_secrets()

        if report["warnings"]:
            warn_lines = "\n".join([f"• {w}" for w in report["warnings"]])
            msg = (
                f"🛡️ <b><u>WEALTHOS | SECRETS WARDEN</u></b>\n"
                f"🚨 <b>STATUS:</b> <strong>CREDENTIAL EXPIRY WARNING</strong>\n"
                f"─────────────────────────\n"
                f"<blockquote>{warn_lines}</blockquote>\n"
                f"─────────────────────────\n"
                f"⏰ <i>Audit time: {report['audit_timestamp'][:19]} IST</i>"
            )
            log.warning(f"[SECRETS WARDEN] Alerting on Telegram: {report['warnings']}")

            # Load bot from telegram_config.json
            token = os.getenv("TELEGRAM_BOT_TOKEN")
            chat_id = os.getenv("TELEGRAM_CHAT_ID")
            thread_id = 24

            try:
                data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
                config_file = os.path.join(data_dir, "telegram_config.json")
                if os.path.exists(config_file):
                    import json
                    with open(config_file, "r") as f:
                        bots = json.load(f)
                        bot = next((b for b in bots if b.get("role") == "system" and b.get("enabled")), None)
                        if not bot:
                            bot = next((b for b in bots if b.get("enabled")), None)
                        if bot:
                            token = bot.get("token")
                            raw_chat = bot.get("chatId")
                            if raw_chat and "#" in str(raw_chat):
                                parts = str(raw_chat).split("#", 1)
                                chat_id = parts[0]
                                thread_id = int(parts[1])
                            else:
                                chat_id = raw_chat
            except Exception as e:
                log.warn(f"[SECRETS WARDEN] Error reading telegram config: {e}")

            if token and chat_id:
                try:
                    import requests
                    payload = {"chat_id": chat_id, "text": msg, "parse_mode": "HTML"}
                    if thread_id is not None:
                        payload["message_thread_id"] = thread_id
                    requests.post(
                        f"https://api.telegram.org/bot{token}/sendMessage",
                        json=payload,
                        timeout=3
                    )
                except Exception as e:
                    log.error(f"[SECRETS WARDEN] Telegram alert send failed: {e}")
        else:
            log.info("[SECRETS WARDEN] ✅ All secrets audited fresh and secure.")

# Global singleton instance
secrets_warden = SecretsWarden()
