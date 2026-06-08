import os
import sys
import json
import subprocess
import traceback
from fastapi import APIRouter, HTTPException, Query, Request
from logger import get_logger

log = get_logger("backtest_router", tag="BACKTEST")

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import parquet_query
import screener
import analytics_engine
from backtest_simulator import BacktestSimulator
from monte_carlo import run_monte_carlo

router = APIRouter()

sync_subprocess_p = None

@router.get("/api/backtest/candles")
def get_backtest_candles(
    symbol: str = Query(...),
    interval: str = Query("day"),
    from_date: str = Query(...),
    to_date: str = Query(...),
    expiry: str = Query(None),
    strike: float = Query(None),
    option_type: str = Query(None)
):
    if expiry and strike and option_type:
        data = parquet_query.query_option_candles(symbol, expiry, strike, option_type, from_date, to_date)
    else:
        data = parquet_query.query_candles(symbol, interval, from_date, to_date)
        
    status = "success"
    warning = None
    
    if data is None:
        return {
            "status": "unavailable",
            "source": "parquet",
            "candles": [],
            "warning": "Requested candle data is not present in local Parquet archive."
        }
        
    if not expiry and data:
        try:
            from datetime import datetime, date
            d1 = datetime.strptime(from_date, "%Y-%m-%d").date()
            d2 = datetime.strptime(to_date, "%Y-%m-%d").date()
            workdays = 0
            for d_ord in range(d1.toordinal(), d2.toordinal() + 1):
                if date.fromordinal(d_ord).weekday() < 5:
                    workdays += 1
            if workdays > 5 and len(data) < 0.7 * workdays:
                status = "partial"
                warning = f"Returned partial dataset: only {len(data)} candles found for the requested range of {workdays} business days."
        except Exception:
            pass
            
    res = {
        "status": status,
        "source": "parquet",
        "candles": data
    }
    if warning:
        res["warning"] = warning
    return res

@router.get("/api/backtest/sync-status")
def get_backtest_sync_status():
    global sync_subprocess_p
    status = parquet_query.get_sync_status()
    
    is_running = False
    if sync_subprocess_p is not None:
        if sync_subprocess_p.poll() is None:
            is_running = True
        else:
            sync_subprocess_p = None
            
    status["is_running"] = is_running
    return status

@router.get("/api/backtest/archive-stats")
def get_backtest_archive_stats():
    try:
        return parquet_query.get_archive_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/backtest/start-sync")
def start_backtest_sync(
    mode: str = Query("delta", description="delta or full"),
    symbols: str = Query("indices", description="indices, all, or comma-separated list"),
    delta_strategy: str = Query("static", description="static or buffer"),
    buffer_days: int = Query(7, description="Number of days for recent buffer override")
):
    global sync_subprocess_p
    if sync_subprocess_p is not None and sync_subprocess_p.poll() is None:
        raise HTTPException(status_code=400, detail="Synchronization is already running in the background.")
        
    script_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sync_parquet.py")
    cmd = [
        sys.executable, 
        script_path, 
        "--mode", mode, 
        "--symbols", symbols, 
        "--delta-strategy", delta_strategy, 
        "--buffer-days", str(buffer_days)
    ]
    
    try:
        sync_subprocess_p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {
            "status": "success",
            "message": "Synchronization script started in background.",
            "pid": sync_subprocess_p.pid
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start sync subprocess: {str(e)}")

@router.post("/api/backtest/screener")
async def run_backtest_screener(request: Request):
    try:
        config = await request.json()
        result = screener.run_screener(config)
        return result
    except Exception as e:
        log.error("Screener execution failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Screener execution failed: {str(e)}")

@router.post("/api/backtest/simulate")
async def run_backtest_simulation(request: Request):
    try:
        config = await request.json()
        
        # Extract basic info for warning check
        from_date = config.get("from_date")
        to_date = config.get("to_date")
        interval = config.get("interval", "day").lower()
        
        warning = None
        if from_date and to_date:
            try:
                from datetime import datetime
                d1 = datetime.strptime(from_date, "%Y-%m-%d")
                d2 = datetime.strptime(to_date, "%Y-%m-%d")
                days_diff = (d2 - d1).days
                is_intraday = any(unit in interval for unit in ["minute", "min", "hour"])
                if is_intraday and days_diff > 180:
                    warning = f"Requested intraday backtest covers {days_diff} days, but local intraday cache is limited to a 180-day rolling window. Results may be partial or empty for earlier dates."
            except Exception:
                pass
                
        simulator = BacktestSimulator(config)
        result = simulator.run()
        
        if result.get("status") == "success":
            # Run server-side Monte Carlo shuffles
            trade_log = result.get("trade_log", [])
            initial_capital = float(config.get("initial_capital", 500000.0))
            monte_carlo_res = run_monte_carlo(trade_log, initial_capital)
            result["monte_carlo"] = monte_carlo_res
            
            if warning:
                result["warning"] = warning
                
        return result
    except Exception as e:
        log.error("Simulation execution failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Simulation failed: {str(e)}")

@router.get("/api/upstox/instruments/fno-list")
def get_upstox_fno_list():
    fno_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fno_stocks_generated.json")
    if not os.path.exists(fno_file):
        raise HTTPException(status_code=404, detail="F&O stocks metadata file not found.")
    try:
        with open(fno_file, "r") as f:
            data = json.load(f)
            return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read F&O list: {str(e)}")

@router.get("/api/backtest/iv-surface")
def get_iv_surface(
    underlying: str = Query(..., description="Underlying symbol (e.g. NIFTY)"),
    expiry: str = Query(..., description="Expiry date in YYYY-MM-DD format")
):
    try:
        result = analytics_engine.build_iv_surface(underlying, expiry)
        if not result:
            raise HTTPException(status_code=404, detail=f"No IV Surface archive found for {underlying} on {expiry}.")
        return result
    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to calculate IV Surface", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to calculate IV Surface: {str(e)}")

@router.get("/api/backtest/max-pain-history")
def get_max_pain_history(
    underlying: str = Query(..., description="Underlying symbol (e.g. NIFTY)"),
    count: int = Query(24, description="Number of historical expiries to return"),
    view_all: bool = Query(False, description="True to show all expiries, False for monthly only")
):
    try:
        result = analytics_engine.get_historical_max_pain(underlying, count, view_all)
        return {
            "status": "success",
            "underlying": underlying.upper(),
            "count": len(result),
            "history": result
        }
    except Exception as e:
        log.error("Failed to calculate Max Pain history", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to calculate Max Pain history: {str(e)}")

@router.get("/api/backtest/expiries")
def get_backtest_expiries(symbol: str = Query(...)):
    """Reads available options expiries from the local option Parquet directory structure."""
    symbol_upper = symbol.upper().strip()
    options_dir = os.path.join(parquet_query.DATA_DIR, "options", symbol_upper)
    
    if not os.path.exists(options_dir):
        return {"status": "success", "expiries": []}
        
    try:
        # Expiries are the subdirectories under DATA_DIR/options/SYMBOL/
        expiries = []
        for name in os.listdir(options_dir):
            if os.path.isdir(os.path.join(options_dir, name)):
                # Verify that the directory contains a parquet file
                parquet_file = os.path.join(options_dir, name, "data.parquet")
                if os.path.exists(parquet_file):
                    expiries.append(name)
        
        # Sort expiries chronologically
        expiries.sort()
        return {
            "status": "success",
            "source": "local_parquet",
            "expiries": expiries
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list local expiries: {str(e)}")

# ── VectorBT high-performance backtest endpoint ────────────────────────────

from pydantic import BaseModel
from typing import Optional, List


class VectorBTRequest(BaseModel):
    symbol:      str
    from_date:   str         # "2023-01-01"
    to_date:     str         # "2024-12-31"
    capital:     float = 100_000.0
    strategy:    str   = "ema_cross"   # "ema_cross" | "rsi"
    fast_period: Optional[int] = 9
    slow_period: Optional[int] = 21
    rsi_period:  Optional[int] = 14
    rsi_entry:   Optional[int] = 30
    rsi_exit:    Optional[int] = 70

@router.post("/api/backtest/vectorbt")
def run_vectorbt(req: VectorBTRequest):
    """
    High-performance vectorized backtest via VectorBT.
    100x faster than the event-loop BacktestSimulator.
    """
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from vectorbt_engine import run_strategy
        result = run_strategy(req.model_dump())
        return {"status": "success", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"VectorBT error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Backtest engine error")

# ── PyBroker backtest endpoint ────────────────────────────

class PyBrokerRequest(BaseModel):
    symbol:      str
    from_date:   str
    to_date:     str
    capital:     float = 100_000.0

@router.post("/api/backtest/pybroker")
def run_pybroker(req: PyBrokerRequest):
    """
    Machine learning backtest via PyBroker.
    """
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from pybroker_engine import run_pybroker_backtest
        result = run_pybroker_backtest(req.model_dump())
        return {"status": "success", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"PyBroker error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="PyBroker engine error")


# ── Optopsy Options Backtester endpoints ───────────────────────────────

class OptionLeg(BaseModel):
    strike: float
    type: str  # "CE" | "PE"
    action: str  # "BUY" | "SELL"
    premium: float
    quantity: int = 1

class OptopsyRequest(BaseModel):
    symbol: str
    spot_price: float
    legs: List[OptionLeg]

@router.post("/api/backtest/optopsy")
def run_optopsy(req: OptopsyRequest):
    """
    Options payoff calculator and multi-leg simulator using Optopsy logic.
    """
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from optopsy_engine import run_options_backtest
        result = run_options_backtest(req.model_dump())
        return result
    except Exception as e:
        log.error(f"Optopsy simulation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── LEAN Engine connector endpoints ───────────────────────────────

class LeanCandle(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int

class LeanExportRequest(BaseModel):
    symbol: str
    candles: List[LeanCandle]

@router.post("/api/backtest/lean/export")
def run_lean_export(req: LeanExportRequest):
    """
    Exports historical OHLCV data to QuantConnect LEAN format.
    """
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'services'))
        from lean_connector import export_to_lean_csv
        result = export_to_lean_csv(req.symbol, [c.model_dump() for c in req.candles])
        return result
    except Exception as e:
        log.error(f"LEAN export error: {e}")
        raise HTTPException(status_code=500, detail=str(e))




