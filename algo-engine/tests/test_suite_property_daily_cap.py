# Feature: intraday-strategy-suite, Property 14
"""Property 14 - Daily entry count never exceeds the cap.

For *any* candle sequence within a single trading day and *any* configured
``max_trades_per_day``, the total number of **entry** Signals emitted that day is
less than or equal to ``max_trades_per_day``.

Validates: Requirements 8.3, 8.4

Approach
--------
This is a suite-wide property, so the test is parameterized across all five
strategy classes. Each strategy is fed a single-day candle sequence under a
randomized config. To make the cap *genuinely bind* (rather than passing
vacuously because the sequence never produced enough entries), the test:

* uses a small ``warmup_period`` and a very large ``capital`` so the warmup gate
  and the 2% risk gate do not suppress every emission;
* draws a small ``max_trades_per_day`` (1..4) so the cap is reachable; and
* forces **re-entry eligibility** between candles by closing any open Position via
  a tick that breaches its stop/target. The position/re-entry gate (Req 8.1) only
  blocks new entries *while a Position is open*; by closing the position after each
  entry the strategy is free to re-enter on the next qualifying candle, so the only
  thing that can stop it re-entering indefinitely is the daily cap (Req 8.4).

An emission is classified as an **entry** (as opposed to a risk-reducing
square-off, which does not count toward the cap) by snapshotting
``state.trades_today`` immediately before each ``on_candle`` call: only entries
increment that counter. We assert both that the running entry count stays within
the cap and that ``state.trades_today`` itself never exceeds the cap at any point.
"""

from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import generators as gen

from strategies.vwap_mean_reversion import VWAPMeanReversion
from strategies.ema_trend_pullback import EMATrendPullback
from strategies.orb_enhanced import ORBEnhanced
from strategies.zscore_reversion import ZScoreReversion
from strategies.volatility_squeeze import VolatilitySqueezeBreakout


# All five strategies share the do-not-modify BaseStrategy contract and the
# copy-stable lifecycle pipeline (including the position / max-trades gate), so the
# cap property applies uniformly to every one of them.
STRATEGY_CLASSES = [
    VWAPMeanReversion,
    EMATrendPullback,
    ORBEnhanced,
    ZScoreReversion,
    VolatilitySqueezeBreakout,
]


def _close_open_position_via_tick(strategy) -> None:
    """Close any open Position by sending a tick that breaches its stop.

    For a BUY a tick at/below ``stop_loss`` breaches; for a SELL a tick at/above
    ``stop_loss`` breaches. Sending ``price = stop_loss`` therefore breaches for
    either direction (the breach checks use ``<=`` / ``>=``). ``on_tick`` marks the
    position closed internally and always returns None, leaving the strategy
    eligible for re-entry on the next qualifying candle.
    """
    pos = strategy.state.position
    if pos is not None and pos.is_open:
        result = strategy.on_tick({"price": float(pos.stop_loss)})
        # on_tick never emits a Signal (stops are broker-managed bookkeeping only).
        assert result is None


# Feature: intraday-strategy-suite, Property 14
@pytest.mark.property
@pytest.mark.parametrize("strategy_cls", STRATEGY_CLASSES)
@settings(max_examples=100)
@given(
    base_config=gen.configs(),
    sequence=gen.candle_sequences(days=1, min_len=1, max_len=60),
    max_trades=st.integers(min_value=1, max_value=4),
    warmup=st.integers(min_value=1, max_value=3),
)
def test_daily_entry_count_never_exceeds_cap(
    strategy_cls, base_config, sequence, max_trades, warmup
):
    """Total entry Signals in a single day stay within max_trades_per_day."""
    config = dict(base_config)
    # Make the cap genuinely reachable and binding:
    #  - small cap so it can be hit within a single day's sequence,
    #  - small warmup so entries are evaluated early,
    #  - huge capital so the 2% risk gate does not veto every entry.
    config["max_trades_per_day"] = max_trades
    config["warmup_period"] = warmup
    config["capital"] = 1e12

    strategy = strategy_cls(config=config)

    entry_count = 0
    for candle in sequence:
        trades_before = strategy.state.trades_today
        signal = strategy.on_candle(candle)

        # Classify the emission: only an ENTRY increments trades_today; a
        # square-off closes a position and is exempt from the cap.
        is_entry = strategy.state.trades_today > trades_before
        if signal is not None and is_entry:
            entry_count += 1

        # The strategy's own daily counter must never exceed the cap at any point.
        assert strategy.state.trades_today <= max_trades, (
            f"{strategy_cls.__name__}: trades_today "
            f"{strategy.state.trades_today} exceeded cap {max_trades}"
        )

        # Force re-entry eligibility so the cap is the only thing that can stop
        # further entries (otherwise an open position would mask the cap).
        _close_open_position_via_tick(strategy)

    # The total number of entry Signals emitted during the day is bounded by the cap.
    assert entry_count <= max_trades, (
        f"{strategy_cls.__name__}: emitted {entry_count} entries in one day, "
        f"exceeding max_trades_per_day={max_trades}"
    )
