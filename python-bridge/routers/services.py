import json
import subprocess
import logging
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/services", tags=["Services Management"])
log = logging.getLogger("app.services")

# Standard PM2 services we manage as defined in ecosystem.config.js
MANAGED_SERVICES = {
    "wealthos-api": "FastAPI NSE Bridge",
    "wealthos-telegram": "Telegram Ear Server",
    "wealthos-dhan": "Dhan Integration Bridge",
    "wealthos-webhook": "Webhook Signal Receiver",
    "wealthos-email": "Email Signal Listener",
    "wealthos-openalgo": "OpenAlgo Strategy Server",
    "wealthos-tunnel": "Cloudflare Tunnel"
}

def get_pm2_processes() -> List[Dict[str, Any]]:
    """Runs pm2 jlist and parses the JSON result securely."""
    try:
        # shell=True enables running pm2.cmd on Windows and pm2 executable on Linux path
        result = subprocess.run(
            "pm2 jlist",
            shell=True,
            capture_output=True,
            text=True,
            check=True
        )
        raw = result.stdout.strip()
        if not raw:
            return []
        start_idx = raw.find('[')
        end_idx = raw.rfind(']')
        if start_idx != -1 and end_idx != -1 and end_idx >= start_idx:
            return json.loads(raw[start_idx:end_idx + 1])
        return []
    except Exception:
        return []

@router.get("/status")
async def get_services_status():
    """Returns the real-time running status of all managed backend services."""
    pm2_list = get_pm2_processes()
    
    # Index PM2 processes by name for fast lookup
    pm2_map = {proc.get("name"): proc for proc in pm2_list if "name" in proc}
    
    response_data = []
    
    for service_name, display_name in MANAGED_SERVICES.items():
        pm2_proc = pm2_map.get(service_name)
        
        if pm2_proc:
            pm2_env = pm2_proc.get("pm2_env", {})
            monit = pm2_proc.get("monit", {})
            
            # Translate PM2 status values
            pm2_status = pm2_env.get("status", "unknown")
            status = "online" if pm2_status == "online" else "offline"
            if pm2_status in ("errored", "stopping", "stopped"):
                status = "offline"
            elif pm2_status == "launching":
                status = "launching"
                
            response_data.append({
                "name": service_name,
                "displayName": display_name,
                "status": status,
                "pm2Status": pm2_status,
                "pid": pm2_proc.get("pid", 0),
                "uptime": pm2_env.get("pm_uptime", 0),
                "restarts": pm2_env.get("restart_time", 0),
                "memory": monit.get("memory", 0), # in bytes
                "cpu": monit.get("cpu", 0) # percentage
            })
        else:
            # Service defined in config but not currently registered in PM2 active list
            response_data.append({
                "name": service_name,
                "displayName": display_name,
                "status": "offline",
                "pm2Status": "unregistered",
                "pid": 0,
                "uptime": 0,
                "restarts": 0,
                "memory": 0,
                "cpu": 0
            })
            
    return response_data

@router.post("/{name}/restart")
async def restart_service(name: str):
    """Restarts a single PM2 service by name."""
    if name not in MANAGED_SERVICES:
        raise HTTPException(status_code=400, detail="Invalid service name")
        
    try:
        result = subprocess.run(
            f"pm2 restart {name}",
            shell=True,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            log.info(f"Successfully restarted service: {name}")
            return {"success": True, "message": f"Service {name} restarted successfully"}
        else:
            log.error(f"Failed to restart service {name}: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"PM2 failed to restart service: {result.stderr}")
    except Exception as e:
        log.error(f"Exception restarting service {name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{name}/stop")
async def stop_service(name: str):
    """Stops a single PM2 service by name."""
    if name not in MANAGED_SERVICES:
        raise HTTPException(status_code=400, detail="Invalid service name")
        
    try:
        result = subprocess.run(
            f"pm2 stop {name}",
            shell=True,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            log.info(f"Successfully stopped service: {name}")
            return {"success": True, "message": f"Service {name} stopped successfully"}
        else:
            log.error(f"Failed to stop service {name}: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"PM2 failed to stop service: {result.stderr}")
    except Exception as e:
        log.error(f"Exception stopping service {name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{name}/logs")
async def get_service_logs(name: str):
    """Retrieves the last 100 log lines from PM2 logs for a specific service."""
    if name not in MANAGED_SERVICES:
        raise HTTPException(status_code=400, detail="Invalid service name")
        
    try:
        # pm2 logs --raw --lines 100 --nostream {name}
        result = subprocess.run(
            f"pm2 logs --raw --lines 100 --nostream {name}",
            shell=True,
            capture_output=True,
            text=True
        )
        # Log outputs are typically combined stdout + stderr
        logs = result.stdout or result.stderr or ""
        return {"name": name, "logs": logs.splitlines()}
    except Exception as e:
        log.error(f"Exception fetching logs for service {name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
