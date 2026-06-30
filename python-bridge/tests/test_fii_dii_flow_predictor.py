"""
Unit Tests for Institutional FII/DII Net Flow & Derivative Squeeze Predictor (Domain 131 / WP-AG)
"""

from datetime import datetime
import pytest

from services.fii_dii_flow_predictor import (
    FIIDIISqueezePredictor,
    DailyParticipantPositioning,
    SqueezePredictorResult,
)


@pytest.fixture
def predictor():
    return FIIDIISqueezePredictor(
        rolling_window_days=15,
        short_crowding_z_threshold=-1.8,
        long_crowding_z_threshold=1.8,
        extreme_short_pct_threshold=22.0,
        extreme_long_pct_threshold=78.0,
        db_path=":memory:",
    )


def test_calculate_cash_flows(predictor):
    pos = DailyParticipantPositioning(
        date_str="2026-10-15",
        fii_cash_buy_cr=12500.0,
        fii_cash_sell_cr=15000.0,
        dii_cash_buy_cr=14000.0,
        dii_cash_sell_cr=11200.0,
        fii_index_futures_long=40000,
        fii_index_futures_short=60000,
        pro_index_futures_long=30000,
        pro_index_futures_short=30000,
        client_index_futures_long=100000,
        client_index_futures_short=80000,
        spot_close=25500.0,
    )
    fii_net, dii_net, total_net = predictor.calculate_cash_flows(pos)
    assert abs(fii_net - (-2500.0)) < 1e-4
    assert abs(dii_net - 2800.0) < 1e-4
    assert abs(total_net - 300.0) < 1e-4


def test_calculate_fii_derivative_ratios(predictor):
    # Long 25k, Short 100k
    lsr, pct_long, net_oi = predictor.calculate_fii_derivative_ratios(25000, 100000)
    assert abs(lsr - 0.25) < 1e-4
    assert abs(pct_long - 20.0) < 1e-4
    assert net_oi == -75000


def test_coiled_short_squeeze_regime(predictor):
    # Seed baseline with neutral positions
    for i in range(10):
        pos_seed = DailyParticipantPositioning(
            date_str=f"2026-10-{i+1:02d}",
            fii_cash_buy_cr=10000.0,
            fii_cash_sell_cr=10000.0,
            dii_cash_buy_cr=10000.0,
            dii_cash_sell_cr=10000.0,
            fii_index_futures_long=50000,
            fii_index_futures_short=50000,
            pro_index_futures_long=30000,
            pro_index_futures_short=30000,
            client_index_futures_long=80000,
            client_index_futures_short=80000,
            spot_close=25000.0,
        )
        predictor.assess_daily_positioning(pos_seed)

    # Massive short crowding day: FII 15k Long vs 85k Short (15% Long, Net OI = -70,000)
    pos_squeeze = DailyParticipantPositioning(
        date_str="2026-10-16",
        fii_cash_buy_cr=9000.0,
        fii_cash_sell_cr=12000.0,
        dii_cash_buy_cr=13000.0,
        dii_cash_sell_cr=9000.0,
        fii_index_futures_long=15000,
        fii_index_futures_short=85000,
        pro_index_futures_long=30000,
        pro_index_futures_short=30000,
        client_index_futures_long=90000,
        client_index_futures_short=20000,
        spot_close=24800.0,
    )

    # Without intraday confirmation
    res_base = predictor.assess_daily_positioning(pos_squeeze, intraday_spot_above_vwap=False, intraday_cvd_positive=False)
    assert res_base.regime == "COILED_SHORT_SQUEEZE_SETUP"
    assert res_base.directional_recommendation == "CALL_SQUEEZE_UPSIDE_ASYMMETRY"
    assert res_base.stop_adjustment_factor == 0.50
    assert res_base.squeeze_probability >= 0.55

    # With afternoon intraday bullish confirmation (spot > VWAP, CVD > 0)
    res_confirmed = predictor.assess_daily_positioning(pos_squeeze, intraday_spot_above_vwap=True, intraday_cvd_positive=True)
    assert res_confirmed.squeeze_probability > res_base.squeeze_probability
    assert res_confirmed.squeeze_probability >= 0.85


def test_long_liquidation_vulnerability_regime(predictor):
    # Seed baseline with neutral positions
    for i in range(10):
        pos_seed = DailyParticipantPositioning(
            date_str=f"2026-10-{i+1:02d}",
            fii_cash_buy_cr=10000.0,
            fii_cash_sell_cr=10000.0,
            dii_cash_buy_cr=10000.0,
            dii_cash_sell_cr=10000.0,
            fii_index_futures_long=50000,
            fii_index_futures_short=50000,
            pro_index_futures_long=30000,
            pro_index_futures_short=30000,
            client_index_futures_long=80000,
            client_index_futures_short=80000,
            spot_close=25000.0,
        )
        predictor.assess_daily_positioning(pos_seed)

    # Excessive long crowding: FII 88k Long vs 12k Short (88% Long, Net OI = +76,000)
    pos_long_heavy = DailyParticipantPositioning(
        date_str="2026-10-17",
        fii_cash_buy_cr=15000.0,
        fii_cash_sell_cr=10000.0,
        dii_cash_buy_cr=8000.0,
        dii_cash_sell_cr=12000.0,
        fii_index_futures_long=88000,
        fii_index_futures_short=12000,
        pro_index_futures_long=30000,
        pro_index_futures_short=30000,
        client_index_futures_long=20000,
        client_index_futures_short=96000,
        spot_close=25600.0,
    )

    res = predictor.assess_daily_positioning(pos_long_heavy)
    assert res.regime == "LONG_LIQUIDATION_VULNERABILITY"
    assert res.directional_recommendation == "PUT_HEDGE_RECOMMENDED"
    assert res.stop_adjustment_factor == 0.70
    assert res.crowding_z_score >= 1.8


def test_sqlite_persistence(predictor):
    pos = DailyParticipantPositioning(
        date_str="2026-10-18",
        fii_cash_buy_cr=11000.0,
        fii_cash_sell_cr=10000.0,
        dii_cash_buy_cr=9000.0,
        dii_cash_sell_cr=9500.0,
        fii_index_futures_long=50000,
        fii_index_futures_short=50000,
        pro_index_futures_long=30000,
        pro_index_futures_short=30000,
        client_index_futures_long=80000,
        client_index_futures_short=80000,
        spot_close=25200.0,
    )
    predictor.assess_daily_positioning(pos)

    conn = predictor._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT date_str, regime, recommendation FROM fii_dii_positioning_telemetry WHERE date_str = '2026-10-18'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "2026-10-18"
    assert row[1] == "BALANCED_POSITIONING"
    assert row[2] == "NEUTRAL"
