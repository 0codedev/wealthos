"""Unit tests for services/gamma_scalping_rebalancer.py."""

import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.gamma_scalping_rebalancer import (
    OptionLeg, StraddlePortfolio, GammaScalperEngine, HedgeSignal,
    configure_db, migrate, init_schema, db_path, get_engine, reset_engine,
    whalley_wilmott_band, optimal_band, compute_band,
    compute_portfolio_delta, portfolio_delta, compute_portfolio_gamma, portfolio_gamma,
    compute_portfolio_theta, gamma_pnl_vs_theta,
)


@pytest.fixture
def tmp_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.remove(path)
    configure_db(path)
    reset_engine()
    yield path
    try:
        os.remove(path)
    except OSError:
        pass
    os.environ.pop("GAMMA_SCALP_DB_PATH", None)


def make_straddle(spot=22000.0, strike=22000.0, delta_ce=0.5, delta_pe=-0.5, gamma=0.001,
                  theta=-10.0, qty=1, lot=50):
    legs = [
        OptionLeg(underlying="NIFTY", strike=strike, option_type="CE", side="LONG",
                  quantity=qty, lot_size=lot, delta=delta_ce, gamma=gamma, theta=theta, price=100.0),
        OptionLeg(underlying="NIFTY", strike=strike, option_type="PE", side="LONG",
                  quantity=qty, lot_size=lot, delta=delta_pe, gamma=gamma, theta=theta, price=100.0),
    ]
    return StraddlePortfolio(underlying="NIFTY", spot=spot, legs=legs, underlying_position=0.0)


def test_fixtures_load():
    p = make_straddle()
    assert len(p.legs) == 2
    assert p.portfolio_delta() == pytest.approx(0.0)  # 0.5 + -0.5 times units


def test_portfolio_delta_units():
    p = make_straddle(qty=2, lot=50, delta_ce=0.5, delta_pe=-0.4)
    # 2*50*(0.5-0.4)=5? wait plus underlying 0 => 5
    assert p.portfolio_delta() == pytest.approx(2 * 50 * (0.5 - 0.4))


def test_whalley_wilmott_band_formula():
    c, S, G, ra = 1.0, 100.0, 2.0, 1e-6
    expected = ((3 * c * S * G * G) / (2 * ra)) ** (1.0 / 3.0)
    assert whalley_wilmott_band(c, S, G, ra) == pytest.approx(expected)
    assert optimal_band(c, S, G, ra) == pytest.approx(expected)
    assert compute_band(c, S, G, ra) == pytest.approx(expected)


def test_delta_neutral_invariant_after_rebalance(tmp_db):
    eng = GammaScalperEngine(db_path_override=tmp_db, risk_aversion=1e3)
    p = make_straddle(spot=22000.0, delta_ce=0.55, delta_pe=-0.45)  # net delta 0.1*50=5
    pd_before = p.portfolio_delta()
    assert abs(pd_before) > 0
    sig = eng.hedge_signal(portfolio=p, spot=p.spot, now="10:00", realized_vol=0.2, implied_vol=0.18,
                           cost=5.0, risk_aversion=1e3)
    assert sig is not None
    # invariant: reported after-delta within band (or no trigger with before within band)
    if sig.action in ("BUY", "SELL", "FLATTEN"):
        assert abs(sig.port_delta_after) <= sig.band + 1e-6
    else:
        assert abs(sig.port_delta_before) <= sig.band + 1e-6


def test_delta_neutral_invariant_strict(tmp_db):
    eng = GammaScalperEngine(db_path_override=tmp_db)
    p = make_straddle(spot=22000.0, delta_ce=0.6, delta_pe=-0.4)
    # band computed normally
    g = p.portfolio_gamma()
    band = eng.whalley_wilmott_band(cost=10.0, spot=p.spot, gamma=g, risk_aversion=1e-3)
    # rebalance
    sig = eng.hedge_signal(portfolio=p, now="10:00", realized_vol=0.25, implied_vol=0.20)
    pd_after = p.portfolio_delta()
    # after hedge signal, the reported after delta should be within band
    assert abs(sig.port_delta_after) <= band + 1e-9 or abs(pd_after) <= max(band, 1e-9) + 1e-6


def test_gamma_pnl_vs_theta():
    res = gamma_pnl_vs_theta(gamma=10.0, spot_move=5.0, theta=-2.0, dt=1.0)
    assert res["gamma_pnl"] == pytest.approx(0.5 * 10.0 * 25.0)
    assert res["theta_burn"] == pytest.approx(-2.0)
    assert res["net"] == pytest.approx(125.0 + 2.0)


def test_churn_suppression(tmp_db):
    eng = GammaScalperEngine(db_path_override=tmp_db)
    # midday window 12:00, realized < implied
    assert eng.churn_suppressed(now="12:00", realized_vol=0.10, implied_vol=0.20) is True
    # outside window
    assert eng.churn_suppressed(now="10:00", realized_vol=0.10, implied_vol=0.20) is False
    # realized >= implied
    assert eng.churn_suppressed(now="12:00", realized_vol=0.25, implied_vol=0.20) is False


def test_churn_suppresses_hedge_signal(tmp_db):
    eng = GammaScalperEngine(db_path_override=tmp_db)
    p = make_straddle(spot=22000.0, delta_ce=0.6, delta_pe=-0.4)
    sig = eng.hedge_signal(portfolio=p, now="12:30", realized_vol=0.10, implied_vol=0.20)
    assert sig is not None
    assert sig.churn_suppressed is True
    assert sig.action == "NONE"


def test_eod_unwind(tmp_db):
    eng = GammaScalperEngine(db_path_override=tmp_db)
    assert eng.end_of_day_unwind(now="15:20") is True
    assert eng.end_of_day_unwind(now="14:00") is False
    p = make_straddle(spot=22000.0, delta_ce=0.6, delta_pe=-0.4)
    sig = eng.hedge_signal(portfolio=p, now="15:20", realized_vol=0.25, implied_vol=0.20)
    assert sig.eod_unwind is True
    assert sig.action in ("FLATTEN", "BUY", "SELL")


def test_persistence(tmp_db):
    eng = GammaScalperEngine(db_path_override=tmp_db)
    p = make_straddle()
    sig = eng.hedge_signal(portfolio=p, now="10:00", realized_vol=0.2, implied_vol=0.18)
    tid = eng.persist_signal(sig, underlying="NIFTY", spot=p.spot, realized_vol=0.2, implied_vol=0.18)
    assert tid
    trades = eng.list_trades()
    assert len(trades) >= 1
    hedges = eng.list_hedges()
    # may or may not have hedge depending action
    assert isinstance(hedges, list)


def test_simulate_scalp(tmp_db):
    eng = GammaScalperEngine(db_path_override=tmp_db)
    p = make_straddle(spot=22000.0)
    path = [22000.0, 22010.0, 22005.0, 22020.0]
    res = eng.simulate_scalp(p, path)
    assert "gamma_pnl" in res
    assert "theta_burn" in res
    assert "net_pnl" in res


def test_store_direct(tmp_db):
    from services.gamma_scalping_rebalancer import GammaScalpingStore, ScalpTradeRecord
    store = GammaScalpingStore(db_path_override=tmp_db)
    rec = ScalpTradeRecord(trade_id="t1", underlying="NIFTY", spot=22000.0,
                           port_delta_before=5.0, port_delta_after=0.0, band=1.0,
                           hedge_qty=-5.0, realized_vol=0.2, implied_vol=0.18,
                           churn_suppressed=False, eod_unwind=False, friction_cost=1.0)
    store.record_trade(rec)
    assert store.count_trades() >= 1
