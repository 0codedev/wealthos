"""
Unit Tests for Real-Time Options Surface Wing Kurtosis & Extreme Tail-Risk Pricing Engine (Domain 186 / WP-CJ)
"""

import pytest

from services.options_wing_kurtosis_evt_engine import (
    OptionsWingKurtosisEVTEngine,
    DeepSmileQuotes,
    TailRiskDirective,
)


@pytest.fixture
def engine():
    return OptionsWingKurtosisEVTEngine(
        db_path=":memory:",
        kurtosis_fat_threshold=2.40,
        kurtosis_thin_threshold=1.35,
        tail_index_heavy_threshold=0.28,
    )


def test_normal_gaussian_tail_regime(engine):
    # Standard benign smile:
    # ATM = 15%, 25P = 17%, 25C = 15% -> den = (17 + 15) - 30 = 2%
    # 10P = 18.5%, 10C = 15.2% -> num = (18.5 + 15.2) - 30 = 3.7% -> Kurtosis = 3.7 / 2.0 = 1.85 (Normal)
    # Wing excess = 18.5% - 15% = 3.5% -> Xi = (0.035 / 0.15) * 0.85 = 0.198 < 0.28
    quotes = DeepSmileQuotes(
        symbol="NIFTY",
        underlying_price=25000.0,
        days_to_expiry=30.0,
        atm_vol=0.15,
        put_25d_vol=0.17,
        call_25d_vol=0.15,
        put_10d_vol=0.185,
        call_10d_vol=0.152,
        realized_vol_30d=0.14,
    )

    rep = engine.analyze_tail_risk(quotes)

    assert 1.40 <= rep.wing_kurtosis_index <= 2.20
    assert rep.directive == TailRiskDirective.NORMAL_GAUSSIAN_TAIL_REGIME
    assert "normal Gaussian regime" in rep.rationale


def test_heavy_tail_crash_hedge_acceleration(engine):
    # Crash panic: 10P explodes to 32%, 10C is 18%, ATM=15%, 25P=19%, 25C=15%
    # den = (19 + 15) - 30 = 4%
    # num = (32 + 18) - 30 = 20% -> Kurtosis = 20 / 4 = 5.0 (Severe fat tail)
    quotes = DeepSmileQuotes(
        symbol="NIFTY",
        underlying_price=25000.0,
        days_to_expiry=15.0,
        atm_vol=0.15,
        put_25d_vol=0.19,
        call_25d_vol=0.15,
        put_10d_vol=0.32,
        call_10d_vol=0.18,
        realized_vol_30d=0.22,  # RV is also elevated, so richness is not > 2.5x (32 / 22 = 1.45)
    )

    rep = engine.analyze_tail_risk(quotes)

    assert rep.wing_kurtosis_index > 2.40
    assert rep.gpd_tail_index_xi >= 0.28
    assert rep.directive == TailRiskDirective.CRASH_HEDGE_ACCELERATION_BUY_WINGS
    assert "Tail hazard elevated" in rep.rationale


def test_harvest_overpriced_wings_short_fly(engine):
    # Fat wings in quiet market: 10P=30%, 10C=18%, ATM=15%, 25P=18%, 25C=15%
    # den = 33 - 30 = 3%. num = 48 - 30 = 18% -> Kurtosis = 6.0
    # But realized volatility is dead quiet at 9% -> Richness = 30 / 9 = 3.33x
    quotes = DeepSmileQuotes(
        symbol="NIFTY",
        underlying_price=25000.0,
        days_to_expiry=25.0,
        atm_vol=0.15,
        put_25d_vol=0.18,
        call_25d_vol=0.15,
        put_10d_vol=0.30,
        call_10d_vol=0.18,
        realized_vol_30d=0.09,
    )

    rep = engine.analyze_tail_risk(quotes)

    assert rep.wing_kurtosis_index >= 2.40
    assert rep.wing_richness_ratio >= 2.50
    assert rep.directive == TailRiskDirective.HARVEST_OVERPRICED_WINGS_SHORT_FLY
    assert "Wings severely overpriced" in rep.rationale


def test_thin_tail_underpriced_hazard(engine):
    # Artificially flat smile: den = (18 + 16) - 30 = 4%
    # num = (18.5 + 16.5) - 30 = 5% -> Kurtosis = 5 / 4 = 1.25 (< 1.35)
    quotes = DeepSmileQuotes(
        symbol="COMPLACENT_STK",
        underlying_price=1000.0,
        days_to_expiry=30.0,
        atm_vol=0.15,
        put_25d_vol=0.18,
        call_25d_vol=0.16,
        put_10d_vol=0.185,
        call_10d_vol=0.165,
        realized_vol_30d=0.15,
    )

    rep = engine.analyze_tail_risk(quotes)

    assert rep.wing_kurtosis_index <= 1.35
    assert rep.directive == TailRiskDirective.THIN_TAIL_UNDERPRICED_HAZARD
    assert "Wings unnaturally thin" in rep.rationale


def test_sqlite_persistence(engine):
    quotes = DeepSmileQuotes(
        symbol="PERSIST_TAIL",
        underlying_price=25000.0,
        days_to_expiry=30.0,
        atm_vol=0.15,
        put_25d_vol=0.18,
        call_25d_vol=0.15,
        put_10d_vol=0.20,
        call_10d_vol=0.155,
    )
    engine.analyze_tail_risk(quotes)

    telemetry = engine.get_latest_telemetry(limit=5)
    assert len(telemetry) == 1
    assert telemetry[0][0] == "PERSIST_TAIL"
    assert telemetry[0][1] == 30.0
