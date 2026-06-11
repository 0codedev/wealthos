"""
python-bridge/services/audit_log.py — SHA-256 Cryptographic Immutable Audit Chain

Implements append-only cryptographic block chaining for trade executions & admin actions.
Each record hashes its payload along with the previous record's SHA-256 hash.
Provides verify_chain_integrity() to detect any tampering or record deletion.
"""

import os
import time
import sqlite3
import hashlib
import json
import logging
from typing import Dict, Any, Tuple

log = logging.getLogger("audit_chain")

class ImmutableAuditChain:
    def __init__(self):
        self.db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cache.db")
        if not os.path.exists(self.db_path):
            self.db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "database.db")
        self._init_db()

    def _init_db(self):
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS audit_chain (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    prev_hash TEXT NOT NULL,
                    hash TEXT NOT NULL
                )
            """)
            conn.commit()
            conn.close()
        except Exception as e:
            log.error(f"[AUDIT CHAIN] DB init error: {e}")

    def append_event(self, event_type: str, actor: str, payload: dict) -> str:
        """Appends a new event block to the SHA-256 audit chain."""
        ts = str(time.time())
        payload_str = json.dumps(payload, sort_keys=True)

        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT hash FROM audit_chain ORDER BY id DESC LIMIT 1")
            row = cursor.fetchone()
            prev_hash = row[0] if row else "0000000000000000000000000000000000000000000000000000000000000000"

            raw_block = f"{ts}:{event_type}:{actor}:{payload_str}:{prev_hash}"
            block_hash = hashlib.sha256(raw_block.encode("utf-8")).hexdigest()

            cursor.execute("""
                INSERT INTO audit_chain (timestamp, event_type, actor, payload, prev_hash, hash)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (ts, event_type, actor, payload_str, prev_hash, block_hash))

            conn.commit()
            conn.close()
            return block_hash
        except Exception as e:
            log.error(f"[AUDIT CHAIN] Error appending event: {e}")
            return ""

    def verify_chain_integrity(self) -> Tuple[bool, int]:
        """Validates cryptographic integrity across all chained audit records."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT id, timestamp, event_type, actor, payload, prev_hash, hash FROM audit_chain ORDER BY id ASC")
            rows = cursor.fetchall()
            conn.close()

            if not rows:
                return True, 0

            expected_prev = "0000000000000000000000000000000000000000000000000000000000000000"
            for row in rows:
                idx, ts, event_type, actor, payload_str, prev_hash, block_hash = row
                if prev_hash != expected_prev:
                    log.error(f"[AUDIT CHAIN] 🚨 Chain integrity broken at block #{idx}: prev_hash mismatch!")
                    return False, len(rows)

                raw_block = f"{ts}:{event_type}:{actor}:{payload_str}:{prev_hash}"
                calculated_hash = hashlib.sha256(raw_block.encode("utf-8")).hexdigest()
                if calculated_hash != block_hash:
                    log.error(f"[AUDIT CHAIN] 🚨 Tampering detected at block #{idx}: hash mismatch!")
                    return False, len(rows)

                expected_prev = block_hash

            return True, len(rows)
        except Exception as e:
            log.error(f"[AUDIT CHAIN] Verification error: {e}")
            return False, 0

# Global singleton instance
audit_chain = ImmutableAuditChain()
