"""
Pytest integration wrapper for WealthOS E2E Trading Lifecycle Runner (WP07).
Validates tick ingestion, risk gates, atomic brackets, statutory friction, and failover.
"""

import pytest
import sys
import os

# Add repo root to path to import e2e runner
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TESTS_DIR = os.path.join(REPO_ROOT, "tests")
if TESTS_DIR not in sys.path:
    sys.path.insert(0, TESTS_DIR)

from e2e_trading_lifecycle_runner import E2ELifecycleRunner, SEBIStatutoryEngine, MockBrokerGateway


class TestE2ELifecycle:
    """Institutional Pytest Suite for WP07 Lifecycle Verification."""

    @pytest.fixture(autouse=True)
    def setup_runner(self):
        self.runner = E2ELifecycleRunner()

    def test_tick_storm_ingestion(self):
        assert self.runner.test_01_synthetic_tick_storm_ingestion() is True

    def test_pre_trade_risk_gates(self):
        assert self.runner.test_02_pre_trade_risk_gates() is True

    def test_atomic_bracket_execution(self):
        assert self.runner.test_03_atomic_bracket_execution() is True

    def test_reverse_orphan_liquidation(self):
        assert self.runner.test_04_reverse_orphan_liquidation() is True

    def test_sebi_statutory_friction(self):
        assert self.runner.test_05_sebi_statutory_friction_exactness() is True

    def test_socket_drop_and_recovery(self):
        assert self.runner.test_06_socket_drop_and_state_recovery() is True

    def test_fno_options_statutory_charges(self):
        # Additional check on F&O options charges (STT on sell premium post-Oct 2024 revised)
        buy_val = 150000.0
        sell_val = 180000.0
        tax = SEBIStatutoryEngine.calculate_fno_options(buy_val, sell_val)
        expected_stt = round(180000.0 * 0.001, 2)  # 0.1% = Rs 180.0
        assert tax["stt"] == expected_stt
        assert tax["total_statutory"] > expected_stt
