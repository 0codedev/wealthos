# python-bridge/scripts/backfill_trade_legs.py
# Backfill per-leg trade history from DhanHQ for an arbitrary date range.
# Writes one JSON file per trading day under data/trade_legs/YYYY-MM-DD.json.
# Resumable from checkpoint; zero-trade days exit fast.
#
# Usage:
#   python backfill_trade_legs.py --from 2026-01-01 --to 2026-06-18
#   python backfill_trade_legs.py --from 2026-01-01                # up to today
#   python backfill_trade_legs.py --from 2026-01-01 --rps 0.5       # 1 call / 2s
#   python backfill_trade_legs.py --from 2026-01-01 --dry-run       # just print
#
# Env (already supported by dhan_client.SecureCredentialStore):
#   dhan_client_id, dhan_access_token   → OS keychain via SecureCredentialStore
#   OR set DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN env vars.

import os
import sys
import json
import argparse
import logging
from datetime import date, datetime, timedelta
from pathlib import Path

# Add python-bridge root to path so we can reuse dhan_client.
THIS_DIR = Path(__file__).resolve().parent
BRIDGE_ROOT = THIS_DIR.parent
sys.path.insert(0, str(BRIDGE_ROOT))

import requests  # noqa: E402

from services.dhan_client import dhan_client  # noqa: E402
from scripts.rate_limiter import RateLimiter  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("backfill")

# Dhan trade-history endpoint
TRADE_HISTORY_PATH = "/v2/trades/{from_date}/{to_date}/{page}"
MAX_PAGES_PER_DAY = 6        # safety cap (matches frontend convention: 6 pages × 50 ≈ 300 legs/day)
PAGE_DETECT_MIN = 20         # if a page returns < 20 legs, assume no more pages
DATA_DIR = BRIDGE_ROOT / "data" / "trade_legs"
CHECKPOINT_PATH = DATA_DIR / "_checkpoint.json"


def daterange(start: date, end: date):
    """Yield each date from start..end inclusive (skipping weekends)."""
    cur = start
    while cur <= end:
        if cur.weekday() < 5:  # Mon-Fri only
            yield cur
        cur += timedelta(days=1)


def load_checkpoint() -> set[str]:
    if CHECKPOINT_PATH.exists():
        try:
            return set(json.loads(CHECKPOINT_PATH.read_text()).get("done", []))
        except Exception:
            log.warning("Could not parse checkpoint; starting fresh.")
    return set()


def save_checkpoint(done: set[str]) -> None:
    CHECKPOINT_PATH.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_PATH.write_text(json.dumps({"done": sorted(done)}, indent=2))


def fetch_day(trade_date: date, rl: RateLimiter, dry: bool) -> list[dict]:
    """Fetch all legs for one day. Returns [] on no trades."""
    iso = trade_date.isoformat()
    out: list[dict] = []
    for page in range(MAX_PAGES_PER_DAY):
        rl.acquire()
        path = TRADE_HISTORY_PATH.format(from_date=iso, to_date=iso, page=page)
        if dry:
            log.info(f"  [dry-run] would GET {path}")
            out.append({"_dry_page": page})
            continue
        try:
            res = dhan_client.request_with_retry("GET", path)
        except Exception as e:
            log.error(f"  request failed for {iso} page {page}: {e}")
            return out  # partial; will be re-attempted next run
        if res.status_code == 429:
            wait = rl.record_429(res.headers.get("Retry-After"))
            time.sleep(wait)
            rl.acquire()
            res = dhan_client.request_with_retry("GET", path)
        if res.status_code != 200:
            log.error(f"  HTTP {res.status_code} for {iso} page {page}: {res.text[:200]}")
            return out
        rl.record_2xx()
        try:
            payload = res.json()
        except Exception:
            log.error(f"  non-JSON response for {iso} page {page}")
            return out
        legs = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(legs, list) or len(legs) == 0:
            break  # no more pages, no trades
        out.extend(legs)
        if len(legs) < PAGE_DETECT_MIN:
            break  # last page
    return out


def write_day(trade_date: date, legs: list[dict], dry: bool) -> None:
    if dry:
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = DATA_DIR / f"{trade_date.isoformat()}.json"
    out.write_text(json.dumps({
        "date": trade_date.isoformat(),
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "leg_count": len(legs),
        "legs": legs,
    }, indent=2))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--from", dest="from_date", required=True, help="YYYY-MM-DD")
    p.add_argument("--to",   dest="to_date",   help="YYYY-MM-DD (default: today)")
    p.add_argument("--rps",  dest="rps", type=float, default=1.0, help="requests per second (default 1.0)")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-skip-weekends", action="store_true",
                   help="Don't auto-skip Sat/Sun (Dhan returns empty for these, but they're cheap)")
    p.add_argument("--reset", action="store_true", help="Wipe checkpoint + output before starting")
    args = p.parse_args()

    start = date.fromisoformat(args.from_date)
    end   = date.fromisoformat(args.to_date) if args.to_date else date.today()
    if end < start:
        log.error(f"--to {end} is before --from {start}")
        return 2

    if args.reset:
        for f in DATA_DIR.glob("*.json"):
            f.unlink()
        log.info("Reset: cleared data/trade_legs/")

    rl = RateLimiter(reqs_per_sec=max(args.rps, 0.05))
    done = load_checkpoint()
    total = 0
    skipped = 0
    days_planned = sum(1 for _ in daterange(start, end)) if not args.no_skip_weekends else (end - start).days + 1
    log.info(f"Backfill {start} → {end} ({days_planned} weekdays, rps={args.rps})")

    for trade_date in daterange(start, end):
        if not args.no_skip_weekends and trade_date.weekday() >= 5:
            continue
        iso = trade_date.isoformat()
        if iso in done:
            skipped += 1
            continue
        legs = fetch_day(trade_date, rl, args.dry_run)
        write_day(trade_date, legs, args.dry_run)
        if not args.dry_run:
            done.add(iso)
            save_checkpoint(done)
        log.info(f"  {iso}: {len(legs)} legs")
        total += len(legs)

    log.info(f"Done. {total} legs across {(days_planned - skipped)} new days "
             f"({skipped} resumed from checkpoint). Output: {DATA_DIR}")

    # Write _index.json so the browser + CLI can discover available days
    # without scanning the directory.
    if not args.dry_run:
        days = sorted(p.stem for p in DATA_DIR.glob("????-??-??.json") if len(p.stem) == 10)
        index_path = DATA_DIR / "_index.json"
        index_path.write_text(json.dumps({
            "days": days,
            "count": len(days),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }, indent=2))
        log.info(f"Index written: {index_path} ({len(days)} days)")

    return 0


if __name__ == "__main__":
    import time  # used inside fetch_day
    sys.exit(main())
