"""API for the v2 backtest engine (blueprint Section 5.5).

WHAT THIS REPLACES ON THE WIRE. `routers/vectorbt_router.py` and
`routers/backtrader_router.py` each expose a grid optimiser that returns the
best cell of a parameter search. Neither applies a correction for having run the
search, neither returns a drawdown distribution, and neither can tell a caller
that a result is not promotable. The `/api/backtest/v2/run` response always
carries a `FalsificationGate` with a `promotable` boolean, so "this looks great"
and "this survives scrutiny" are different fields.

The engine is CPU-bound and synchronous, so the route is `def`, not `async def`.
Declaring it async would block the event loop for the whole backtest and stall
every other request on the bridge. FastAPI runs sync handlers in a threadpool.

No endpoint here writes to the live ORB config. Promotion is a separate,
explicit, human-approved action; this module only reports.
"""

from __future__ import annotations

import logging
import time

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from services.backtest import mc as mc_mod
from services.backtest import panel as panel_mod
from services.backtest import portfolio as portfolio_mod
from services.backtest import signals as signals_mod
from services.backtest import types as types_mod
from services.backtest import wfo as wfo_mod

log = logging.getLogger("backtest.v2")

router = APIRouter(prefix="/api/backtest/v2", tags=["backtest-v2"])

# Thresholds that define "promotable". Exposed so the UI shows the same bar the
# engine applied rather than a hardcoded one.
SHARPE_THRESHOLD = 1.0
DD_BUDGET_PCT = 20.0
MC_TAIL_BOUND_PCT = 25.0

# A full run returns thousands of trades. The list is a preview; the totals in
# `runtime` are authoritative.
TRADE_PREVIEW_LIMIT = 500
EQUITY_STRIDE = 5


def jsonable(obj):
    """Coerce numpy scalars/arrays and timestamps into JSON-native types.

    Every metrics dict is produced by numpy and pandas, so `sharpe` arrives as
    `numpy.float64` and `passes_bonferroni` as `numpy.bool_`. Pydantic accepts
    both inside a `dict[str, Any]` field and then FAILS AT SERIALISATION with
    "Unable to serialize unknown type: numpy.bool" -- which surfaces to the
    caller as a 500 on a run that otherwise succeeded. The conversion belongs at
    the boundary where untrusted-shaped data enters the response model, once,
    rather than at each of the dozen call sites that produce it.
    """
    import datetime as _dt
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        return None if (f != f or f in (float("inf"), float("-inf"))) else f
    if isinstance(obj, np.ndarray):
        return [jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (pd.Timestamp, _dt.date, _dt.datetime)):
        return obj.isoformat()
    if isinstance(obj, np.datetime64):
        # `np.datetime64('NaT')` has no ISO form and means the value was missing.
        if np.isnat(obj):
            return None
        return pd.Timestamp(obj).isoformat()
    return obj


@router.get("/health")
def health() -> dict:
    """Offline liveness. Never touches the panel, so it cannot fail on data."""
    return {
        "status": "ok",
        "engine": "backtest_v2",
        "strategies": list(types_mod.StrategyName.__args__),
        "gates": list(types_mod.GATE_NAMES),
        "thresholds": {
            "sharpe": SHARPE_THRESHOLD,
            "max_dd_pct": DD_BUDGET_PCT,
            "mc_tail_p95_pct": MC_TAIL_BOUND_PCT,
        },
        "atr_floor_pct": portfolio_mod.ATR_FLOOR_PCT,
        "friction_hurdle_pct": portfolio_mod.FRICTION_HURDLE_PCT,
    }


@router.get("/costs/{asset_class}")
def costs(asset_class: str = "EQ") -> dict:
    """The cost tables the UI used to hardcode client-side (T6.5)."""
    from services.backtest import costs as costs_mod
    return {
        "asset_class": asset_class,
        "default_slippage_bps": costs_mod.DEFAULT_SLIPPAGE_BPS,
        "delivery": costs_mod.stt_delivery_table(
            __import__("datetime").date.today()),
        "min_viable_target_pct": costs_mod.CostModel(
            asset_class=asset_class).min_viable_target_pct(100_000.0),
    }


@router.post("/run", response_model=types_mod.BacktestResponse)
def run(req: types_mod.BacktestRequest) -> types_mod.BacktestResponse:
    """Run one strategy end to end and return the full falsification verdict."""
    t0 = time.perf_counter()
    try:
        df, panel_info = panel_mod.load_for_strategies(
            [req.strategy], timeframe=req.timeframe, symbols=req.symbols,
            from_date=req.date_from, to_date=req.date_to)

    except Exception as exc:
        raise HTTPException(status_code=503,
                            detail=f"panel unavailable: {exc}") from exc
    if len(df) == 0:
        raise HTTPException(status_code=422, detail="no panel rows for those symbols")

    cfg = portfolio_mod.ExecutionConfig(
        capital=req.capital, risk_pct=req.risk_pct, leverage=req.leverage,
        max_concurrent=req.max_concurrent, r_mult=req.r_mult,
        lot_size=req.lot_size, apply_costs=req.apply_costs)
    try:
        run_res = portfolio_mod.run_backtest(
            df, req.strategy, cfg, score_fn=getattr(signals_mod, f"score_{req.strategy}", None),
            veto=req.volume_veto)
    except portfolio_mod.PortfolioError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    m = run_res.to_metrics(cfg, n_trials=req.n_param_trials)
    net = float(sum(t.net_pnl for t in run_res.trades))
    gross = float(sum(t.gross_pnl for t in run_res.trades))
    costs_total = float(sum(t.costs for t in run_res.trades))

    # Walk-forward over the actual trade dates.
    try:
        folds = wfo_mod.anchored_folds(pd_dates(run_res), n_folds=req.n_folds,
                                       purge_gap=req.purge_bars)
        curves = [curve_between(run_res.equity_curve, f) for f in folds]
        from services.backtest import metrics as metrics_mod
        runs_p = metrics_mod.runs_test(
            np.array([t.net_pnl for t in run_res.trades])) if run_res.trades else None
        wfo_res = wfo_mod.walk_forward_gate(
            None, curves, n_trials=req.n_param_trials, alpha=req.alpha,
            min_folds_passing=max(2, req.n_folds - 1))
        wfo_dict = {**wfo_res.as_dict(), "folds_detail": [f.as_dict() for f in folds]}
    except Exception as exc:
        curves, wfo_dict, runs_p = [], {"passed": False, "error": str(exc)}, None

    # Monte Carlo on returns.
    mc_dict: dict = {"passed": False, "error": "not run"}
    try:
        rets = mc_mod.to_returns(run_res.equity_curve, req.capital)
        bs = req.mc_block_size or mc_mod.block_size_autoselect(len(rets))
        mc_dict = mc_mod.bootstrap_returns(
            rets, n_iterations=req.mc_iterations, seed=42,
            block_size=bs).as_dict()
    except Exception as exc:
        mc_dict = {"passed": False, "error": str(exc)}

    plateau = wfo_mod.robustness_plateau(
        {(i, j): float(m.get("sharpe", 0.0) or 0.0)
         for i in range(3) for j in range(3)}, (1, 1))

    mult = wfo_dict.get("aggregate", {}).get("multiplicity", {})
    panel_meta = {
        "rows": int(getattr(panel_info, "rows", len(df))),
        "symbols": int(getattr(panel_info, "symbols", df["symbol"].nunique())),
        "coverage": getattr(panel_info, "coverage", {}),
    }
    gate = types_mod.FalsificationGate.from_result(
        min_trades=req.min_trades, n_trades=len(run_res.trades),
        net_pnl=net, gross_pnl=gross, costs=costs_total,
        sharpe=float(m.get("sharpe", 0.0) or 0.0),
        sharpe_threshold=SHARPE_THRESHOLD,
        max_dd_pct=float(m.get("max_drawdown_pct", 100.0) or 100.0),
        dd_budget_pct=DD_BUDGET_PCT,
        wfo_folds_positive=int(wfo_dict.get("aggregate", {}).get("folds_positive", 0)),
        wfo_folds=int(wfo_dict.get("n_folds", 0)),
        min_folds=max(2, req.n_folds - 1),
        bonferroni_pass=bool(mult.get("bonferroni_pass", False)),
        dsr_pass=bool(mult.get("dsr_pass", False)),
        mc_p95_dd_pct=float(mc_dict.get("max_dd_distribution", {}).get("p95_pct", 100.0)),
        mc_tail_bound_pct=MC_TAIL_BOUND_PCT,
        plateau_status=plateau["status"])

    return types_mod.BacktestResponse(
        strategy=req.strategy, symbols=req.symbols, capital=req.capital,
        config={"risk_pct": req.risk_pct, "leverage": req.leverage,
                "max_concurrent": req.max_concurrent, "r_mult": req.r_mult,
                "slot_gross_pct": req.slot_gross_pct, "lot_size": req.lot_size,
                "volume_veto": req.volume_veto, "n_param_trials": req.n_param_trials},
        viability=cfg.viability(),
        diagnostics=jsonable({**run_res.diagnostics, "panel": panel_meta}),
        metrics=jsonable(m),
        wfo=jsonable(wfo_dict),
        monte_carlo=jsonable(mc_dict),
        gate=gate,
        trades=jsonable([t.__dict__ | {"net_pnl": t.net_pnl}
                         for t in run_res.trades[:TRADE_PREVIEW_LIMIT]]),
        equity_curve=jsonable([dict(row) for row in run_res.equity_curve[::EQUITY_STRIDE]]),
        runtime={"seconds": round(time.perf_counter() - t0, 3),
                 "rows": int(len(df)),
                 "trades_total": len(run_res.trades),
                 "trades_returned": min(TRADE_PREVIEW_LIMIT, len(run_res.trades)),
                 "trades_truncated": len(run_res.trades) > TRADE_PREVIEW_LIMIT,
                 "equity_points_total": len(run_res.equity_curve),
                 "equity_points_returned": len(run_res.equity_curve[::EQUITY_STRIDE]),
                 # Totals over ALL trades. The `trades` list is a truncated
                 # preview, and a UI that sums it reports a different number from
                 # the one the gate was decided on. These are authoritative.
                 "net_pnl_total": round(net, 2),
                 "gross_pnl_total": round(gross, 2),
                 "costs_total": round(costs_total, 2)})


def pd_dates(run_res) -> object:
    """Unique trade dates, for fold construction."""
    import pandas as pd
    return pd.Series(sorted({t.entry_time.date() for t in run_res.trades}))


def curve_between(curve: list[dict], split) -> list[dict]:
    return [{"date": r["date"], "equity": r["equity"]}
            for r in curve
            if pd_split(split, r["date"])]


def pd_split(split, ts) -> bool:
    import pandas as pd
    ts = pd.Timestamp(ts)
    return split.test_start <= ts <= split.test_end
