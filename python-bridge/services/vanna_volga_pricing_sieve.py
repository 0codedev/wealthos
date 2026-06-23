"""
Domain 169 (WP-BS): Real-Time Cross-Strike Vanna-Volga Foreign Exchange / Equity Option Pricing Sieve

Implements Castagna-Mercurio (2007) and Wystup (2006) Vanna-Volga option pricing,
3-quote cross-smile volatility interpolation (25-Delta Put, ATM, 25-Delta Call),
Vega-Vanna-Volga replication weighting, and second-order smile mispricing arbitrage detection.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class MarketQuotes:
    spot: float
    r: float  # Risk-free rate
    t: float  # Time to expiry in years
    atm_vol: float
    rr_25: float  # 25-Delta Risk Reversal = vol(25C) - vol(25P)
    bf_25: float  # 25-Delta Butterfly = 0.5*(vol(25C) + vol(25P)) - atm_vol


@dataclass
class VannaVolgaResult:
    strike: float
    is_call: bool
    bs_atm_price: float
    vv_price: float
    vv_implied_vol: float
    market_iv: Optional[float]
    mispricing_bps: Optional[float]
    vega: float
    vanna: float
    volga: float
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VannaVolgaPricingSieve:
    """
    Cross-Strike Vanna-Volga Option Pricing & Volatility Smile Sieve.
    """

    def __init__(self, db_path: str = ":memory:"):
        self.db_path = db_path
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Vanna-Volga telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS vanna_volga_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                spot REAL NOT NULL,
                strike REAL NOT NULL,
                expiry_t REAL NOT NULL,
                market_iv REAL,
                vv_iv REAL NOT NULL,
                mispricing_bps REAL,
                vega REAL NOT NULL,
                vanna REAL NOT NULL,
                volga REAL NOT NULL,
                regime TEXT NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def norm_cdf(x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    @staticmethod
    def norm_pdf(x: float) -> float:
        return (1.0 / math.sqrt(2.0 * math.pi)) * math.exp(-0.5 * x * x)

    def bs_price(self, S: float, K: float, T: float, r: float, sigma: float, is_call: bool) -> float:
        """Standard Black-Scholes European option pricing."""
        if T <= 0 or sigma <= 0:
            return max(0.0, S - K) if is_call else max(0.0, K - S)

        sqrt_t = math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_t)
        d2 = d1 - sigma * sqrt_t
        df = math.exp(-r * T)

        if is_call:
            return S * self.norm_cdf(d1) - K * df * self.norm_cdf(d2)
        else:
            return K * df * self.norm_cdf(-d2) - S * self.norm_cdf(-d1)

    def bs_vega(self, S: float, K: float, T: float, r: float, sigma: float) -> float:
        """Black-Scholes Vega."""
        if T <= 0 or sigma <= 0:
            return 0.0
        sqrt_t = math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_t)
        return S * sqrt_t * self.norm_pdf(d1)

    def bs_vanna(self, S: float, K: float, T: float, r: float, sigma: float) -> float:
        """Black-Scholes Vanna: dVega / dS."""
        if T <= 0 or sigma <= 0:
            return 0.0
        sqrt_t = math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_t)
        d2 = d1 - sigma * sqrt_t
        return -self.norm_pdf(d1) * d2 / sigma

    def bs_volga(self, S: float, K: float, T: float, r: float, sigma: float) -> float:
        """Black-Scholes Volga: dVega / dSigma."""
        if T <= 0 or sigma <= 0:
            return 0.0
        sqrt_t = math.sqrt(T)
        d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_t)
        d2 = d1 - sigma * sqrt_t
        vega = S * sqrt_t * self.norm_pdf(d1)
        return vega * d1 * d2 / sigma

    def invert_iv(
        self,
        target_price: float,
        S: float,
        K: float,
        T: float,
        r: float,
        is_call: bool,
    ) -> float:
        """Inverts implied volatility via robust Brent/Bisection hybrid."""
        low_vol = 0.001
        high_vol = 3.0

        p_low = self.bs_price(S, K, T, r, low_vol, is_call)
        p_high = self.bs_price(S, K, T, r, high_vol, is_call)

        if target_price <= p_low:
            return low_vol
        if target_price >= p_high:
            return high_vol

        # Bisection
        for _ in range(50):
            mid_vol = 0.5 * (low_vol + high_vol)
            p_mid = self.bs_price(S, K, T, r, mid_vol, is_call)
            diff = p_mid - target_price
            if abs(diff) < 1e-5:
                return mid_vol
            if diff > 0:
                high_vol = mid_vol
            else:
                low_vol = mid_vol

        return 0.5 * (low_vol + high_vol)

    def calculate_pillar_strikes(self, quotes: MarketQuotes) -> Tuple[float, float, float, float, float]:
        """
        Derives the 3 benchmark pillar strikes (K1 = 25-delta Put, K2 = ATM, K3 = 25-delta Call)
        and their market implied volatilities.
        """
        S = quotes.spot
        T = quotes.t
        r = quotes.r
        sigma_atm = quotes.atm_vol

        # Market vols for 25D Call and 25D Put
        sigma_call = sigma_atm + quotes.bf_25 + 0.5 * quotes.rr_25
        sigma_put = sigma_atm + quotes.bf_25 - 0.5 * quotes.rr_25

        # K2 = ATM strike
        k2 = S * math.exp(r * T)  # Forward ATM strike

        # K1 (25-delta Put): N(d1) - 1 = -0.25 -> N(d1) = 0.75 -> d1 = +0.6745
        d1_put = 0.6745
        k1 = S * math.exp((r + 0.5 * sigma_put * sigma_put) * T - d1_put * sigma_put * math.sqrt(T))

        # K3 (25-delta Call): N(d1) = 0.25 -> d1 = -0.6745
        d1_call = -0.6745
        k3 = S * math.exp((r + 0.5 * sigma_call * sigma_call) * T - d1_call * sigma_call * math.sqrt(T))

        return k1, k2, k3, sigma_put, sigma_call

    def price_vanna_volga(
        self,
        symbol: str,
        target_strike: float,
        is_call: bool,
        quotes: MarketQuotes,
        market_iv: Optional[float] = None,
    ) -> VannaVolgaResult:
        """
        Prices an arbitrary strike option using the Castagna-Mercurio Vanna-Volga method:
        C_VV(K) = C_BS(K, sigma_atm) + w1*(C_Mkt(K1) - C_BS(K1)) + w3*(C_Mkt(K3) - C_BS(K3))
        """
        S, T, r, sigma_atm = quotes.spot, quotes.t, quotes.r, quotes.atm_vol
        k1, k2, k3, vol_put, vol_call = self.calculate_pillar_strikes(quotes)

        # Baseline ATM Black-Scholes price
        c_bs_target = self.bs_price(S, target_strike, T, r, sigma_atm, is_call)

        # Market prices at K1 and K3
        c_mkt_k1 = self.bs_price(S, k1, T, r, vol_put, is_call=False if k1 < S else is_call)
        c_bs_k1 = self.bs_price(S, k1, T, r, sigma_atm, is_call=False if k1 < S else is_call)

        c_mkt_k3 = self.bs_price(S, k3, T, r, vol_call, is_call=True if k3 > S else is_call)
        c_bs_k3 = self.bs_price(S, k3, T, r, sigma_atm, is_call=True if k3 > S else is_call)

        diff_k1 = c_mkt_k1 - c_bs_k1
        diff_k3 = c_mkt_k3 - c_bs_k3

        # Analytical Vanna-Volga weights
        vega_target = self.bs_vega(S, target_strike, T, r, sigma_atm)
        vega_k1 = max(1e-6, self.bs_vega(S, k1, T, r, sigma_atm))
        vega_k3 = max(1e-6, self.bs_vega(S, k3, T, r, sigma_atm))

        # Log strike ratios
        ln_k2_k = math.log(k2 / target_strike)
        ln_k3_k = math.log(k3 / target_strike)
        ln_k_k1 = math.log(target_strike / k1)
        ln_k_k2 = math.log(target_strike / k2)

        ln_k2_k1 = math.log(k2 / k1)
        ln_k3_k1 = math.log(k3 / k1)
        ln_k3_k2 = math.log(k3 / k2)

        w1 = (vega_target / vega_k1) * (ln_k2_k * ln_k3_k) / (ln_k2_k1 * ln_k3_k1)
        w3 = (vega_target / vega_k3) * (ln_k_k1 * ln_k_k2) / (ln_k3_k1 * ln_k3_k2)

        # Adjusted Vanna-Volga Price
        vv_price = max(
            max(0.0, S - target_strike if is_call else target_strike - S),
            c_bs_target + w1 * diff_k1 + w3 * diff_k3,
        )

        # Invert to find Vanna-Volga implied volatility
        vv_iv = self.invert_iv(vv_price, S, target_strike, T, r, is_call)

        # Greeks
        vanna = self.bs_vanna(S, target_strike, T, r, vv_iv)
        volga = self.bs_volga(S, target_strike, T, r, vv_iv)

        # Mispricing evaluation
        mispricing_bps = None
        regime = "FAIR_VALUE_EQUILIBRIUM"
        directive = "HOLD_DELTA_GAMMA_NEUTRAL"

        if market_iv is not None:
            # Difference in basis points of implied vol
            mispricing_bps = round((market_iv - vv_iv) * 10000.0, 2)
            if mispricing_bps > 50.0:
                # Market IV is significantly richer than VV theoretical fair value
                regime = "RICH_VOLATILITY_OVERPRICING"
                directive = "EXECUTE_SHORT_VEGA_HARVEST"
            elif mispricing_bps < -50.0:
                # Market IV is cheap relative to VV theoretical fair value
                regime = "CHEAP_VOLATILITY_UNDERPRICING"
                directive = "EXECUTE_LONG_VEGA_HARVEST"

        result = VannaVolgaResult(
            strike=target_strike,
            is_call=is_call,
            bs_atm_price=round(c_bs_target, 4),
            vv_price=round(vv_price, 4),
            vv_implied_vol=round(vv_iv, 4),
            market_iv=market_iv,
            mispricing_bps=mispricing_bps,
            vega=round(vega_target, 4),
            vanna=round(vanna, 6),
            volga=round(volga, 6),
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(symbol, quotes, result)
        return result

    def _record_telemetry(self, symbol: str, q: MarketQuotes, res: VannaVolgaResult) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO vanna_volga_telemetry (
                timestamp, symbol, spot, strike, expiry_t,
                market_iv, vv_iv, mispricing_bps, vega, vanna, volga,
                regime, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                res.timestamp,
                symbol,
                q.spot,
                res.strike,
                q.t,
                res.market_iv,
                res.vv_implied_vol,
                res.mispricing_bps,
                res.vega,
                res.vanna,
                res.volga,
                res.regime,
                res.trade_directive,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest persisted telemetry rows."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, spot, strike, vv_iv, market_iv, mispricing_bps, regime, directive
            FROM vanna_volga_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
