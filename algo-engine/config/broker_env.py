"""
Broker environment switcher.
Usage: python config/broker_env.py dhan_sandbox
"""
import shutil
import os
import sys

OPENALGO_DIR = r"C:\Users\gadda\Desktop\Projects\openalgo"
ENV_PROFILES = {
    "dhan_sandbox": ".env.dhan_sandbox",
    "dhan_live":    ".env.dhan_live",
    "upstox":       ".env.upstox",
}

def switch(profile: str):
    if profile not in ENV_PROFILES:
        raise ValueError(f"Unknown profile. Choose from: {list(ENV_PROFILES.keys())}")
    
    src = os.path.join(OPENALGO_DIR, ENV_PROFILES[profile])
    dst = os.path.join(OPENALGO_DIR, ".env")
    
    if not os.path.exists(src):
        raise FileNotFoundError(f"Profile file not found: {src}")
    
    shutil.copy2(src, dst)
    print(f"Switched to broker profile: {profile}")
    print(f"   Restart OpenAlgo for changes to take effect.")
    print(f"   -> cd {OPENALGO_DIR} && uv run app.py")

if __name__ == "__main__":
    profile = sys.argv[1] if len(sys.argv) > 1 else "dhan_sandbox"
    try:
        switch(profile)
    except Exception as e:
        print(f"Error switching profile: {e}")
        sys.exit(1)
