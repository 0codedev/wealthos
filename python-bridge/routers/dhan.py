import os
import sys
import json
import asyncio
import requests
import tempfile
from datetime import datetime
from fastapi import APIRouter, Request, Response

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.dhan_client import dhan_client

router = APIRouter(prefix="/api/dhan")

OPENALGO_HOST = os.getenv("OPENALGO_HOST", "http://127.0.0.1:5000")
OPENALGO_API_KEY = os.getenv("OPENALGO_API_KEY", "")

session = requests.Session()
session.trust_env = False

def stop_local_engine():
    """Trigger the emergency halt flag and stop the running local algo process."""
    try:
        halt_file = os.path.join(tempfile.gettempdir(), "algo_halt.flag")
        with open(halt_file, "w") as f:
            f.write("HALT")
    except Exception as e:
        print(f"[KILL SWITCH] Failed to write halt file: {e}")
        
    try:
        status_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "algo-engine", "journal", "status.json")
        if os.path.exists(status_file):
            with open(status_file, "r") as f:
                data = json.load(f)
            pid = data.get("pid")
            if pid:
                import subprocess
                if os.name == 'nt':
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    import signal
                    os.kill(pid, signal.SIGTERM)
            os.remove(status_file)
    except Exception as e:
        print(f"[KILL SWITCH] Failed to stop local process: {e}")

@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_dhan_request(path: str, request: Request):
    """
    Proxies all REST requests targeting /api/dhan to OpenAlgo if configured,
    otherwise falls back to the real Dhan API server.
    """
    body = await request.body()
    params = dict(request.query_params)
    method = request.method
    dhan_path = f"/{path}"
    
    # Intercept DELETE v2/positions (Kill Switch / Exit All Positions)
    if OPENALGO_API_KEY and method == "DELETE" and path == "v2/positions":
        try:
            stop_local_engine()
            
            oa_payload = {"apikey": OPENALGO_API_KEY}
            oa_headers = {"Content-Type": "application/json"}
            
            # Cancel all open orders in OpenAlgo
            try:
                session.post(f"{OPENALGO_HOST}/api/v1/cancel_all_order", headers=oa_headers, json=oa_payload, timeout=5)
            except Exception as ce:
                print(f"[OPENALGO KILL SWITCH WARNING] cancel_all_order failed: {ce}")
                
            # Close all positions in OpenAlgo
            resp = session.post(f"{OPENALGO_HOST}/api/v1/close_position", headers=oa_headers, json=oa_payload, timeout=5)
            if resp.status_code == 200:
                return Response(
                    content=json.dumps({"status": "success", "message": "Emergency halt triggered. All orders canceled, positions closed."}),
                    status_code=200,
                    media_type="application/json"
                )
        except Exception as e:
            print(f"[OPENALGO KILL SWITCH ERROR]: {e}")

    # Intercept positions, orders, fundlimit, trades and route to OpenAlgo
    # Only if OPENALGO_API_KEY is configured
    if OPENALGO_API_KEY and method == "GET":
        oa_payload = {"apikey": OPENALGO_API_KEY}
        oa_headers = {"Content-Type": "application/json"}
        
        if path == "v2/positions":
            try:
                url = f"{OPENALGO_HOST}/api/v1/positionbook"
                resp = session.post(url, headers=oa_headers, json=oa_payload, timeout=5)
                if resp.status_code == 200:
                    positions = resp.json().get("data", [])
                    if not isinstance(positions, list):
                        positions = []
                    dhan_positions = []
                    for pos in positions:
                        qty = int(pos.get("quantity", 0))
                        avg_price = float(pos.get("average_price", 0) or pos.get("costPrice", 0) or 0)
                        realized = float(pos.get("realized_pnl", 0) or pos.get("realizedpnl", 0) or 0)
                        unrealized = float(pos.get("unrealized_pnl", 0) or pos.get("unrealizedpnl", 0) or 0)
                        dhan_positions.append({
                            "tradingSymbol": pos.get("symbol", ""),
                            "exchangeSegment": f"{pos.get('exchange', 'NSE')}_EQ" if pos.get("exchange") == "NSE" else pos.get("exchange", "NSE"),
                            "productType": "INTRADAY" if pos.get("product") == "MIS" else "CNC",
                            "positionType": "LONG" if qty > 0 else ("SHORT" if qty < 0 else "CLOSED"),
                            "netQty": qty,
                            "costPrice": avg_price,
                            "buyAvg": avg_price if qty >= 0 else 0,
                            "sellAvg": avg_price if qty < 0 else 0,
                            "realizedProfit": realized,
                            "unrealizedProfit": unrealized,
                            "buyQty": abs(qty) if qty >= 0 else 0,
                            "sellQty": abs(qty) if qty < 0 else 0,
                            "securityId": "12345"
                        })
                    return Response(content=json.dumps({"data": dhan_positions}), status_code=200, media_type="application/json")
            except Exception as e:
                print(f"[OPENALGO PROXY WARNING] positions fallback: {e}")
                
        elif path == "v2/orders":
            try:
                url = f"{OPENALGO_HOST}/api/v1/orderbook"
                resp = session.post(url, headers=oa_headers, json=oa_payload, timeout=5)
                if resp.status_code == 200:
                    orders = resp.json().get("data", {}).get("orders", [])
                    if not isinstance(orders, list):
                        orders = []
                    dhan_orders = []
                    for ord in orders:
                        qty = int(ord.get("quantity", 0))
                        price = float(ord.get("price", 0))
                        status = ord.get("status", "PENDING").upper()
                        dhan_status = "PENDING"
                        if status == "COMPLETE" or status == "FILLED":
                            dhan_status = "FILLED"
                        elif status == "REJECTED" or status == "REJECT":
                            dhan_status = "REJECTED"
                        elif status == "CANCELLED" or status == "CANCEL":
                            dhan_status = "CANCELLED"
                            
                        dhan_orders.append({
                            "orderId": ord.get("orderid", "0"),
                            "tradingSymbol": ord.get("symbol", ""),
                            "transactionType": ord.get("action", "BUY").upper(),
                            "quantity": qty,
                            "price": price,
                            "orderStatus": dhan_status,
                            "productType": "INTRADAY" if ord.get("product") == "MIS" else "CNC",
                            "exchangeSegment": f"{ord.get('exchange', 'NSE')}_EQ" if ord.get("exchange") == "NSE" else ord.get("exchange", "NSE"),
                            "orderType": ord.get("pricetype", "MARKET").upper(),
                            "orderTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        })
                    return Response(content=json.dumps({"data": dhan_orders}), status_code=200, media_type="application/json")
            except Exception as e:
                print(f"[OPENALGO PROXY WARNING] orders fallback: {e}")
                
        elif path == "v2/fundlimit":
            try:
                url = f"{OPENALGO_HOST}/api/v1/funds"
                resp = session.post(url, headers=oa_headers, json=oa_payload, timeout=5)
                if resp.status_code == 200:
                    funds_data = resp.json().get("data", {})
                    avail = float(funds_data.get("availablecash", 0) or funds_data.get("available", 0) or 10000000.0)
                    util = float(funds_data.get("utiliseddebits", 0) or 0)
                    dhan_funds = {
                        "availabelLimit": avail,
                        "utilizedLimit": util,
                        "sodLimit": avail + util
                    }
                    return Response(content=json.dumps({"data": dhan_funds}), status_code=200, media_type="application/json")
            except Exception as e:
                print(f"[OPENALGO PROXY WARNING] funds fallback: {e}")
                
        elif path == "v2/trades":
            try:
                url = f"{OPENALGO_HOST}/api/v1/tradebook"
                resp = session.post(url, headers=oa_headers, json=oa_payload, timeout=5)
                if resp.status_code == 200:
                    trades = resp.json().get("data", [])
                    if not isinstance(trades, list):
                        trades = []
                    dhan_trades = []
                    for t in trades:
                        qty = int(t.get("quantity", 0))
                        price = float(t.get("price", 0))
                        dhan_trades.append({
                            "orderId": t.get("orderid", "0"),
                            "tradeId": t.get("tradeid", t.get("orderid", "0")),
                            "tradingSymbol": t.get("symbol", ""),
                            "transactionType": t.get("action", "BUY").upper(),
                            "tradedQty": qty,
                            "avgTradedPrice": price,
                            "productType": "INTRADAY" if t.get("product") == "MIS" else "CNC",
                            "exchangeSegment": f"{t.get('exchange', 'NSE')}_EQ" if t.get("exchange") == "NSE" else t.get("exchange", "NSE")
                        })
                    return Response(content=json.dumps({"data": dhan_trades}), status_code=200, media_type="application/json")
            except Exception as e:
                print(f"[OPENALGO PROXY WARNING] trades fallback: {e}")

    # Legacy fallback: proxy directly to Dhan API
    def do_request():
        if method in ("POST", "PUT") and body:
            try:
                json_data = json.loads(body.decode("utf-8"))
                return dhan_client.request_with_retry(method, dhan_path, params=params, json=json_data)
            except Exception:
                return dhan_client.request_with_retry(method, dhan_path, params=params, data=body)
        else:
            return dhan_client.request_with_retry(method, dhan_path, params=params)
            
    try:
        loop = asyncio.get_running_loop()
        res = await loop.run_in_executor(None, do_request)
        return Response(content=res.content, status_code=res.status_code, media_type=res.headers.get("Content-Type"))
    except Exception as e:
        return Response(content=json.dumps({"error": str(e)}), status_code=500, media_type="application/json")
