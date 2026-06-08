"""
backtrader_router.py — Realistic Event-Driven Backtesting Router
Prefix: /api/backtrader
"""
import os
import sys
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd

logger = logging.getLogger("backtrader_router")

router = APIRouter(prefix="/api/backtrader", tags=["Backtrader — Realistic Event-Driven Backtest"])

class BTRequest(BaseModel):
    symbol: str = "RELIANCE.NS"
    start_date: str = "2023-01-01"
    end_date: str = "2024-01-01"
    fast_period: int = 10
    slow_period: int = 30
    cash: float = 100000.0
    commission: float = 0.001       # 0.1% per trade
    slippage_perc: float = 0.001    # 0.1% slippage

@router.post("/sma_crossover")
def backtrader_sma_crossover(req: BTRequest):
    """
    Realistic tick-by-tick SMA crossover simulation using Backtrader.
    Includes brokerage commission and market slippage modeling.
    """
    try:
        import backtrader as bt
        import yfinance as yf

        df = yf.download(req.symbol, start=req.start_date, end=req.end_date, auto_adjust=True, progress=False)
        if df is None or df.empty:
            raise HTTPException(status_code=404, detail=f"No price data found for symbol: {req.symbol}")

        df.index = pd.to_datetime(df.index)

        class SmaCrossStrategy(bt.Strategy):
            params = (("fast", req.fast_period), ("slow", req.slow_period))
            
            def __init__(self):
                sma1 = bt.ind.SMA(period=self.p.fast)
                sma2 = bt.ind.SMA(period=self.p.slow)
                self.crossover = bt.ind.CrossOver(sma1, sma2)
                self.total_trades_cnt = 0

            def next(self):
                if not self.position:
                    if self.crossover > 0:
                        self.buy()
                        self.total_trades_cnt += 1
                elif self.crossover < 0:
                    self.close()

        cerebro = bt.Cerebro()
        cerebro.addstrategy(SmaCrossStrategy)

        data_feed = bt.feeds.PandasData(dataname=df)
        cerebro.adddata(data_feed)
        cerebro.broker.setcash(req.cash)
        cerebro.broker.setcommission(commission=req.commission)
        cerebro.broker.set_slippage_perc(req.slippage_perc)

        # Analyzers
        cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name="sharpe", riskfreerate=0.06)
        cerebro.addanalyzer(bt.analyzers.DrawDown, _name="drawdown")
        cerebro.addanalyzer(bt.analyzers.Returns, _name="returns")
        cerebro.addanalyzer(bt.analyzers.SQN, _name="sqn")
        cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name="trades")

        initial_value = cerebro.broker.getvalue()
        results = cerebro.run()
        final_value = cerebro.broker.getvalue()
        strat = results[0]

        # Extract stats safely
        sharpe = strat.analyzers.sharpe.get_analysis().get("sharperatio") or 0.0
        dd_analysis = strat.analyzers.drawdown.get_analysis()
        max_dd = dd_analysis.get("max", {}).get("drawdown") or 0.0
        sqn = strat.analyzers.sqn.get_analysis().get("sqn") or 0.0

        trade_analysis = strat.analyzers.trades.get_analysis()
        total_trades = trade_analysis.get("total", {}).get("total", 0) or strat.total_trades_cnt
        won_trades = trade_analysis.get("won", {}).get("total", 0)
        lost_trades = trade_analysis.get("lost", {}).get("total", 0)
        pnl_net = trade_analysis.get("pnl", {}).get("net", {}).get("total", 0.0)

        total_return_pct = ((final_value - initial_value) / initial_value) * 100

        return {
            "status": "success",
            "engine": "Backtrader (Event-Driven)",
            "symbol": req.symbol,
            "period": f"{req.start_date} → {req.end_date}",
            "params": {
                "fast_period": req.fast_period,
                "slow_period": req.slow_period,
                "commission": req.commission,
                "slippage_perc": req.slippage_perc
            },
            "performance": {
                "initial_value": round(float(initial_value), 2),
                "final_value": round(float(final_value), 2),
                "total_return_pct": round(float(total_return_pct), 2),
                "sharpe_ratio": round(float(sharpe), 3),
                "max_drawdown_pct": round(float(max_dd), 2),
                "sqn_score": round(float(sqn), 3),
            },
            "trade_stats": {
                "total_trades": int(total_trades),
                "won": int(won_trades),
                "lost": int(lost_trades),
                "net_pnl": round(float(pnl_net), 2),
            }
        }
    except Exception as e:
        logger.error(f"Backtrader backtest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
