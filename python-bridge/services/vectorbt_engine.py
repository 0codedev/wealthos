"""
vectorbt_engine.py
VectorBT-based backtesting engine.
Exposes run_strategy() for use by the /api/backtest/vectorbt endpoint.
"""
import logging
import pandas as pd
import numpy as np

log = logging.getLogger("vectorbt_engine")


def load_ohlcv(symbol: str, from_date: str, to_date: str) -> pd.Series:
    """
    Load OHLCV data from local Parquet archive (existing data pipeline).
    Falls back to yfinance if parquet data is missing.
    """
    try:
        import sys
        import os
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        import parquet_query
        candles = parquet_query.query_candles(symbol, "day", from_date, to_date)
        if candles and len(candles) > 0:
            df = pd.DataFrame(candles)
            df['date'] = pd.to_datetime(df['date'])
            df = df.set_index('date').sort_index()
            # Ensure index has timezone-naive DatetimeIndex for VectorBT
            if df.index.tz is not None:
                df.index = df.index.tz_localize(None)
            return df['close']  # VectorBT needs a price Series or DataFrame
    except Exception as e:
        log.warning(f"Parquet load failed for {symbol}: {e}")

    # yfinance fallback
    import yfinance as yf
    ticker = f"{symbol}.NS" if not symbol.endswith('.NS') else symbol
    df = yf.download(ticker, start=from_date, end=to_date, progress=False)
    if df.empty:
        raise ValueError(f"No data for {symbol} in range {from_date}–{to_date}")
    
    # Return close price Series
    # Handle multi-index column if yfinance returns it
    if isinstance(df.columns, pd.MultiIndex):
        close_col = [col for col in df.columns if col[0] == 'Close']
        if close_col:
            series = df[close_col[0]]
        else:
            series = df.iloc[:, 0]
    else:
        series = df['Close']
        
    if series.index.tz is not None:
        series.index = series.index.tz_localize(None)
        
    return series


def run_strategy(payload: dict) -> dict:
    """
    Execute a vectorized backtest and return performance metrics.

    payload keys:
      symbol, from_date, to_date, capital,
      strategy: "ema_cross" | "rsi",
      fast_period, slow_period, rsi_period, rsi_entry, rsi_exit
    """
    import vectorbt as vbt

    symbol    = payload["symbol"]
    from_date = payload["from_date"]
    to_date   = payload["to_date"]
    capital   = float(payload.get("capital", 100_000))
    strategy  = payload.get("strategy", "ema_cross")

    price = load_ohlcv(symbol, from_date, to_date)
    log.info(f"Loaded {len(price)} candles for {symbol} [{from_date}→{to_date}]")

    # ── Strategy: EMA Crossover ───────────────────────────────────────────
    if strategy == "ema_cross":
        fast = int(payload.get("fast_period", 9))
        slow = int(payload.get("slow_period", 21))
        fast_ma = vbt.MA.run(price, fast, short_name="fast")
        slow_ma = vbt.MA.run(price, slow, short_name="slow")
        entries = fast_ma.ma_crossed_above(slow_ma)
        exits   = fast_ma.ma_crossed_below(slow_ma)

    # ── Strategy: RSI Mean-Reversion ─────────────────────────────────────
    elif strategy == "rsi":
        period    = int(payload.get("rsi_period", 14))
        entry_lvl = int(payload.get("rsi_entry",  30))
        exit_lvl  = int(payload.get("rsi_exit",   70))
        rsi = vbt.RSI.run(price, period)
        entries = rsi.rsi_crossed_below(entry_lvl)
        exits   = rsi.rsi_crossed_above(exit_lvl)

    else:
        raise ValueError(f"Unknown strategy: {strategy}")

    # ── Portfolio Simulation ──────────────────────────────────────────────
    pf = vbt.Portfolio.from_signals(
        price, entries, exits,
        init_cash=capital,
        fees=0.0003,       # 0.03% — typical Indian broker fee
        slippage=0.001     # 0.1% slippage
    )

    # ── Build equity curve (for chart rendering in UI) ───────────────────
    equity = pf.value()
    drawdown = pf.drawdown()

    return {
        "symbol":         symbol,
        "strategy":       strategy,
        "from_date":      from_date,
        "to_date":        to_date,
        "candle_count":   len(price),
        "total_return":   round(pf.total_return() * 100, 2),
        "annualized_return": round(pf.annualized_return() * 100, 2),
        "sharpe_ratio":   round(float(pf.sharpe_ratio()) if not np.isnan(pf.sharpe_ratio()) else 0.0, 3),
        "sortino_ratio":  round(float(pf.sortino_ratio()) if not np.isnan(pf.sortino_ratio()) else 0.0, 3),
        "max_drawdown":   round(pf.max_drawdown() * 100, 2),
        "win_rate":       round(float(pf.trades.win_rate()) * 100, 2) if pf.trades.count() > 0 else 0.0,
        "trade_count":    int(pf.trades.count()),
        "profit_factor":  round(float(pf.trades.profit_factor()) if not np.isnan(pf.trades.profit_factor()) else 0.0, 3),
        "equity_curve": [
            {"date": str(idx.date()), "value": round(val, 2)}
            for idx, val in equity.items()
        ],
        "drawdown_curve": [
            {"date": str(idx.date()), "value": round(val * 100, 2)}
            for idx, val in drawdown.items()
        ]
    }
