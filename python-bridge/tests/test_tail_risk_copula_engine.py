"""
Unit Tests for Portfolio CVaR & Non-Gaussian Tail-Risk Copula Engine (Domain 121 / WP-W)
"""

from datetime import datetime
import math
import random
import pytest

from services.tail_risk_copula_engine import (
    TailRiskCopulaEngine,
    AssetPosition,
    TailRiskMetrics,
)


@pytest.fixture
def copula_engine():
    return TailRiskCopulaEngine(
        cvar_elevated_threshold=0.35,
        cvar_critical_threshold=0.50,
        degrees_of_freedom=4.0,
        db_path=":memory:",
    )


def test_excess_kurtosis_calculation(copula_engine):
    # Simulated Gaussian returns
    random.seed(42)
    gaussian_returns = [random.gauss(0.0005, 0.01) for _ in range(1000)]
    kurt_gauss = copula_engine.calculate_sample_kurtosis(gaussian_returns)
    assert abs(kurt_gauss) < 1.0  # Gaussian excess kurtosis is near 0

    # Simulated Fat-Tailed returns (Student-t with 3 DoF: extreme jumps)
    fat_returns = [
        random.gauss(0.0005, 0.01) * (5.0 if random.random() < 0.05 else 1.0)
        for _ in range(1000)
    ]
    kurt_fat = copula_engine.calculate_sample_kurtosis(fat_returns)
    assert kurt_fat > 3.0  # Significant excess kurtosis


def test_lower_tail_dependence_student_t(copula_engine):
    # High positive correlation has significant lower tail dependence
    dep_high = copula_engine.calculate_lower_tail_dependence(rho=0.85, nu=4.0)
    assert dep_high > 0.30

    # Moderate correlation still maintains non-zero lower tail dependence in t-copula
    dep_mod = copula_engine.calculate_lower_tail_dependence(rho=0.40, nu=4.0)
    assert dep_mod > 0.05

    # Negative correlation has near zero tail dependence
    dep_neg = copula_engine.calculate_lower_tail_dependence(rho=-0.80, nu=4.0)
    assert dep_neg < 0.02


def test_gpd_moments_fit(copula_engine):
    exceedances = [0.01, 0.02, 0.015, 0.04, 0.025, 0.06, 0.035, 0.08]
    xi, beta = copula_engine.fit_gpd_moments(exceedances)

    assert -0.45 <= xi <= 0.45
    assert beta > 0.0


def test_evt_var_cvar_ordering(copula_engine):
    random.seed(101)
    returns = [random.gauss(0.0002, 0.015) for _ in range(250)]
    total_val = 1000000.0  # INR 10 Lakhs

    var_95, var_99, cvar_95, cvar_99, xi = copula_engine.compute_portfolio_evt_cvar(
        returns, total_val
    )

    # Fundamental mathematical properties of coherent risk measures:
    # VaR_99 >= VaR_95
    # CVaR_99 >= VaR_99
    # CVaR_95 >= VaR_95
    # CVaR_99 >= CVaR_95
    assert var_99 >= var_95
    assert cvar_95 >= var_95
    assert cvar_99 >= var_99
    assert cvar_99 >= cvar_95


def test_portfolio_tail_risk_normal_regime(copula_engine):
    now = datetime(2026, 10, 18, 11, 0, 0)
    random.seed(42)

    # Moderate volatility portfolio with INR 20 Lakh capital
    rets = [random.gauss(0.0005, 0.008) for _ in range(100)]
    pos1 = AssetPosition("NIFTY_FUT", "FUTURE", 0.6, 600000.0, rets)
    pos2 = AssetPosition("BANKNIFTY_FUT", "FUTURE", 0.4, 400000.0, rets)

    metrics = copula_engine.assess_portfolio_tail_risk(
        positions=[pos1, pos2],
        total_available_margin_inr=2000000.0,  # 20L margin -> plenty of headroom
        timestamp=now,
    )

    assert metrics.risk_regime == "NORMAL"
    assert metrics.cvar_to_capital_ratio < 0.35
    assert metrics.recommended_hedging_notional_inr == 0.0


def test_portfolio_tail_risk_critical_deleveraging(copula_engine):
    now = datetime(2026, 10, 18, 11, 15, 0)
    random.seed(99)

    # Extreme jumpy returns simulating high-beta F&O positions
    rets = [
        random.gauss(-0.005, 0.04) if random.random() < 0.15 else random.gauss(0.001, 0.015)
        for _ in range(100)
    ]
    pos = AssetPosition("HIGH_BETA_BASKET", "OPTION", 1.0, 5000000.0, rets)

    # Available margin is very low (e.g. INR 2 Lakh) compared to portfolio value
    metrics = copula_engine.assess_portfolio_tail_risk(
        positions=[pos],
        total_available_margin_inr=200000.0,
        timestamp=now,
    )

    assert metrics.risk_regime == "CRITICAL_DELEVERAGE"
    assert metrics.cvar_to_capital_ratio >= 0.50
    assert metrics.recommended_hedging_notional_inr > 0.0


def test_empty_positions_handling(copula_engine):
    now = datetime(2026, 10, 18, 11, 20, 0)
    metrics = copula_engine.assess_portfolio_tail_risk(
        positions=[],
        total_available_margin_inr=1000000.0,
        timestamp=now,
    )
    assert metrics.risk_regime == "NORMAL"
    assert metrics.var_99_inr == 0.0


def test_sqlite_persistence(copula_engine):
    now = datetime(2026, 10, 18, 11, 25, 0)
    rets = [0.01, -0.02, 0.015, -0.03, 0.005, -0.01] * 10
    pos = AssetPosition("NIFTY_FUT", "FUTURE", 1.0, 100000.0, rets)

    copula_engine.assess_portfolio_tail_risk(
        positions=[pos],
        total_available_margin_inr=500000.0,
        timestamp=now,
    )

    conn = copula_engine._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT risk_regime FROM tail_risk_surveillance_logs")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] in ("NORMAL", "ELEVATED", "CRITICAL_DELEVERAGE")
