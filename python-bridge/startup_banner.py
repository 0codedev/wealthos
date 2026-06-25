from datetime import datetime

def print_banner(systems: dict):
    """
    systems = {
        "NSE Stealth Session": ("READY", True),
        "FastAPI / Uvicorn": ("http://127.0.0.1:8765", True),
        ...
    }
    """
    width = 62
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S IST")
    print(f"\n\033[36m╔{'═' * width}╗")
    print(f"║{'WEALTH DASHBOARD — Python Bridge v2':^{width}}║")
    print(f"║{'Started: ' + now:^{width}}║")
    print(f"╠{'═' * width}╣")
    for name, (status, ok) in systems.items():
        icon = "✅" if ok else "⏳" if status != "FAILED" else "❌"
        line = f"  {icon}  {name:<28} {status}"
        print(f"║{line:<{width}}║")
    print(f"╚{'═' * width}╝\033[0m\n")
