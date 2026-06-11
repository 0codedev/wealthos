"""THE bracket. The R-multiple is the single source of truth.

Fixes blueprint Section 1.3.2. The legacy scanner computed

    R         = |entry - stop|
    target    = entry +/- (target_atr_mult / stop_atr_mult) * R

so the REALISED risk:reward is the RATIO of the two parameters, not the value the
parameter name advertises. `snap` with stop_atr_mult 0.75 and target_atr_mult 2.0
actually trades at 2.667:1, not 2.0:1. Every strategy in the legacy registry
therefore had a risk:reward different from its label, and nobody could reason about
the portfolio.

Here the bracket is built once, from a single r_mult, and BOTH legs are derived from
it. If you want 2:1, you set r_mult=2 and you get exactly 2:1.

The ATR floor is the second thing this module owns. A stop may never be tighter than
atr_floor_pct * entry. Without that floor, a tight stop still manufactures size
because the sizing law divides by the stop distance -- which is how a flat Rs 2.00
stop on a Rs 3,500 stock produced a 35x-capital position.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_ATR_FLOOR_PCT = 0.005
DEFAULT_R_MULT = 2.0


class ExitError(ValueError):
    """Raised when a bracket cannot be built. Never silently substituted."""


@dataclass(frozen=True)
class Bracket:
    """A complete, self-consistent exit bracket.

    direction : +1 long, -1 short
    stop      : absolute price
    target    : absolute price
    risk      : per-unit risk (== |entry - stop| by construction)
    r_mult    : reward expressed in units of risk
    atr       : the ATR that fed the floor, or None if the floor governed
    floored   : True when the ATR floor widened the stop above atr_mult * ATR
    """
    entry: float
    direction: int
    stop: float
    target: float
    risk: float
    r_mult: float
    atr: float | None
    floored: bool

    @property
    def realised_r_multiple(self) -> float:
        """What the position ACTUALLY pays, which is what the report must show."""
        return abs(self.target - self.entry) / self.risk if self.risk > 0 else 0.0

    def as_dict(self) -> dict:
        return {
            "entry": self.entry, "direction": self.direction, "stop": self.stop,
            "target": self.target, "risk": self.risk, "r_mult": self.r_mult,
            "atr": self.atr, "floored": self.floored,
            "realised_r_multiple": self.realised_r_multiple,
        }


def bracket(entry: float, atr: float | None, direction: int,
            r_mult: float = DEFAULT_R_MULT,
            atr_floor_pct: float = DEFAULT_ATR_FLOOR_PCT) -> Bracket:
    """Build the bracket. THE only place stops and targets are made.

    risk   = max(r_mult * stop_mult... ) -- see below
    stop   = entry - direction * risk
    target = entry + direction * r_mult * risk

    `atr_floor_pct` is the fix for the leverage disaster: a stop may never be tighter
    than atr_floor_pct * entry, which bounds the nominal multiple that the sizing law
    can manufacture.
    """
    if entry <= 0:
        raise ExitError(f"entry must be positive, got {entry}")
    if direction not in (1, -1):
        raise ExitError(f"direction must be +1 (long) or -1 (short), got {direction!r}")
    if r_mult <= 0:
        raise ExitError(f"r_mult must be positive, got {r_mult}")
    if atr_floor_pct < 0 or atr_floor_pct >= 1:
        raise ExitError(f"atr_floor_pct must be in [0, 1), got {atr_floor_pct}")

    floor = atr_floor_pct * entry
    raw = None
    if atr is not None:
        try:
            a = float(atr)
        except (TypeError, ValueError):
            a = None
        if a is not None and a == a and a not in (float("inf"), float("-inf")) and a > 0:
            raw = a
    risk = max(raw, floor) if raw is not None else floor
    if risk <= 0:
        raise ExitError("computed risk must be positive")

    stop = entry - direction * risk
    target = entry + direction * r_mult * risk
    floored = raw is None or risk > raw + 1e-12
    return Bracket(entry=entry, direction=direction, stop=stop, target=target,
                   risk=risk, r_mult=r_mult, atr=raw, floored=floored)


def structural_bracket(entry: float, structure_level: float, direction: int,
                       r_mult: float = DEFAULT_R_MULT,
                       atr: float | None = None,
                       atr_floor_pct: float = DEFAULT_ATR_FLOOR_PCT) -> Bracket:
    """Bracket whose stop sits at a structural level (e.g. the far side of a squeeze).

    Used by the squeeze strategy, whose stop is `squeeze_low` (long) / `squeeze_high`
    (short) rather than an ATR multiple. Falls back to the ATR/floor bracket when the
    structural level is on the WRONG SIDE of entry, which is the case the legacy
    volatility_squeezev2.py:502-503 guarded for.

    The ATR floor still applies: a structural stop that happens to be very tight is
    floored, because the sizing law divides by the stop distance.
    """
    if entry <= 0:
        raise ExitError(f"entry must be positive, got {entry}")
    if direction not in (1, -1):
        raise ExitError(f"direction must be +1 or -1, got {direction!r}")
    if structure_level is None:
        return bracket(entry, atr, direction, r_mult, atr_floor_pct)

    raw_risk = abs(entry - float(structure_level))
    if raw_risk <= 0:
        return bracket(entry, atr, direction, r_mult, atr_floor_pct)

    # Wrong side of entry (a long stop above entry) is incoherent; fall back.
    if (direction == 1 and float(structure_level) >= entry) or \
       (direction == -1 and float(structure_level) <= entry):
        return bracket(entry, atr, direction, r_mult, atr_floor_pct)

    floor = atr_floor_pct * entry
    risk = max(raw_risk, floor)
    stop = float(structure_level)
    target = entry + direction * r_mult * risk
    return Bracket(entry=entry, direction=direction, stop=stop, target=target,
                   risk=risk, r_mult=r_mult, atr=atr,
                   floored=risk > raw_risk + 1e-12)


def objective_bracket(entry: float, objective: float, direction: int,
                      atr: float | None = None,
                      max_r_mult: float = 6.0,
                      atr_floor_pct: float = DEFAULT_ATR_FLOOR_PCT) -> Bracket:
    """Bracket whose TARGET is a price objective rather than an R multiple.

    Used by VWAP mean reversion, where the exit is the VWAP line itself. If the
    objective is closer than the ATR floor would allow, the target is pulled back to
    the floor and the realised R multiple is reported honestly -- because a 1:1
    VWAP target is what made that strategy unviable on cost grounds (breakeven 56.6%
    win rate against a 48.2% base rate).
    """
    if entry <= 0:
        raise ExitError(f"entry must be positive, got {entry}")
    if direction not in (1, -1):
        raise ExitError(f"direction must be +1 or -1, got {direction!r}")
    if objective is None:
        return bracket(entry, atr, direction, DEFAULT_R_MULT, atr_floor_pct)

    reward = direction * (float(objective) - entry)
    if reward <= 0:
        return bracket(entry, atr, direction, DEFAULT_R_MULT, atr_floor_pct)

    floor = atr_floor_pct * entry
    atr_ok = atr is not None and atr == atr and atr > 0
    risk = max(float(atr) if atr_ok else 0.0, floor)
    realised_r = reward / risk if risk > 0 else 0.0
    if realised_r > max_r_mult:
        target = entry + direction * max_r_mult * risk
        effective_r = max_r_mult
    else:
        target = float(objective)
        effective_r = realised_r
    stop = entry - direction * risk
    return Bracket(entry=entry, direction=direction, stop=stop, target=target,
                   risk=risk, r_mult=effective_r, atr=atr,
                   floored=atr is None or risk > (atr + 1e-12))


def first_touch_exit(high: float, low: float, open_: float,
                     br: Bracket) -> tuple[float, str] | None:
    """Resolve an exit on a single bar, PESSIMISTICALLY.

    Contract E2 (blueprint Section 3.5.2):
      * stop is checked BEFORE target, so a bar touching both books the stop;
      * the stop fills AT OR THROUGH the stop, not at the stop. A real stop-market
        order does not fill at the trigger price on a gap.

    This is the fix for finding R-13: the legacy engines did
    `exit_price = active_trade["stop_loss"]`, making every stop fill a best case.

    `open_` is used to model a gap through the level. Returns (exit_price, reason) or
    None when neither level was touched.
    """
    if br.direction == 1:
        if low <= br.stop:
            fill = min(br.stop, open_) if open_ is not None and open_ < br.stop else br.stop
            return (fill, "STOP")
        if high >= br.target:
            fill = max(br.target, open_) if open_ is not None and open_ > br.target else br.target
            return (fill, "TARGET")
    else:
        if high >= br.stop:
            fill = max(br.stop, open_) if open_ is not None and open_ > br.stop else br.stop
            return (fill, "STOP")
        if low <= br.target:
            fill = min(br.target, open_) if open_ is not None and open_ < br.target else br.target
            return (fill, "TARGET")
    return None
