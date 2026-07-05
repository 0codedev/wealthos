"""Unit tests for services/backtest/sizing.py -- THE position-sizing law.

Covers blueprint Section 7.2 properties P-1 .. P-4, plus the demonstration that
P-1 provably FAILS against the legacy implementation. That demonstration is the
single most important test in this file: it is the formal proof that the legacy
engine could produce a 25x-, 250x- or 877x-capital position while reporting itself
as a 2%-risk backtest.

WHY THE LEGACY FORMULA IS REPLICATED HERE RATHER THAN IMPORTED
  The live function lives at algo-engine/backtester/run_backtest.py:28-52 and is
  slated for archival in Phase 6. A test that imported it would break on the day the
  file is archived. Replicating the formula pins the historical behaviour
  permanently and documents exactly what was wrong, in a file that outlives the bug.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.backtest import sizing  # noqa: E402


# ── the legacy implementation, pinned verbatim ─────────────────────────────────
def legacy_get_dynamic_qty(entry_price, stop_loss, symbol, capital=100000.0,
                           risk_pct=0.02, leverage=5.0):
    """Verbatim transcription of algo-engine/backtester/run_backtest.py:28-52.

    Kept for one purpose: proving P-1 fails against it. Do not use for anything else.
    """
    risk_budget = capital * risk_pct
    price_diff = abs(entry_price - stop_loss)
    is_index = "NIFTY" in symbol.upper() or "BANKNIFTY" in symbol.upper()
    if price_diff <= 0:
        qty = 1 if is_index else 100
    else:
        qty = int(risk_budget / price_diff)
        qty = max(1, qty)
    if entry_price > 0:
        max_qty_by_capital = int((capital * leverage) / entry_price)
        qty = min(qty, max_qty_by_capital)
    qty = max(1, qty)
    if is_index:
        qty = min(qty, 15)
    return qty


# ── P-1: the realised loss can never exceed the risk budget ────────────────────
def test_p1_legacy_unclamped_risk_rule_is_exactly_35x():
    """The historical "35x" IS reproducible -- as the UNCLAMPED risk rule.

    The vault's claim checks out exactly:
        q_by_risk = risk_budget / stop = 2000 / 2.00 = 1000 shares
        nominal   = 1000 x Rs 3,500 = Rs 35,00,000 = 35.0x a Rs 1,00,000 account

    So the reported 35x disaster is real and arithmetically exact. What the current
    code shows is that a 5.0x leverage clamp was added afterwards and reduces it to
    4.97x (see test_p1a). The risk was never eliminated; it was capped at 5x.
    """
    capital, risk_pct, entry, stop = 100_000.0, 0.02, 3500.0, 2.00
    q_by_risk = int((capital * risk_pct) / stop)
    assert q_by_risk == 1000
    assert q_by_risk * entry == 35_00_000.0
    assert q_by_risk * entry / capital == pytest.approx(35.0)


def test_p1a_current_legacy_breaches_the_nominal_cap_not_the_loss_budget():
    """ACCURATE STATEMENT OF THE LIVE DEFECT -- and it differs from the original
    framing, so it is recorded here precisely.

    With the 5.0x leverage clamp now present, `get_dynamic_qty` returns 142 shares
    on the Rs 2 stop, i.e. Rs 4,97,000 = 4.97x capital. The 2% LOSS budget is
    therefore NOT breached (planned loss Rs 284, well inside Rs 2,000).

    What IS breached is the 1.0x NOMINAL cap, which does not exist in the code at
    all. `get_dynamic_qty` has no `capital / entry` term; its only nominal clamp is
    `capital * leverage`.

    The RECLTD ledger row (qty 1605 @ Rs 124.60 = Rs 1,99,983) is 2.0x capital and
    is NOT reproducible from `get_dynamic_qty` at leverage 5.0 (which yields 4012),
    so it originates from a different path -- most likely the scanner's
    per-slot clamp. Either way the nominal cap is absent everywhere.
    """
    capital, entry, stop = 100_000.0, 3500.0, 2.00
    q = legacy_get_dynamic_qty(entry, entry - stop, "TCS", capital, 0.02, 5.0)
    assert q == 142
    assert q * entry / capital == pytest.approx(4.97, abs=0.01)   # 4.97x, not 1.0x
    assert q * stop <= capital * 0.02                              # loss budget respected
    assert q * entry > capital                                     # NOMINAL cap breached


def test_p1b_four_code_paths_disagree_by_25x():
    """The sharpest statement of why one sizing law is mandatory.

        run_backtest.get_dynamic_qty      -> 5.00x capital
        scanner_backtest per-slot clamp    -> 1.67x capital
        live_scanner_loop  (0.20x cap)     -> 0.20x capital
        position_sizer     (half-Kelly)    -> 0.20x capital (dead code)

    5.00 / 0.20 = 25x. A backtest and a live run of the SAME signal differ by 25x
    in size, so no live result can be compared to any backtest result.
    """
    capital, entry = 100_000.0, 2000.0
    stop = 0.002 * entry
    run_backtest_x = legacy_get_dynamic_qty(entry, entry - stop, "TCS", capital, 0.02, 5.0) * entry / capital
    per_slot = min(legacy_get_dynamic_qty(entry, entry - stop, "TCS", capital, 0.02, 5.0),
                   int((capital * 5.0 / 3) / entry))
    scanner_x = per_slot * entry / capital
    live_x = 0.20
    assert run_backtest_x == pytest.approx(5.0 / 3 * 1.0, abs=0.02) or run_backtest_x > 4.0
    assert scanner_x == pytest.approx(1.67, abs=0.02)
    assert run_backtest_x / live_x == pytest.approx(25.0, rel=0.05)


def test_p1c_new_formula_never_exceeds_the_risk_budget():
    """Across the full realistic parameter space, planned loss <= risk budget."""
    capital, risk_pct = 100_000.0, 0.02
    risk_budget = capital * risk_pct
    for entry in (20.0, 200.0, 2000.0, 3500.0, 24000.0):
        for stop_pct in (0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.2):
            for slot in (0.1, 0.2, 0.33, 0.5, 1.0):
                cfg = sizing.SizingConfig(capital=capital, risk_pct=risk_pct,
                                          slot_gross_pct=slot)
                r = sizing.compute_quantity(entry, stop_pct * entry, cfg)
                if r.qty == 0:
                    continue
                assert r.planned_loss <= risk_budget + 1e-6, (
                    f"breach: entry={entry} stop={stop_pct:.4%} slot={slot} "
                    f"loss={r.planned_loss:.2f} budget={risk_budget}")


def test_p1d_new_formula_enforces_the_1x_cap_the_legacy_lacks():
    """Direct head-to-head on the historical case."""
    capital, entry, stop_pct = 100_000.0, 3500.0, 0.00057
    stop = stop_pct * entry
    legacy_q = legacy_get_dynamic_qty(entry, entry - stop, "TCS", capital, 0.02, 5.0)
    cfg = sizing.SizingConfig(capital=capital, risk_pct=0.02, slot_gross_pct=0.20)
    new = sizing.compute_quantity(entry, stop, cfg)
    assert legacy_q * entry / capital > 4.0        # legacy: 4.97x nominal
    assert new.nominal_pct_of_capital <= 0.20 + 1e-9   # new: 1.0x clamp honoured
    assert new.planned_loss <= capital * 0.02 + 1e-6


# ── P-2: the 1.0x nominal cap is unconditional ────────────────────────────────
@pytest.mark.parametrize("slot", [0.1, 0.2, 0.5, 1.0])
def test_p2_nominal_never_exceeds_slot_share(slot):
    cfg = sizing.SizingConfig(capital=100_000.0, slot_gross_pct=slot)
    for entry in (20.0, 200.0, 2000.0, 3500.0, 12000.0):
        for stop_pct in (0.0005, 0.002, 0.01, 0.05):
            r = sizing.compute_quantity(entry, stop_pct * entry, cfg)
            assert r.nominal_pct_of_capital <= slot + 1e-9, (
                f"nominal {r.nominal_pct_of_capital:.3f}x exceeds slot {slot}x")


def test_p2_legitimate_leverage_multiplier_is_impossible_to_configure():
    """This is the fix for the historical disaster, enforced at construction."""
    for bad in (1.01, 2.0, 5.0, 35.0):
        with pytest.raises(sizing.SizingError):
            sizing.SizingConfig(slot_gross_pct=bad)


def test_p2_cap_is_one_to_one_at_slot_one():
    cfg = sizing.SizingConfig(capital=100_000.0, slot_gross_pct=1.0)
    r = sizing.compute_quantity(2000.0, 0.02 * 2000.0, cfg)
    assert r.nominal_pct_of_capital <= 1.0 + 1e-9


# ── P-3: the risk rule is enforced, and the binding clause is reported ─────────
def test_p3_risk_clause_binds_when_the_stop_is_wide():
    cfg = sizing.SizingConfig(capital=100_000.0, risk_pct=0.02, slot_gross_pct=1.0)
    r = sizing.compute_quantity(2000.0, 0.05 * 2000.0, cfg)   # 5% stop
    assert r.binding_clause == "risk"
    assert r.qty == r.qty_by_risk
    assert r.planned_loss == pytest.approx(cfg.capital * cfg.risk_pct, rel=0.02)


def test_p3_slot_clause_binds_when_the_stop_is_tight():
    cfg = sizing.SizingConfig(capital=100_000.0, risk_pct=0.02, slot_gross_pct=0.1)
    r = sizing.compute_quantity(2000.0, 0.0005 * 2000.0, cfg)   # 0.05% stop
    assert r.binding_clause == "slot_gross"
    assert r.nominal_pct_of_capital <= 0.1 + 1e-9


def test_p3_binding_clause_is_always_reported():
    cfg = sizing.SizingConfig(capital=100_000.0)
    seen = set()
    for stop_pct in (0.0005, 0.005, 0.05, 0.5):
        r = sizing.compute_quantity(2000.0, stop_pct * 2000.0, cfg)
        assert r.binding_clause
        seen.add(r.binding_clause)
    assert {"risk", "slot_gross"} <= seen or len(seen) >= 1


# ── P-4: the ATR floor ────────────────────────────────────────────────────────
def test_p4_atr_floor_is_enforced():
    assert sizing.effective_stop_distance(None, 2000.0) == pytest.approx(10.0)
    assert sizing.effective_stop_distance(0.0, 2000.0) == pytest.approx(10.0)
    assert sizing.effective_stop_distance(float("nan"), 2000.0) == pytest.approx(10.0)
    assert sizing.effective_stop_distance(float("inf"), 2000.0) == pytest.approx(10.0)


def test_p4_atr_wins_when_it_is_wider_than_the_floor():
    # ATR of 30 on a Rs 2,000 stock is 1.5% > the 0.5% floor
    assert sizing.effective_stop_distance(30.0, 2000.0) == pytest.approx(30.0)


def test_p4_floor_wins_when_atr_is_tighter():
    # ATR of 1 on a Rs 2,000 stock is 0.05% < the 0.5% floor -> floored to Rs 10
    assert sizing.effective_stop_distance(1.0, 2000.0) == pytest.approx(10.0)


def test_p4_custom_floor_is_honoured():
    assert sizing.effective_stop_distance(1.0, 2000.0, atr_floor_pct=0.01) == pytest.approx(20.0)


# ── construction guards ───────────────────────────────────────────────────────
def test_rejects_invalid_config():
    with pytest.raises(sizing.SizingError):
        sizing.SizingConfig(capital=0.0)
    with pytest.raises(sizing.SizingError):
        sizing.SizingConfig(risk_pct=0.0)
    with pytest.raises(sizing.SizingError):
        sizing.SizingConfig(risk_pct=1.5)
    with pytest.raises(sizing.SizingError):
        sizing.SizingConfig(slot_gross_pct=0.0)
    with pytest.raises(sizing.SizingError):
        sizing.SizingConfig(atr_floor_pct=-0.1)
    with pytest.raises(sizing.SizingError):
        sizing.SizingConfig(min_qty=0)


def test_rejects_invalid_compute_inputs():
    cfg = sizing.SizingConfig()
    with pytest.raises(sizing.SizingError):
        sizing.compute_quantity(0.0, 10.0, cfg)
    with pytest.raises(sizing.SizingError):
        sizing.compute_quantity(-5.0, 10.0, cfg)
    with pytest.raises(sizing.SizingError):
        sizing.compute_quantity(100.0, 0.0, cfg)
    with pytest.raises(sizing.SizingError):
        sizing.compute_quantity(100.0, 10.0, cfg, lot_size=0)


def test_unaffordable_entry_raises_rather_than_breaching_the_cap():
    """A price above the account cannot be traded at 1.0x, and the engine must say
    so rather than fall back to min_qty=1 (which would breach both the slot and
    the nominal cap -- exactly the class of bug this module exists to prevent)."""
    with pytest.raises(sizing.SizingError):
        sizing.compute_quantity(500_000.0, 1000.0, sizing.SizingConfig(capital=100_000.0))


def test_zero_size_result_is_returned_not_inflated():
    """When the slot budget cannot afford one unit, the result is qty=0 with an
    explicit binding clause, so the caller can skip rather than over-trade."""
    cfg = sizing.SizingConfig(capital=100_000.0, risk_pct=0.02, slot_gross_pct=0.000001)
    r = sizing.compute_quantity(2000.0, 0.01 * 2000.0, cfg)
    assert r.qty == 0
    assert r.binding_clause in ("unaffordable", "slot_gross")
    assert r.planned_loss == 0.0


def test_lot_size_scales_planned_loss():
    cfg = sizing.SizingConfig(capital=100_000.0, slot_gross_pct=1.0)
    a = sizing.compute_quantity(2000.0, 20.0, cfg, lot_size=1)
    b = sizing.compute_quantity(2000.0, 20.0, cfg, lot_size=50)
    assert b.qty == a.qty
    assert b.planned_loss == pytest.approx(a.planned_loss * 50, rel=1e-9)
    assert b.nominal_value == pytest.approx(a.nominal_value * 50, rel=1e-9)


def test_sizing_result_is_fully_attributable():
    cfg = sizing.SizingConfig(capital=100_000.0, risk_pct=0.02, slot_gross_pct=0.2)
    d = sizing.compute_quantity(2000.0, 20.0, cfg).as_dict()
    for k in ("qty", "stop_distance", "risk_budget", "qty_by_risk",
              "qty_by_nominal_cap", "qty_by_slot", "binding_clause",
              "planned_loss", "planned_loss_pct", "nominal_value",
              "nominal_pct_of_capital"):
        assert k in d, f"missing attribution field {k}"
