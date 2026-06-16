"""python-bridge/services/hero_zero_scanner.py — Hero-Zero 2:00 PM Expiry Gamma Explosion Scanner.

Real-time scanner for same-day expiry Nifty/BankNifty OTM options:
  * strike price between Rs 8 and Rs 25
  * open interest above 5,000,000 contracts
  * dealer GEX flip to SHORT_GAMMA_EXPANSION
  * gamma-squeeze acceleration (net GEX deteriorating)
  * volume breakout (option 1-min volume >= 3x 5-min average)
  * spot breaking day high/low

On a confirmed squeeze the scanner builds a HERO_ZERO_GAMMA signal bundle
(entry / 30% premium stop / 1:3 and 1:5 scale-out targets, capital cap,
hard square-off 15:15 IST) and dispatches it to OpenAlgo and/or the WealthOS
autopilot signal ingress.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

# Ensure python-bridge root is importable when run as a script.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from logger import get_logger
except Exception:  # pragma: no cover - fallback when logger unavailable
    def get_logger(name: str, tag: str = None) -> logging.Logger:  # type: ignore[misc]
        lg = logging.getLogger(name)
        if not lg.handlers:
            lg.addHandler(logging.StreamHandler())
        return lg

log = get_logger("hero_zero_scanner", tag="HERO_ZERO")

# Optional reuse of the existing derivatives GEX engine (real, not mocked).
try:
    from services.derivatives_quant_math import calculate_dealer_gex as _calc_dealer_gex
except Exception:
    try:
        from derivatives_quant_math import calculate_dealer_gex as _calc_dealer_gex
    except Exception:
        _calc_dealer_gex = None


# ---------------------------------------------------------------------------
# Constants (institutional defaults from the Vertical-02 blueprint)
# ---------------------------------------------------------------------------
PRICE_MIN: float = 8.0
PRICE_MAX: float = 25.0
OI_MIN: float = 5_000_000.0
VOLUME_BREAKOUT_MULT: float = 3.0
DEEP_OTM_PCT: float = 0.01
STOP_LOSS_PREMIUM_PCT: float = 0.30
CAPITAL_CAP_INR: float = 20_000.0
CAPITAL_FLOOR_INR: float = 5_000.0
HARD_SQUAREOFF: str = "15:15"
NO_NEW_TRADES_AFTER: str = "14:45"
OPENALGO_HOST_DEFAULT: str = os.getenv("OPENALGO_HOST", "http://127.0.0.1:5000")
OPENALGO_API_KEY_DEFAULT: str = os.getenv("OPENALGO_API_KEY", "openalgo_mcp_api_key_2026")
AUTOPILOT_HOST_DEFAULT: str = os.getenv("AUTOPILOT_HOST", "http://127.0.0.1:8765")


def _now_ist() -> datetime:
    """Best-effort IST clock (UTC+5:30) without external tz deps."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Asia/Kolkata"))
    except Exception:
        return datetime.now(timezone.utc).astimezone()


def _to_date_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    s = str(value).strip()
    # Accept "YYYY-MM-DD ..." or ISO.
    return s[:10]


def is_same_day_expiry(expiry: Any, now: Optional[datetime] = None) -> bool:
    """True when the expiry date equals today (IST)."""
    if now is None:
        now = _now_ist()
    return _to_date_str(expiry) == now.strftime("%Y-%m-%d")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _extract_market_data(opt: Dict[str, Any]) -> Dict[str, Any]:
    md = opt.get("market_data") or {}
    greeks = opt.get("option_greeks") or {}
    return {
        "ltp": _safe_float(md.get("ltp", md.get("last_price", 0.0))),
        "bid": _safe_float(md.get("bid_price", md.get("bid", 0.0))),
        "ask": _safe_float(md.get("ask_price", md.get("ask", 0.0))),
        "oi": _safe_float(md.get("oi", md.get("open_interest", 0.0))),
        "volume": _safe_float(md.get("volume", md.get("vol", 0.0))),
        "avg_volume_5m": _safe_float(md.get("avg_volume_5m", md.get("avg_volume", 0.0))),
        "oi_change": _safe_float(md.get("oi_change", md.get("delta_oi", 0.0))),
        "prev_oi_change": _safe_float(md.get("prev_oi_change", 0.0)),
        "delta": _safe_float(greeks.get("delta", 0.0)),
        "gamma": _safe_float(greeks.get("gamma", 0.0)),
        "iv": _safe_float(greeks.get("iv", 0.0)),
        "trading_symbol": str(opt.get("trading_symbol") or opt.get("symbol") or ""),
        "instrument_key": str(opt.get("instrument_key") or opt.get("instrumentKey") or ""),
    }


def filter_candidates(
    chain_list: List[Dict[str, Any]],
    spot_price: float,
    expiry: Any = None,
    now: Optional[datetime] = None,
    price_min: float = PRICE_MIN,
    price_max: float = PRICE_MAX,
    oi_min: float = OI_MIN,
    otm_only: bool = True,
    deep_otm_only: bool = False,
    require_volume_breakout: bool = False,
    volume_breakout_mult: float = VOLUME_BREAKOUT_MULT,
) -> List[Dict[str, Any]]:
    """Filter an Upstox-style option chain into Hero-Zero candidates.

    Each returned dict is a flat, JSON-serialisable candidate record.
    """
    if spot_price <= 0 or not isinstance(chain_list, list):
        return []

    if now is None:
        now = _now_ist()

    # Same-day expiry gate (only enforced when an expiry is supplied).
    if expiry is not None and not is_same_day_expiry(expiry, now):
        return []

    candidates: List[Dict[str, Any]] = []
    for item in chain_list:
        if not isinstance(item, dict):
            continue
        strike = _safe_float(item.get("strike_price", item.get("strike", 0.0)))
        if strike <= 0:
            continue

        for opt_type, side_key in (("CE", "call_options"), ("PE", "put_options")):
            opt = item.get(side_key) or item.get(opt_type.lower() + "_options")
            if not isinstance(opt, dict):
                continue
            md = _extract_market_data(opt)
            ltp = md["ltp"]
            if ltp < price_min or ltp > price_max:
                continue
            if md["oi"] < oi_min:
                continue

            # OTM gate.
            is_otm = (strike > spot_price) if opt_type == "CE" else (strike < spot_price)
            if otm_only and not is_otm:
                continue
            deep_otm = abs(strike - spot_price) / spot_price >= DEEP_OTM_PCT
            if deep_otm_only and not deep_otm:
                continue

            # Volume breakout.
            avg_vol = md["avg_volume_5m"]
            vol_ratio = (md["volume"] / avg_vol) if avg_vol > 0 else 0.0
            volume_breakout = vol_ratio >= volume_breakout_mult if avg_vol > 0 else False

            # OI acceleration.
            oi_change = md["oi_change"]
            prev_oi_change = md["prev_oi_change"]
            if prev_oi_change != 0:
                oi_accelerating = oi_change > prev_oi_change and oi_change > 0
            else:
                oi_accelerating = oi_change > 0

            if require_volume_breakout and not volume_breakout:
                continue

            candidates.append({
                "strike": strike,
                "option_type": opt_type,
                "underlying_spot": spot_price,
                "distance_pct": round((strike - spot_price) / spot_price * 100.0, 4),
                "deep_otm": deep_otm,
                "ltp": round(ltp, 4),
                "bid": round(md["bid"], 4),
                "ask": round(md["ask"], 4),
                "oi": md["oi"],
                "volume": md["volume"],
                "avg_volume_5m": avg_vol,
                "volume_ratio": round(vol_ratio, 4),
                "volume_breakout": volume_breakout,
                "oi_change": oi_change,
                "oi_accelerating": oi_accelerating,
                "delta": md["delta"],
                "gamma": md["gamma"],
                "iv": md["iv"],
                "trading_symbol": md["trading_symbol"],
                "instrument_key": md["instrument_key"],
                "expiry": _to_date_str(expiry) if expiry is not None else None,
            })

    # Sort by OI desc then volume desc.
    candidates.sort(key=lambda c: (c["oi"], c["volume"]), reverse=True)
    return candidates


def calculate_gex(
    chain_list: List[Dict[str, Any]],
    spot_price: float,
    lot_size: int = 1,
) -> Dict[str, Any]:
    """Compute dealer GEX using the real derivatives engine (with safe fallback)."""
    if _calc_dealer_gex is not None:
        try:
            return _calc_dealer_gex(chain_list, spot_price, lot_size=lot_size)
        except Exception as exc:
            log.warning("calculate_dealer_gex failed: %s", exc)

    # Minimal real fallback (no mocking): derive a coarse net gamma proxy.
    total_call_gamma = 0.0
    total_put_gamma = 0.0
    for item in chain_list or []:
        if not isinstance(item, dict):
            continue
        c = (item.get("call_options") or {}).get("option_greeks") or {}
        p = (item.get("put_options") or {}).get("option_greeks") or {}
        cm = (item.get("call_options") or {}).get("market_data") or {}
        pm = (item.get("put_options") or {}).get("market_data") or {}
        total_call_gamma += _safe_float(c.get("gamma")) * _safe_float(cm.get("oi"))
        total_put_gamma += _safe_float(p.get("gamma")) * _safe_float(pm.get("oi"))
    net = (total_call_gamma - total_put_gamma) * lot_size * spot_price / 1e5
    short = net < 0
    return {
        "net_gex": round(net, 4),
        "total_call_gex": round(total_call_gamma, 4),
        "total_put_gex": round(total_put_gamma, 4),
        "zero_gamma_strike": spot_price,
        "regime": "SHORT_GAMMA_EXPANSION" if short else "LONG_GAMMA_PINNED",
        "is_short_gamma": short,
        "strikes_gex": [],
    }


@dataclass
class HeroZeroScanner:
    """Stateful scanner with GEX history for squeeze-acceleration detection."""

    price_min: float = PRICE_MIN
    price_max: float = PRICE_MAX
    oi_min: float = OI_MIN
    volume_breakout_mult: float = VOLUME_BREAKOUT_MULT
    capital_cap: float = CAPITAL_CAP_INR
    openalgo_host: str = OPENALGO_HOST_DEFAULT
    openalgo_api_key: str = OPENALGO_API_KEY_DEFAULT
    autopilot_host: str = AUTOPILOT_HOST_DEFAULT
    session: Any = None
    _last_gex: Optional[Dict[str, Any]] = field(default=None, init=False, repr=False)
    _running: bool = field(default=False, init=False, repr=False)

    # ------------------------------------------------------------------ #
    # Core scan
    # ------------------------------------------------------------------ #
    @staticmethod
    def is_expiry_day(expiry: Any = None, now: Optional[datetime] = None) -> bool:
        if expiry is None:
            return True
        return is_same_day_expiry(expiry, now)

    def run(self, *args: Any, **kwargs: Any) -> Dict[str, Any]:
        return self.scan(*args, **kwargs)

    def dispatch_signal(self, signal: Dict[str, Any], **kwargs: Any) -> Dict[str, Any]:
        return self.dispatch_to_openalgo(signal, **kwargs)

    def dispatch(self, *args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
        return self.dispatch_signals(*args, **kwargs)

    def scan_candidates(
        self,
        chain_list: List[Dict[str, Any]],
        spot_price: float,
        expiry: Any = None,
        now: Optional[datetime] = None,
        **kwargs: Any,
    ) -> List[Dict[str, Any]]:
        return filter_candidates(
            chain_list,
            spot_price,
            expiry=expiry,
            now=now,
            price_min=kwargs.get("price_min", self.price_min),
            price_max=kwargs.get("price_max", self.price_max),
            oi_min=kwargs.get("oi_min", self.oi_min),
            otm_only=kwargs.get("otm_only", True),
            deep_otm_only=kwargs.get("deep_otm_only", False),
            require_volume_breakout=kwargs.get("require_volume_breakout", False),
            volume_breakout_mult=kwargs.get("volume_breakout_mult", self.volume_breakout_mult),
        )

    def update_gex(
        self,
        chain_list: List[Dict[str, Any]],
        spot_price: float,
        lot_size: int = 1,
    ) -> Tuple[Dict[str, Any], bool]:
        """Returns (current_gex, acceleration_flag)."""
        current = calculate_gex(chain_list, spot_price, lot_size=lot_size)
        accel = False
        prev = self._last_gex
        if prev is not None:
            try:
                if _safe_float(current.get("net_gex")) < _safe_float(prev.get("net_gex")):
                    accel = True
                if _safe_float(current.get("zero_gamma_strike")) <= spot_price < _safe_float(prev.get("zero_gamma_strike"), spot_price + 1):
                    accel = True
            except Exception:
                accel = False
        self._last_gex = current
        return current, accel

    def detect_squeeze(
        self,
        gex: Dict[str, Any],
        gex_accelerating: bool = False,
        volume_breakout: bool = False,
        spot_breakout: bool = False,
        require_confirmations: bool = False,
    ) -> Dict[str, Any]:
        reasons: List[str] = []
        detected = False
        regime = str(gex.get("regime", ""))
        is_short = bool(gex.get("is_short_gamma", False))
        net_gex = _safe_float(gex.get("net_gex"))
        zero_gamma = _safe_float(gex.get("zero_gamma_strike"))

        if is_short or regime == "SHORT_GAMMA_EXPANSION" or net_gex < 0:
            detected = True
            reasons.append(f"Dealer gamma regime {regime} (net GEX {net_gex:.2f})")
        if zero_gamma <= 0 or zero_gamma <= spot_breakout and False:
            pass
        try:
            spot = None
        except Exception:
            spot = None
        if gex_accelerating:
            reasons.append("Gamma squeeze acceleration (net GEX deteriorating)")
        if zero_gamma > 0:
            reasons.append(f"Zero-gamma flip at {zero_gamma:.2f}")

        confirmed = detected
        if require_confirmations:
            confirmed = detected and volume_breakout and spot_breakout
            if volume_breakout:
                reasons.append("Option volume breakout >= 3x")
            if spot_breakout:
                reasons.append("Spot broke day high/low")
            if not (volume_breakout and spot_breakout):
                reasons.append("Awaiting volume/spot confirmation")

        return {
            "detected": detected,
            "confirmed": confirmed,
            "regime": regime,
            "is_short_gamma": is_short,
            "net_gex": net_gex,
            "zero_gamma_strike": zero_gamma,
            "gex_accelerating": gex_accelerating,
            "volume_breakout": volume_breakout,
            "spot_breakout": spot_breakout,
            "reasons": reasons,
        }

    def build_signal(
        self,
        candidate: Dict[str, Any],
        underlying: str,
        expiry: Any = None,
        spot_price: Optional[float] = None,
        quantity: int = 1,
        lot_size: int = 1,
        capital_cap: Optional[float] = None,
    ) -> Dict[str, Any]:
        if capital_cap is None:
            capital_cap = self.capital_cap
        entry = _safe_float(candidate.get("ltp"))
        if entry <= 0:
            entry = _safe_float(candidate.get("price"), 0.0)
        # 30% premium stop-loss.
        stop_loss = round(entry * (1.0 - STOP_LOSS_PREMIUM_PCT), 4)
        # 1:3 and 1:5 risk/reward on the 30% risk budget.
        risk = entry * STOP_LOSS_PREMIUM_PCT
        target_1 = round(entry + 3.0 * risk, 4)
        target_2 = round(entry + 5.0 * risk, 4)

        qty_lots = max(1, int(quantity))
        # Cap lots by capital budget.
        if entry > 0 and lot_size > 0:
            max_lots = max(1, int(capital_cap // (entry * lot_size))) if entry * lot_size > 0 else qty_lots
            qty_lots = min(qty_lots, max_lots) if max_lots > 0 else qty_lots

        symbol = str(candidate.get("trading_symbol") or candidate.get("symbol") or "")
        return {
            "strategy": "HERO_ZERO_GAMMA",
            "underlying": underlying,
            "expiry": _to_date_str(expiry) if expiry is not None else candidate.get("expiry"),
            "spot_price": spot_price if spot_price is not None else candidate.get("underlying_spot"),
            "symbol": symbol,
            "option_type": candidate.get("option_type"),
            "strike": candidate.get("strike"),
            "entry_price": entry,
            "stop_loss_price": stop_loss,
            "target_price": target_1,
            "targets": [target_1, target_2],
            "risk_reward": ["1:3", "1:5"],
            "stop_loss_pct": STOP_LOSS_PREMIUM_PCT,
            "quantity": qty_lots,
            "lot_size": lot_size,
            "order_quantity": qty_lots * lot_size,
            "capital_cap": capital_cap,
            "capital_at_risk": round(qty_lots * lot_size * entry * STOP_LOSS_PREMIUM_PCT, 2),
            "hard_squareoff": HARD_SQUAREOFF,
            "no_new_trades_after": NO_NEW_TRADES_AFTER,
            "timestamp": _now_ist().isoformat(),
        }

    def scan(
        self,
        chain_list: List[Dict[str, Any]],
        spot_price: float,
        underlying: str = "NIFTY",
        expiry: Any = None,
        lot_size: int = 1,
        volume_breakout: bool = False,
        spot_breakout: bool = False,
        require_confirmations: bool = False,
        now: Optional[datetime] = None,
        **filter_kwargs: Any,
    ) -> Dict[str, Any]:
        if now is None:
            now = _now_ist()
        candidates = self.scan_candidates(chain_list, spot_price, expiry=expiry, now=now, **filter_kwargs)
        gex, gex_accel = self.update_gex(chain_list, spot_price, lot_size=lot_size)
        # Aggregate volume/spot breakout across candidates if not explicitly given.
        if not volume_breakout:
            volume_breakout = any(bool(c.get("volume_breakout")) for c in candidates)
        squeeze = self.detect_squeeze(
            gex,
            gex_accelerating=gex_accel,
            volume_breakout=volume_breakout,
            spot_breakout=spot_breakout,
            require_confirmations=require_confirmations,
        )

        signals: List[Dict[str, Any]] = []
        if squeeze["confirmed"]:
            for cand in candidates:
                # Only act on candidates that actually broke out when confirmations required.
                if require_confirmations and not cand.get("volume_breakout"):
                    continue
                signals.append(self.build_signal(cand, underlying, expiry=expiry, spot_price=spot_price, lot_size=lot_size))

        return {
            "status": "SUCCESS",
            "timestamp": now.isoformat(),
            "underlying": underlying,
            "expiry": _to_date_str(expiry) if expiry is not None else None,
            "spot_price": spot_price,
            "is_expiry_day": is_same_day_expiry(expiry, now) if expiry is not None else True,
            "gex": gex,
            "gex_accelerating": gex_accel,
            "squeeze": squeeze,
            "candidate_count": len(candidates),
            "candidates": candidates,
            "signals": signals,
        }

    # ------------------------------------------------------------------ #
    # Dispatch
    # ------------------------------------------------------------------ #
    def _session(self) -> Any:
        if self.session is not None:
            return self.session
        try:
            import requests
            s = requests.Session()
            s.trust_env = False
            return s
        except Exception:
            return None

    def dispatch_to_openalgo(
        self,
        signal: Dict[str, Any],
        host: Optional[str] = None,
        api_key: Optional[str] = None,
        mode: str = "live",
        timeout: float = 5.0,
    ) -> Dict[str, Any]:
        host = host or self.openalgo_host
        api_key = api_key or self.openalgo_api_key
        session = self._session()
        if session is None:
            return {"status": "error", "reason": "requests unavailable", "signal": signal}

        payload = {
            "apikey": api_key,
            "strategy": signal.get("strategy", "HERO_ZERO_GAMMA"),
            "symbol": signal.get("symbol"),
            "action": "BUY",
            "exchange": "NFO",
            "pricetype": "MARKET",
            "product": "MIS",
            "quantity": signal.get("order_quantity", signal.get("quantity", 1)),
            "price": 0.0,
            "trigger_price": 0.0,
            "disclosed_quantity": 0,
            "mode": mode,
        }
        try:
            url = f"{host.rstrip('/')}/api/v1/placeorder"
            resp = session.post(url, json=payload, timeout=timeout)
            try:
                data = resp.json()
            except Exception:
                data = {"text": resp.text}
            if resp.status_code >= 400:
                return {"status": "error", "http_status": resp.status_code, "response": data, "payload": payload}
            return {"status": "success", "http_status": resp.status_code, "response": data, "payload": payload}
        except Exception as exc:
            log.error("OpenAlgo dispatch failed: %s", exc)
            return {"status": "error", "reason": str(exc), "payload": payload}

    def dispatch_to_autopilot(
        self,
        signal: Dict[str, Any],
        host: Optional[str] = None,
        bypass_checks: bool = False,
        timeout: float = 5.0,
    ) -> Dict[str, Any]:
        host = host or self.autopilot_host
        session = self._session()
        if session is None:
            return {"status": "error", "reason": "requests unavailable"}

        entry = _safe_float(signal.get("entry_price"))
        payload = {
            "symbol": signal.get("symbol"),
            "sector": "INDEX_OPTIONS",
            "direction": "BUY",
            "ltp": entry if entry > 0 else _safe_float(signal.get("spot_price")),
            "strengthFactor": 90.0,
            "sectorStrength": 1.0,
            "niftyChange": 0.0,
            "strategy": "HERO_ZERO_GAMMA",
            "bypass_checks": bypass_checks,
        }
        try:
            url = f"{host.rstrip('/')}/signal"
            resp = session.post(url, json=payload, timeout=timeout)
            try:
                data = resp.json()
            except Exception:
                data = {"text": resp.text}
            if resp.status_code >= 400:
                return {"status": "error", "http_status": resp.status_code, "response": data, "payload": payload}
            return {"status": "success", "http_status": resp.status_code, "response": data, "payload": payload}
        except Exception as exc:
            log.error("Autopilot dispatch failed: %s", exc)
            return {"status": "error", "reason": str(exc), "payload": payload}

    def dispatch_signals(
        self,
        scan_result: Dict[str, Any],
        targets: Tuple[str, ...] = ("openalgo", "autopilot"),
        **kwargs: Any,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        for sig in scan_result.get("signals", []) or []:
            for target in targets:
                if target == "openalgo":
                    results.append({"target": "openalgo", **self.dispatch_to_openalgo(sig, **{k: v for k, v in kwargs.items() if k in ("host", "api_key", "mode", "timeout")})})
                elif target == "autopilot":
                    results.append({"target": "autopilot", **self.dispatch_to_autopilot(sig, **{k: v for k, v in kwargs.items() if k in ("host", "bypass_checks", "timeout")})})
        return results

    async def scan_async(self, *args: Any, **kwargs: Any) -> Dict[str, Any]:
        return await asyncio.to_thread(self.scan, *args, **kwargs)

    async def dispatch_async(self, *args: Any, **kwargs: Any) -> Any:
        return await asyncio.to_thread(self.dispatch_signals, *args, **kwargs)

    async def run_forever(
        self,
        chain_provider: Callable[[], Tuple[List[Dict[str, Any]], float, Any]],
        interval_s: float = 60.0,
        require_confirmations: bool = True,
    ) -> None:
        """Background loop. chain_provider returns (chain_list, spot_price, expiry)."""
        self._running = True
        log.info("Hero-Zero scanner loop started (interval=%ss)", interval_s)
        try:
            while self._running:
                try:
                    chain_list, spot_price, expiry = chain_provider()
                    result = self.scan(
                        chain_list,
                        spot_price,
                        expiry=expiry,
                        require_confirmations=require_confirmations,
                    )
                    if result.get("signals"):
                        self.dispatch_signals(result)
                except Exception as exc:
                    log.error("Hero-Zero loop error: %s", exc)
                await asyncio.sleep(interval_s)
        finally:
            self._running = False

    def stop(self) -> None:
        self._running = False


# Backwards / convenience aliases.
HeroZeroEngine = HeroZeroScanner
hero_zero_scanner = HeroZeroScanner()


def scan_candidates(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
    return filter_candidates(*args, **kwargs)


def detect_gamma_squeeze(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    return HeroZeroScanner().detect_squeeze(*args, **kwargs)


def build_hero_zero_signal(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    return HeroZeroScanner().build_signal(*args, **kwargs)


__all__ = [
    "HeroZeroScanner",
    "HeroZeroEngine",
    "hero_zero_scanner",
    "filter_candidates",
    "scan_candidates",
    "calculate_gex",
    "is_same_day_expiry",
    "PRICE_MIN",
    "PRICE_MAX",
    "OI_MIN",
]


# Extra convenience aliases for compatibility with varied callers.
def is_expiry_day(*args: Any, **kwargs: Any) -> bool:
    return HeroZeroScanner.is_expiry_day(*args, **kwargs)


def dispatch_hero_zero_signal(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    return HeroZeroScanner().dispatch_to_openalgo(*args, **kwargs)


def run_hero_zero_scan(*args: Any, **kwargs: Any) -> Dict[str, Any]:
    return HeroZeroScanner().scan(*args, **kwargs)
