"""Fallback stub used by TabPFNTrainer when weights can't be downloaded."""
from __future__ import annotations

import numpy as np


class _StubTabPFN:
    """Pretends to be a TabPFNClassifier that returns the base rate.

    Used only when the real TabPFN model can't be loaded (e.g. headless
    environments without a browser for one-time license acceptance).
    """

    def __init__(self, base_rate: float):
        self.base_rate = float(base_rate)

    def predict_proba(self, X):
        n = len(X)
        return np.column_stack([
            np.full(n, 1.0 - self.base_rate),
            np.full(n, self.base_rate),
        ])
