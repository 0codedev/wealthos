"""THE cost model. One class. Date-aware, segment-aware, side-aware, lot-aware.

Replaces six mutually inconsistent implementations that existed simultaneously
across the repository (blueprint Section 4.5):

  1. algo-engine/backtester/run_backtest.py:54-99      flat Rs 40 brokerage, 0.02% slippage
  2. algo-engine/backtester/scanner_backtest.py:45-71  min(Rs 20, 0.03%), 0.01% slippage
  3. algo-engine/backtester/cost_model.py:6-24         most complete, but DEAD (zero importers)
  4. python-bridge/backtest_simulator.py:764-779       GST and SEBI entirely ABSENT
  5. components/tabs/ApexBacktesterTab.tsx:239-243     flat Rs 20, no GST, no SEBI
  6. services/backtester/pine/PineBacktester.ts:109-110 flat Rs 40, no GST, no SEBI

Rate constants are salvaged verbatim from algo-engine/backtester/cost_model.py:7-24,
which remains the most complete of the six and is archived only after this module
passes the cross-check against routers/openalgo.py:207 `calculate_indian_fno_charges`.

Three defects in the salvaged source are fixed here:
  (a) NO DATE PARAMETER  -> the Oct-2024 STT regime was never modelled (blueprint R-21).
  (b) FUTURES STAMP DUTY used the options rate (0.003% instead of 0.002%).
  (c) NO LOT MULTIPLIER  -> NIFTY/BANKNIFTY payoffs were off by 15-50x (blueprint R-15).

Convention: all percentage rates are FRACTIONS of notional (0.000625 == 6.25 bps).
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass

# ── Salvaged verbatim from algo-engine/backtester/cost_model.py:7-24 ────────────
BROKERAGE_PCT = 0.0003              # 0.03% capped at Rs 20 per ORDER
MAX_BROKERAGE_PER_ORDER = 20.0      # Rs 20 max fee per executed order leg

STT_EQUITY_BUY = 0.0                # pre-Oct-2024: 0% on equity delivery buy
STT_EQUITY_SELL_INTRADAY = 0.00025  # 0.025% on intraday equity SELL

# Pre-Oct-2024 F&O STT rates
STT_FNO_FUTURES_SELL_PRE_2024 = 0.000125     # 0.0125% on futures sell
STT_FNO_OPTIONS_SELL_PRE_2024 = 0.000625     # 0.0625% on options PREMIUM sell

# Post-Oct-2024 (Union Budget 2024 / Finance Act 2024, effective Oct 1, 2024)
STT_FNO_FUTURES_SELL_POST_2024 = 0.00020     # 0.02% on futures sell (+60% hike)
STT_FNO_OPTIONS_SELL_POST_2024 = 0.0010      # 0.10% on options PREMIUM sell (+60% hike)

# Legacy alias constants (preserved for backward compatibility)
STT_FNO_FUTURES_SELL = STT_FNO_FUTURES_SELL_PRE_2024
STT_FNO_OPTIONS_SELL = STT_FNO_OPTIONS_SELL_PRE_2024

EXCHANGE_TXN_EQ = 0.0000345         # NSE equity turnover 0.00345%
# Pre-Oct-2024 Exchange txn rates
EXCHANGE_TXN_FNO_FUT_PRE_2024 = 0.00002      # NSE futures turnover 0.002%
EXCHANGE_TXN_FNO_OPT_PRE_2024 = 0.00053      # NSE options premium turnover 0.053%

# Post-Oct-2024 SEBI True-to-Label Uniform Exchange Txn Rates (effective Oct 1, 2024)
EXCHANGE_TXN_FNO_FUT_POST_2024 = 0.0000173   # NSE futures turnover 0.00173%
EXCHANGE_TXN_FNO_OPT_POST_2024 = 0.0003503   # NSE options premium turnover 0.03503%

EXCHANGE_TXN_FNO_FUT = EXCHANGE_TXN_FNO_FUT_PRE_2024
EXCHANGE_TXN_FNO_OPT = EXCHANGE_TXN_FNO_OPT_PRE_2024

GST_RATE = 0.18                     # 18% GST on (brokerage + exchange txn + SEBI)
SEBI_TURNOVER_FEE = 0.000001        # Rs 10 per crore

STAMP_DUTY_BUY_EQ = 0.00015         # 0.015% on buy equity
STAMP_DUTY_BUY_OPT = 0.00003        # 0.003% on buy options premium
STAMP_DUTY_BUY_FUT = 0.00002        # 0.002% on buy futures  (FIX: cost_model.py wrongly used OPT)

DEFAULT_SLIPPAGE_PCT = 0.0005       # 0.05% legacy default; see DEFAULT_SLIPPAGE_BPS

# 2 bps is the calibrated default. The repository's own measured Indian intraday
# round-trip cost is ~0.10-0.15% of notional (docs/algo/edge_analysis_report.md:14).
DEFAULT_SLIPPAGE_BPS = 2.0

# ── FIX (a): the Finance (No.2) Act 2024 regime, effective 2024-10-01 ──────────
# Delivery STT, F&O STT, and True-to-Label exchange transaction rates cutover
STT_REGIME_CUTOVER = _dt.date(2024, 10, 1)
_STT_DELIVERY_PRE_2024 = {"buy": STT_EQUITY_BUY, "sell": 0.001}
_STT_DELIVERY_POST_2024 = {"buy": 0.001, "sell": 0.001}

ASSET_EQ = "EQ"
ASSET_FUT = "FUT"
ASSET_OPT = "OPT"

_VALID_ASSETS = (ASSET_EQ, ASSET_FUT, ASSET_OPT)


class CostModelError(ValueError):
    """Raised when a cost model is constructed with an unusable configuration."""


def stt_delivery_table(trade_date: _dt.date) -> dict[str, float]:
    """Return the {'buy': rate, 'sell': rate} STT table in force on `trade_date`."""
    return _STT_DELIVERY_POST_2024 if trade_date >= STT_REGIME_CUTOVER else _STT_DELIVERY_PRE_2024


@dataclass(frozen=True)
class CostBreakdown:
    """Immutable per-trade cost decomposition. Every rupee is attributable."""
    brokerage: float
    stt: float
    exchange: float
    sebi: float
    stamp_duty: float
    gst: float
    slippage: float

    @property
    def total(self) -> float:
        return (self.brokerage + self.stt + self.exchange + self.sebi
                + self.stamp_duty + self.gst + self.slippage)

    def as_dict(self) -> dict[str, float]:
        return {
            "brokerage": self.brokerage,
            "stt": self.stt,
            "exchange": self.exchange,
            "sebi": self.sebi,
            "stamp_duty": self.stamp_duty,
            "gst": self.gst,
            "slippage": self.slippage,
            "total": self.total,
        }


@dataclass(frozen=True)
class CostModel:
    """THE cost model.

    asset_class : ASSET_EQ | ASSET_FUT | ASSET_OPT
    delivery    : equity only. True  -> delivery STT regime applies (date-aware).
                        False -> intraday equity STT (0.025% sell only, both regimes).
    lot_size    : multiplies quantity. MANDATORY for F&O; 1 for cash equity.
    slippage_bps: per-side execution drag. A real stop-market fills THROUGH the
                  price, so this is a cost, not a cosmetic adjustment.
    """

    asset_class: str = ASSET_EQ
    delivery: bool = False
    lot_size: int = 1
    slippage_bps: float = DEFAULT_SLIPPAGE_BPS

    def __post_init__(self) -> None:
        if self.asset_class not in _VALID_ASSETS:
            raise CostModelError(
                f"asset_class must be one of {_VALID_ASSETS}, got {self.asset_class!r}"
            )
        if self.lot_size < 1:
            raise CostModelError(f"lot_size must be >= 1, got {self.lot_size}")
        if self.slippage_bps < 0:
            raise CostModelError(f"slippage_bps must be >= 0, got {self.slippage_bps}")

    def exchange_rate_for_date(self, trade_date: _dt.date) -> float:
        if trade_date >= STT_REGIME_CUTOVER:
            return {ASSET_EQ: EXCHANGE_TXN_EQ,
                    ASSET_FUT: EXCHANGE_TXN_FNO_FUT_POST_2024,
                    ASSET_OPT: EXCHANGE_TXN_FNO_OPT_POST_2024}[self.asset_class]
        return {ASSET_EQ: EXCHANGE_TXN_EQ,
                ASSET_FUT: EXCHANGE_TXN_FNO_FUT_PRE_2024,
                ASSET_OPT: EXCHANGE_TXN_FNO_OPT_PRE_2024}[self.asset_class]

    # ── component-level accessors, exposed for tests and for cost_drag reporting ──
    @property
    def _exchange_rate(self) -> float:
        return {ASSET_EQ: EXCHANGE_TXN_EQ,
                ASSET_FUT: EXCHANGE_TXN_FNO_FUT,
                ASSET_OPT: EXCHANGE_TXN_FNO_OPT}[self.asset_class]

    @property
    def _stamp_rate(self) -> float:
        return {ASSET_EQ: STAMP_DUTY_BUY_EQ,
                ASSET_FUT: STAMP_DUTY_BUY_FUT,
                ASSET_OPT: STAMP_DUTY_BUY_OPT}[self.asset_class]

    def _stt(self, buy_value: float, sell_value: float, trade_date: _dt.date) -> float:
        if self.asset_class == ASSET_OPT:
            # Options STT is charged on SELL PREMIUM only.
            rate = STT_FNO_OPTIONS_SELL_POST_2024 if trade_date >= STT_REGIME_CUTOVER else STT_FNO_OPTIONS_SELL_PRE_2024
            return sell_value * rate
        if self.asset_class == ASSET_FUT:
            rate = STT_FNO_FUTURES_SELL_POST_2024 if trade_date >= STT_REGIME_CUTOVER else STT_FNO_FUTURES_SELL_PRE_2024
            return sell_value * rate
        if self.delivery:
            tbl = stt_delivery_table(trade_date)
            return buy_value * tbl["buy"] + sell_value * tbl["sell"]
        # Intraday equity: SELL side only, unchanged across both regimes.
        return sell_value * STT_EQUITY_SELL_INTRADAY

    def round_trip(self, entry: float, exit: float, qty: int,
                   trade_date: _dt.date | None = None) -> float:
        """Total round-trip cost in rupees. Convenience wrapper over round_trip_breakdown."""
        return self.round_trip_breakdown(entry, exit, qty, trade_date).total

    def round_trip_breakdown(self, entry: float, exit: float, qty: int,
                             trade_date: _dt.date | None = None) -> CostBreakdown:
        """Full, attributable round-trip cost decomposition in rupees."""
        if entry <= 0 or exit <= 0:
            raise CostModelError(f"prices must be positive, got entry={entry}, exit={exit}")
        if qty < 1:
            raise CostModelError(f"qty must be >= 1, got {qty}")
        d = trade_date or _dt.date.today()
        if not isinstance(d, _dt.date):
            raise CostModelError(f"trade_date must be a date, got {type(d).__name__}")

        units = qty * self.lot_size                       # FIX (c): the lot multiplier
        buy_value = entry * units
        sell_value = exit * units
        turnover = buy_value + sell_value

        # Brokerage: 0.03% capped at Rs 20, charged PER ORDER (i.e. per leg).
        brokerage = 2.0 * min(MAX_BROKERAGE_PER_ORDER, turnover / 2.0 * BROKERAGE_PCT)

        stt = self._stt(buy_value, sell_value, d)
        exchange = turnover * self.exchange_rate_for_date(d)
        sebi = turnover * SEBI_TURNOVER_FEE
        stamp = buy_value * self._stamp_rate              # BUY side only
        # FIX: SEBI IS inside the GST base (run_backtest.py:93 had it right; cost_model.py:74 did not).
        gst = GST_RATE * (brokerage + exchange + sebi)
        slippage = turnover * (self.slippage_bps / 10_000.0)

        return CostBreakdown(brokerage=brokerage, stt=stt, exchange=exchange, sebi=sebi,
                             stamp_duty=stamp, gst=gst, slippage=slippage)

    def round_trip_pct(self, entry: float, exit: float, qty: int,
                       trade_date: _dt.date | None = None) -> float:
        """Round-trip cost as a FRACTION OF SINGLE-SIDE NOTIONAL (entry * qty * lot_size).

        This is the convention used by the repository's own research: the 75,815-bar
        scan measured MFE/MAE as a percentage of price (0.942% / 0.938%) and the
        round-trip cost as ~0.10-0.15% (docs/algo/edge_analysis_report.md:14, 25, 26).
        Using turnover as the denominator would report half the true figure and
        would silently make every cost-sensitive strategy look twice as viable.
        """
        if entry <= 0:
            raise CostModelError(f"entry must be positive, got {entry}")
        notional = entry * qty * self.lot_size
        return self.round_trip(entry, exit, qty, trade_date) / notional

    def min_viable_target_pct(self, notional: float, max_cost_drag: float = 0.20) -> float:
        """Smallest target excursion (fraction of notional) that keeps cost drag <= max_cost_drag.

        Derivation of blueprint Section 4.2 (the cost/gross law):
            cost_drag = round_trip_cost / (target_pct * notional) <= max_cost_drag
            =>  target_pct >= round_trip_cost / (max_cost_drag * notional)

        This is the constraint that makes intraday cash equity structurally
        impossible at high concurrency: at Rs 10,000 notional the minimum viable
        target is ~2.0%, against a measured unconditional MFE of 0.94%.
        """
        if notional <= 0:
            raise CostModelError(f"notional must be positive, got {notional}")
        if max_cost_drag <= 0:
            raise CostModelError(f"max_cost_drag must be > 0, got {max_cost_drag}")
        flat = notional * self.slippage_bps / 10_000.0 * 2.0
        return (flat / notional + 2.0 * MAX_BROKERAGE_PER_ORDER / notional
                + 0.00033) / max_cost_drag
