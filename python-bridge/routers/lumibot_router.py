"""
lumibot_router.py — Multi-Asset Lumibot Strategy Backtesting Router
Prefix: /api/lumibot
"""
import os
import sys
import logging
import uuid
from typing import Optional, Dict, Any
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("lumibot_router")

router = APIRouter(prefix="/api/lumibot", tags=["Lumibot — Unified Strategy Framework"])

STRATEGY_RESULTS: Dict[str, Dict[str, Any]] = {}

class StrategyConfig(BaseModel):
    symbol: str = "RELIANCE.NS"
    start_date: str = "2023-01-01"
    end_date: str = "2024-01-01"
    budget: float = 100000.0
    strategy_type: str = "buy_and_hold"

@router.post("/backtest")
def run_lumibot_backtest(config: StrategyConfig, bg: BackgroundTasks):
    """
    Launch Lumibot multi-asset strategy backtest asynchronously.
    Returns a task_id immediately for frontend polling.
    """
    task_id = str(uuid.uuid4())[:8]
    STRATEGY_RESULTS[task_id] = {
        "status": "running",
        "symbol": config.symbol,
        "strategy_type": config.strategy_type,
        "period": f"{config.start_date} → {config.end_date}"
    }
    bg.add_task(_run_backtest_task, task_id, config)
    return {
        "status": "started",
        "task_id": task_id,
        "poll_url": f"/api/lumibot/results/{task_id}"
    }

def _run_backtest_task(task_id: str, config: StrategyConfig):
    """Background task runner for Lumibot backtest"""
    try:
        from lumibot.strategies import Strategy
        from lumibot.backtesting import YahooDataBacktesting
        from datetime import datetime

        class LumibotSimpleStrategy(Strategy):
            def initialize(self):
                self.sleeptime = "1D"

            def on_trading_iteration(self):
                if not self.get_position(config.symbol):
                    price = self.get_last_price(config.symbol)
                    if price and price > 0:
                        qty = int(config.budget / price)
                        if qty > 0:
                            order = self.create_order(config.symbol, qty, "buy")
                            self.submit_order(order)

        start_dt = datetime.strptime(config.start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(config.end_date, "%Y-%m-%d")

        results = LumibotSimpleStrategy.backtest(
            YahooDataBacktesting,
            start_dt, end_dt,
            budget=config.budget,
            parameters={}
        )

        tot_return = getattr(results, "total_return", None)
        cagr = getattr(results, "cagr", None)
        max_dd = getattr(results, "max_drawdown", None)
        sharpe = getattr(results, "sharpe", None)

        STRATEGY_RESULTS[task_id] = {
            "status": "done",
            "engine": "Lumibot (Multi-Asset)",
            "symbol": config.symbol,
            "period": f"{config.start_date} → {config.end_date}",
            "budget": config.budget,
            "stats": {
                "total_return_pct": round(float(tot_return * 100) if tot_return is not None else 0.0, 2),
                "cagr_pct": round(float(cagr * 100) if cagr is not None else 0.0, 2),
                "max_drawdown_pct": round(float(max_dd * 100) if max_dd is not None else 0.0, 2),
                "sharpe_ratio": round(float(sharpe) if sharpe is not None else 0.0, 3)
            }
        }
    except Exception as e:
        logger.error(f"Lumibot execution error for task {task_id}: {e}")
        STRATEGY_RESULTS[task_id] = {
            "status": "error",
            "error": str(e),
            "symbol": config.symbol
        }

@router.get("/results/{task_id}")
def get_results(task_id: str):
    """
    Poll for Lumibot backtest results using task_id
    """
    result = STRATEGY_RESULTS.get(task_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Lumibot task '{task_id}' not found")
    return result
