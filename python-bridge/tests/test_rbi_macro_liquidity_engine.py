"""
Unit Tests for Sovereign Macro Liquidity & RBI Net LAF Factor Transmission Engine (Domain 130 / WP-AF)
"""

from datetime import datetime
import pytest

from services.rbi_macro_liquidity_engine import (
    RBIMacroLiquidityEngine,
    LAFOperationsDaily,
    MacroLiquidityRegime,
)


@pytest.fixture
def rbi_engine():
    return RBIMacroLiquidityEngine(
        rolling_window_days=15,
        sli_expansion_threshold=1.0,
        sli_contraction_threshold=-1.0,
        db_path=":memory:",
    )


def test_compute_net_laf_surplus(rbi_engine):
    # Absorption: SDF 1.2L Cr + VRRR 0.5L Cr = 1.7L Cr
    # Injection: Repo 0.1L Cr + VRR 0.2L Cr + MSF 0.0L Cr = 0.3L Cr
    # Net = 1.7 - 0.3 = +1.4L Cr (Surplus)
    op = LAFOperationsDaily(
        date_str="2026-10-15",
        policy_repo_rate_pct=6.50,
        wacr_pct=6.35,
        sdf_amount_lakh_cr=1.20,
        vrrr_amount_lakh_cr=0.50,
        repo_amount_lakh_cr=0.10,
        vrr_amount_lakh_cr=0.20,
        msf_amount_lakh_cr=0.0,
        treps_rate_pct=6.30,
    )

    net_laf = rbi_engine.compute_net_laf_surplus(op)
    assert abs(net_laf - 1.40) < 1e-4


def test_calculate_wacr_policy_spread(rbi_engine):
    # WACR 6.35% vs Repo 6.50% -> Spread = -15.0 bps (trading near SDF floor)
    spread = rbi_engine.calculate_wacr_policy_spread_bps(6.35, 6.50)
    assert abs(spread - (-15.0)) < 1e-3

    # Spiking WACR 6.70% vs Repo 6.50% -> Spread = +20.0 bps (trading near MSF ceiling)
    spread_high = rbi_engine.calculate_wacr_policy_spread_bps(6.70, 6.50)
    assert abs(spread_high - 20.0) < 1e-3


def test_liquidity_surplus_regime(rbi_engine):
    # Seed baseline of neutral operations
    for i in range(10):
        op_seed = LAFOperationsDaily(f"2026-10-{i+1:02d}", 6.50, 6.45, 0.50, 0.0, 0.40, 0.0, 0.0, 6.40)
        rbi_engine.assess_daily_operations(op_seed)

    # Massive liquidity surplus day: Net LAF = +2.5L Cr, WACR = 6.25% (SDF floor)
    op_surplus = LAFOperationsDaily(
        date_str="2026-10-16",
        policy_repo_rate_pct=6.50,
        wacr_pct=6.25,
        sdf_amount_lakh_cr=2.50,
        vrrr_amount_lakh_cr=0.50,
        repo_amount_lakh_cr=0.0,
        vrr_amount_lakh_cr=0.0,
        msf_amount_lakh_cr=0.0,
        treps_rate_pct=6.20,
    )

    reg = rbi_engine.assess_daily_operations(op_surplus)
    assert reg.regime == "LIQUIDITY_SURPLUS_EXPANSIVE"
    assert reg.banknifty_bias == "AGGRESSIVE_BULLISH"
    assert reg.recommended_leverage_multiplier == 1.25
    assert reg.sli_z_score >= 1.0


def test_liquidity_deficit_regime(rbi_engine):
    # Seed baseline of neutral operations
    for i in range(10):
        op_seed = LAFOperationsDaily(f"2026-10-{i+1:02d}", 6.50, 6.48, 0.40, 0.0, 0.40, 0.0, 0.0, 6.45)
        rbi_engine.assess_daily_operations(op_seed)

    # Severe liquidity deficit day: Banks borrowing ₹2.0 Lakh Cr via VRR + MSF, WACR spikes to 6.75%
    op_deficit = LAFOperationsDaily(
        date_str="2026-10-17",
        policy_repo_rate_pct=6.50,
        wacr_pct=6.75,
        sdf_amount_lakh_cr=0.05,
        vrrr_amount_lakh_cr=0.0,
        repo_amount_lakh_cr=0.50,
        vrr_amount_lakh_cr=1.50,
        msf_amount_lakh_cr=0.20,
        treps_rate_pct=6.70,
    )

    reg = rbi_engine.assess_daily_operations(op_deficit)
    assert reg.regime == "LIQUIDITY_DEFICIT_CONTRACTION"
    assert reg.banknifty_bias == "DEFENSIVE_TIGHTEN_STOPS"
    assert reg.recommended_leverage_multiplier == 0.70
    assert reg.sli_z_score <= -1.0


def test_sqlite_persistence(rbi_engine):
    op = LAFOperationsDaily("2026-10-18", 6.50, 6.48, 0.50, 0.0, 0.50, 0.0, 0.0, 6.45)
    rbi_engine.assess_daily_operations(op)

    conn = rbi_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT date_str, regime, banknifty_bias FROM rbi_macro_liquidity_telemetry WHERE date_str = '2026-10-18'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "2026-10-18"
    assert row[1] == "LIQUIDITY_NEUTRAL_BALANCED"
