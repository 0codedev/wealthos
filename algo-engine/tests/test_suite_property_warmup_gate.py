# Feature: intraday-strategy-suite, Property 11
"""Property 11 - Warmup gate suppresses entries until enough data.

*For any* candle sequence within a trading day, no entry Signal is emitted while
the day's observed candle count is less than the configured ``warmup_period``, and
the strategy becomes entry-eligible exactly when the count first reaches
``warmup_period``, for any configured ``warmup_period``.

**Validates: Requirements 7.1, 7.2, 7.3**

Approach
--------
This is a *suite-wide* property: it is parameterized across all five strategy
classes, which all gate entries through the same copy-stable lifecycle pipeline.

For each example we draw a randomized full Config (so strategy-specific tunables
vary) and override ``warmup_period`` with a *drawn* value (Req 7.3: warmup is a
Config-overridable parameter, and the gate must track whatever value is supplied).
``capital`` is set very large so the 2% risk gate never vetoes an otherwise-valid
entry -- this keeps the property exercised against real emissions rather than
passing vacuously. The four session-timing values keep their valid defaults so the
warmup gate (not the market-hours gate) is the boundary under test.

We feed a *single-day* candle sequence (``days=1``) so no trading-day reset occurs
and ``candle_count`` / ``trades_today`` increase monotonically. In the shared
pipeline the day's ``candle_count`` is incremented *before* the warmup gate is
evaluated, so an entry emitted on the day's N-th candle is observed with
``state.candle_count == N``; the gate permits entries only when
``candle_count >= warmup_period``.

An *entry* is detected as an increment of ``state.trades_today`` across an
``on_candle`` call -- square-off signals do not touch that counter, so exits are
correctly excluded. For every detected entry we assert
``state.candle_count >= warmup_period`` at the moment of emission, which is
equivalent to: no entry ever fires while ``candle_count < warmup_period``.
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
# copy-stable lifecycle pipeline (including the warmup gate), so the warmup
# invariant must hold identically for each (Req 7.1, 7.2, 7.3).
STRATEGY_CLASSES = [
    VWAPMeanReversion,
    EMATrendPullback,
    ORBEnhanced,
    ZScoreReversion,
    VolatilitySqueezeBreakout,
]


# Feature: intraday-strategy-suite, Property 11
@pytest.mark.property
@pytest.mark.parametrize("strategy_cls", STRATEGY_CLASSES)
@settings(max_examples=100)
@given(
    base_config=gen.configs(),
    warmup_period=st.integers(min_value=1, max_value=30),
    sequence=gen.candle_sequences(days=1, min_len=1, max_len=60),
)
def test_no_entry_while_below_warmup_period(strategy_cls, base_config, warmup_period, sequence):
    """No entry Signal fires while the day's candle count is below ``warmup_period``."""
    config = dict(base_config)
    # Req 7.3: the gate must track the Config-supplied warmup, whatever its value.
    config["warmup_period"] = warmup_period
    # Large capital so the 2% risk gate never vetoes an otherwise-valid entry,
    # keeping the warmup gate the meaningful boundary under test.
    config["capital"] = 1e12

    strategy = strategy_cls(config=config)

    for i, candle in enumerate(sequence):
        before = strategy.state.trades_today
        strategy.on_candle(candle)
        after = strategy.state.trades_today

        if after > before:
            # An entry fired on this candle (square-offs never touch trades_today).
            # candle_count is incremented before the warmup gate in the pipeline, so
            # an entry on the N-th candle means candle_count == N >= warmup_period.
            assert strategy.state.candle_count >= warmup_period, (
                f"{strategy_cls.__name__}: entry fired at candle index {i} with "
                f"candle_count={strategy.state.candle_count} < "
                f"warmup_period={warmup_period}"
            )
