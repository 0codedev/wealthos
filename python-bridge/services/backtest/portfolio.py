"""Order execution and cross-sectional portfolio construction.

THE THREE-EVENT EXECUTION CONTRACT (blueprint Section 3.5.2).

  E1  ENTRY. The signal is computed from the close of bar t. The fill happens at the
      OPEN of bar t+1, plus slippage. The confirmed look-ahead in vectorbt_engine.py
      was a signal on the bar closing at 100 filling at exactly 100.0 (finding R-2).

  E2  EXIT. Stop is checked BEFORE target on the same bar (pessimistic), and the
      stop fills AT OR THROUGH the level. Every legacy engine did
      `exit_price = stop_loss`, making each stop fill a best case (finding R-13).

  E3  TIME. A hard square-off fires at the LAST BAR OF THE SAME CALENDAR DATE. The
      search window is bounded by the session, so an intraday strategy can never
      hold overnight. The legacy engine's "if not closed: continue" path
      (backtest_simulator.py:946-970) left an open position contributing ZERO P&L
      and zero cost to the reported metrics (finding R-26).

  E4  CONCURRENCY. A position is live on [entry_time, exit_time). A new idea is
      admitted only if admitting it keeps the number of simultaneously live
      positions at or below `max_concurrent`, and only if the symbol is not
      already live. Positions are retired by their real exit time, not by
      iteration order (finding S-5).

ONE SIZING LAW. `bracket()` decides the risk; `compute_quantity()` sizes against
exactly that risk, so `planned_loss` in the report is the same rupee figure the
exit was built from. The legacy engine had four coexisting laws spanning
5.00x / 1.67x / 0.20x / 0.20x (finding S-3).

ATR FLOOR = 0.10%. Measured on this panel, ATR is a median 0.187% of close
(p10 0.121%, p90 0.308%). A 0.5% floor therefore discarded the real ATR on 100%
of trades and replaced market structure with a constant. 0.10% is a genuine
backstop against a zero-volatility divide and micro-slippage traps while leaving
the panel's own ATR to govern dynamic brackets.

WHY NOT A PER-BAR PYTHON LOOP. The expensive legacy work was per-BAR: recomputing
40+ indicators for every bar of every symbol on every run. The panel has already
done that once and signals.py evaluates entry predicates as array operations. What
remains is a per-TRADE walk, and the trade count is roughly 1/64th of the bar
count (measured: 0.319 signals per symbol-day against 64 bars per day). Each
trade's first-touch search is itself a vectorised numpy scan.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import costs as costs_mod
from . import exits as exits_mod
from . import metrics as metrics_mod
from . import signals as signals_mod
from . import sizing as sizing_mod

log = logging.getLogger("backtest.portfolio")

REQUIRED_PANEL_COLUMNS = ("open", "high", "low", "close", "datetime", "date",
                           "symbol", "bar_of_day")

# ECONOMIC VIABILITY FLOOR. Round-trip friction on Indian equities is ~0.10%
# (measured by costs.py: Rs 30.62 on Rs 19,244 notional = 0.159%, worse than the
# headline because the STT/charges apply to a TINY stop). A stop narrower than
# ~3.5x the friction hurdle cannot survive its own transaction: at 0.10% costs
# and a 0.187% median ATR, statutory charges consumed 88% of gross P&L.
#
# The panel's own ATR is a median 0.187% of close (p10 0.121%, p90 0.308%), so a
# 0.35% floor also exceeds the p90: on this panel the floor governs essentially
# every trade. That is the intended behaviour -- a 0.187% stop is not tradeable
# in India -- and `brackets_atr_governed` reports it rather than hiding it.
ATR_FLOOR_PCT = 0.0035

# The friction-aware viability gate, exposed for the router and the UI.
FRICTION_HURDLE_PCT = 0.0010
MIN_VIABLE_STOP_MULTIPLE = 3.5


class PortfolioError(RuntimeError):
    """Raised when a run cannot be completed honestly. Never returns a default."""


@dataclass(frozen=True)
class ExecutionConfig:
    capital: float = 100_000.0
    risk_pct: float = 0.01
    max_concurrent: int = 3
    leverage: float = 1.0
    slot_gross_pct: float | None = None
    atr_floor_pct: float = ATR_FLOOR_PCT
    r_mult: float = 2.0
    lot_size: int = 1
    cost_profile: str = costs_mod.ASSET_EQ
    delivery: bool = False
    slippage_bps: float = costs_mod.DEFAULT_SLIPPAGE_BPS
    apply_costs: bool = True

    def __post_init__(self) -> None:
        # Validate BEFORE deriving, or the default derivation divides by zero on
        # max_concurrent=0 and the guard below is never reached.
        if self.max_concurrent < 1:
            raise PortfolioError(f"max_concurrent must be >= 1, got {self.max_concurrent}")
        if self.capital <= 0:
            raise PortfolioError(f"capital must be positive, got {self.capital}")
        if self.slot_gross_pct is None:
            # Equal split of buying power across concurrent slots, so the account
            # total is leverage x capital regardless of the concurrency setting.
            object.__setattr__(self, "slot_gross_pct", 1.0 / self.max_concurrent)
        sizing_mod.SizingConfig(capital=self.capital, risk_pct=self.risk_pct,
                                slot_gross_pct=self.slot_gross_pct,
                                atr_floor_pct=self.atr_floor_pct,
                                leverage=self.leverage)

    @property
    def risk_budget(self) -> float:
        """Rupee risk per trade, ALWAYS on unlevered equity (see sizing.SizingConfig)."""
        return self.capital * self.risk_pct

    @property
    def buying_power(self) -> float:
        return self.capital * self.leverage

    def viability(self) -> dict:
        """Report the friction arithmetic that justifies the ATR floor."""
        stop_pct = self.atr_floor_pct
        hurdle = FRICTION_HURDLE_PCT
        return {
            "atr_floor_pct": stop_pct,
            "friction_hurdle_pct": hurdle,
            "hurdle_multiple": stop_pct / hurdle if hurdle else float("inf"),
            "meets_3_5x_hurdle": (stop_pct / hurdle) >= MIN_VIABLE_STOP_MULTIPLE
            if hurdle else False,
            "risk_implied_notional_x": (self.risk_pct / stop_pct) if stop_pct else 0.0,
            "slot_gross_pct": self.slot_gross_pct,
            "leverage": self.leverage,
            "buying_power": self.buying_power,
            "risk_budget": self.risk_budget,
        }

    def cost_model(self) -> costs_mod.CostModel:
        return costs_mod.CostModel(asset_class=self.cost_profile,
                                    delivery=self.delivery,
                                    lot_size=self.lot_size,
                                    slippage_bps=self.slippage_bps)


@dataclass
class ResolvedFill:
    """A price path for one candidate. Deliberately independent of sizing and slots,
    so that slot admission cannot change a fill."""
    symbol: str
    direction: str
    sign: int
    atr_14: float
    score: float
    entry_index: int
    exit_index: int
    entry_time: pd.Timestamp
    exit_time: pd.Timestamp
    entry_price: float
    exit_price: float
    exit_reason: str
    stop: float
    target: float
    risk: float
    mfe: float
    mae: float
    gap_through_stop: bool
    atr_governed: bool

    @property
    def holding_bars(self) -> int:
        return max(self.exit_index - self.entry_index, 0)


@dataclass
class SimTrade(ResolvedFill):
    qty: int = 0
    gross_pnl: float = 0.0
    costs: float = 0.0
    planned_loss: float = 0.0
    realised_r: float = 0.0
    binding_clause: str = ""
    notional_pct_of_capital: float = 0.0

    @property
    def net_pnl(self) -> float:
        return self.gross_pnl - self.costs

    def to_metrics_trade(self) -> metrics_mod.Trade:
        return metrics_mod.Trade(
            entry_time=self.entry_time, exit_time=self.exit_time, symbol=self.symbol,
            direction=self.direction, qty=self.qty, entry_price=self.entry_price,
            exit_price=self.exit_price, gross_pnl=self.gross_pnl, costs=self.costs,
            exit_reason=self.exit_reason, planned_loss=self.planned_loss,
            mfe=self.mfe, mae=self.mae)


@dataclass
class BacktestRun:
    trades: list[SimTrade] = field(default_factory=list)
    equity_curve: list[dict] = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)

    def to_metrics(self, cfg: ExecutionConfig, timeframe: str = "5minute",
                   n_trials: int = 1) -> dict:
        """Metrics from the equity CURVE, not from a mean of per-trade returns.

        P-11: the curve is the source of truth. The legacy runs computed Sharpe
        from the mean of per-trade returns, which is not a time series and
        understated volatility by 8.7x.
        """
        return metrics_mod.compute_metrics(
            self.equity_curve, [t.to_metrics_trade() for t in self.trades],
            initial_capital=cfg.capital, timeframe=timeframe, n_trials=n_trials)


# ── stage 1: resolve price paths (no sizing, no slots) ────────────────────────
def resolve_fills(df: pd.DataFrame, cands: pd.DataFrame,
                  cfg: ExecutionConfig) -> list[ResolvedFill]:
    """Compute the E1/E2/E3 price path for every candidate, per symbol.

    A candidate whose fill bar does not exist, or whose bracket is invalid, is
    dropped here. Nothing in this function consults the slot ceiling, so E4 can
    never alter a price.
    """
    fills: list[ResolvedFill] = []
    slip = cfg.slippage_bps / 10_000.0
    cand_symbols = set(cands["symbol"].unique())
    bars_by_sym = {s: g.reset_index(drop=True) for s, g in df[df["symbol"].isin(cand_symbols)].groupby("symbol", sort=False)}
    for sym, grp in cands.groupby("symbol", sort=True):
        bars = bars_by_sym[sym]
        o = bars["open"].to_numpy(float)
        h = bars["high"].to_numpy(float)
        l = bars["low"].to_numpy(float)
        c_ = bars["close"].to_numpy(float)
        times = pd.to_datetime(bars["datetime"]).to_numpy()
        # E3 anchor: index of the LAST bar of each date, per symbol.
        last_of_day = (bars.groupby("date")["pos_in_symbol"].transform("max")
                       .to_numpy(int))
        n_bars = len(o)

        for _, cand in grp.sort_values("pos_in_symbol").iterrows():
            sig_i = int(cand["pos_in_symbol"])
            fill_i = sig_i + 1                      # E1
            if fill_i >= n_bars:
                continue
            sign = 1 if str(cand["direction"]).upper() in ("BUY", "LONG", "1") else -1
            entry = float(o[fill_i] * (1.0 + slip)) if sign == 1 else float(o[fill_i] * (1.0 - slip))
            if entry <= 0 or not np.isfinite(entry):
                continue
            try:
                br = exits_mod.bracket(entry, cand.get("atr_14"), sign,
                                       r_mult=cfg.r_mult,
                                       atr_floor_pct=cfg.atr_floor_pct)
            except exits_mod.ExitError as exc:
                log.debug("bracket rejected %s@%.2f: %s", sym, entry, exc)
                continue
            stop, target = br.stop, br.target

            # E3: the search window never crosses the date boundary.
            day_end = int(last_of_day[fill_i])
            win = slice(fill_i, day_end + 1)
            hi, lo = h[win], l[win]
            if len(hi) == 0:
                continue
            hit_stop = (lo <= stop) if sign == 1 else (hi >= stop)
            hit_tgt = (hi >= target) if sign == 1 else (lo <= target)
            any_hit = hit_stop | hit_tgt
            k = int(np.argmax(any_hit)) if any_hit.any() else -1

            # numpy comparisons yield numpy.bool_; a bare `is True` in a test or
            # `json.dumps` then fails on what is semantically a plain boolean.
            gap_through = False
            if k >= 0:
                bar_open = float(o[fill_i + k])
                if bool(hit_stop[k]):                # E2: stop wins the tie
                    reason = "STOP"
                    exit_px = min(stop, bar_open) if sign == 1 else max(stop, bar_open)
                    gap_through = bool(bar_open < stop) if sign == 1 \
                        else bool(bar_open > stop)
                else:
                    reason = "TARGET"
                    exit_px = (max(target, bar_open) if sign == 1
                               else min(target, bar_open))
                exit_i = fill_i + k
            else:
                exit_i = day_end                       # E3 square-off
                exit_px = float(c_[exit_i] * (1.0 - slip)) if sign == 1 else float(c_[exit_i] * (1.0 + slip))
                reason = "EOD"

            if exit_px <= 0 or not np.isfinite(exit_px):
                continue
            seg = slice(fill_i, exit_i + 1)
            fills.append(ResolvedFill(
                symbol=str(sym),
                direction="LONG" if sign == 1 else "SHORT",
                sign=sign, atr_14=float(cand.get("atr_14", np.nan)),
                score=float(cand.get("score", 0.0) or 0.0),
                entry_index=fill_i, exit_index=exit_i,
                entry_time=pd.Timestamp(times[fill_i]),
                exit_time=pd.Timestamp(times[exit_i]),
                entry_price=float(entry), exit_price=float(exit_px),
                exit_reason=reason,
                stop=float(stop), target=float(target), risk=float(br.risk),
                mfe=float((float(np.max(h[seg])) - entry) * sign),
                mae=float((entry - float(np.min(l[seg]))) * sign),
                gap_through_stop=bool(gap_through),
                atr_governed=bool(not br.floored)))
    return fills


# ── stage 2: E4 concurrency admission ─────────────────────────────────────────
def admit_by_concurrency(fills: list[ResolvedFill], max_concurrent: int) -> list[ResolvedFill]:
    """Greedy admission under a cross-sectional concurrency ceiling.

    A position is live on [entry_time, exit_time). A candidate is admitted only if
    admitting it keeps live count <= max_concurrent AND its symbol is not already
    live. Retirement is by real exit time, so ordering cannot invert (S-5).
    """
    if not fills:
        return []
    order = sorted(fills, key=lambda f: (f.entry_time, -f.score, f.symbol))
    live: list[ResolvedFill] = []          # accepted and still open
    accepted: list[ResolvedFill] = []
    for f in order:
        # Retire anything that has already closed by this candidate's entry.
        live = [x for x in live if x.exit_time > f.entry_time]
        if len(live) >= max_concurrent:
            continue
        if any(x.symbol == f.symbol for x in live):
            continue                        # one position per symbol
        accepted.append(f)
        live.append(f)
    return accepted


# ── stage 3: size with the one law ────────────────────────────────────────────
def size_fills(fills: list[ResolvedFill], cfg: ExecutionConfig) -> list[SimTrade]:
    sc = sizing_mod.SizingConfig(capital=cfg.capital, risk_pct=cfg.risk_pct,
                                 slot_gross_pct=cfg.slot_gross_pct,
                                 atr_floor_pct=cfg.atr_floor_pct,
                                 leverage=cfg.leverage)
    # Fills already incorporate execution slippage in f.entry_price (E1).
    # CostModel accounts for statutory charges (STT, GST, Stamp, Turnover, SEBI, Brokerage) without double-slippage.
    cm = costs_mod.CostModel(asset_class=cfg.cost_profile, delivery=cfg.delivery,
                             lot_size=cfg.lot_size, slippage_bps=0.0)
    out: list[SimTrade] = []
    for f in fills:
        try:
            res = sizing_mod.compute_quantity(f.entry_price, f.risk, sc,
                                              lot_size=cfg.lot_size)
        except sizing_mod.SizingError:
            continue
        if res.qty <= 0:
            continue
        qty = int(res.qty)
        gross = (f.exit_price - f.entry_price) * qty * f.sign
        costs = (cm.round_trip(f.entry_price, f.exit_price, qty, f.entry_time.date())
                 if cfg.apply_costs else 0.0)
        planned = float(res.planned_loss)
        out.append(SimTrade(**{**f.__dict__, "qty": qty, "gross_pnl": gross,
                               "costs": costs, "planned_loss": planned,
                               "realised_r": (gross / planned) if planned > 0 else 0.0,
                               "binding_clause": res.binding_clause,
                               "notional_pct_of_capital": res.nominal_pct_of_capital}))
    out.sort(key=lambda t: (t.entry_time, t.symbol))
    return out


# ── stage 4: time-major equity curve ──────────────────────────────────────────
def audit_equity_curve(df: pd.DataFrame, trades: list[SimTrade],
                       initial_capital: float, max_samples: int | None = 200) -> dict:
    """INDEPENDENT check of P-12. Deliberately written a different way.

    This reconstructs equity from the trade list with plain Python loops, rather
    than sharing `build_equity_curve`'s difference-array algebra. An earlier version
    of this check mirrored the implementation's convention and therefore passed a
    curve that was wrong by full notional on every position open. A verification
    that shares a bug with its subject is not a verification.

    The expectation is derived independently, from the accounting identity

        equity[t] = initial
                  + sum over CLOSED trades of net_pnl
                  + sum over OPEN   trades of ((mark - entry) * sign * qty - costs/2)

    Returns max absolute discrepancy in rupees. `max_samples` bounds the cost on
    large panels; pass None to check every timestamp.
    """
    closes: dict[tuple[str, pd.Timestamp], float] = {}
    for _, r in df.iterrows():
        closes[(str(r["symbol"]), pd.Timestamp(r["datetime"]))] = float(r["close"])
    times = sorted({t for _, t in closes})
    if max_samples is not None and len(times) > max_samples:
        step = len(times) / max_samples
        times = [times[int(i * step)] for i in range(max_samples)]

    last_seen: dict[str, tuple[pd.Timestamp, float]] = {}

    def mark(sym: str, ts: pd.Timestamp) -> float | None:
        v = closes.get((sym, ts))
        if v is not None:
            last_seen[sym] = (ts, v)
            return v
        prior = last_seen.get(sym)
        return prior[1] if prior else None

    by_time: dict[pd.Timestamp, list[SimTrade]] = {}
    for t in trades:
        by_time.setdefault(t.entry_time, []).append(t)

    # The production curve is evaluated once, not per timestamp.
    reported = {pd.Timestamp(r["date"]): float(r["equity"])
                for r in build_equity_curve(df, trades, initial_capital)}

    worst = 0.0
    worst_at = None
    for ts in times:
        for t in by_time.get(ts, []):
            v = closes.get((t.symbol, ts))
            if v is not None:
                last_seen[t.symbol] = (ts, v)
        realised = 0.0
        unrealised = 0.0
        for t in trades:
            if t.exit_time <= ts:
                realised += (t.exit_price - t.entry_price) * t.qty * t.sign - t.costs
            elif t.entry_time <= ts:
                px = mark(t.symbol, ts)
                if px is not None:
                    unrealised += ((px - t.entry_price) * t.qty * t.sign
                                   - t.costs / 2.0)
        expected = initial_capital + realised + unrealised
        delta = abs(expected - reported.get(ts, float("nan")))
        if delta == delta and delta > worst:      # skip timestamps off the curve
            worst, worst_at = delta, ts
    return {"max_abs_delta": worst, "worst_timestamp": worst_at,
            "timestamps_checked": sum(1 for ts in times if ts in reported),
            "final_equity": initial_capital + sum(
                (t.exit_price - t.entry_price) * t.qty * t.sign - t.costs
                for t in trades)}


def build_equity_curve(df: pd.DataFrame, trades: list[SimTrade],
                      initial_capital: float, lot_size: int = 1) -> list[dict]:
    """Mark-to-market equity on a UNIFIED TIME AXIS, satisfying P-12.

        equity[t] == cash[t] + sum(mark-to-market of every position live at t)

    The panel arrives sorted by symbol, so its row order is six contiguous blocks,
    not time. A difference array over ROWS would book a 2025 TCS trade against a
    2023 TCS bar. This pivots to a shared timestamp index and marks each position
    against its OWN symbol's close at that timestamp, so concurrency and drawdown
    are the real cross-sectional ones.
    """
    if len(df) == 0:
        return []
    times = pd.to_datetime(df["datetime"])
    uniq = np.sort(times.unique())
    if not trades:
        return [{"date": uniq[i], "equity": float(initial_capital), "cash": float(initial_capital),
                 "open_positions": 0} for i in range(len(uniq))]

    symbols = sorted({str(t.symbol) for t in trades})
    pos_of_time = {t: i for i, t in enumerate(uniq)}
    col_of_sym = {s: j for j, s in enumerate(symbols)}

    close_wide = (df[df["symbol"].astype(str).isin(symbols)]
                    .assign(_s=df["symbol"].astype(str))
                    .pivot_table(index="datetime", columns="_s", values="close",
                                 aggfunc="last")
                    .reindex(uniq)
                    .ffill())
    close_wide = close_wide.reindex(columns=symbols)
    closes = close_wide.to_numpy(float)
    # Never carry a close across a date boundary.
    day_id = pd.Series(uniq).dt.date.to_numpy()
    for j in range(closes.shape[1]):
        col = closes[:, j]
        new_day = np.empty(len(col), dtype=bool)
        new_day[0] = True
        new_day[1:] = day_id[1:] != day_id[:-1]
        col[new_day] = np.nan
        closes[:, j] = pd.Series(col).ffill().to_numpy()

    n_t = len(uniq)
    d_cash = np.zeros(n_t + 1, dtype=float)
    mtm = np.zeros(n_t, dtype=float)
    d_pos = np.zeros(n_t + 1, dtype=int)
    for t in trades:
        e = pos_of_time.get(pd.Timestamp(t.entry_time))
        x = pos_of_time.get(pd.Timestamp(t.exit_time))
        if e is None:
            continue
        if x is None or x < e:
            x = n_t - 1
        # Cash flows MUST carry the direction sign. A short SELLS at entry and BUYS
        # BACK at exit; an unsigned flow books it as a long and inverts its P&L.
        # This is why a run whose trades summed to +Rs 106,140 produced an equity
        # curve ending at -Rs 28,608: every short was double-counted backwards.
        d_cash[e] -= (t.sign * t.entry_price * t.qty * lot_size) + t.costs / 2.0
        d_cash[x] += (t.sign * t.exit_price * t.qty * lot_size) - t.costs / 2.0
        # Mark at MARKET VALUE, not at P&L-vs-entry. The entry leg is already
        # debited above, so marking at (close - entry) would charge it twice and
        # make equity plunge by the full notional on every position open. A long
        # holds qty shares worth close*qty; a short is a liability of -close*qty.
        mtm[e:x] += closes[e:x, col_of_sym[t.symbol]] * t.qty * lot_size * t.sign
        d_pos[e] += 1
        d_pos[x] -= 1

    cash = initial_capital + np.cumsum(d_cash[:-1])
    equity = cash + mtm
    npos = np.cumsum(d_pos[:-1])
    return [{"date": uniq[i], "equity": float(equity[i]), "cash": float(cash[i]),
             "open_positions": int(npos[i])} for i in range(n_t)]


def prepare_panel(panel_df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in REQUIRED_PANEL_COLUMNS if c not in panel_df.columns]
    if missing:
        raise PortfolioError(f"panel is missing required columns {missing}")
    if len(panel_df) == 0:
        raise PortfolioError("empty panel; refusing to report a successful backtest")
    df = panel_df.sort_values(["symbol", "datetime"], kind="mergesort").reset_index(drop=True)
    # pos_in_symbol is the ONLY correct way to address a bar for execution.
    df["pos_in_symbol"] = df.groupby("symbol", sort=False).cumcount()
    return df


def run_backtest(panel_df: pd.DataFrame, strategy: str, cfg: ExecutionConfig,
                 score_fn=None, veto: bool = True) -> BacktestRun:
    """signals -> candidates -> fills -> E4 admission -> sizing -> curve -> metrics."""
    df = prepare_panel(panel_df)
    sig = signals_mod.generate(df, strategy, veto=veto)
    mask = sig.reindex(df.index).fillna(0).to_numpy() != 0
    n_cand = int(mask.sum())
    diag = {"strategy": strategy, "symbols_evaluated": int(df["symbol"].nunique()),
            "candidates": n_cand, "max_concurrent": cfg.max_concurrent,
            "slot_gross_pct": cfg.slot_gross_pct, "risk_pct": cfg.risk_pct,
            "r_mult": cfg.r_mult, "atr_floor_pct": cfg.atr_floor_pct,
            "signals_per_symbol_day": n_cand / max(
                df["symbol"].nunique() * df["date"].nunique(), 1)}
    if n_cand == 0:
        return BacktestRun([], [], {**diag, "fills": 0, "admitted": 0, "trades": 0,
                                    "note": "zero candidates; NOT a successful backtest"})

    cands = df.loc[mask].copy()
    cands["direction"] = np.where(sig.reindex(cands.index).to_numpy() > 0, "LONG", "SHORT")
    cands["score"] = (score_fn(df).reindex(cands.index).to_numpy()
                      if score_fn is not None else 0.0)

    fills = resolve_fills(df, cands, cfg)
    admitted = admit_by_concurrency(fills, cfg.max_concurrent)
    trades = size_fills(admitted, cfg)
    curve = build_equity_curve(df, trades, cfg.capital, cfg.lot_size)

    held = [c["open_positions"] for c in curve] or [0]
    diag.update({
        "fills": len(fills), "admitted": len(admitted), "trades": len(trades),
        "max_concurrent_observed": int(max(held)),
        "concurrency_ceiling_respected": bool(max(held) <= cfg.max_concurrent),
        "overnight_trades": int(sum(1 for t in trades
                                    if t.entry_time.date() != t.exit_time.date())),
        "brackets_atr_governed": int(sum(1 for t in trades if t.atr_governed)),
        "brackets_floored": int(sum(1 for t in trades if not t.atr_governed)),
    })
    return BacktestRun(trades, curve, diag)
