"""THE position-sizing law. One function. No leverage term. No callers besides tests.

Replaces five mutually incompatible sizing implementations that coexisted
(blueprint Section 1.1.5, finding R-16):

  1. algo-engine/backtester/run_backtest.py:28-52        risk/stop, 5.0x capital cap
  2. algo-engine/backtester/scanner_backtest.py:323-328   calls (1), re-clamped to 1.67x
  3. algo-engine/backtester/portfolio_scanner.py:345      calls (1)
  4. algo-engine/oms/live_scanner_loop.py:91-102         risk/stop, 0.20x capital cap
  5. algo-engine/oms/position_sizer.py:37-48             half-Kelly, 0.20x cap (dead code)

A backtest run through (1) and a live run through (4) differed by 25x in position
size for the identical signal. That is the bug this module exists to make impossible.

ROOT CAUSE (blueprint Section 1.1.2). The legacy risk rule was

    q_risk = floor(risk_budget / stop_distance)

so nominal exposure as a multiple of capital is

    (q_risk * entry) / capital = risk_pct * entry / stop_distance
                               = 1 / (risk_pct * epsilon)

where epsilon is the stop as a fraction of price. Nominal exposure is therefore
INDEPENDENT of capital and is a pure function of how tight the stop is:

    stop 2.0% of price, risk 2%  ->  25x capital
    stop 1.0% of price, risk 2%  ->  50x capital
    stop 0.2% of price, risk 2%  -> 250x capital   (the VWAP flat-Rs.2 case)

With a flat Rs 2.00 stop on a Rs 3,500 stock the unclamped value is 877x. The
reported "35x" was what the 5.0x cap reduced it to -- the cap was the only thing
between the engine and an 877x position, and it was 5x, not the 1x that the
historical record claims was implemented.

THE FIX. A triple clamp, applied in this order, all three terms ALWAYS:

    q = min( floor(risk_budget / stop_distance),        # risk rule
            floor(capital / entry),                     # 1.0x nominal cap, UNCONDITIONAL
            floor(capital * slot_gross / entry) )       # per-slot gross exposure

with the stop distance itself floored:

    stop_distance = max(atr_multiple * atr, atr_floor_pct * entry)

The ATR floor is the term the repository never had. Without it a tight stop still
manufactures size, because the risk rule is a function of the stop distance.

INVARIANT (property P-1). With all terms present, the realised per-trade loss is

    L = q * stop_distance <= min(risk_pct * capital, capital * stop_distance / entry)

which is <= risk_pct * capital whenever stop_distance / entry <= risk_pct -- true for
every liquid name once the ATR floor is applied. No regime can produce a loss larger
than the risk budget.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Default ATR floor. 0.5% of price. Chosen so that, at risk_pct = 0.02, the
# nominal multiple 1/(risk_pct * atr_floor_pct) = 100x is an upper bound that the
# 1.0x nominal cap then always dominates for any stop >= 0.25% of price.
DEFAULT_ATR_FLOOR_PCT = 0.005


class SizingError(ValueError):
    """Raised when a sizing request is unusable. Never silently substituted."""


@dataclass(frozen=True)
class SizingConfig:
    capital: float = 100_000.0
    risk_pct: float = 0.02
    slot_gross_pct: float = 0.20
    atr_floor_pct: float = DEFAULT_ATR_FLOOR_PCT
    min_qty: int = 1
    leverage: float = 1.0
    """Buying-power multiplier. Scales the NOMINAL and SLOT caps only.

    It NEVER scales the risk budget. `risk_budget = capital * risk_pct` is always
    measured against UNLEVERED equity, so `risk_pct=0.01` on Rs 100,000 is Rs 1,000
    of real risk whether or not 3x margin is in use. Leving the risk budget as well
    would silently convert a stated 1% account risk into a 3% one.

    At leverage = 1.0 every clamp below is bit-identical to the pre-leverage law,
    which is why the existing sizing tests pass unchanged.
    """

    def __post_init__(self) -> None:
        if self.capital <= 0:
            raise SizingError(f"capital must be positive, got {self.capital}")
        if not (0 < self.risk_pct <= 1):
            raise SizingError(f"risk_pct must be in (0, 1], got {self.risk_pct}")
        if not (0 < self.slot_gross_pct <= 1.0):
            raise SizingError(
                f"slot_gross_pct must be in (0, 1.0] -- it is the per-slot SHARE of "
                f"buying power, so the account total is bounded by leverage; "
                f"got {self.slot_gross_pct}"
            )
        if not (0 <= self.atr_floor_pct < 1):
            raise SizingError(f"atr_floor_pct must be in [0, 1), got {self.atr_floor_pct}")
        if self.min_qty < 1:
            raise SizingError(f"min_qty must be >= 1, got {self.min_qty}")
        if not (1.0 <= self.leverage <= 5.0):
            raise SizingError(
                f"leverage must be in [1.0, 5.0] -- beyond 5x the exchange margin "
                f"and the brokerage cost both stop being retail-viable; got {self.leverage}"
            )

    @property
    def buying_power(self) -> float:
        """Total nominal exposure this config authorises across ALL slots."""
        return self.capital * self.leverage


@dataclass(frozen=True)
class SizingResult:
    """A fully attributable sizing decision. Every clamp is recorded so that
    reports can state WHICH term bound -- the diagnostic the legacy engine lacked."""
    qty: int
    stop_distance: float
    risk_budget: float
    qty_by_risk: int
    qty_by_nominal_cap: int
    qty_by_slot: int
    binding_clause: str
    planned_loss: float
    planned_loss_pct: float
    nominal_value: float
    nominal_pct_of_capital: float

    def as_dict(self) -> dict[str, float | int | str]:
        return {
            "qty": self.qty,
            "stop_distance": self.stop_distance,
            "risk_budget": self.risk_budget,
            "qty_by_risk": self.qty_by_risk,
            "qty_by_nominal_cap": self.qty_by_nominal_cap,
            "qty_by_slot": self.qty_by_slot,
            "binding_clause": self.binding_clause,
            "planned_loss": self.planned_loss,
            "planned_loss_pct": self.planned_loss_pct,
            "nominal_value": self.nominal_value,
            "nominal_pct_of_capital": self.nominal_pct_of_capital,
        }


def effective_stop_distance(atr: float | None, entry: float,
                            atr_multiple: float = 1.0,
                            atr_floor_pct: float = DEFAULT_ATR_FLOOR_PCT) -> float:
    """Stop distance with the ATR floor applied.

    stop_distance = max(atr_multiple * atr, atr_floor_pct * entry)

    `atr` may be None, 0, or non-finite (a name with no usable history). In every
    such case the floor governs, which is the safe direction: it makes the stop
    wider and the position smaller.
    """
    if entry <= 0:
        raise SizingError(f"entry must be positive, got {entry}")
    if not (atr_floor_pct >= 0):
        raise SizingError(f"atr_floor_pct must be >= 0, got {atr_floor_pct}")
    floor = atr_floor_pct * entry
    if atr is None:
        return floor
    try:
        a = float(atr)
    except (TypeError, ValueError):
        return floor
    if not math.isfinite(a) or a <= 0:
        return floor
    return max(atr_multiple * a, floor)


def compute_quantity(entry: float, stop_distance: float, cfg: SizingConfig,
                     lot_size: int = 1) -> SizingResult:
    """THE sizing law. Returns the quantity AND the full clamp attribution.

    The three clamps, all unconditional:
        1. risk rule     : qty <= floor(risk_pct * capital / stop_distance)
        2. 1.0x nominal  : qty <= floor(capital / entry)
        3. slot exposure : qty <= floor(capital * slot_gross_pct / entry)

    Clause 3 is the binding constraint at high concurrency and is what makes the
    cost/gross law of blueprint Section 4.2 bite: at slot_gross_pct = 0.10 and
    capital 100,000, notional is Rs 10,000, at which the minimum viable intraday
    target is ~2.0% against a measured unconditional MFE of 0.94%.
    """
    if entry <= 0:
        raise SizingError(f"entry must be positive, got {entry}")
    if stop_distance <= 0:
        raise SizingError(f"stop_distance must be positive, got {stop_distance}")
    if lot_size < 1:
        raise SizingError(f"lot_size must be >= 1, got {lot_size}")

    # The risk budget is ALWAYS measured against unlevered equity.
    risk_budget = cfg.capital * cfg.risk_pct
    qty_by_risk = int(risk_budget / stop_distance)

    # The nominal cap. At leverage = 1.0 this is the unconditional 1.0x cap whose
    # absence produced the 35x/877x disasters; leverage multiplies it into an
    # explicit buying-power allowance rather than an implicit accident.
    buying_power = cfg.buying_power
    qty_by_nominal_cap = int(buying_power / entry)
    qty_by_slot = int((buying_power * cfg.slot_gross_pct) / entry)

    qty_by_risk = max(qty_by_risk, 0)
    qty_by_nominal_cap = max(qty_by_nominal_cap, 0)
    qty_by_slot = max(qty_by_slot, 0)

    if qty_by_nominal_cap == 0:
        raise SizingError(
            f"entry {entry} exceeds capital {cfg.capital}: no whole unit is "
            f"affordable at 1.0x nominal. The 1.0x cap is not negotiable."
        )

    if qty_by_slot == 0:
        qty = 0
        binding = "slot_gross"
    elif qty_by_risk <= qty_by_slot and qty_by_risk <= qty_by_nominal_cap:
        qty = qty_by_risk
        binding = "risk"
    elif qty_by_slot <= qty_by_risk and qty_by_slot <= qty_by_nominal_cap:
        qty = qty_by_slot
        binding = "slot_gross"
    else:
        qty = qty_by_nominal_cap
        binding = "nominal_cap"

    if qty < 1:
        # Cannot afford even one unit within the slot budget. Return a zero-size
        # decision and let the caller skip -- do NOT fall back to min_qty=1, which
        # would silently breach both the slot and the 1.0x cap.
        return SizingResult(
            qty=0, stop_distance=stop_distance, risk_budget=risk_budget,
            qty_by_risk=qty_by_risk, qty_by_nominal_cap=qty_by_nominal_cap,
            qty_by_slot=qty_by_slot, binding_clause="unaffordable",
            planned_loss=0.0, planned_loss_pct=0.0, nominal_value=0.0,
            nominal_pct_of_capital=0.0,
        )

    units = qty * lot_size
    nominal = entry * units
    planned_loss = stop_distance * units

    return SizingResult(
        qty=qty,
        stop_distance=stop_distance,
        risk_budget=risk_budget,
        qty_by_risk=qty_by_risk,
        qty_by_nominal_cap=qty_by_nominal_cap,
        qty_by_slot=qty_by_slot,
        binding_clause=binding,
        planned_loss=planned_loss,
        planned_loss_pct=planned_loss / cfg.capital,
        nominal_value=nominal,
        nominal_pct_of_capital=nominal / cfg.capital,
    )