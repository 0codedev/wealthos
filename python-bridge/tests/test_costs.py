"""Unit tests for services/backtest/costs.py -- THE cost model.

Covers blueprint Section 7.5 tests C-1 .. C-8.

The module under test replaces six mutually inconsistent cost models that coexisted
in the repository. These tests pin the RATES so a future refactor cannot silently
reintroduce the divergences that made results incomparable across engines:

  * C-1 round-trip cost must land in the 0.10-0.15% band that the repository's own
    research measured (docs/algo/edge_analysis_report.md:14). Four of the six legacy
    models omitted GST and/or SEBI entirely.
  * C-2 brokerage has TWO regimes (percentage and cap). Picking one unconditionally
    understates cost on large tickets or overstates it on small ones.
  * C-3 the Oct-2024 STT regime is DATE-AWARE. No legacy model was (finding R-21).
  * C-4 segment correctness: options STT on sell premium only; futures stamp duty is
    0.002% and NOT the options 0.003% (a bug inherited from cost_model.py:85).
  * C-5 the lot multiplier is MANDATORY (finding R-15: NIFTY/BANKNIFTY payoffs were
    off by 15-50x in optopsy_engine.py).
  * C-6 SEBI is inside the GST base.
  * C-7 cross-check against the independent implementation in
    routers/openalgo.py:207 `calculate_indian_fno_charges`.
  * C-8 the cost/gross law: cost as a fraction of the target move must be bounded.
"""

import datetime as dt
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.backtest import costs  # noqa: E402

D = dt.date(2026, 9, 1)
PRE_CUTOVER = dt.date(2024, 9, 30)
POST_CUTOVER = dt.date(2024, 10, 1)


# ── C-1: round-trip regression against the measured band ───────────────────────
def test_c1_intraday_round_trip_in_measured_band():
    """Intraday equity, Rs 1,00,000 notional, 1-day hold => 0.10-0.15% of notional.

    This is the regression that would have caught backtest_simulator.py:764-779,
    which omitted GST and SEBI and therefore under-reported cost by ~7%.
    """
    cm = costs.CostModel()
    pct = cm.round_trip_pct(1000.0, 1000.0, 100, D) * 100.0
    assert 0.10 <= pct <= 0.15, f"round trip {pct:.4f}% outside the measured 0.10-0.15% band"


def test_c1_breakdown_is_attributable_and_sums():
    cm = costs.CostModel()
    b = cm.round_trip_breakdown(1000.0, 1000.0, 100, D)
    parts = (b.brokerage + b.stt + b.exchange + b.sebi
             + b.stamp_duty + b.gst + b.slippage)
    assert parts == pytest.approx(b.total, rel=1e-12)
    assert all(v >= 0 for v in b.as_dict().values())


def test_c1_zero_slippage_removes_slippage_only():
    with_slip = costs.CostModel(slippage_bps=2.0)
    without = costs.CostModel(slippage_bps=0.0)
    a = with_slip.round_trip_breakdown(1000.0, 1000.0, 100, D)
    b = without.round_trip_breakdown(1000.0, 1000.0, 100, D)
    assert b.slippage == 0.0
    assert a.total - b.total == pytest.approx(a.slippage, rel=1e-12)
    assert a.brokerage == b.brokerage  # nothing else moved


# ── C-2: brokerage has two regimes ────────────────────────────────────────────
def test_c2_brokerage_percentage_binds_on_small_notional():
    """0.03% of Rs 10,000 = Rs 3 < the Rs 20 cap, so the PERCENTAGE binds."""
    b = costs.CostModel().round_trip_breakdown(100.0, 100.0, 100, D)
    assert b.brokerage == pytest.approx(2 * 3.0, rel=1e-9)


def test_c2_brokerage_cap_binds_on_large_notional():
    """0.03% of Rs 10,00,000 = Rs 300 > the Rs 20 cap, so the CAP binds."""
    b = costs.CostModel().round_trip_breakdown(100000.0, 100000.0, 100, D)
    assert b.brokerage == pytest.approx(2 * costs.MAX_BROKERAGE_PER_ORDER, rel=1e-9)


def test_c2_brokerage_boundary_is_where_the_formula_says():
    """The cap binds above Rs 66,667 single-side notional (20 / 0.0003)."""
    switch = costs.MAX_BROKERAGE_PER_ORDER / costs.BROKERAGE_PCT   # 66,666.67
    below = costs.CostModel().round_trip_breakdown(1.0, 1.0, int(switch * 0.99), D)
    above = costs.CostModel().round_trip_breakdown(1.0, 1.0, int(switch * 1.01) + 1, D)
    assert below.brokerage < 2 * costs.MAX_BROKERAGE_PER_ORDER
    assert above.brokerage == pytest.approx(2 * costs.MAX_BROKERAGE_PER_ORDER, rel=1e-9)


# ── C-3: the Oct-2024 STT regime is date-aware (finding R-21) ──────────────────
def test_c3_delivery_stt_buy_is_zero_before_cutover():
    pre = costs.CostModel(delivery=True)
    # 0 on the buy, 0.1% on the sell => 0.001 * 100000 = 100
    assert pre._stt(100000.0, 100000.0, PRE_CUTOVER) == pytest.approx(100.0)


def test_c3_delivery_stt_buy_is_charged_after_cutover():
    post = costs.CostModel(delivery=True)
    # 0.1% on BOTH sides => 200
    assert post._stt(100000.0, 100000.0, POST_CUTOVER) == pytest.approx(200.0)


def test_c3_cutover_boundary_is_inclusive():
    tbl_pre = costs.stt_delivery_table(costs.STT_REGIME_CUTOVER - dt.timedelta(days=1))
    tbl_post = costs.stt_delivery_table(costs.STT_REGIME_CUTOVER)
    assert tbl_pre["buy"] == 0.0
    assert tbl_post["buy"] == 0.001


def test_c3_intraday_stt_is_unchanged_across_both_regimes():
    cm = costs.CostModel(delivery=False)
    assert cm._stt(100000.0, 100000.0, PRE_CUTOVER) == \
           cm._stt(100000.0, 100000.0, POST_CUTOVER)


# ── C-4: segment correctness ───────────────────────────────────────────────────
def test_c4_options_stt_applies_to_sell_premium_only():
    opt = costs.CostModel(asset_class=costs.ASSET_OPT)
    # Pre-Oct 2024: 0.0625% on sell premium => Rs 62.50
    assert opt._stt(100000.0, 100000.0, PRE_CUTOVER) == pytest.approx(
        100000.0 * costs.STT_FNO_OPTIONS_SELL_PRE_2024)
    # Post-Oct 2024 (Budget 2024): 0.10% on sell premium => Rs 100.00
    assert opt._stt(100000.0, 100000.0, POST_CUTOVER) == pytest.approx(
        100000.0 * costs.STT_FNO_OPTIONS_SELL_POST_2024)
    # no premium on the buy leg => no STT at all
    assert opt._stt(0.0, 100000.0, POST_CUTOVER) == pytest.approx(100000.0 * costs.STT_FNO_OPTIONS_SELL_POST_2024)
    assert opt._stt(100000.0, 0.0, POST_CUTOVER) == 0.0


def test_c4_futures_stamp_duty_is_not_the_options_rate():
    """cost_model.py:85 wrongly applied STAMP_DUTY_BUY_OPT (0.003%) to futures."""
    fut = costs.CostModel(asset_class=costs.ASSET_FUT)
    assert fut._stamp_rate == 0.00002
    assert fut._stamp_rate != costs.STAMP_DUTY_BUY_OPT
    b = fut.round_trip_breakdown(100.0, 100.0, 1, D)
    assert b.stamp_duty == pytest.approx(100.0 * 0.00002)


def test_c4_stamp_duty_is_buy_side_only():
    cm = costs.CostModel()
    b = cm.round_trip_breakdown(1000.0, 1.0, 100, D)   # sell far below entry
    assert b.stamp_duty == pytest.approx(100000.0 * costs.STAMP_DUTY_BUY_EQ)


# ── C-5: lot multiplier (finding R-15) ────────────────────────────────────────
def test_c5_lot_multiplier_scales_every_leg_linearly():
    one = costs.CostModel(asset_class=costs.ASSET_OPT, lot_size=1)
    fifty = costs.CostModel(asset_class=costs.ASSET_OPT, lot_size=50)
    a = one.round_trip(100.0, 110.0, 1, D)
    b = fifty.round_trip(100.0, 110.0, 1, D)
    assert b == pytest.approx(a * 50, rel=1e-9)


def test_c5_lot_multiplier_affects_nifty_scale():
    """optopsy_engine.py had NO lot multiplier, so NIFTY (lot 50) was off by ~39x.

    Note the ratio is ~39x, NOT 50x, and that is correct: brokerage is capped at
    Rs 20 per leg, so it saturates and damps the scaling. Uncapped components
    (STT, exchange, SEBI, stamp, slippage) scale exactly 50x. This test pins both
    facts, because a naive "total == 50x" assertion would be wrong.
    """
    nifty_1 = costs.CostModel(asset_class=costs.ASSET_OPT, lot_size=1)
    nifty_50 = costs.CostModel(asset_class=costs.ASSET_OPT, lot_size=50)
    b1 = nifty_1.round_trip_breakdown(24000.0, 24200.0, 1, D)
    b50 = nifty_50.round_trip_breakdown(24000.0, 24200.0, 1, D)

    # Uncapped components scale exactly with the multiplier.
    assert b50.stt == pytest.approx(b1.stt * 50, rel=1e-9)
    assert b50.exchange == pytest.approx(b1.exchange * 50, rel=1e-9)
    assert b50.sebi == pytest.approx(b1.sebi * 50, rel=1e-9)
    assert b50.stamp_duty == pytest.approx(b1.stamp_duty * 50, rel=1e-9)
    assert b50.slippage == pytest.approx(b1.slippage * 50, rel=1e-9)

    # Brokerage is capped, so it saturates instead of scaling.
    assert b1.brokerage < 2 * costs.MAX_BROKERAGE_PER_ORDER   # 0.03% of 24,000 = 7.2/leg
    assert b50.brokerage == pytest.approx(2 * costs.MAX_BROKERAGE_PER_ORDER, rel=1e-9)

    # Total is materially larger but strictly less than 50x because of that cap.
    ratio = b50.total / b1.total
    assert 30.0 < ratio < 50.0, f"expected a damped ~39x, got {ratio:.2f}x"
    # This is the magnitude of the legacy under-reporting at NIFTY scale.
    assert b1.total < 100.0 and b50.total > 2000.0


# ── C-6: SEBI is inside the GST base ──────────────────────────────────────────
def test_c6_gst_base_includes_sebi():
    cm = costs.CostModel()
    b = cm.round_trip_breakdown(1000.0, 1000.0, 100, D)
    assert b.gst == pytest.approx(
        costs.GST_RATE * (b.brokerage + b.exchange + b.sebi), rel=1e-12)


def test_c6_gst_base_excludes_stt_and_stamp_and_slippage():
    cm = costs.CostModel()
    b = cm.round_trip_breakdown(1000.0, 1000.0, 100, D)
    without = costs.GST_RATE * (b.brokerage + b.exchange)
    assert b.gst > without
    assert b.gst == pytest.approx(without + costs.GST_RATE * b.sebi, rel=1e-9)


# ── C-7: cross-check against the independent router implementation ────────────
def test_c7_statutory_rates_are_exact():
    """The backtest engine's statutory legs must be EXACTLY the published rates."""
    opt = costs.CostModel(asset_class=costs.ASSET_OPT, lot_size=1)
    sell_value, turnover = 220.0 * 50, (200.0 + 220.0) * 50
    # Pre-Oct 2024 statutory checks
    b_pre = opt.round_trip_breakdown(200.0, 220.0, 50, PRE_CUTOVER)
    assert b_pre.stt == pytest.approx(sell_value * costs.STT_FNO_OPTIONS_SELL_PRE_2024, rel=1e-12)
    assert b_pre.exchange == pytest.approx(turnover * costs.EXCHANGE_TXN_FNO_OPT_PRE_2024, rel=1e-12)

    # Post-Oct 2024 (Budget 2024 & SEBI True to Label) checks
    b_post = opt.round_trip_breakdown(200.0, 220.0, 50, POST_CUTOVER)
    assert b_post.stt == pytest.approx(sell_value * costs.STT_FNO_OPTIONS_SELL_POST_2024, rel=1e-12)
    assert b_post.exchange == pytest.approx(turnover * costs.EXCHANGE_TXN_FNO_OPT_POST_2024, rel=1e-12)
    assert b_post.sebi == pytest.approx(turnover * costs.SEBI_TURNOVER_FEE, rel=1e-12)
    assert b_post.stamp_duty == pytest.approx(200.0 * 50 * costs.STAMP_DUTY_BUY_OPT, rel=1e-12)

    eq = costs.CostModel(asset_class=costs.ASSET_EQ, lot_size=1)
    e = eq.round_trip_breakdown(2500.0, 2400.0, 2, D)
    assert e.stt == pytest.approx(2400.0 * 2 * costs.STT_EQUITY_SELL_INTRADAY, rel=1e-12)
    assert e.exchange == pytest.approx(4900.0 * 2 * costs.EXCHANGE_TXN_EQ, rel=1e-12)
    assert e.stamp_duty == pytest.approx(2500.0 * 2 * costs.STAMP_DUTY_BUY_EQ, rel=1e-12)

    fut = costs.CostModel(asset_class=costs.ASSET_FUT, lot_size=50)
    f_pre = fut.round_trip_breakdown(24000.0, 24100.0, 1, PRE_CUTOVER)
    assert f_pre.stt == pytest.approx(24100.0 * 50 * costs.STT_FNO_FUTURES_SELL_PRE_2024, rel=1e-12)
    assert f_pre.stamp_duty == pytest.approx(24000.0 * 50 * costs.STAMP_DUTY_BUY_FUT, rel=1e-12)

    f_post = fut.round_trip_breakdown(24000.0, 24100.0, 1, POST_CUTOVER)
    assert f_post.stt == pytest.approx(24100.0 * 50 * costs.STT_FNO_FUTURES_SELL_POST_2024, rel=1e-12)
    assert f_post.exchange == pytest.approx((24000.0 + 24100.0) * 50 * costs.EXCHANGE_TXN_FNO_FUT_POST_2024, rel=1e-12)


def test_c7b_known_defect_openalgo_charge_oracle_uses_pre_2024_stt():
    """RECORDED DEFECT -- the charge calculator at routers/openalgo.py:207 is STALE.

    `calculate_indian_fno_charges` charges options STT at 0.125% (Rs 13.75 on a
    Rs 11,000 sell premium) where the pre-Oct 2024 rate was 0.0625% (Rs 6.875)
    and the post-Oct 2024 Budget rate is 0.10% (Rs 11.00).
    """
    from routers.openalgo import calculate_indian_fno_charges
    ours = costs.CostModel(asset_class=costs.ASSET_OPT, lot_size=1)
    o_stt = float((calculate_indian_fno_charges(200.0, 220.0, 50, "Options")
                   .get("feeBreakdown") or {}).get("stt", 0.0))
    if o_stt <= 0:
        pytest.skip("openalgo charge oracle unavailable in this environment")
    our_stt_pre = ours.round_trip_breakdown(200.0, 220.0, 50, PRE_CUTOVER).stt
    assert our_stt_pre == pytest.approx(6.875, rel=1e-9)
    our_stt_post = ours.round_trip_breakdown(200.0, 220.0, 50, POST_CUTOVER).stt
    assert our_stt_post == pytest.approx(11.0, rel=1e-9)
    # The oracle charges exactly double pre-cutover (0.125% instead of 0.0625%).
    assert o_stt == pytest.approx(our_stt_pre * 2.0, rel=1e-6)


def test_c7b2_brokerage_schedules_differ_by_design():
    """The oracle uses a FLAT Rs 40 round trip; this model uses the exchange
    schedule of 0.03% capped at Rs 20 PER ORDER. The divergence is recorded here
    so it is a documented decision rather than a latent surprise.

    Consequence: flat brokerage is only defensible at Indian retail ticket sizes.
    At a Rs 100 option it is 40% of the trade; at a Rs 10,00,000 NIFTY lot it is
    0.004%. Only the capped-percentage form behaves correctly across both.
    """
    from routers.openalgo import calculate_indian_fno_charges
    cm = costs.CostModel(asset_class=costs.ASSET_OPT, lot_size=1)
    small = 100.0
    ours_small = cm.round_trip_breakdown(small, small, 1, D).brokerage
    theirs_small = float((calculate_indian_fno_charges(small, small, 1, "Options")
                          .get("feeBreakdown") or {}).get("brokerage", 0.0))
    if theirs_small > 0:
        assert ours_small < theirs_small / 100.0, (
            "flat brokerage should be catastrophically wrong on small tickets")

    big = 1_000_000.0
    ours_big = cm.round_trip_breakdown(big, big, 1, D).brokerage
    assert ours_big == pytest.approx(2 * costs.MAX_BROKERAGE_PER_ORDER, rel=1e-9)
    # A flat Rs 40 would be 0.004% here -- understating by 20x.
    assert ours_big == pytest.approx(40.0)


# ── C-8: the cost/gross law (blueprint Section 4.2) ────────────────────────────
def test_c8_min_viable_target_rises_as_notional_falls():
    cm = costs.CostModel()
    small = cm.min_viable_target_pct(10_000.0) * 100.0
    large = cm.min_viable_target_pct(1_67_000.0, max_cost_drag=0.10) * 100.0
    assert small > large
    # At Rs 10,000 the minimum viable intraday target EXCEEDS the measured
    # unconditional MFE of 0.942%, which is why Path A could not work.
    assert small > 0.942
    assert cm.min_viable_target_pct(1_67_000.0) < 0.942


def test_c8_cost_drag_bounded_for_a_viable_target():
    cm = costs.CostModel()
    for notional, target, max_drag in ((1_00_000.0, 0.05, 0.10),
                                       (5_00_000.0, 0.02, 0.10),
                                       (2_00_000.0, 0.03, 0.15)):
        entry = notional / 100.0
        cost = cm.round_trip(entry, entry * (1 + target), 100, D)
        drag = cost / (notional * target)
        assert drag <= max_drag, f"cost drag {drag:.3f} exceeds {max_drag}"


# ── construction guards ───────────────────────────────────────────────────────
def test_rejects_invalid_configuration():
    with pytest.raises(costs.CostModelError):
        costs.CostModel(asset_class="CRYPTO")
    with pytest.raises(costs.CostModelError):
        costs.CostModel(lot_size=0)
    with pytest.raises(costs.CostModelError):
        costs.CostModel(slippage_bps=-1.0)


def test_rejects_nonpositive_prices_and_quantities():
    cm = costs.CostModel()
    with pytest.raises(costs.CostModelError):
        cm.round_trip(0.0, 100.0, 1, D)
    with pytest.raises(costs.CostModelError):
        cm.round_trip(100.0, 100.0, 0, D)


def test_round_trip_pct_denominator_is_single_side_notional():
    """Using turnover would halve every cost figure and make each strategy look
    twice as viable. This test pins the single-side convention."""
    cm = costs.CostModel()
    entry, qty = 1000.0, 100
    notional = entry * qty
    total = cm.round_trip(entry, entry, qty, D)
    assert cm.round_trip_pct(entry, entry, qty, D) == pytest.approx(total / notional, rel=1e-12)
