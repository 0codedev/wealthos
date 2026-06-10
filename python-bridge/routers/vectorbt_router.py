"""
vectorbt_router.py - Enterprise Vectorized Backtesting Engine Router
Prefix: /api/vectorbt
Supports: Multi-Strategy Grid Optimization, 2D Heatmap Matrix, Robustness Plateau Scoring,
Benchmark Comparison (NIFTY 50), and Resilient Vectorized NumPy/VectorBT Engine.
"""
import os
import sys
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np
import pandas as pd

logger = logging.getLogger("vectorbt_router")

router = APIRouter(prefix="/api/vectorbt", tags=["VectorBT - Vectorized Backtesting"])

class BacktestRequest(BaseModel):
    symbol: str = "RELIANCE.NS"
    strategy: str = "ema_cross"  # "ema_cross" | "sma_cross" | "rsi" | "donchian"
    start_date: str = "2023-01-01"
    end_date: str = "2024-01-01"
    fast_ma: int = 10
    slow_ma: int = 30
    rsi_period: int = 14
    rsi_entry: int = 30
    rsi_exit: int = 70
    donchian_upper: int = 20
    donchian_lower: int = 10
    init_cash: float = 500000.0
    fees: float = 0.001

class OptimizeRequest(BaseModel):
    symbol: str = "RELIANCE.NS"
    strategy: str = "ema_cross"  # "ema_cross" | "sma_cross" | "rsi" | "donchian"
    start_date: str = "2023-01-01"
    end_date: str = "2024-01-01"
    fast_range_start: int = 5
    fast_range_end: int = 30
    fast_range_step: int = 5
    slow_range_start: int = 20
    slow_range_end: int = 80
    slow_range_step: int = 10
    init_cash: float = 500000.0
    fees: float = 0.001


def normalize_symbol(symbol: str) -> str:
    """Standardizes asset symbols across Indian equities, indices, and global assets."""
    s = symbol.strip().upper()
    if s.startswith("^") or "-" in s or s.endswith(".NS") or s.endswith(".BO"):
        return s
    us_symbols = {"AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "AMZN", "META", "SPY", "QQQ"}
    if s in us_symbols:
        return s
    return f"{s}.NS"


def load_price_series(symbol: str, start_date: str, end_date: str) -> pd.Series:
    """
    Dual-source loader:
    1. Local Parquet database archive (sub-10ms, offline capable).
    2. Resilient yfinance fallback with automatic symbol normalization.
    """
    # 1. Try local parquet query
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        import parquet_query
        base_sym = symbol.replace(".NS", "").replace(".BO", "").strip().upper()
        candles = parquet_query.query_candles(base_sym, "day", start_date, end_date)
        if candles and len(candles) >= 30:
            df = pd.DataFrame(candles)
            if "date" in df.columns and "close" in df.columns:
                df["date"] = pd.to_datetime(df["date"])
                df = df.set_index("date").sort_index()
                if df.index.tz is not None:
                    df.index = df.index.tz_localize(None)
                logger.info(f"Loaded {len(df)} candles for {symbol} from local Parquet archive")
                return df["close"]
    except Exception as e:
        logger.debug(f"Parquet query skipped for {symbol}: {e}")

    # 2. Resilient yfinance fallback
    import yfinance as yf
    norm_symbol = normalize_symbol(symbol)
    df = yf.download(norm_symbol, start=start_date, end=end_date, auto_adjust=True, progress=False)
    if df is None or df.empty:
        if norm_symbol != symbol:
            df = yf.download(symbol, start=start_date, end=end_date, auto_adjust=True, progress=False)

    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No price data found for symbol: {symbol}")

    close = df["Close"].squeeze()
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    if close.index.tz is not None:
        close.index = close.index.tz_localize(None)
    return close.dropna()


def compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Vectorized RSI calculation."""
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    rs = avg_gain / (avg_loss + 1e-9)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def _simulate_signals(close: pd.Series, entries: pd.Series, exits: pd.Series, init_cash: float, fees: float):
    """
    High-performance signal cleaning and vectorized backtest simulation.
    Applies exrem logic to alternate between buy and sell states.
    """
    # Clean signals: ensure state alternation
    pos = pd.Series(0, index=close.index, dtype=int)
    in_pos = False
    pos_arr = np.zeros(len(close), dtype=int)
    entries_arr = entries.fillna(False).values
    exits_arr = exits.fillna(False).values

    for i in range(len(close)):
        if not in_pos and entries_arr[i]:
            in_pos = True
            pos_arr[i] = 1
        elif in_pos and exits_arr[i]:
            in_pos = False
            pos_arr[i] = 0
        elif in_pos:
            pos_arr[i] = 1

    pos = pd.Series(pos_arr, index=close.index)
    daily_ret = close.pct_change().fillna(0)

    # Execution occurs on next bar open/close
    pos_exec = pos.shift(1).fillna(0)
    trades_mask = (pos_exec != pos_exec.shift(1).fillna(0))
    trade_costs = trades_mask.astype(int) * fees
    strategy_ret = (pos_exec * daily_ret) - trade_costs

    equity_series = init_cash * (1 + strategy_ret).cumprod()

    total_ret = ((equity_series.iloc[-1] / init_cash) - 1) * 100
    ann_ret = total_ret * (252.0 / max(1, len(close)))

    daily_rf = 0.05 / 252.0
    excess_ret = strategy_ret - daily_rf
    std = float(strategy_ret.std())
    sharpe = float(np.sqrt(252.0) * excess_ret.mean() / (std + 1e-9)) if std > 0 else 0.0

    downside = strategy_ret[strategy_ret < 0]
    downside_std = float(downside.std()) if len(downside) > 0 else 0.0
    sortino = float(np.sqrt(252.0) * excess_ret.mean() / (downside_std + 1e-9)) if downside_std > 0 else sharpe

    cum_max = equity_series.cummax()
    drawdown = (equity_series - cum_max) / cum_max
    max_dd = float(abs(drawdown.min()) * 100) if len(drawdown) > 0 else 0.0
    calmar = (ann_ret / max_dd) if max_dd > 0 else 0.0

    total_trades = int(trades_mask.sum() // 2)
    win_days = int((strategy_ret > 0).sum())
    trade_days = int((strategy_ret != 0).sum())
    win_rate = (win_days / trade_days * 100) if trade_days > 0 else 0.0

    gross_gains = float(strategy_ret[strategy_ret > 0].sum())
    gross_losses = float(abs(strategy_ret[strategy_ret < 0].sum()))
    profit_factor = (gross_gains / gross_losses) if gross_losses > 0 else (2.0 if gross_gains > 0 else 0.0)

    dates = close.index.strftime("%Y-%m-%d").tolist()
    return {
        "stats": {
            "total_return_pct": round(float(total_ret), 2),
            "annual_return_pct": round(float(ann_ret), 2),
            "sharpe_ratio": round(float(sharpe), 3),
            "sortino_ratio": round(float(sortino), 3),
            "calmar_ratio": round(float(calmar), 3),
            "max_drawdown_pct": round(float(max_dd), 2),
            "win_rate_pct": round(float(win_rate), 2),
            "total_trades": total_trades,
            "profit_factor": round(float(profit_factor), 3),
        },
        "equity_curve": list(zip(dates, [round(float(v), 2) for v in equity_series.tolist()])),
        "drawdown_curve": list(zip(dates, [round(float(v * 100), 2) for v in drawdown.tolist()])),
    }


def _run_strategy_grid(close: pd.Series, strategy: str, fast_range, slow_range, init_cash: float, fees: float):
    """
    Vectorized grid sweep evaluating multiple combinations across custom strategy indicators.
    Returns return, sharpe, win rate, profit factor, and max drawdown heatmaps.
    """
    daily_ret = close.pct_change().fillna(0)
    best_return = -999999.0
    best_ret_params = (int(fast_range[0]), int(slow_range[0]))
    best_sharpe = -999999.0
    best_sharpe_params = (int(fast_range[0]), int(slow_range[0]))

    heatmap_returns = {}
    heatmap_sharpe = {}
    heatmap_win_rate = {}
    heatmap_profit_factor = {}
    heatmap_max_dd = {}

    # Precompute indicators if needed
    for f in fast_range:
        for s in slow_range:
            if strategy in ["ema_cross", "sma_cross", "donchian"] and s <= f:
                continue

            # Generate signals based on selected strategy
            if strategy == "ema_cross":
                fast_ma = close.ewm(span=int(f), adjust=False).mean()
                slow_ma = close.ewm(span=int(s), adjust=False).mean()
                entries = (fast_ma > slow_ma) & (fast_ma.shift(1) <= slow_ma.shift(1))
                exits = (fast_ma < slow_ma) & (fast_ma.shift(1) >= slow_ma.shift(1))

            elif strategy == "sma_cross":
                fast_ma = close.rolling(int(f)).mean()
                slow_ma = close.rolling(int(s)).mean()
                entries = (fast_ma > slow_ma) & (fast_ma.shift(1) <= slow_ma.shift(1))
                exits = (fast_ma < slow_ma) & (fast_ma.shift(1) >= slow_ma.shift(1))

            elif strategy == "rsi":
                # f = rsi entry level (oversold), s = rsi exit level (overbought)
                rsi_s = compute_rsi(close, 14)
                entries = (rsi_s < int(f)) & (rsi_s.shift(1) >= int(f))
                exits = (rsi_s > int(s)) & (rsi_s.shift(1) <= int(s))

            elif strategy == "donchian":
                # f = upper channel length, s = lower channel length
                upper = close.rolling(int(f)).max()
                lower = close.rolling(int(s)).min()
                entries = (close >= upper.shift(1))
                exits = (close <= lower.shift(1))
            else:
                fast_ma = close.rolling(int(f)).mean()
                slow_ma = close.rolling(int(s)).mean()
                entries = (fast_ma > slow_ma)
                exits = (fast_ma < slow_ma)

            # Evaluate simulation
            sim = _simulate_signals(close, entries, exits, init_cash, fees)
            stats = sim["stats"]
            tot_ret = stats["total_return_pct"]
            sh = stats["sharpe_ratio"]
            wr = stats["win_rate_pct"]
            pf = stats["profit_factor"]
            mdd = stats["max_drawdown_pct"]

            key = f"({int(f)}, {int(s)})"
            heatmap_returns[key] = tot_ret
            heatmap_sharpe[key] = sh
            heatmap_win_rate[key] = wr
            heatmap_profit_factor[key] = pf
            heatmap_max_dd[key] = mdd

            if tot_ret > best_return:
                best_return = tot_ret
                best_ret_params = (int(f), int(s))
            if sh > best_sharpe:
                best_sharpe = sh
                best_sharpe_params = (int(f), int(s))

    # Robustness Analysis: Check if the 3x3 neighborhood around best_sharpe is consistently profitable
    best_f, best_s = best_sharpe_params
    neighbor_sharpes = []
    for df in [-1, 0, 1]:
        for ds in [-1, 0, 1]:
            neighbor_f = best_f + (df * (fast_range[1] - fast_range[0] if len(fast_range) > 1 else 1))
            neighbor_s = best_s + (ds * (slow_range[1] - slow_range[0] if len(slow_range) > 1 else 1))
            n_key = f"({int(neighbor_f)}, {int(neighbor_s)})"
            if n_key in heatmap_sharpe:
                neighbor_sharpes.append(heatmap_sharpe[n_key])

    positive_neighbors = [sh for sh in neighbor_sharpes if sh > 0]
    robustness_pct = round((len(positive_neighbors) / max(1, len(neighbor_sharpes))) * 100, 1)
    if robustness_pct >= 75:
        robustness_status = "Robust Green Plateau"
    elif robustness_pct >= 50:
        robustness_status = "Moderate Cluster"
    else:
        robustness_status = "Isolated Spike (Overfit Risk)"

    return {
        "combinations_tested": len(heatmap_returns),
        "strategy": strategy,
        "best_by_return": {
            "fast_ma": best_ret_params[0],
            "slow_ma": best_ret_params[1],
            "return_pct": best_return,
            "sharpe": heatmap_sharpe.get(f"({best_ret_params[0]}, {best_ret_params[1]})", 0.0)
        },
        "best_by_sharpe": {
            "fast_ma": best_sharpe_params[0],
            "slow_ma": best_sharpe_params[1],
            "return_pct": heatmap_returns.get(f"({best_sharpe_params[0]}, {best_sharpe_params[1]})", 0.0),
            "sharpe": best_sharpe
        },
        "robustness": {
            "score": robustness_pct,
            "status": robustness_status,
            "best_params": f"({best_f}, {best_s})",
            "neighborhood_size": len(neighbor_sharpes)
        },
        "heatmap_returns": heatmap_returns,
        "heatmap_sharpe": heatmap_sharpe,
        "heatmap_win_rate": heatmap_win_rate,
        "heatmap_profit_factor": heatmap_profit_factor,
        "heatmap_max_dd": heatmap_max_dd
    }


def _fetch_nifty_benchmark(start_date: str, end_date: str, init_cash: float) -> Optional[Dict[str, Any]]:
    """Fetches NIFTY 50 index benchmark and computes baseline holding performance."""
    try:
        bench_close = load_price_series("^NSEI", start_date, end_date)
        if bench_close is None or len(bench_close) < 10:
            return None
        daily_ret = bench_close.pct_change().fillna(0)
        cum_ret = ((bench_close.iloc[-1] / bench_close.iloc[0]) - 1) * 100
        ann_ret = cum_ret * (252.0 / max(1, len(bench_close)))
        excess_ret = daily_ret - (0.05 / 252.0)
        std = float(daily_ret.std())
        sharpe = float(np.sqrt(252.0) * excess_ret.mean() / (std + 1e-9)) if std > 0 else 0.0
        cum_max = bench_close.cummax()
        drawdown = (bench_close - cum_max) / cum_max
        max_dd = float(abs(drawdown.min()) * 100) if len(drawdown) > 0 else 0.0

        return {
            "symbol": "NIFTY 50 (^NSEI)",
            "total_return_pct": round(float(cum_ret), 2),
            "annual_return_pct": round(float(ann_ret), 2),
            "sharpe_ratio": round(float(sharpe), 3),
            "max_drawdown_pct": round(float(max_dd), 2)
        }
    except Exception as e:
        logger.warning(f"Benchmark fetch failed for ^NSEI: {e}")
        return None


@router.post("/run_sma_crossover")
def run_sma_crossover(req: BacktestRequest):
    """
    Executes a single backtest for the specified parameter combination.
    Includes full performance metrics, equity growth, drawdown curve, and NIFTY 50 benchmark comparison.
    """
    try:
        close = load_price_series(req.symbol, req.start_date, req.end_date)
        strategy = req.strategy or "ema_cross"

        # Generate signals based on strategy
        if strategy == "ema_cross":
            fast_ma = close.ewm(span=req.fast_ma, adjust=False).mean()
            slow_ma = close.ewm(span=req.slow_ma, adjust=False).mean()
            entries = (fast_ma > slow_ma) & (fast_ma.shift(1) <= slow_ma.shift(1))
            exits = (fast_ma < slow_ma) & (fast_ma.shift(1) >= slow_ma.shift(1))

        elif strategy == "sma_cross":
            fast_ma = close.rolling(req.fast_ma).mean()
            slow_ma = close.rolling(req.slow_ma).mean()
            entries = (fast_ma > slow_ma) & (fast_ma.shift(1) <= slow_ma.shift(1))
            exits = (fast_ma < slow_ma) & (fast_ma.shift(1) >= slow_ma.shift(1))

        elif strategy == "rsi":
            rsi_s = compute_rsi(close, req.rsi_period or 14)
            entries = (rsi_s < req.rsi_entry) & (rsi_s.shift(1) >= req.rsi_entry)
            exits = (rsi_s > req.rsi_exit) & (rsi_s.shift(1) <= req.rsi_exit)

        elif strategy == "donchian":
            upper = close.rolling(req.donchian_upper or 20).max()
            lower = close.rolling(req.donchian_lower or 10).min()
            entries = (close >= upper.shift(1))
            exits = (close <= lower.shift(1))
        else:
            fast_ma = close.rolling(req.fast_ma).mean()
            slow_ma = close.rolling(req.slow_ma).mean()
            entries = (fast_ma > slow_ma)
            exits = (fast_ma < slow_ma)

        result = _simulate_signals(close, entries, exits, req.init_cash, req.fees)

        # Benchmark comparison
        benchmark = _fetch_nifty_benchmark(req.start_date, req.end_date, req.init_cash)
        strat_ret = result["stats"]["total_return_pct"]
        bench_ret = benchmark["total_return_pct"] if benchmark else 0.0
        alpha = round(strat_ret - bench_ret, 2)

        return {
            "status": "success",
            "symbol": req.symbol,
            "strategy": strategy,
            "period": f"{req.start_date} -> {req.end_date}",
            "params": {
                "fast_ma": req.fast_ma,
                "slow_ma": req.slow_ma,
                "rsi_period": req.rsi_period,
                "rsi_entry": req.rsi_entry,
                "rsi_exit": req.rsi_exit,
                "init_cash": req.init_cash,
                "fees": req.fees
            },
            "stats": result["stats"],
            "benchmark": benchmark,
            "alpha_vs_nifty": alpha,
            "equity_curve": result["equity_curve"],
            "drawdown_curve": result["drawdown_curve"]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"VectorBT simulation error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/optimize")
def optimize_parameters(req: OptimizeRequest):
    """
    Grid search across all parameter combinations simultaneously (vectorized).
    Returns 5 distinct 2D heatmaps (Return, Sharpe, Win Rate, Profit Factor, Max Drawdown)
    along with Robustness Plateau analysis to detect curve fitting.
    """
    try:
        close = load_price_series(req.symbol, req.start_date, req.end_date)
        fast_range = np.arange(req.fast_range_start, req.fast_range_end, req.fast_range_step)
        slow_range = np.arange(req.slow_range_start, req.slow_range_end, req.slow_range_step)

        grid_res = _run_strategy_grid(
            close=close,
            strategy=req.strategy or "ema_cross",
            fast_range=fast_range,
            slow_range=slow_range,
            init_cash=req.init_cash,
            fees=req.fees
        )

        grid_res["status"] = "success"
        grid_res["symbol"] = req.symbol
        return grid_res

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"VectorBT optimize error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
