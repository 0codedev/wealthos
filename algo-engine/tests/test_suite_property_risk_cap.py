# Feature: intraday-strategy-suite, Property 2
"""Property 2 - Entry signals never exceed the 2% risk cap.

For *any* emitted **entry** Signal from any of the five strategies, the projected
loss ``abs(price - stop_loss) * quantity`` is less than or equal to
``0.02 * capital``; whenever a computed stop would violate this bound the strategy
emits no entry Signal for that candle (the risk gate vetoes it -> returns None).

Validates: Requirements 5.5, 5.6

Approach
--------
This is a suite-wide property, so the test is parameterized across all five
strategy classes. Each strategy is fed varied multi-day candle sequences
(``generators.candle_sequences``) under varied configs (``generators.configs``,
which supplies ``capital`` / ``quantity`` and every per-strategy tunable).

The only Signals subject to the 2% cap are **entry** signals; square-off signals
(emitted at the cutoff to close an open position, with ``price = 0.0``) reduce risk
and are explicitly exempt (design "Risk Model"). Entries are distinguished from
square-offs by their side effect on per-day state: an entry increments
``state.trades_today`` (and opens a Position) whereas a square-off does not. We
therefore snapshot ``trades_today`` immediately before each ``on_candle`` call and
treat the returned Signal as an entry only when the counter increased across the
call. For every such entry we assert the projected loss stays within the cap.
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


# All five strategy classes share the do-not-modify BaseStrategy contract and the
# copy-stable lifecycle pipeline (including the risk gate), so the same property
# applies uniformly to every one of them.
STRATEGY_CLASSES = [
    VWAPMeanReversion,
    EMATrendPullback,
    ORBEnhanced,
    ZScoreReversion,
    VolatilitySqueezeBreakout,
]

# Small absolute tolerance to absorb floating-point rounding in the projected-loss
# product (price/stop are floats, quantity is an int).
_RISK_TOLERANCE = 1e-6


# Feature: intraday-strategy-suite, Property 2
@pytest.mark.property
@settings(max_examples=100)
@given(
    strategy_cls=st.sampled_from(STRATEGY_CLASSES),
    config=gen.configs(),
    sequence=gen.candle_sequences(min_len=1, max_len=40, max_days=3),
)
def test_entry_signals_never_exceed_two_percent_risk_cap(strategy_cls, config, sequence):
    """Every emitted entry Signal keeps projected loss within 0.02 * capital."""
    strategy = strategy_cls(config=config)

    capital = float(config["capital"])
    risk_cap = 0.02 * capital

    for candle in sequence:
        trades_before = strategy.state.trades_today
        signal = strategy.on_candle(candle)

        if signal is None:
            continue

        # Distinguish an ENTRY from a square-off: only entries increment
        # trades_today (square-offs close an open position and are risk-exempt).
        is_entry = strategy.state.trades_today > trades_before
        if not is_entry:
            continue

        projected_loss = abs(float(signal.price) - float(signal.stop_loss)) * signal.quantity
        assert projected_loss <= risk_cap + _RISK_TOLERANCE, (
            f"{strategy_cls.__name__}: entry projected loss {projected_loss!r} "
            f"exceeds 2% risk cap {risk_cap!r} "
            f"(price={signal.price!r}, stop_loss={signal.stop_loss!r}, "
            f"quantity={signal.quantity!r}, capital={capital!r})"
        )
