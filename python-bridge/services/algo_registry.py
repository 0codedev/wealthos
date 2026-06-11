"""
python-bridge/services/algo_registry.py — SEBI Registered Algorithm Registry

Tracks algorithm IDs, versions, and risk classifications for SEBI compliance.
"""

import logging
from typing import Dict, Any, List

log = logging.getLogger("algo_registry")

REGISTERED_ALGOS = [
    {
        "algo_id": "ALG_FNO_ROTATION_V3",
        "name": "FNO Sector Momentum Rotation",
        "version": "3.2.0",
        "risk_classification": "MEDIUM",
        "max_orders_per_day": 100,
        "sebi_registration_status": "APPROVED",
        "last_updated": "2026-08-08"
    },
    {
        "algo_id": "ALG_PUT_PROTECTION_V1",
        "name": "Nifty Tail Risk Put Protection",
        "version": "1.0.4",
        "risk_classification": "LOW",
        "max_orders_per_day": 20,
        "sebi_registration_status": "APPROVED",
        "last_updated": "2026-08-08"
    }
]

class AlgoRegistry:
    def get_registered_algos(self) -> List[Dict[str, Any]]:
        return REGISTERED_ALGOS

# Global singleton instance
algo_registry = AlgoRegistry()
