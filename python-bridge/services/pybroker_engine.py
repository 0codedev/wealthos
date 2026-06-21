"""
pybroker_engine.py
PyBroker-based machine learning and quantitative backtesting engine.
"""
import logging
import pandas as pd
import numpy as np

log = logging.getLogger("pybroker_engine")

def load_data(symbol: str, from_date: str, to_date: str) -> pd.DataFrame:
    # Load OHLCV for pybroker
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
            if df.index.tz is not None:
                df.index = df.index.tz_localize(None)
            df = df.reset_index()
            df = df.rename(columns={
                'date': 'date',
                'open': 'open',
                'high': 'high',
                'low': 'low',
                'close': 'close',
                'volume': 'volume'
            })
            df['symbol'] = symbol
            return df[['date', 'symbol', 'open', 'high', 'low', 'close', 'volume']]
    except Exception as e:
        log.warning(f"Parquet load failed for {symbol}: {e}")

    import yfinance as yf
    ticker = f"{symbol}.NS" if not symbol.endswith('.NS') else symbol
    df = yf.download(ticker, start=from_date, end=to_date, progress=False)
    if df.empty:
        raise ValueError(f"No data for {symbol} in range {from_date}–{to_date}")
    df = df.reset_index()
    
    # Check if multi-index column
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0] for col in df.columns]

    df = df.rename(columns={
        'Date': 'date',
        'Open': 'open',
        'High': 'high',
        'Low': 'low',
        'Close': 'close',
        'Volume': 'volume'
    })
    df['symbol'] = symbol
    if df['date'].dt.tz is not None:
        df['date'] = df['date'].dt.tz_localize(None)
    return df[['date', 'symbol', 'open', 'high', 'low', 'close', 'volume']]


def run_pybroker_backtest(payload: dict) -> dict:
    """
    Executes backtest with lib-pybroker.
    """
    import pybroker
    from pybroker import Strategy, StrategyConfig

    symbol = payload["symbol"]
    from_date = payload["from_date"]
    to_date = payload["to_date"]
    capital = float(payload.get("capital", 100_000))
    
    # Load data
    df = load_data(symbol, from_date, to_date)
    
    # Setup indicators
    def indicators(bar_data):
        close = bar_data.close
        sma_20 = pybroker.indicator('sma_20', lambda c: pd.Series(c).rolling(20).mean())(close)
        sma_50 = pybroker.indicator('sma_50', lambda c: pd.Series(c).rolling(50).mean())(close)
        return sma_20, sma_50

    # Define strategy rules
    def buy_sell_rules(ctx):
        # Check if indicators are computed
        sma20 = ctx.indicator('sma_20')
        sma50 = ctx.indicator('sma_50')
        if len(sma20) < 2 or len(sma50) < 2:
            return
        
        if sma20[-1] > sma50[-1] and not ctx.long_pos():
            ctx.buy_shares = 100
        elif sma20[-1] < sma50[-1] and ctx.long_pos():
            ctx.sell_all()

    config = StrategyConfig(
        initial_cash=capital,
        bootstrap_size=100
    )
    
    strategy = Strategy(df, start_date=from_date, end_date=to_date, config=config)
    strategy.add_execution(buy_sell_rules, indicators=indicators)
    
    # Run backtest
    result = strategy.backtest()
    metrics = result.metrics
    
    return {
        "symbol": symbol,
        "cagr": round(float(metrics.cagr) * 100, 2) if not np.isnan(metrics.cagr) else 0.0,
        "sharpe": round(float(metrics.sharpe), 3) if not np.isnan(metrics.sharpe) else 0.0,
        "max_drawdown": round(float(metrics.max_drawdown) * 100, 2) if not np.isnan(metrics.max_drawdown) else 0.0,
        "trade_count": int(metrics.trade_count) if not np.isnan(metrics.trade_count) else 0,
        "win_rate": round(float(metrics.win_rate) * 100, 2) if not np.isnan(metrics.win_rate) else 0.0
    }
