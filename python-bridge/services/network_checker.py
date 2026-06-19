import socket
import ssl
import urllib.request
import sys

def check_network():
    print("=" * 60)
    print(" WEALTHOS NETWORK DIAGNOSTIC & FIREWALL CHECK")
    print("=" * 60)

    # 1. SSL Interception / DPI Check
    print("[1/3] Testing SSL Certificate & Upstox API Reachability...")
    ssl_ok = False
    try:
        req = urllib.request.Request("https://api.upstox.com/v2/market/status/NSE", headers={"User-Agent": "Mozilla/5.0"})
        context = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=5, context=context) as resp:
            ssl_ok = True
            print("  [OK] SSL Native Verification: PASSED (Clean Connection)")
    except urllib.error.HTTPError as e:
        if e.code in (200, 401, 403, 400):
            ssl_ok = True
            print("  [OK] SSL Native Verification: PASSED (Clean Connection to Upstox)")
        else:
            print(f"  [WARN] HTTP Response Code: {e.code}")
    except ssl.SSLError as e:
        print(f"  [BLOCKED] SSL Interception Detected! Campus Firewall is inspecting SSL certs: {e}")
    except Exception as e:
        print(f"  [WARN] Network Reachability Issue: {e}")

    # 2. Telegram MTProto Check
    print("\n[2/3] Testing Telegram MTProto Firewall Bypass...")
    tg_ok = False
    try:
        s = socket.create_connection(("149.154.167.50", 443), timeout=3)
        s.close()
        tg_ok = True
        print("  [OK] Telegram MTProto Connection: PASSED (Port 443 open)")
    except Exception as e:
        print(f"  [BLOCKED] Telegram MTProto Blocked by Campus Firewall: {e}")

    # 3. Summary & Recommendation
    print("\n" + "=" * 60)
    if ssl_ok and tg_ok:
        print(" STATUS: CLEAN CONNECTION (Mobile Hotspot or Active WireGuard/SSH Proxy)")
        print(" All API endpoints, WebSockets, and Telegram streams will run at 100%.")
    elif not ssl_ok:
        print(" STATUS: CAMPUS WI-FI RESTRICTION ACTIVE")
        print(" Campus Wi-Fi is intercepting SSL & blocking trading APIs.")
        print(" SOLUTION: Turn on WireGuard VPN / SSH Proxy OR use Mobile Hotspot.")
    else:
        print(" STATUS: PARTIAL RESTRICTION ACTIVE")
    print("=" * 60)

if __name__ == "__main__":
    check_network()
