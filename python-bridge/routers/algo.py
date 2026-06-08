import os
import sys
import time
import json
import sqlite3
import subprocess
import tempfile
import signal
from typing import Optional
from fastapi import APIRouter, HTTPException, Body

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

router = APIRouter(prefix="/algo", tags=["ALGO"])

# Constants
WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ALGO_DIR = os.path.join(WORKSPACE_ROOT, "algo-engine")
STATUS_FILE = os.path.join(ALGO_DIR, "journal", "status.json")
DB_PATH = os.path.join(ALGO_DIR, "journal", "trades.db")
HALT_FILE = os.path.join(tempfile.gettempdir(), "algo_halt.flag")

def is_pid_running(pid: int) -> bool:
    """Cross-platform check to verify if a process ID is running."""
    if pid <= 0:
        return False
    if os.name == 'nt':
        import ctypes
        kernel32 = ctypes.windll.kernel32
        # PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if handle:
            kernel32.CloseHandle(handle)
            return True
        return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

def get_current_status() -> dict:
    """Reads status.json and checks if PID is still alive."""
    if not os.path.exists(STATUS_FILE):
        return {"status": "idle", "mode": None, "pid": None}
    
    try:
        with open(STATUS_FILE, "r") as f:
            data = json.load(f)
        
        pid = data.get("pid")
        if pid and is_pid_running(pid):
            return {
                "status": "running",
                "mode": data.get("mode", "sandbox"),
                "pid": pid,
                "startTime": data.get("startTime")
            }
    except Exception:
        pass
        
    return {"status": "idle", "mode": None, "pid": None}

@router.get("/status")
def get_algo_status():
    status = get_current_status()
    # Check if kill switch is active
    status["is_halted"] = os.path.exists(HALT_FILE)
    return status

@router.post("/start")
def start_algo_engine(payload: dict = Body(...)):
    """Starts the algo engine in either 'sandbox' or 'simulate' mode."""
    status = get_current_status()
    if status["status"] == "running":
        raise HTTPException(status_code=400, detail=f"Algo engine is already running with PID {status['pid']}.")

    mode = payload.get("mode", "simulate")  # Default to simulation
    if mode not in ("sandbox", "simulate"):
        raise HTTPException(status_code=400, detail="Invalid mode. Must be 'sandbox' or 'simulate'.")

    # Path to main.py
    main_py = os.path.join(ALGO_DIR, "main.py")
    
    # Run the engine
    cmd = [sys.executable, main_py]
    if mode == "sandbox":
        cmd.append("--sandbox")
    else:
        cmd.append("--simulate")
        
    try:
        # Launch process in background (detached from main process)
        proc = subprocess.Popen(
            cmd,
            cwd=ALGO_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        )
        
        # Write status file
        status_data = {
            "status": "running",
            "mode": mode,
            "pid": proc.pid,
            "startTime": int(time.time())
        }
        
        os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
        with open(STATUS_FILE, "w") as f:
            json.dump(status_data, f)
            
        print(f"[API] Launched Algo Engine. PID: {proc.pid}, Mode: {mode}")
        return {"status": "success", "pid": proc.pid, "mode": mode}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start algo engine: {str(e)}")

@router.post("/stop")
def stop_algo_engine():
    """Stops the running algo engine process."""
    status = get_current_status()
    if status["status"] == "idle":
        return {"status": "success", "message": "Algo engine is already stopped."}
        
    pid = status["pid"]
    try:
        if os.name == 'nt':
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            os.kill(pid, signal.SIGTERM)
            
        # Clean up status file
        if os.path.exists(STATUS_FILE):
            os.remove(STATUS_FILE)
            
        return {"status": "success", "message": f"Stopped algo engine with PID {pid}."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop algo engine process: {str(e)}")

@router.post("/kill-switch")
def trigger_kill_switch(payload: dict = Body(...)):
    """Triggers the emergency halt flag."""
    t0 = time.perf_counter()
    action = payload.get("action", "halt")
    if action == "halt":
        with open(HALT_FILE, "w") as f:
            f.write("HALT")
        
        # Stop the running process as well
        stop_algo_engine()
        duration_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "status": "success",
            "message": "Emergency halt triggered. Algo engine stopped.",
            "duration_ms": duration_ms,
            "engine_stopped": True,
            "orders_cancelled": False,
            "note": "Verify open positions on broker terminal."
        }
    elif action == "resume":
        if os.path.exists(HALT_FILE):
            os.remove(HALT_FILE)
        duration_ms = round((time.perf_counter() - t0) * 1000, 2)
        return {
            "status": "success",
            "message": "Emergency halt flag cleared. Engine can now be restarted.",
            "duration_ms": duration_ms
        }
    else:
        raise HTTPException(status_code=400, detail="Invalid action. Must be 'halt' or 'resume'.")

@router.get("/trades")
def get_algo_trades():
    """Fetches all trades from the SQLite trade journal."""
    if not os.path.exists(DB_PATH):
        return {"status": "success", "trades": []}
        
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM trades ORDER BY id DESC")
        rows = cursor.fetchall()
        trades = [dict(row) for row in rows]
        conn.close()
        return {"status": "success", "trades": trades}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query trade journal: {str(e)}")

import time
