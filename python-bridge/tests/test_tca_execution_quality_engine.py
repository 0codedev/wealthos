"""Unit tests for services/tca_execution_quality_engine.py."""

import os
import sys
import tempfile
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.tca_execution_quality_engine import (
    Side,
    FillStatus,
    ParentOrder,
    ChildFill,
    MarketTick,
    TCAMetrics,
    AlmgrenChrissParams,
    MarketImpactEstimate,
    BrokerFillRecord,
    LeakageEvent,
    LeakageReport,
    configure_db,
    migrate,
    init_schema,
    db_path,
    effective_spread,
    effective_spread_bps,
    realized_spread,
    price_impact,
    slippage_bps,
    participation_rate,
    trading_rate,
    permanent_impact_bps,
    temporary_impact_bps,
    estimate_market_impact,
    calibrate_almgren_chriss,
    BrokerRoutingProfiler,
    LeakageDetector,
    ExecutionQualityScorer,
    TCAStore,
    TCAExecutionQualityEngine,
    get_engine,
    reset_engine,
    make_fixture_parent,
    make_fixture_fill,
    make_fixture_market_series,
    make_fixture_broker_records,
)


@pytest.fixture
def tmp_db():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.remove(path)
    configure_db(path)
    yield path
    try:
        os.remove(path)
    except OSError:
        pass
    # reset env
    os.environ.pop("TCA_DB_PATH", None)


# ---------------------------------------------------------------------------
# Core TCA math
# ---------------------------------------------------------------------------
def test_effective_spread():
    assert effective_spread(100.5, 100.0) == pytest.approx(1.0)
    assert effective_spread(99.5, 100.0) == pytest.approx(1.0)
    assert effective_spread_bps(100.5, 100.0) == pytest.approx(100.0)


def test_realized_spread_and_price_impact():
    # buy: q=+1
    assert realized_spread(100.5, 100.2, Side.BUY) == pytest.approx(2 * (100.5 - 100.2))
    assert price_impact(100.0, 100.2, Side.BUY) == pytest.approx(2 * (100.2 - 100.0))
    # sell: q=-1
    assert realized_spread(99.5, 99.8, Side.SELL) == pytest.approx(-2 * (99.5 - 99.8))
    assert price_impact(100.0, 99.8, Side.SELL) == pytest.approx(-2 * (99.8 - 100.0))


def test_slippage_bps():
    assert slippage_bps(100.5, 100.0, Side.BUY) == pytest.approx(50.0)


# ---------------------------------------------------------------------------
# Almgren-Chriss
# ---------------------------------------------------------------------------
def test_permanent_temporary_impact():
    assert permanent_impact_bps(1000, 100000, 0.1) == pytest.approx(10.0)  # 0.1*0.01*10000
    assert temporary_impact_bps(1000, 10, 100, 0.05) == pytest.approx(0.05 * (100 / 100) * 10000)


def test_estimate_market_impact():
    est = estimate_market_impact("P1", "SYM", Side.BUY, 1000, 100000, 60, 50, None)
    assert isinstance(est, MarketImpactEstimate)
    assert est.total_impact_bps == pytest.approx(est.permanent_impact_bps + est.temporary_impact_bps)
    assert est.participation_rate == pytest.approx(0.01)


def test_calibrate_almgren_chriss():
    obs = [
        {"participation_rate": 0.01, "trading_rate": 0.5, "realized_impact_bps": 1.0},
        {"participation_rate": 0.02, "trading_rate": 0.8, "realized_impact_bps": 2.5},
        {"participation_rate": 0.03, "trading_rate": 2.0, "realized_impact_bps": 4.0},
    ]
    params = calibrate_almgren_chriss(obs)
    assert isinstance(params, AlmgrenChrissParams)
    # reconstructed impact should be close
    # gamma*0.01 + eta*0.5 ~ 1.0
    recon = params.gamma * 0.01 + params.eta * 0.5
    assert recon == pytest.approx(1.0, abs=0.5)


def test_calibrate_empty():
    params = calibrate_almgren_chriss([])
    assert params.gamma == pytest.approx(0.1)
    assert params.eta == pytest.approx(0.05)


# ---------------------------------------------------------------------------
# Broker profiler
# ---------------------------------------------------------------------------
def test_broker_profiler_scoring():
    prof = BrokerRoutingProfiler(window_ms=100000)
    for i in range(10):
        base = int(time.time()*1000)
        prof.record_fill("DHAN_REST", f"f{i}", "SYM", 80.0, 2.0, 10.0, base + i, rejected=False, partial=False)
    for i in range(10):
        prof.record_fill("UPSTOX_WS", f"g{i}", "SYM", 12.0, 0.5, 10.0, base + i, rejected=False, partial=False)
    assert prof.score("UPSTOX_WS") > prof.score("DHAN_REST")
    assert prof.best_broker(["DHAN_REST", "UPSTOX_WS"]) == "UPSTOX_WS"
    st = prof.stats("UPSTOX_WS")
    assert st["n"] == 10
    assert st["avg_latency_ms"] == pytest.approx(12.0)


def test_broker_profiler_empty():
    prof = BrokerRoutingProfiler()
    assert prof.score("NONE") == 50.0
    assert prof.stats("NONE")["n"] == 0


# ---------------------------------------------------------------------------
# Leakage detector
# ---------------------------------------------------------------------------
def test_leakage_detector_flags_withdrawal():
    det = LeakageDetector(withdrawal_threshold_pct=0.2, window_ms=5000)
    det.register_parent("P1", "SYM", 1000, 100.0)
    # quote depth drops significantly before child fill
    det.on_quote("SYM", 1000, 1000.0, 800.0)
    det.on_quote("SYM", 1100, 400.0, 800.0)  # bid withdrawn 60%
    det.on_child_fill("P1", "F1", 1200, 100.0)
    rep = det.finalize("P1")
    assert isinstance(rep, LeakageReport)
    assert rep.n_withdrawals >= 1
    assert rep.leakage_score > 0
    assert len(rep.events) >= 1


def test_leakage_detector_clean():
    det = LeakageDetector()
    det.register_parent("P2", "SYM", 1000, 100.0)
    det.on_quote("SYM", 1000, 1000.0, 800.0)
    det.on_quote("SYM", 1100, 1050.0, 820.0)
    det.on_child_fill("P2", "F2", 1200, 100.0)
    rep = det.finalize("P2")
    assert rep.n_withdrawals == 0
    assert rep.leakage_score == 0.0


# ---------------------------------------------------------------------------
# Execution quality scorer
# ---------------------------------------------------------------------------
def test_execution_quality_scorer_grade():
    assert ExecutionQualityScorer.grade(95) == "A+"
    assert ExecutionQualityScorer.grade(85) == "A"
    assert ExecutionQualityScorer.grade(75) == "B"
    assert ExecutionQualityScorer.grade(65) == "C"
    assert ExecutionQualityScorer.grade(55) == "D"
    assert ExecutionQualityScorer.grade(40) == "F"


def test_score_fill_range():
    m = TCAMetrics(
        fill_id="F", effective_spread=1.0, effective_spread_bps=10.0,
        realized_spread_1s=0.5, realized_spread_5s=0.4, realized_spread_30s=0.3,
        price_impact_1s=0.2, price_impact_5s=0.2, price_impact_30s=0.2,
        slippage_bps=2.0, implementation_shortfall_bps=2.0,
        mid0=100.0, m_1s=100.1, m_5s=100.1, m_30s=100.1,
    )
    scorer = ExecutionQualityScorer()
    score, grade, comps = scorer.score_fill(m, broker_score=80.0, leakage_score=1.0)
    assert 0 <= score <= 100
    assert grade in {"A+", "A", "B", "C", "D", "F"}
    assert set(comps.keys()) == {"cost", "spread", "impact", "latency", "leakage"}


# ---------------------------------------------------------------------------
# SQLite store
# ---------------------------------------------------------------------------
def test_sqlite_schema_and_roundtrip(tmp_db):
    assert migrate(tmp_db) == 113
    store = TCAStore(tmp_db)
    parent = make_fixture_parent()
    store.insert_parent(parent)
    assert store.get_parent(parent.parent_id) is not None
    fill = make_fixture_fill()
    store.insert_fill(fill)
    row = store.get_fill(fill.fill_id)
    assert row is not None
    assert row["fill_id"] == fill.fill_id
    m = TCAMetrics(
        fill_id=fill.fill_id, effective_spread=1.0, effective_spread_bps=5.0,
        realized_spread_1s=0.1, realized_spread_5s=0.2, realized_spread_30s=0.3,
        price_impact_1s=0.1, price_impact_5s=0.2, price_impact_30s=0.3,
        slippage_bps=1.0, implementation_shortfall_bps=1.0,
        mid0=100.0, m_1s=100.0, m_5s=100.0, m_30s=100.0,
    )
    store.insert_metric(m)
    got = store.get_metric(fill.fill_id)
    assert got is not None
    store.insert_quality_score("fill", fill.fill_id, 88.0, "A", {"cost": 90})
    qs = store.get_quality_score("fill", fill.fill_id)
    assert qs is not None
    assert qs["score"] == pytest.approx(88.0)


# ---------------------------------------------------------------------------
# Engine facade end-to-end
# ---------------------------------------------------------------------------
def test_engine_end_to_end(tmp_db):
    reset_engine()
    eng = TCAExecutionQualityEngine(tmp_db)
    parent = make_fixture_parent(created_ts_ms=1_700_000_000_000)
    eng.register_parent(parent)
    # market ticks
    for ts, mid in make_fixture_market_series(start_ts=1_700_000_000_000, n=400, step_ms=100):
        eng.record_market_tick(parent.symbol, ts, mid)
    fill = make_fixture_fill(ts_ms=1_700_000_000_000, mid0=0.0)
    eng.record_fill(fill)
    metrics, score, grade = eng.compute_tca(fill.fill_id)
    assert isinstance(metrics, TCAMetrics)
    assert 0 <= score <= 100
    assert grade in {"A+", "A", "B", "C", "D", "F"}
    # market impact
    est = eng.record_market_impact(parent.parent_id, parent.symbol, parent.side, 100.0, 10000.0, 60.0, 5.0)
    assert est.total_impact_bps >= 0
    # leakage finalize
    eng.record_quote(parent.symbol, 1_700_000_000_000, 1000.0, 800.0)
    eng.record_quote(parent.symbol, 1_700_000_000_100, 400.0, 800.0)
    rep = eng.finalize_leakage(parent.parent_id)
    assert isinstance(rep, LeakageReport)
    # broker scores persist
    scores = eng.persist_broker_scores()
    assert isinstance(scores, dict)
    # parent score
    ps, pg, pc = eng.score_parent(parent.parent_id)
    assert 0 <= ps <= 100


def test_engine_get_mid_missing_returns_zero(tmp_db):
    eng = TCAExecutionQualityEngine(tmp_db)
    assert eng._nearest_mid("NOPE", 1000) == 0.0


def test_fixtures_shapes():
    p = make_fixture_parent()
    assert p.total_qty > 0
    f = make_fixture_fill()
    assert f.qty > 0
    series = make_fixture_market_series(n=10)
    assert len(series) == 10
    recs = make_fixture_broker_records(n=5)
    assert len(recs) == 5


def test_store_list_fills(tmp_db):
    store = TCAStore(tmp_db)
    parent = make_fixture_parent()
    store.insert_parent(parent)
    for i in range(3):
        store.insert_fill(make_fixture_fill(fill_id=f"F{i}", parent_id=parent.parent_id))
    rows = store.list_fills(parent_id=parent.parent_id)
    assert len(rows) == 3
    assert store.get_fill("F1") is not None
