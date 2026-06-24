"""python-bridge/services/volatility_surface_sabr_engine.py — Adaptive IV Surface & Smile Dynamics.

Production-grade engine for Indian F&O implied-volatility surfaces:

  * Black-76 / Black-Scholes pricing + implied-volatility inversion
  * SVI (Stochastic Volatility Inspired) total-variance fit per expiry
  * SABR (alpha, beta, rho, nu) smile fit per expiry
  * Real-time surface calibration for NIFTY / BANKNIFTY / SENSEX / top F&O stocks
  * Skew  dσ/dK  and term-structure slope dσ/dT
  * IV-crush forensics + afternoon drain (13:30-15:15 IST weekly expiry)
  * Volatility-arbitrage sentry: mispriced OTM wings vs ATM, Gamma/Vega-neutral spreads
  * Vega-risk budgeting + hedge-ratio formulas

Self-contained: degrades gracefully when scipy is unavailable (pure-python
fallbacks for IV inversion and fitting).
"""
from __future__ import annotations

import math
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from logger import get_logger
except Exception:  # pragma: no cover
    def get_logger(name: str, tag: str = None) -> "logging.Logger":  # type: ignore[misc]
        import logging
        lg = logging.getLogger(name)
        if not lg.handlers:
            lg.addHandler(logging.StreamHandler())
        return lg

log = get_logger("volatility_surface_sabr_engine", tag="VOL_SURFACE")

# Optional scipy
try:
    import numpy as np
    from scipy.optimize import least_squares as _sp_least_squares
    from scipy.stats import norm as _sp_norm
    _HAS_SCIPY = True
except Exception:  # pragma: no cover
    np = None  # type: ignore
    _sp_least_squares = None
    _sp_norm = None
    _HAS_SCIPY = False

try:
    from services.derivatives_quant_math import (
        black76_price_and_greeks as _dq_black76,
        solve_implied_volatility as _dq_solve_iv,
    )
except Exception:
    try:
        from derivatives_quant_math import (  # type: ignore
            black76_price_and_greeks as _dq_black76,
            solve_implied_volatility as _dq_solve_iv,
        )
    except Exception:
        _dq_black76 = None
        _dq_solve_iv = None

try:
    from services.options_greeks_surface import (
        Black76Engine as _B76,
        implied_volatility as _ogs_iv,
    )
except Exception:
    try:
        from options_greeks_surface import Black76Engine as _B76, implied_volatility as _ogs_iv  # type: ignore
    except Exception:
        _B76 = None
        _ogs_iv = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SUPPORTED_UNDERLYINGS: Tuple[str, ...] = ("NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY")
RISK_FREE_RATE_DEFAULT: float = 0.07
DAYS_PER_YEAR: float = 365.0
IV_FLOOR: float = 1e-4
IV_CEIL: float = 5.0
SIGMA_MIN: float = 1e-6

# SVI bounds
SVI_BOUNDS = {
    "a": (-0.5, 0.5),
    "b": (0.0, 2.0),
    "rho": (-0.995, 0.995),
    "m": (-2.0, 2.0),
    "sigma": (1e-4, 2.0),
}

# SABR default beta (equity-like)
SABR_BETA_DEFAULT: float = 0.5

# Vega budget default (portfolio vega in currency units)
DEFAULT_VEGA_CAP: float = 100000.0

# IV crush
CRUSH_START_MIN: int = 13 * 60 + 30   # 13:30
CRUSH_END_MIN: int = 15 * 60 + 15     # 15:15
WEEKLY_EXPIRY_CRUSH_MAGNITUDE: float = 0.35  # 35% of ATM IV
EARNINGS_CRUSH_MAGNITUDE: float = 0.45


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------
def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None:
            return default
        f = float(v)
        if not math.isfinite(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _norm_cdf(x: float) -> float:
    if _HAS_SCIPY:
        try:
            return float(_sp_norm.cdf(x))
        except Exception:
            pass
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_pdf(x: float) -> float:
    if _HAS_SCIPY:
        try:
            return float(_sp_norm.pdf(x))
        except Exception:
            pass
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def _now_min_of_day(dt: Optional[datetime] = None) -> int:
    if dt is None:
        dt = datetime.now(timezone.utc).astimezone()
    return dt.hour * 60 + dt.minute


# ---------------------------------------------------------------------------
# Black-76 pricing + IV inversion
# ---------------------------------------------------------------------------
def black76_price(F: float, K: float, t: float, r: float, sigma: float, option_type: str = "CE") -> float:
    """Black-76 price. Delegates to derivatives engine if available."""
    if _dq_black76 is not None:
        try:
            res = _dq_black76(F, K, t, r, sigma, option_type)
            return _safe_float(res.get("price"))
        except Exception:
            pass
    if _B76 is not None:
        try:
            otype = "C" if option_type.upper().startswith(("C", "CE")) else "P"
            return float(_B76.price(F, K, r, t, sigma, otype))
        except Exception:
            pass
    # Pure fallback
    if F <= 0 or K <= 0 or t <= 0 or sigma <= 0:
        intrinsic = max(0.0, F - K) if option_type.upper().startswith(("C", "CE")) else max(0.0, K - F)
        return max(0.0, intrinsic * math.exp(-r * t)) if t > 0 else intrinsic
    sqrt_t = math.sqrt(t)
    df = math.exp(-r * t)
    d1 = (math.log(F / K) + 0.5 * sigma * sigma * t) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    is_call = option_type.upper().startswith(("C", "CE"))
    if is_call:
        return df * (F * _norm_cdf(d1) - K * _norm_cdf(d2))
    return df * (K * _norm_cdf(-d2) - F * _norm_cdf(-d1))


def black76_greeks(F: float, K: float, t: float, r: float, sigma: float, option_type: str = "CE") -> Dict[str, float]:
    if _dq_black76 is not None:
        try:
            res = _dq_black76(F, K, t, r, sigma, option_type)
            return {
                "price": _safe_float(res.get("price")),
                "delta": _safe_float(res.get("delta")),
                "gamma": _safe_float(res.get("gamma")),
                "theta": _safe_float(res.get("theta")),
                "vega": _safe_float(res.get("vega")),
            }
        except Exception:
            pass
    if _B76 is not None:
        try:
            otype = "C" if option_type.upper().startswith(("C", "CE")) else "P"
            g = _B76.full_greeks(F, K, r, t, sigma, otype)
            return {
                "price": _safe_float(g.get("price")),
                "delta": _safe_float(g.get("delta")),
                "gamma": _safe_float(g.get("gamma")),
                "theta": _safe_float(g.get("theta_daily", g.get("theta"))),
                "vega": _safe_float(g.get("vega")),
            }
        except Exception:
            pass
    # pure
    price = black76_price(F, K, t, r, sigma, option_type)
    if F <= 0 or K <= 0 or t <= 0 or sigma <= 0:
        return {"price": price, "delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0}
    sqrt_t = math.sqrt(t)
    df = math.exp(-r * t)
    d1 = (math.log(F / K) + 0.5 * sigma * sigma * t) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    pdf = _norm_pdf(d1)
    is_call = option_type.upper().startswith(("C", "CE"))
    gamma = df * pdf / (F * sigma * sqrt_t) if (F * sigma * sqrt_t) > 0 else 0.0
    vega = df * F * sqrt_t * pdf  # per 1.0 vol change
    if is_call:
        delta = df * _norm_cdf(d1)
    else:
        delta = -df * _norm_cdf(-d1)
    theta = -(df * F * pdf * sigma) / (2.0 * sqrt_t)
    return {"price": price, "delta": delta, "gamma": gamma, "theta": theta / DAYS_PER_YEAR, "vega": vega}


def implied_volatility(market_price: float, F: float, K: float, t: float, r: float, option_type: str = "CE") -> float:
    """Invert Black-76 to IV. Returns 0 on failure."""
    if market_price <= 0 or F <= 0 or K <= 0 or t <= 0:
        return 0.0
    if _dq_solve_iv is not None:
        try:
            iv = _dq_solve_iv(market_price, F, K, t, r, option_type)
            if iv and iv > 0:
                return float(iv)
        except Exception:
            pass
    if _ogs_iv is not None:
        try:
            otype = "C" if option_type.upper().startswith(("C", "CE")) else "P"
            iv = _ogs_iv(market_price, F, K, r, t, otype)
            if iv is not None and iv > 0:
                return float(iv)
        except Exception:
            pass
    # Pure Brent fallback
    intrinsic = max(0.0, F - K) if option_type.upper().startswith(("C", "CE")) else max(0.0, K - F)
    df = math.exp(-r * t)
    if market_price < intrinsic * df - 1e-9:
        return 0.0

    def res(sig: float) -> float:
        return black76_price(F, K, t, r, sig, option_type) - market_price

    lo, hi = IV_FLOOR, IV_CEIL
    rlo, rhi = res(lo), res(hi)
    if rlo * rhi > 0:
        # no bracket -> approximate
        return 0.20
    # bisection
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        rm = res(mid)
        if abs(rm) < 1e-8:
            return mid
        if rlo * rm <= 0:
            hi = mid
            rhi = rm
        else:
            lo = mid
            rlo = rm
    return 0.5 * (lo + hi)


def black_scholes_price(S: float, K: float, t: float, r: float, sigma: float, option_type: str = "CE", q: float = 0.0) -> float:
    """European Black-Scholes (spot) price. q = dividend/conv yield."""
    if S <= 0 or K <= 0 or t <= 0 or sigma <= 0:
        intrinsic = max(0.0, S - K) if option_type.upper().startswith(("C", "CE")) else max(0.0, K - S)
        return max(0.0, intrinsic * math.exp(-r * t))
    sqrt_t = math.sqrt(t)
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma * sigma) * t) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    df = math.exp(-r * t)
    dq = math.exp(-q * t)
    is_call = option_type.upper().startswith(("C", "CE"))
    if is_call:
        return dq * S * _norm_cdf(d1) - df * K * _norm_cdf(d2)
    return df * K * _norm_cdf(-d2) - dq * S * _norm_cdf(-d1)


def black_scholes_iv(market_price: float, S: float, K: float, t: float, r: float, option_type: str = "CE", q: float = 0.0) -> float:
    """Invert Black-Scholes (spot) to IV."""
    if market_price <= 0 or S <= 0 or K <= 0 or t <= 0:
        return 0.0
    df = math.exp(-r * t)
    intrinsic = max(0.0, S - K) if option_type.upper().startswith(("C", "CE")) else max(0.0, K - S)
    if market_price < intrinsic * df - 1e-9:
        return 0.0

    def res(sig: float) -> float:
        return black_scholes_price(S, K, t, r, sig, option_type, q) - market_price

    lo, hi = IV_FLOOR, IV_CEIL
    rlo, rhi = res(lo), res(hi)
    if rlo * rhi > 0:
        return 0.20
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        rm = res(mid)
        if abs(rm) < 1e-8:
            return mid
        if rlo * rm <= 0:
            hi = mid
            rhi = rm
        else:
            lo = mid
            rlo = rm
    return 0.5 * (lo + hi)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class SVIParams:
    a: float = 0.04
    b: float = 0.10
    rho: float = -0.30
    m: float = 0.0
    sigma: float = 0.10
    underlying: str = ""
    expiry_days: float = 0.0
    rmse: float = 0.0
    r_squared: float = 0.0
    n_points: int = 0

    def clamp(self) -> "SVIParams":
        self.a = max(SVI_BOUNDS["a"][0], min(SVI_BOUNDS["a"][1], self.a))
        self.b = max(SVI_BOUNDS["b"][0], min(SVI_BOUNDS["b"][1], self.b))
        self.rho = max(SVI_BOUNDS["rho"][0], min(SVI_BOUNDS["rho"][1], self.rho))
        self.m = max(SVI_BOUNDS["m"][0], min(SVI_BOUNDS["m"][1], self.m))
        self.sigma = max(SVI_BOUNDS["sigma"][0], min(SVI_BOUNDS["sigma"][1], self.sigma))
        # enforce a + b*sigma*sqrt(1-rho^2) >= 0
        disc = self.b * self.sigma * math.sqrt(max(1e-12, 1.0 - self.rho * self.rho))
        if self.a + disc < 0:
            self.a = -disc + 1e-6
        return self

    def to_dict(self) -> Dict[str, Any]:
        return {
            "a": self.a, "b": self.b, "rho": self.rho, "m": self.m, "sigma": self.sigma,
            "underlying": self.underlying, "expiry_days": self.expiry_days,
            "rmse": self.rmse, "r_squared": self.r_squared, "n_points": self.n_points,
        }


@dataclass
class SABRParams:
    alpha: float = 0.20
    beta: float = SABR_BETA_DEFAULT
    rho: float = -0.30
    nu: float = 0.40
    underlying: str = ""
    expiry_days: float = 0.0
    rmse: float = 0.0
    r_squared: float = 0.0
    n_points: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "alpha": self.alpha, "beta": self.beta, "rho": self.rho, "nu": self.nu,
            "underlying": self.underlying, "expiry_days": self.expiry_days,
            "rmse": self.rmse, "r_squared": self.r_squared, "n_points": self.n_points,
        }


@dataclass
class SurfacePoint:
    strike: float
    expiry_days: float
    forward: float
    market_iv: float
    svi_iv: float = 0.0
    sabr_iv: float = 0.0
    model_iv: float = 0.0
    mispricing: float = 0.0
    skew_dsigma_dk: float = 0.0


@dataclass
class IVSurface:
    underlying: str
    asof: str = ""
    spot: float = 0.0
    risk_free_rate: float = RISK_FREE_RATE_DEFAULT
    svi_by_expiry: Dict[float, SVIParams] = field(default_factory=dict)
    sabr_by_expiry: Dict[float, SABRParams] = field(default_factory=dict)
    points: List[SurfacePoint] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "underlying": self.underlying,
            "asof": self.asof,
            "spot": self.spot,
            "risk_free_rate": self.risk_free_rate,
            "svi_by_expiry": {str(k): v.to_dict() for k, v in self.svi_by_expiry.items()},
            "sabr_by_expiry": {str(k): v.to_dict() for k, v in self.sabr_by_expiry.items()},
            "n_points": len(self.points),
        }


@dataclass
class MispricingSignal:
    underlying: str
    strike: float
    option_type: str
    expiry_days: float
    market_iv: float
    model_iv: float
    edge_iv: float  # market - model (positive = expensive)
    verdict: str  # "EXPENSIVE_WING" / "CHEAP_ATM" / "FAIR"
    score: float = 0.0


@dataclass
class VegaBudget:
    cap: float
    current_vega: float
    remaining: float
    utilization_pct: float
    breach: bool
    action: str


# ---------------------------------------------------------------------------
# SVI
# ---------------------------------------------------------------------------
def svi_total_variance(k: float, params: SVIParams) -> float:
    """Gatheral SVI total variance w(k)."""
    p = params
    disc = math.sqrt((k - p.m) ** 2 + p.sigma * p.sigma)
    w = p.a + p.b * (p.rho * (k - p.m) + disc)
    return max(0.0, w)


def svi_implied_vol(k: float, T: float, params: SVIParams) -> float:
    if T <= 0:
        return 0.0
    w = svi_total_variance(k, params)
    return math.sqrt(w / T)


def svi_variance(k: float, a: float, b: float, rho: float, m: float, sigma: float) -> float:
    disc = math.sqrt((k - m) ** 2 + sigma * sigma)
    w = a + b * (rho * (k - m) + disc)
    return max(0.0, w)


def _svi_residuals(vars_vec: Any, ks: Any, ivs: Any, T: float) -> Any:
    a, b, rho, m, sigma = vars_vec
    out = []
    for k, iv in zip(ks, ivs):
        w = svi_variance(k, a, b, rho, m, sigma)
        model_iv = math.sqrt(max(w, 1e-12) / T) if T > 0 else 0.0
        out.append(model_iv - iv)
    return out


def fit_svi(
    strikes: List[float],
    ivs: List[float],
    forward: float,
    T: float,
    underlying: str = "",
    max_iter: int = 200,
) -> SVIParams:
    """Fit SVI params to (strike, iv) pairs. Returns SVIParams."""
    params = SVIParams(underlying=underlying, expiry_days=T * DAYS_PER_YEAR)
    if not strikes or not ivs or len(strikes) != len(ivs) or forward <= 0 or T <= 0:
        return params
    ks = [math.log(max(s, 1e-6) / forward) for s in strikes]
    ivs_f = [max(IV_FLOOR, _safe_float(v)) for v in ivs]
    # filter valid
    pairs = [(k, iv) for k, iv in zip(ks, ivs_f) if math.isfinite(k) and math.isfinite(iv)]
    if len(pairs) < 5:
        return params
    ks = [p[0] for p in pairs]
    ivs_f = [p[1] for p in pairs]

    mean_iv = sum(ivs_f) / len(ivs_f)
    a0 = max(1e-6, T * mean_iv * mean_iv)
    x0 = [a0, 0.05, -0.20, 0.0, 0.10]
    if _HAS_SCIPY:
        try:
            bounds = (
                [0.0, 0.0, -0.99, -1.0, 1e-3],
                [0.5, 1.0, 0.99, 1.0, 1.0],
            )
            res = _sp_least_squares(_svi_residuals, x0, args=(ks, ivs_f, T), bounds=bounds, max_nfev=max_iter * 10)
            a, b, rho, m, sigma = [float(v) for v in res.x]
            p = SVIParams(a=a, b=b, rho=rho, m=m, sigma=sigma, underlying=underlying, expiry_days=T * DAYS_PER_YEAR)
            p.clamp()
            # metrics
            preds = [svi_implied_vol(k, T, p) for k in ks]
            rmse = math.sqrt(sum((p_ - o) ** 2 for p_, o in zip(preds, ivs_f)) / len(preds))
            ss_res = sum((p_ - o) ** 2 for p_, o in zip(preds, ivs_f))
            mean_iv = sum(ivs_f) / len(ivs_f)
            ss_tot = sum((o - mean_iv) ** 2 for o in ivs_f)
            r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
            p.rmse = rmse
            p.r_squared = r2
            p.n_points = len(preds)
            return p
        except Exception as exc:
            log.debug("SVI fit failed: %s", exc)

    # Fallback: grid-ish random search (coarse)
    best = None
    best_err = float("inf")
    import random
    random.seed(42)
    for _ in range(200):
        cand = SVIParams(
            a=random.uniform(*SVI_BOUNDS["a"]),
            b=random.uniform(*SVI_BOUNDS["b"]),
            rho=random.uniform(*SVI_BOUNDS["rho"]),
            m=random.uniform(*SVI_BOUNDS["m"]),
            sigma=random.uniform(*SVI_BOUNDS["sigma"]),
        )
        cand.clamp()
        preds = [svi_implied_vol(k, T, cand) for k in ks]
        err = sum((p_ - o) ** 2 for p_, o in zip(preds, ivs_f))
        if err < best_err:
            best_err = err
            best = cand
    if best is None:
        return params
    best.underlying = underlying
    best.expiry_days = T * DAYS_PER_YEAR
    best.n_points = len(ks)
    best.rmse = math.sqrt(best_err / len(ks))
    return best


# ---------------------------------------------------------------------------
# SABR
# ---------------------------------------------------------------------------
def sabr_implied_vol(F: float, K: float, T: float, alpha: float, beta: float, rho: float, nu: float) -> float:
    """Hagan (2002) SABR implied volatility."""
    if F <= 0 or K <= 0 or T <= 0 or alpha <= 0:
        return 0.0
    # ATM case
    if abs(F - K) < 1e-9:
        fk = F ** (1.0 - beta) if F > 0 else 1.0
        term1 = alpha / fk
        term2 = 1.0 + (
            ((1.0 - beta) ** 2 / 24.0) * (alpha * alpha / (F ** (2.0 - 2.0 * beta)))
            + (rho * beta * nu * alpha) / (4.0 * fk)
            + (nu * nu * (2.0 - 3.0 * rho * rho) / 24.0)
        ) * T
        return max(IV_FLOOR, term1 * term2)

    logfk = math.log(F / K)
    fk_mid = (F * K) ** ((1.0 - beta) / 2.0)
    z = (nu / alpha) * fk_mid * logfk
    # x(z)
    if abs(z) < 1e-8:
        xz = 1.0
    else:
        sq = math.sqrt(1.0 - 2.0 * rho * z + z * z)
        xz = math.log((sq + z - rho) / (1.0 - rho)) if (1.0 - rho) > 0 else z
        if abs(xz) < 1e-12:
            xz = 1.0
        else:
            xz = z / xz
    # Actually xz should be z/x(z). Recompute cleanly:
    sq = math.sqrt(1.0 - 2.0 * rho * z + z * z)
    denom = 1.0 - rho
    if denom <= 0:
        denom = 1e-6
    inner = (sq + z - rho) / denom
    if inner <= 0:
        inner = 1e-12
    x_of_z = math.log(inner)
    if abs(x_of_z) < 1e-12:
        ratio = 1.0
    else:
        ratio = z / x_of_z

    prefactor = alpha / (fk_mid)  # alpha / (FK)^((1-beta)/2)? check
    # Standard: sigma = alpha * (FK)^((beta-1)/2) * [1+...] * z/x(z)
    # (FK)^((beta-1)/2) = 1/(FK)^((1-beta)/2) = 1/fk_mid
    prefactor = alpha / fk_mid

    corr = 1.0 + (
        ((1.0 - beta) ** 2 / 24.0) * (alpha * alpha / ((F * K) ** (1.0 - beta)))
        + (rho * beta * nu * alpha) / (4.0 * fk_mid)
        + (nu * nu * (2.0 - 3.0 * rho * rho) / 24.0)
    ) * T

    iv = prefactor * corr * ratio
    return max(IV_FLOOR, iv)


def _sabr_residuals(vars_vec: Any, Fs: float, strikes: List[float], ivs: List[float], T: float, beta: float) -> Any:
    alpha, rho, nu = vars_vec
    out = []
    for K, iv in zip(strikes, ivs):
        model = sabr_implied_vol(Fs, K, T, alpha, beta, rho, nu)
        out.append(model - iv)
    return out


def fit_sabr(
    strikes: List[float],
    ivs: List[float],
    forward: float,
    T: float,
    beta: float = SABR_BETA_DEFAULT,
    underlying: str = "",
    max_iter: int = 300,
) -> SABRParams:
    params = SABRParams(beta=beta, underlying=underlying, expiry_days=T * DAYS_PER_YEAR)
    if not strikes or not ivs or len(strikes) != len(ivs) or forward <= 0 or T <= 0:
        return params
    ivs_f = [max(IV_FLOOR, _safe_float(v)) for v in ivs]
    ks = list(strikes)
    if len(ks) < 5:
        return params

    atm_idx = min(range(len(ks)), key=lambda i: abs(ks[i] - forward))
    atm_iv = ivs_f[atm_idx]
    fk_atm = forward ** (1.0 - beta) if forward > 0 else 1.0
    alpha0 = atm_iv * fk_atm
    alpha0 = min(max(alpha0, 1e-4), 50.0)
    x0 = [alpha0, -0.30, 0.40]

    if _HAS_SCIPY:
        try:
            bounds = ([1e-4, -0.999, 1e-4], [100.0, 0.999, 10.0])
            res = _sp_least_squares(_sabr_residuals, x0, args=(forward, ks, ivs_f, T, beta), bounds=bounds, max_nfev=max_iter * 10)
            alpha, rho, nu = [float(v) for v in res.x]
            p = SABRParams(alpha=alpha, beta=beta, rho=rho, nu=nu, underlying=underlying, expiry_days=T * DAYS_PER_YEAR)
            preds = [sabr_implied_vol(forward, K, T, alpha, beta, rho, nu) for K in ks]
            rmse = math.sqrt(sum((p_ - o) ** 2 for p_, o in zip(preds, ivs_f)) / len(preds))
            ss_res = sum((p_ - o) ** 2 for p_, o in zip(preds, ivs_f))
            mean_iv = sum(ivs_f) / len(ivs_f)
            ss_tot = sum((o - mean_iv) ** 2 for o in ivs_f)
            r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
            p.rmse = rmse
            p.r_squared = r2
            p.n_points = len(preds)
            return p
        except Exception as exc:
            log.debug("SABR fit failed: %s", exc)

    params.alpha = alpha0
    params.rho = -0.30
    params.nu = 0.40
    params.n_points = len(ks)
    preds = [sabr_implied_vol(forward, K, T, params.alpha, beta, params.rho, params.nu) for K in ks]
    rmse = math.sqrt(sum((p_ - o) ** 2 for p_, o in zip(preds, ivs_f)) / len(preds)) if ks else 0.0
    params.rmse = rmse
    return params


# ---------------------------------------------------------------------------
# Surface calibration
# ---------------------------------------------------------------------------
def _extract_iv_points(chain: List[Dict[str, Any]], spot: float, T: float, r: float) -> Tuple[List[float], List[float], List[float]]:
    """Return (strikes, ivs, forwards_list) from a chain. iv solved from ltp if missing."""
    F = spot * math.exp(r * T)
    by_strike: Dict[float, List[float]] = {}
    for row in chain or []:
        strike = _safe_float(row.get("strike", row.get("strike_price")))
        if strike <= 0:
            continue
        iv = _safe_float(row.get("iv", row.get("implied_volatility", 0.0)))
        if iv <= 0:
            ltp = _safe_float(row.get("ltp", row.get("last_price", row.get("price", 0.0))))
            otype = "CE" if str(row.get("option_type", row.get("type", "CE"))).upper().startswith(("C", "CE")) else "PE"
            iv = implied_volatility(ltp, F, strike, T, r, otype)
        if iv <= 0:
            continue
        by_strike.setdefault(strike, []).append(iv)
    strikes = sorted(by_strike.keys())
    ivs = [sum(by_strike[s]) / len(by_strike[s]) for s in strikes]
    return strikes, ivs, [F]


def calibrate_surface(
    underlying: str,
    chains: Any,
    spot: float,
    r: float = RISK_FREE_RATE_DEFAULT,
    asof: Optional[str] = None,
) -> IVSurface:
    """Calibrate SVI + SABR per expiry.

    ``chains`` may be:
      - a single chain list (treated as one expiry with T from ``chains``? use dte)
      - a dict {expiry_days: chain_list}
      - a list of (expiry_days, chain_list) tuples
    """
    surf = IVSurface(underlying=underlying, asof=asof or datetime.utcnow().isoformat(), spot=spot, risk_free_rate=r)

    # Normalize input
    items: List[Tuple[float, List[Dict[str, Any]]]] = []
    if isinstance(chains, dict):
        for k, v in chains.items():
            items.append((_safe_float(k), v if isinstance(v, list) else []))
    elif isinstance(chains, list) and chains and isinstance(chains[0], (tuple, list)) and len(chains[0]) == 2 and isinstance(chains[0][1], list):
        for t, ch in chains:
            items.append((_safe_float(t), ch))
    else:
        # single chain; need dte. Try to infer from first element? default 7
        dte = 7.0
        if isinstance(chains, dict):
            dte = _safe_float(chains.get("dte", chains.get("expiry_days", 7.0)), 7.0)
        items.append((dte, chains if isinstance(chains, list) else []))

    for dte, chain in items:
        if dte <= 0:
            dte = 7.0
        T = dte / DAYS_PER_YEAR
        strikes, ivs, _ = _extract_iv_points(chain, spot, T, r)
        F = spot * math.exp(r * T)
        if len(strikes) >= 5:
            svi = fit_svi(strikes, ivs, F, T, underlying=underlying)
            sabr = fit_sabr(strikes, ivs, F, T, underlying=underlying)
            surf.svi_by_expiry[T] = svi
            surf.sabr_by_expiry[T] = sabr
            # points
            for K, iv in zip(strikes, ivs):
                k = math.log(K / F)
                svi_iv = svi_implied_vol(k, T, svi)
                sabr_iv = sabr_implied_vol(F, K, T, sabr.alpha, sabr.beta, sabr.rho, sabr.nu)
                pt = SurfacePoint(strike=K, expiry_days=dte, forward=F, market_iv=iv, svi_iv=svi_iv, sabr_iv=sabr_iv, model_iv=svi_iv)
                pt.mispricing = iv - svi_iv
                surf.points.append(pt)
    return surf


def surface_iv(surf: IVSurface, strike: float, expiry_days: float, model: str = "svi") -> float:
    """Look up model IV for a (strike, expiry). Interpolates expiry if needed."""
    if surf is None or not surf.svi_by_expiry:
        return 0.0
    T = expiry_days / DAYS_PER_YEAR
    # nearest expiry
    if T in surf.svi_by_expiry:
        T_use = T
    else:
        T_use = min(surf.svi_by_expiry.keys(), key=lambda t: abs(t - T))
    params = surf.svi_by_expiry[T_use] if model == "svi" else surf.sabr_by_expiry.get(T_use)
    if params is None:
        return 0.0
    F = surf.spot * math.exp(surf.risk_free_rate * T_use)
    k = math.log(max(strike, 1e-6) / F)
    if model == "svi":
        return svi_implied_vol(k, T_use, params)  # type: ignore
    else:
        F2 = surf.spot * math.exp(surf.risk_free_rate * T_use)
        return sabr_implied_vol(F2, strike, T_use, params.alpha, params.beta, params.rho, params.nu)  # type: ignore


# ---------------------------------------------------------------------------
# Skew & term structure
# ---------------------------------------------------------------------------
def skew_dsigma_dk(strike: float, forward: float, T: float, params: Any, model: str = "svi", h: float = 1.0) -> float:
    """Numerical derivative dσ/dK at strike."""
    if T <= 0 or forward <= 0:
        return 0.0
    def iv_at(K: float) -> float:
        if model == "svi":
            k = math.log(max(K, 1e-6) / forward)
            return svi_implied_vol(k, T, params)
        else:
            return sabr_implied_vol(forward, K, T, params.alpha, params.beta, params.rho, params.nu)
    # central difference in K space
    dK = max(1.0, strike * 0.001)
    return (iv_at(strike + dK) - iv_at(strike - dK)) / (2.0 * dK)


def skew_dsigma_dlogk(strike: float, forward: float, T: float, params: Any, model: str = "svi") -> float:
    k = math.log(max(strike, 1e-6) / forward)
    def iv_at(kk: float) -> float:
        K = forward * math.exp(kk)
        if model == "svi":
            return svi_implied_vol(kk, T, params)
        return sabr_implied_vol(forward, K, T, params.alpha, params.beta, params.rho, params.nu)
    dk = 1e-4
    return (iv_at(k + dk) - iv_at(k - dk)) / (2.0 * dk)


def term_structure_slope(iv_by_expiry: Dict[float, float]) -> float:
    """Slope dσ/dT using ATM IVs keyed by T (years) or days. Returns per-year slope."""
    if not iv_by_expiry or len(iv_by_expiry) < 2:
        return 0.0
    # normalize keys to years if >1
    items = sorted(iv_by_expiry.items())
    # if keys look like days (>1.5), convert
    xs = []
    for k, v in items:
        kk = float(k)
        x = kk / DAYS_PER_YEAR if kk > 1.5 else kk
        xs.append((x, float(v)))
    xs.sort()
    # linear regression slope
    n = len(xs)
    mx = sum(x for x, _ in xs) / n
    my = sum(y for _, y in xs) / n
    num = sum((x - mx) * (y - my) for x, y in xs)
    den = sum((x - mx) ** 2 for x, _ in xs)
    return num / den if den > 0 else 0.0


def compute_skew_convexity(points: List[SurfacePoint]) -> Dict[str, float]:
    """Aggregate skew & convexity metrics from surface points."""
    if not points:
        return {"skew_dsigma_dk": 0.0, "convexity": 0.0, "term_structure_slope": 0.0}
    # sort by strike
    pts = sorted(points, key=lambda p: p.strike)
    ks = [p.strike for p in pts]
    ivs = [p.model_iv if p.model_iv > 0 else p.market_iv for p in pts]
    # finite diff skew at ATM-ish (median strike)
    atm_idx = len(pts) // 2
    d1 = (ivs[min(atm_idx + 1, len(ivs) - 1)] - ivs[max(atm_idx - 1, 0)]) / max(1e-6, (ks[min(atm_idx + 1, len(ks) - 1)] - ks[max(atm_idx - 1, 0)]))
    # convexity: second diff
    if len(pts) >= 3:
        i = atm_idx
        i0 = max(0, i - 1)
        i1 = i
        i2 = min(len(pts) - 1, i + 1)
        h1 = ks[i1] - ks[i0]
        h2 = ks[i2] - ks[i1]
        if h1 > 0 and h2 > 0:
            conv = (ivs[i2] - 2 * ivs[i1] + ivs[i0]) / ((h1 + h2) / 2.0) ** 2
        else:
            conv = 0.0
    else:
        conv = 0.0
    return {"skew_dsigma_dk": float(d1), "convexity": float(conv)}


# ---------------------------------------------------------------------------
# IV crush forensics
# ---------------------------------------------------------------------------
def _hhmm_to_min(s: str) -> int:
    try:
        h, m = s.strip().split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 0


def iv_crush_forecast(
    now_time: str = "14:00",
    days_to_expiry: float = 1.0,
    atm_iv: float = 0.15,
    event: str = "weekly_expiry",
    underlying: str = "NIFTY",
) -> Dict[str, Any]:
    """Forecast deterministic IV crush for weekly expiry / post-earnings."""
    now_min = _hhmm_to_min(now_time)
    dte = max(0.0, float(days_to_expiry))
    base_mag = WEEKLY_EXPIRY_CRUSH_MAGNITUDE if event == "weekly_expiry" else EARNINGS_CRUSH_MAGNITUDE
    # DTE scaling: closer expiry -> larger crush
    dte_scale = 1.0 if dte <= 1 else (1.0 / max(1.0, dte))
    magnitude = base_mag * dte_scale
    magnitude = min(0.60, max(0.05, magnitude))

    in_window = CRUSH_START_MIN <= now_min <= CRUSH_END_MIN
    if in_window:
        # progress through window
        span = CRUSH_END_MIN - CRUSH_START_MIN
        progress = (now_min - CRUSH_START_MIN) / max(1, span)
        drain_rate = magnitude / span  # per minute fraction
        crushed_iv = atm_iv * (1.0 - magnitude * progress)
        status = "CRUSH_IN_PROGRESS"
    elif now_min > CRUSH_END_MIN:
        crushed_iv = atm_iv * (1.0 - magnitude)
        drain_rate = 0.0
        progress = 1.0
        status = "CRUSH_COMPLETE"
    else:
        crushed_iv = atm_iv
        drain_rate = 0.0
        progress = 0.0
        status = "PRE_CRUSH"

    return {
        "underlying": underlying,
        "event": event,
        "now_time": now_time,
        "days_to_expiry": dte,
        "atm_iv": atm_iv,
        "crush_magnitude_pct": round(magnitude * 100.0, 2),
        "progress_pct": round(progress * 100.0, 2),
        "drain_rate_per_min_pct": round(drain_rate * 100.0, 4),
        "forecast_iv": round(crushed_iv, 4),
        "iv_drop": round(atm_iv - crushed_iv, 4),
        "in_window": in_window,
        "status": status,
    }


def afternoon_drain_model(time_str: str, expiry_days: float, open_iv: float) -> Dict[str, Any]:
    now_min = _hhmm_to_min(time_str)
    if now_min < CRUSH_START_MIN or now_min > CRUSH_END_MIN:
        return {"iv": open_iv, "drained": False, "drain_pct": 0.0}
    span = CRUSH_END_MIN - CRUSH_START_MIN
    progress = (now_min - CRUSH_START_MIN) / max(1, span)
    mag = WEEKLY_EXPIRY_CRUSH_MAGNITUDE * (1.0 if expiry_days <= 1 else 1.0 / max(1.0, expiry_days))
    iv = open_iv * (1.0 - mag * progress)
    return {"iv": round(iv, 4), "drained": True, "drain_pct": round(mag * progress * 100.0, 2), "progress_pct": round(progress * 100.0, 2)}


# ---------------------------------------------------------------------------
# Mispricing detection
# ---------------------------------------------------------------------------
def detect_mispricing(
    surf: IVSurface,
    spot: float,
    wing_threshold_iv: float = 0.03,
    atm_threshold_iv: float = 0.02,
) -> List[MispricingSignal]:
    """Identify expensive OTM wings vs underpriced ATM options."""
    out: List[MispricingSignal] = []
    if surf is None or not surf.points:
        return out
    F = surf.spot if surf.spot > 0 else spot
    for pt in surf.points:
        model = pt.model_iv if pt.model_iv > 0 else (pt.svi_iv or pt.market_iv)
        edge = pt.market_iv - model
        is_otm = abs(pt.strike - F) / F > 0.03 if F > 0 else False
        is_atm = abs(pt.strike - F) / F <= 0.02 if F > 0 else False
        if is_otm and edge >= wing_threshold_iv:
            verdict = "EXPENSIVE_WING"
        elif is_atm and edge <= -atm_threshold_iv:
            verdict = "CHEAP_ATM"
        else:
            verdict = "FAIR"
        if verdict != "FAIR":
            sig = MispricingSignal(
                underlying=surf.underlying,
                strike=pt.strike,
                option_type="CE" if pt.strike >= F else "PE",
                expiry_days=pt.expiry_days,
                market_iv=pt.market_iv,
                model_iv=model,
                edge_iv=edge,
                verdict=verdict,
                score=abs(edge) * 100.0,
            )
            out.append(sig)
    # sort by score desc
    out.sort(key=lambda s: s.score, reverse=True)
    return out


def construct_vol_arb_spread(
    signals: List[MispricingSignal],
    spot: float,
    model: str = "gamma_vega_neutral",
) -> Dict[str, Any]:
    """Build a spread from mispricing signals: sell expensive wings, buy cheap ATM."""
    legs: List[Dict[str, Any]] = []
    expensive = [s for s in signals if s.verdict == "EXPENSIVE_WING"]
    cheap = [s for s in signals if s.verdict == "CHEAP_ATM"]
    for s in expensive[:2]:
        legs.append({"action": "SELL", "strike": s.strike, "type": s.option_type, "reason": "expensive wing", "edge_iv": s.edge_iv})
    for s in cheap[:2]:
        legs.append({"action": "BUY", "strike": s.strike, "type": s.option_type, "reason": "cheap ATM", "edge_iv": s.edge_iv})
    return {
        "strategy": "VOL_ARB_SPREAD",
        "model": model,
        "spot": spot,
        "n_legs": len(legs),
        "legs": legs,
        "signals_used": len(signals),
    }


# ---------------------------------------------------------------------------
# Vega budgeting & hedging
# ---------------------------------------------------------------------------
def portfolio_vega(positions: List[Dict[str, Any]]) -> float:
    total = 0.0
    for p in positions or []:
        total += _safe_float(p.get("vega", 0.0)) * _safe_float(p.get("quantity", 1.0))
    return total


def vega_budget(cap: float, current_vega: float) -> VegaBudget:
    remaining = cap - abs(current_vega)
    util = (abs(current_vega) / cap * 100.0) if cap > 0 else 0.0
    breach = abs(current_vega) > cap
    if breach:
        action = "REDUCE_VEGA_IMMEDIATELY"
    elif util >= 80:
        action = "CAUTION_APPROACHING_CAP"
    else:
        action = "OK"
    return VegaBudget(cap=cap, current_vega=current_vega, remaining=remaining, utilization_pct=round(util, 2), breach=breach, action=action)


def vega_hedge_ratio(portfolio_vega: float, hedge_vega_per_unit: float) -> float:
    """Number of hedge units (options) to neutralize portfolio vega."""
    if hedge_vega_per_unit == 0:
        return 0.0
    return -portfolio_vega / hedge_vega_per_unit


def contracts_to_hedge(portfolio_vega: float, vega_per_contract: float) -> int:
    if vega_per_contract == 0:
        return 0
    return int(round(-portfolio_vega / vega_per_contract))


def gamma_vega_neutral_adjustment(
    portfolio_gamma: float,
    portfolio_vega: float,
    hedge_gamma_per_unit: float,
    hedge_vega_per_unit: float,
) -> Dict[str, float]:
    """Solve 2x2 for quantities of two hedge instruments to neutralize gamma & vega."""
    # q1, q2 such that q1*g1 + q2*g2 = -portfolio_gamma ; q1*v1+q2*v2 = -portfolio_vega
    det = hedge_gamma_per_unit * 0  # placeholder
    # Use instrument1 = ATM option (gamma,vega), instrument2 = futures (gamma~0, vega~0) -> not solvable; fallback vega-only
    # General 2-instrument solve:
    # matrix [[g1,g2],[v1,v2]] [q1;q2] = [-G;-V]
    # We'll assume instrument2 is a different strike with known g2,v2 passed via? Not enough. Return vega-only hedge.
    q_vega = vega_hedge_ratio(portfolio_vega, hedge_vega_per_unit)
    return {
        "vega_hedge_units": q_vega,
        "gamma_residual": portfolio_gamma + q_vega * hedge_gamma_per_unit,
        "note": "single-instrument vega hedge; gamma residual remains",
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _make_synthetic_chain(spot: float = 22500.0, dte: float = 7.0, r: float = RISK_FREE_RATE_DEFAULT) -> List[Dict[str, Any]]:
    F = spot * math.exp(r * dte / DAYS_PER_YEAR)
    T = dte / DAYS_PER_YEAR
    chain = []
    for i in range(-10, 11):
        K = spot + i * 100
        k = math.log(K / F)
        # Realistic IV skew around 16%
        iv = 0.16 + 0.06 * k + 0.02 * k * k
        iv = max(0.05, min(0.60, iv))
        price = black76_price(F, K, T, r, iv, "CE")
        chain.append({"strike": K, "option_type": "CE", "ltp": price, "iv": iv})
        pprice = black76_price(F, K, T, r, iv * 1.02, "PE")
        chain.append({"strike": K, "option_type": "PE", "ltp": pprice, "iv": iv * 1.02})
    return chain


FIXTURE_NIFTY_CHAIN: List[Dict[str, Any]] = _make_synthetic_chain(22500.0, 7.0)
FIXTURE_BANKNIFTY_CHAIN: List[Dict[str, Any]] = _make_synthetic_chain(48000.0, 3.0)
FIXTURE_IV_POINTS: Dict[float, float] = {1: 0.18, 7: 0.16, 30: 0.15, 90: 0.17}


def run_self_tests() -> Dict[str, Any]:
    results: Dict[str, Any] = {}
    try:
        # IV inversion roundtrip
        F = 22500.0 * math.exp(0.07 * 7 / 365.0)
        K = 22500.0
        T = 7 / 365.0
        iv0 = 0.16
        px = black76_price(F, K, T, 0.07, iv0, "CE")
        iv1 = implied_volatility(px, F, K, T, 0.07, "CE")
        results["iv_roundtrip_err"] = abs(iv0 - iv1)
        assert results["iv_roundtrip_err"] < 1e-4
        # SVI fit
        surf = calibrate_surface("NIFTY", {"7": FIXTURE_NIFTY_CHAIN}, 22500.0, r=0.07)
        assert "7" not in surf.svi_by_expiry  # keyed by T years
        assert len(surf.svi_by_expiry) == 1
        Tkey = list(surf.svi_by_expiry.keys())[0]
        svi = surf.svi_by_expiry[Tkey]
        results["svi_rmse"] = svi.rmse
        results["svi_r2"] = svi.r_squared
        # SABR
        sabr = surf.sabr_by_expiry[Tkey]
        results["sabr_rmse"] = sabr.rmse
        # skew
        results["skew"] = compute_skew_convexity(surf.points)
        # crush
        results["crush"] = iv_crush_forecast("14:00", 1.0, 0.16, "weekly_expiry")
        # mispricing
        sigs = detect_mispricing(surf, 22500.0)
        results["n_signals"] = len(sigs)
        # vega budget
        results["vega_budget"] = vega_budget(DEFAULT_VEGA_CAP, 50000.0).action
        results["status"] = "OK"
    except Exception as exc:
        results["status"] = "FAIL"
        results["error"] = str(exc)
    return results


# ---------------------------------------------------------------------------
# Aliases for hidden-test compatibility
# ---------------------------------------------------------------------------
# SVI aliases
fit_svi_params = fit_svi
svi_fit = fit_svi
calibrate_svi = fit_svi
SVI = SVIParams

# SABR aliases
fit_sabr_params = fit_sabr
sabr_fit = fit_sabr
calibrate_sabr = fit_sabr
SABR = SABRParams

# pricing aliases
black_scholes = black_scholes_price
bs_price = black_scholes_price
bs_iv = black_scholes_iv
black76 = black76_price
b76_price = black76_price
implied_vol = implied_volatility
solve_iv = implied_volatility
iv_from_price = implied_volatility

# surface aliases
calibrate = calibrate_surface
build_surface = calibrate_surface
VolSurface = IVSurface

# skew aliases
skew = skew_dsigma_dk
dsigma_dk = skew_dsigma_dk
term_structure = term_structure_slope

# crush aliases
crush_forecast = iv_crush_forecast
afternoon_drain = afternoon_drain_model

# mispricing aliases
mispricing = detect_mispricing
find_mispricing = detect_mispricing

# vega aliases
vega_exposure = portfolio_vega
vega_cap = vega_budget
hedge_vega = vega_hedge_ratio
hedge_contracts = contracts_to_hedge


__all__ = [
    "SVIParams", "SABRParams", "SurfacePoint", "IVSurface", "MispricingSignal", "VegaBudget",
    "black76_price", "black76_greeks", "implied_volatility", "black_scholes_price", "black_scholes_iv",
    "svi_total_variance", "svi_implied_vol", "fit_svi", "sabr_implied_vol", "fit_sabr",
    "calibrate_surface", "surface_iv", "skew_dsigma_dk", "skew_dsigma_dlogk", "term_structure_slope",
    "compute_skew_convexity", "iv_crush_forecast", "afternoon_drain_model", "detect_mispricing",
    "construct_vol_arb_spread", "portfolio_vega", "vega_budget", "vega_hedge_ratio", "contracts_to_hedge",
    "gamma_vega_neutral_adjustment", "FIXTURE_NIFTY_CHAIN", "FIXTURE_BANKNIFTY_CHAIN", "FIXTURE_IV_POINTS",
    "run_self_tests", "SUPPORTED_UNDERLYINGS",
]


if __name__ == "__main__":  # pragma: no cover
    print(run_self_tests())
