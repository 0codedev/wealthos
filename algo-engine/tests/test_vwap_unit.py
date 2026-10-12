"""Example/edge-case unit tests for the VWAP Mean Reversion strategy (task 2.7).

These are hand-constructed, fully deterministic scenarios that pin down concrete
arithmetic the property tests only assert structurally:

1. ``test_buy_entry_stop_and_target_arithmetic`` -- a BUY whose stop/target are
   computed by hand from a *known* VWAP (Requirements 9.2, 9.4).
2. ``test_sell_entry_stop_and_target_arithmetic`` -- the SELL mirror
   (Requirements 9.3, 9.5).
3. ``test_degraded_mode_emits_prefixed_debug_log`` -- feeding candles without
   ``volume`` drives Synthetic_VWAP (degraded) mode and emits a strategy-prefixed
   degraded-mode debug log (Requirements 2.8, 9.4, 9.5 context).

The VWAP is held at an exact, hand-checkable value of 100.0 by constructing every
candle so its Typical_Price = (high + low + close) / 3 equals 100 and carrying a
constant volume, so cum_pv / cum_vol stays exactly 100 even on the entry candle.
"""

from __future__ import annotations

import datetime as _dt

import pytest

from strategies.vwap_mean_reversion import VWAPMeanReversion


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


def _time(minute_offset: int) -> str:
    """A monotonic in-window time string starting at 09:20:00 IST."""
    base = _dt.datetime(2024, 1, 1, 9, 20, 0) + _dt.timedelta(minutes=minute_offset)
    return base.strftime("%H:%M:%S")


# A config whose risk gate (2% of capital = 20,000) comfortably admits the
# hand-computed stops, with warmup small enough to reach the entry candle quickly.
def _config(**overrides) -> dict:
    cfg = {
        "instrument": "2885",
        "quantity": 50,
        "capital": 1_000_000.0,   # 2% risk cap = 20,000
        "entry_deviation": 1.0,
        "stop_distance": 3.0,
        "synthetic_confidence_cap": 0.5,
        "warmup_period": 5,
        "max_trades_per_day": 3,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    cfg.update(overrides)
    return cfg


def _warmup_at_100(strat, count):
    """Feed ``count`` flat candles (Typical_Price == VWAP == 100) with volume.

    All emit None (still in warmup). Times are monotonic so no day reset fires.
    """
    for i in range(count):
        sig = strat.on_candle(_candle(100.0, 100.0, 100.0, _time(i), volume=1000.0))
        assert sig is None, f"warmup candle {i} should not emit a signal"


# ---------------------------------------------------------------------------
# 1. BUY scenario -- hand-computed stop/target
# ---------------------------------------------------------------------------
def test_buy_entry_stop_and_target_arithmetic():
    """close stretched below a known VWAP of 100 emits BUY with exact levels.

    With four flat warmup candles, VWAP = 100.0. The entry candle is constructed
    so its Typical_Price is still exactly 100 (high=108, low=96, close=96), keeping
    cum_pv / cum_vol == 100 after it is folded in. close (96) is 4 below VWAP,
    well past entry_deviation (1.0), so:

        direction = BUY
        price     = close          = 96.0
        stop_loss = close - stop_distance = 96 - 3 = 93.0   (Req 9.4)
        target    = VWAP                  = 100.0           (Req 9.4, toward VWAP)
    """
    strat = VWAPMeanReversion(config=_config())

    # 4 warmup candles (candle_count 1..4 < warmup_period 5 -> all None).
    _warmup_at_100(strat, 4)

    # 5th candle is the entry candle. Typical = (108 + 96 + 96) / 3 = 100.
    entry = _candle(108.0, 96.0, 96.0, _time(4), volume=1000.0)
    sig = strat.on_candle(entry)

    assert sig is not None, "expected a BUY signal on the entry candle"
    assert sig.direction == "BUY"
    assert sig.price == pytest.approx(96.0)
    assert sig.stop_loss == pytest.approx(93.0)   # close - stop_distance
    assert sig.target == pytest.approx(100.0)     # at VWAP
    # target is above entry and stop below entry for a BUY.
    assert sig.stop_loss < sig.price < sig.target
    # Signal contract spot-checks.
    assert sig.instrument == "2885"
    assert sig.quantity == 50
    assert sig.strategy_name == strat.name
    assert 0.0 <= sig.confidence <= 1.0


# ---------------------------------------------------------------------------
# 2. SELL scenario -- hand-computed stop/target (mirror)
# ---------------------------------------------------------------------------
def test_sell_entry_stop_and_target_arithmetic():
    """close stretched above a known VWAP of 100 emits SELL with exact levels.

    Entry candle Typical_Price stays exactly 100 (high=104, low=92, close=104),
    keeping VWAP == 100. close (104) is 4 above VWAP, past entry_deviation, so:

        direction = SELL
        price     = close          = 104.0
        stop_loss = close + stop_distance = 104 + 3 = 107.0  (Req 9.5)
        target    = VWAP                  = 100.0            (Req 9.5, toward VWAP)
    """
    strat = VWAPMeanReversion(config=_config())

    _warmup_at_100(strat, 4)

    # Typical = (104 + 92 + 104) / 3 = 100.
    entry = _candle(104.0, 92.0, 104.0, _time(4), volume=1000.0)
    sig = strat.on_candle(entry)

    assert sig is not None, "expected a SELL signal on the entry candle"
    assert sig.direction == "SELL"
    assert sig.price == pytest.approx(104.0)
    assert sig.stop_loss == pytest.approx(107.0)  # close + stop_distance
    assert sig.target == pytest.approx(100.0)     # at VWAP
    # target is below entry and stop above entry for a SELL.
    assert sig.target < sig.price < sig.stop_loss
    assert sig.instrument == "2885"
    assert sig.quantity == 50
    assert sig.strategy_name == strat.name
    assert 0.0 <= sig.confidence <= 1.0


# ---------------------------------------------------------------------------
# 3. Degraded mode (Synthetic_VWAP) debug-log assertion
# ---------------------------------------------------------------------------
def test_degraded_mode_emits_prefixed_debug_log(logger_capture):
    """Candles without ``volume`` drive Synthetic_VWAP mode and log it (Req 2.8).

    The degraded-mode notice must be emitted and, like every strategy log line,
    be prefixed with the strategy's configured name (Req 6.1).
    """
    strat = VWAPMeanReversion(config=_config())
    cap = logger_capture(strat.name)  # attach to the strategy's own logger

    # Feed candles WITHOUT a volume field -> true VWAP not computable -> degraded.
    for i in range(3):
        strat.on_candle(_candle(100.0, 100.0, 100.0, _time(i)))  # no volume

    # A degraded-mode notice naming Synthetic_VWAP was emitted.
    assert cap.contains("degraded mode"), (
        f"expected a degraded-mode debug log; captured: {cap.messages}"
    )
    assert cap.contains("Synthetic_VWAP"), (
        f"expected the degraded notice to name Synthetic_VWAP; captured: {cap.messages}"
    )

    # Every captured message is prefixed with the strategy name (Req 6.1).
    prefix = f"[{strat.name}]"
    assert cap.messages, "expected at least one captured log message"
    for msg in cap.messages:
        assert msg.startswith(prefix), f"log line not prefixed with {prefix!r}: {msg!r}"
