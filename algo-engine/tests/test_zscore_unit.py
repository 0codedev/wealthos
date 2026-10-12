"""Example/edge-case unit tests for the Bollinger / Z-Score Reversion strategy (task 7.7).

These are hand-constructed, fully deterministic scenarios that pin down concrete
arithmetic the property tests only assert structurally:

1. ``test_buy_entry_target_at_mean_and_stop_arithmetic`` -- a BUY whose target
   (rolling mean) and stop (``exit_z`` std-devs below entry) are computed by hand
   from a *known* rolling window (Requirements 12.5).
2. ``test_sell_entry_target_at_mean_and_stop_arithmetic`` -- the SELL mirror,
   stop placed ``exit_z`` std-devs above entry (Requirements 12.5).
3. ``test_risk_veto_just_under_two_percent_emits`` and
   ``test_risk_veto_just_over_two_percent_vetoes`` -- a sibling pair straddling the
   2% risk boundary. With identical stop arithmetic (projected loss = exit_z * std *
   quantity = 600) the only difference is ``capital``, so one config admits the entry
   and the sibling vetoes it with a risk-limit debug log (Requirements 5.6).

THE EXACT WINDOW
----------------
Four warmup closes of 100.0 plus an entry close of 90.0 (BUY) / 110.0 (SELL) gives a
full lookback window of five closes whose rolling statistics are exact integers:

    BUY  window = [100, 100, 100, 100, 90]  -> mean = 98,  std = 4,  z = (90-98)/4  = -2.0
    SELL window = [100, 100, 100, 100, 110] -> mean = 102, std = 4,  z = (110-102)/4 = +2.0

population std = sqrt( ((4*2^2) + 8^2) / 5 ) = sqrt(80 / 5) = sqrt(16) = 4  (np.std, ddof=0)

With ``entry_z = 2.0`` the entry candle sits exactly at the threshold (z = -+2.0), and
with ``exit_z = 3.0`` the stop is exit_z*std = 12 away from entry:

    BUY:  target = mean = 98.0,  stop = 90 - 3*4 = 78.0
    SELL: target = mean = 102.0, stop = 110 + 3*4 = 122.0

Projected loss for the 2% gate = |entry - stop| * quantity = 12 * 50 = 600.
"""

from __future__ import annotations

import datetime as _dt

import pytest

from strategies.zscore_reversion import ZScoreReversion


pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _candle(high, low, close, t):
    """Build a candle dict with the guaranteed high/low/close/time fields."""
    return {"high": float(high), "low": float(low), "close": float(close), "time": t}


def _time(minute_offset: int) -> str:
    """A monotonic in-window time string starting at 09:20:00 IST, after warmup."""
    base = _dt.datetime(2024, 1, 1, 9, 20, 0) + _dt.timedelta(minutes=minute_offset)
    return base.strftime("%H:%M:%S")


def _config(**overrides) -> dict:
    """A config with lookback == warmup_period == 5 so the 5th candle is the entry.

    The 2% risk cap (0.02 * capital) defaults to 20,000 here, which comfortably
    admits the hand-computed projected loss of 600; the risk-veto tests override
    ``capital`` to straddle the boundary instead.
    """
    cfg = {
        "instrument": "2885",
        "quantity": 50,
        "capital": 1_000_000.0,   # 2% risk cap = 20,000 (admits projected loss 600)
        "lookback": 5,
        "entry_z": 2.0,
        "exit_z": 3.0,
        "warmup_period": 5,
        "max_trades_per_day": 3,
        "market_open": "09:15:00",
        "no_new_entry": "15:00:00",
        "square_off": "15:15:00",
        "session_close": "15:20:00",
    }
    cfg.update(overrides)
    return cfg


def _feed_warmup_100(strat):
    """Feed four flat closes of 100.0; all return None (still in warmup).

    Times are monotonic in-window so no day-reset fires. After these four candles
    the rolling window holds [100, 100, 100, 100] (not yet full at maxlen 5).
    """
    for i in range(4):
        sig = strat.on_candle(_candle(100.0, 100.0, 100.0, _time(i)))
        assert sig is None, f"warmup candle {i} should not emit a signal"


# ---------------------------------------------------------------------------
# 1. BUY scenario -- hand-computed target-at-mean and stop arithmetic
# ---------------------------------------------------------------------------
def test_buy_entry_target_at_mean_and_stop_arithmetic():
    """A close stretched below the rolling mean emits BUY with exact levels.

    Window = [100, 100, 100, 100, 90] -> mean = 98, std = 4, z = -2.0 == -entry_z.

        direction = BUY
        price     = close = 90.0
        target    = rolling mean       = 98.0          (Req 12.5, reversion target)
        stop_loss = close - exit_z*std = 90 - 3*4 = 78.0  (Req 12.5, exit_z below entry)
    """
    strat = ZScoreReversion(config=_config())

    _feed_warmup_100(strat)

    # 5th candle completes the window of five and is the entry candle.
    entry = _candle(91.0, 89.0, 90.0, _time(4))
    sig = strat.on_candle(entry)

    assert sig is not None, "expected a BUY signal on the entry candle"
    assert sig.direction == "BUY"
    assert sig.price == pytest.approx(90.0)
    assert sig.target == pytest.approx(98.0)       # at rolling mean
    assert sig.stop_loss == pytest.approx(78.0)    # close - exit_z * std
    # For a BUY: stop below entry, target (mean) above entry.
    assert sig.stop_loss < sig.price < sig.target
    # Signal contract spot-checks.
    assert sig.instrument == "2885"
    assert sig.quantity == 50
    assert sig.strategy_name == strat.name
    assert 0.0 <= sig.confidence <= 1.0


# ---------------------------------------------------------------------------
# 2. SELL scenario -- hand-computed target-at-mean and stop arithmetic (mirror)
# ---------------------------------------------------------------------------
def test_sell_entry_target_at_mean_and_stop_arithmetic():
    """A close stretched above the rolling mean emits SELL with exact levels.

    Window = [100, 100, 100, 100, 110] -> mean = 102, std = 4, z = +2.0 == entry_z.

        direction = SELL
        price     = close = 110.0
        target    = rolling mean       = 102.0           (Req 12.5, reversion target)
        stop_loss = close + exit_z*std = 110 + 3*4 = 122.0  (Req 12.5, exit_z above entry)
    """
    strat = ZScoreReversion(config=_config())

    _feed_warmup_100(strat)

    entry = _candle(111.0, 109.0, 110.0, _time(4))
    sig = strat.on_candle(entry)

    assert sig is not None, "expected a SELL signal on the entry candle"
    assert sig.direction == "SELL"
    assert sig.price == pytest.approx(110.0)
    assert sig.target == pytest.approx(102.0)      # at rolling mean
    assert sig.stop_loss == pytest.approx(122.0)   # close + exit_z * std
    # For a SELL: target (mean) below entry, stop above entry.
    assert sig.target < sig.price < sig.stop_loss
    assert sig.instrument == "2885"
    assert sig.quantity == 50
    assert sig.strategy_name == strat.name
    assert 0.0 <= sig.confidence <= 1.0


# ---------------------------------------------------------------------------
# 3. Risk-veto pair straddling the 2% boundary (Req 5.6)
# ---------------------------------------------------------------------------
# Both siblings reuse the BUY window so the stop arithmetic is identical:
#   projected loss = |entry - stop| * quantity = exit_z * std * quantity
#                  = 3 * 4 * 50 = 600.
# Only ``capital`` differs, placing the 2% cap (0.02 * capital) just above / below 600.
_BOUNDARY_PROJECTED_LOSS = 3.0 * 4.0 * 50.0  # exit_z * std * quantity == 600.0


def test_risk_veto_just_under_two_percent_emits():
    """capital chosen so the 2% cap (602) just exceeds the projected loss (600).

    0.02 * 30_100 = 602.0 >= 600.0 -> entry admitted.
    """
    capital_under = 30_100.0
    assert 0.02 * capital_under > _BOUNDARY_PROJECTED_LOSS  # 602 > 600

    strat = ZScoreReversion(config=_config(capital=capital_under))
    _feed_warmup_100(strat)

    sig = strat.on_candle(_candle(91.0, 89.0, 90.0, _time(4)))

    assert sig is not None, "projected loss just under the 2% cap should emit"
    assert sig.direction == "BUY"
    assert sig.price == pytest.approx(90.0)
    assert sig.stop_loss == pytest.approx(78.0)


def test_risk_veto_just_over_two_percent_vetoes(logger_capture):
    """sibling capital so the 2% cap (598) is just under the projected loss (600).

    0.02 * 29_900 = 598.0 < 600.0 -> entry vetoed: on_candle returns None and a
    risk-limit debug log is emitted (Req 5.6).
    """
    capital_over = 29_900.0
    assert 0.02 * capital_over < _BOUNDARY_PROJECTED_LOSS  # 598 < 600

    strat = ZScoreReversion(config=_config(capital=capital_over))
    cap = logger_capture(strat.name)  # attach to the strategy's own logger
    _feed_warmup_100(strat)

    sig = strat.on_candle(_candle(91.0, 89.0, 90.0, _time(4)))

    assert sig is None, "projected loss just over the 2% cap must be vetoed"
    assert cap.contains("risk limit exceeded"), (
        f"expected a risk-limit debug log; captured: {cap.messages}"
    )
    # Like every strategy log line, the veto notice is prefixed with the name (Req 6.1).
    prefix = f"[{strat.name}]"
    assert any(m.startswith(prefix) for m in cap.messages), (
        f"expected a name-prefixed log line; captured: {cap.messages}"
    )
