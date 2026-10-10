"""Example/edge-case unit tests for the ORB Enhanced retest sequence (task 5.8).

This module pins down the *retest filter* emission timing (Requirement 11.4) with a
single, fully deterministic, hand-built candle sequence rather than the structural
guarantees the property tests assert. With ``require_retest=True`` and
``require_volume_confirmation=False`` the enhanced ORB must:

  - establish a known Opening_Range,
  - *arm* (but NOT emit) on the first breakout beyond a boundary,
  - stay silent while price pulls back and retests the broken boundary,
  - emit the entry only when a later candle *resumes* through the boundary in the
    breakout direction,

with ``stop_loss`` / ``target`` sized from the range size (Requirement 11.6).

Concrete numbers
----------------
Config: ``market_open=09:15:00``, ``opening_range_minutes=3`` -> range window is
``[09:15:00, 09:18:00)`` and the first candle at/after ``09:18:00`` locks the range.
``warmup_period=2`` so entries are evaluated well before the breakout candle.

Hand-built sequence (times monotonic, all in-window so no day reset fires):

    t         role        high    low     close   effect
    09:15:00  range       110     105     107     or_high=110, or_low=105
    09:16:00  range       108     100     103     or_low=100  -> OR = [100, 110]
    09:17:00  range       109     102     106     inside OR   -> OR unchanged
    09:18:00  lock        109     103     105     locks range; close inside -> None
    09:19:00  breakout    113     109     112     close 112 > 110 -> ARM, no signal
    09:20:00  retest      110.5   109.5   109.8   low 109.5 <= 110 retest; close <=110 -> None
    09:21:00  resume      114     111     113     close 113 > 110 after retest -> BUY

Range size = 110 - 100 = 10. With the default ``stop_multiplier=1.0`` and
``target_multiplier=2.0`` on the resume close of 113:

    stop_loss = 113 - 10 * 1.0 = 103.0
    target    = 113 + 10 * 2.0 = 133.0

Risk gate: projected loss = |113 - 103| * 50 = 500 <= 2% * 1,000,000 = 20,000, so the
entry passes the 2% risk cap.
"""

from __future__ import annotations

import pytest

from strategies.orb_enhanced import ORBEnhanced


pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _candle(high, low, close, t, volume=None):
    """Build a candle dict; ``volume`` omitted entirely when None."""
    c = {"high": float(high), "low": float(low), "close": float(close), "time": t}
    if volume is not None:
        c["volume"] = float(volume)
    return c


def _config(**overrides) -> dict:
    """Config with the retest filter on, volume confirmation off, generous risk cap."""
    cfg = {
        "instrument": "2885",
        "quantity": 50,
        "capital": 1_000_000.0,        # 2% risk cap = 20,000
        "opening_range_minutes": 3,    # range window [09:15:00, 09:18:00)
        "require_retest": True,
        "require_volume_confirmation": False,
        "stop_multiplier": 1.0,
        "target_multiplier": 2.0,
        "warmup_period": 2,            # entries evaluated before the breakout candle
        "max_trades_per_day": 3,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    cfg.update(overrides)
    return cfg


# ---------------------------------------------------------------------------
# The retest emission-timing sequence
# ---------------------------------------------------------------------------
def test_retest_sequence_emits_only_on_resume():
    """Breakout -> pullback/retest -> resume: signal fires only on the resume candle.

    Asserts the precise emission timing required by Requirement 11.4:
      - the breakout candle ARMS the strategy but emits None,
      - the retest candle (price back at the boundary) still emits None,
      - the resume candle (close back above or_high) emits the BUY,
    with the hand-computed stop/target sized from the range.
    """
    strat = ORBEnhanced(config=_config())

    # --- Opening-range window: establish OR = [100, 110]. No signals. ---
    assert strat.on_candle(_candle(110, 105, 107, "09:15:00")) is None
    assert strat.on_candle(_candle(108, 100, 103, "09:16:00")) is None
    assert strat.on_candle(_candle(109, 102, 106, "09:17:00")) is None

    # --- Lock candle (first at/after range end). Close inside range -> no break. ---
    assert strat.on_candle(_candle(109, 103, 105, "09:18:00")) is None
    assert strat.state.range_locked is True
    assert strat.state.or_high == pytest.approx(110.0)
    assert strat.state.or_low == pytest.approx(100.0)

    # --- Breakout candle: close 112 > or_high 110 -> ARM only, NO signal yet. ---
    breakout = strat.on_candle(_candle(113, 109, 112, "09:19:00"))
    assert breakout is None, "breakout candle must arm, not emit, under require_retest"
    assert strat.state.breakout_dir == "BUY"
    assert strat.state.retest_armed is True
    assert strat.state.retested is False
    assert strat.state.position is None

    # --- Retest candle: low 109.5 <= boundary 110, close 109.8 (<=110) -> NO signal. ---
    retest = strat.on_candle(_candle(110.5, 109.5, 109.8, "09:20:00"))
    assert retest is None, "retest candle must not emit until price resumes"
    assert strat.state.retested is True, "the boundary retest should be recorded"
    assert strat.state.breakout_dir == "BUY", "still awaiting resumption"
    assert strat.state.position is None

    # --- Resume candle: close 113 > or_high 110 after retest -> BUY emitted now. ---
    resume = strat.on_candle(_candle(114, 111, 113, "09:21:00"))
    assert resume is not None, "resume candle must emit the BUY signal"
    assert resume.direction == "BUY"
    assert resume.price == pytest.approx(113.0)
    # Sized from range_size = 110 - 100 = 10 (Req 11.6).
    assert resume.stop_loss == pytest.approx(103.0)   # 113 - 10 * 1.0
    assert resume.target == pytest.approx(133.0)      # 113 + 10 * 2.0
    assert resume.stop_loss < resume.price < resume.target

    # Signal contract spot-checks.
    assert resume.instrument == "2885"
    assert resume.quantity == 50
    assert resume.strategy_name == strat.name
    assert 0.0 <= resume.confidence <= 1.0
    # Retest-confirmed (but not volume-confirmed) -> base 0.6 + 0.2 retest boost.
    assert resume.confidence == pytest.approx(0.8)

    # The position is now open and the arming state has been cleared.
    assert strat.state.position is not None
    assert strat.state.position.is_open is True
    assert strat.state.breakout_dir is None
    assert strat.state.retested is False
    assert strat.state.trades_today == 1
