"""
KILL SWITCH — Emergency halt for all algo positions.
This MUST be the first thing built and the last thing removed.
"""
import os
import requests
import tempfile

DHAN_CLIENT_ID = os.getenv("DHAN_CLIENT_ID")
DHAN_ACCESS_TOKEN = os.getenv("DHAN_ACCESS_TOKEN")
PAPER_TRADING = os.getenv("PAPER_TRADING", "true").lower() == "true"

# Cross-platform flag file (works on Windows and Linux)
HALT_FILE = os.path.join(tempfile.gettempdir(), "algo_halt.flag")

def cancel_all_orders():
    """Cancel every open order on Dhan immediately."""
    if not DHAN_CLIENT_ID or not DHAN_ACCESS_TOKEN:
        print("[KILL SWITCH WARNING] API credentials not loaded. Cannot cancel orders.")
        return 0

    headers = {
        "access-token": DHAN_ACCESS_TOKEN,
        "client-id": DHAN_CLIENT_ID,
        "Content-type": "application/json",
        "Accept": "application/json"
    }
    
    # Choose base URL based on environment
    base_url = "https://sandbox.dhan.co/v2" if PAPER_TRADING else "https://api.dhan.co/v2"
    
    try:
        # Get all open orders
        resp = requests.get(f"{base_url}/orders", headers=headers, timeout=10)
        if resp.status_code == 200:
            orders = resp.json() or []
            if isinstance(orders, dict) and "data" in orders:
                orders = orders["data"] or []
        else:
            orders = []
            print(f"[KILL SWITCH ERROR] Failed to fetch orders: HTTP {resp.status_code}")
    except Exception as e:
        orders = []
        print(f"[KILL SWITCH ERROR] Exception fetching orders: {e}")
        
    cancelled = 0
    for order in orders:
        if isinstance(order, dict) and order.get("orderStatus") in ["PENDING", "TRANSIT", "PART_FILLED"]:
            try:
                order_id = order.get("orderId")
                cancel_url = f"{base_url}/orders/{order_id}"
                del_resp = requests.delete(cancel_url, headers=headers, timeout=10)
                if del_resp.status_code == 200:
                    cancelled += 1
            except Exception as e:
                print(f"[KILL SWITCH ERROR] Exception cancelling order {order.get('orderId')}: {e}")
    
    print(f"[KILL SWITCH] Cancelled {cancelled} open orders.")
    return cancelled

def halt_engine():
    """Write a halt file — main.py checks this every second."""
    try:
        with open(HALT_FILE, "w") as f:
            f.write("HALT")
        print(f"[KILL SWITCH] Flag file written to {HALT_FILE}")
    except Exception as e:
        print(f"[KILL SWITCH ERROR] Failed to write flag file: {e}")
        
    cancel_all_orders()
    print("[KILL SWITCH] Engine halted. All orders cancelled.")

def is_halted():
    return os.path.exists(HALT_FILE)

def resume_engine():
    if os.path.exists(HALT_FILE):
        try:
            os.remove(HALT_FILE)
            print("[KILL SWITCH] Flag file removed.")
        except Exception as e:
            print(f"[KILL SWITCH ERROR] Failed to remove flag file: {e}")
    print("[KILL SWITCH] Engine resumed.")
