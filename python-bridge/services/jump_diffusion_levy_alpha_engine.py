r"""
Domain 189 (WP-CM): High-Frequency Limit Order Book Jump Diffusion & Lévy Alpha Engine

Implements high-frequency discontinuous jump decomposition from continuous diffusive Brownian motion:
- Barndorff-Nielsen & Shephard (2004, 2006) Bipower Variation (BV) vs Realized Variance (RV)
- Lee & Mykland (2008) non-parametric jump arrival detection test statistic \mathcal{L}_k
- Merton (1976) and Kou (2002) double exponential jump diffusion model parameter calibration:
    * Arrival intensity \lambda
    * Asymmetric upward/downward jump probability p and decay parameters \eta_1, \eta_2
    * Drift compensator -\lambda \bar{k} where \bar{k} = \mathbb{E}[e^Y - 1]
- Quantitative market microstructure alpha directives:
    * Downward cascade veto & defensive bid spread widening
    * Upward aggressive liquidity sweep momentum chasing
    * Symmetric jump regime two-sided quote widening
    * Gaussian pure diffusive regime tight market making
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import random
import sqlite3
from typing import Dict, List, Optional, Tuple


class LevyAlphaDirective(str, Enum):
    CASCADE_DOWNWARD_JUMP_VETO_BIDS = "CASCADE_DOWNWARD_JUMP_VETO_BIDS"
    MOMENTUM_UPWARD_JUMP_SWEEP = "MOMENTUM_UPWARD_JUMP_SWEEP"
    SYMMETRIC_HIGH_JUMP_REGIME_WIDEN_SPREADS = "SYMMETRIC_HIGH_JUMP_REGIME_WIDEN_SPREADS"
    DIFFUSIVE_GAUSSIAN_MARKET_MAKING = "DIFFUSIVE_GAUSSIAN_MARKET_MAKING"
    EQUILIBRIUM_CALM = "EQUILIBRIUM_CALM"


@dataclass
class JumpEvent:
    timestamp_sec: float
    price: float
    log_return: float
    jump_size: float  # e^{r_k} - 1
    direction: int  # +1 for upward jump, -1 for downward jump
    lee_mykland_stat: float
    is_jump: bool


@dataclass
class JumpDiffusionCalibration:
    symbol: str
    n_observations: int
    total_time_sec: float
    realized_variance: float  # RV = \sum r_k^2
    bipower_variation: float  # BV = \frac{\pi}{2} \sum |r_k||r_{k-1}|
    continuous_vol_annualized: float
    total_vol_annualized: float
    jump_variance: float  # max(0, RV - BV)
    jump_ratio: float  # JV / RV
    jump_count: int
    upward_jump_count: int
    downward_jump_count: int
    jump_arrival_intensity: float  # \lambda (jumps per second)
    jump_asymmetry: float  # \mathcal{A}_J \in [-1.0, 1.0]
    kou_p: float  # Upward jump probability p
    kou_eta1: float  # Upward exponential decay \eta_1
    kou_eta2: float  # Downward exponential decay \eta_2
    expected_jump_size: float  # \bar{k}
    drift_compensator: float  # -\lambda \bar{k}
    directive: LevyAlphaDirective
    quote_spread_multiplier: float
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class JumpDiffusionLevyAlphaEngine:
    r"""
    Continuous-Time Jump Diffusion & Lévy Process Microstructure Alpha Engine.
    Decomposes asset price trajectories into continuous Gaussian diffusion (dW_t)
    and discontinuous Poisson jump arrivals (dN_t) with double-exponential Kou distributions.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        jump_threshold_sigma: float = 3.5,
        jump_ratio_threshold: float = 0.25,
        asymmetry_threshold: float = 0.40,
    ):
        self.db_path = db_path
        self.jump_thresh_sigma = jump_threshold_sigma
        self.jump_ratio_thresh = jump_ratio_threshold
        self.asymmetry_thresh = asymmetry_threshold

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for jump diffusion telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS jump_diffusion_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                n_obs INTEGER NOT NULL,
                rv REAL NOT NULL,
                bv REAL NOT NULL,
                jump_variance REAL NOT NULL,
                jump_ratio REAL NOT NULL,
                jump_count INTEGER NOT NULL,
                jump_intensity REAL NOT NULL,
                jump_asymmetry REAL NOT NULL,
                kou_p REAL NOT NULL,
                kou_eta1 REAL NOT NULL,
                kou_eta2 REAL NOT NULL,
                expected_jump_k REAL NOT NULL,
                drift_compensator REAL NOT NULL,
                directive TEXT NOT NULL,
                spread_mult REAL NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def compute_bipower_variation(
        self, log_returns: List[float]
    ) -> Tuple[float, float, float]:
        r"""
        Computes Realized Variance (RV), Bipower Variation (BV), and Jump Ratio:
        RV = \sum_{k=1}^n r_k^2
        BV = \frac{\pi}{2} \cdot \frac{n}{n-1} \sum_{k=2}^n |r_k| |r_{k-1}|
        Jump Ratio = \max(0, RV - BV) / RV
        """
        n = len(log_returns)
        if n < 2:
            return 0.0, 0.0, 0.0

        rv = sum(r * r for r in log_returns)
        if rv <= 1e-15:
            return 0.0, 0.0, 0.0

        bv_sum = sum(abs(log_returns[k]) * abs(log_returns[k - 1]) for k in range(1, n))
        # Small sample correction factor n / (n - 1)
        bv = (math.pi / 2.0) * (n / float(n - 1)) * bv_sum

        # In finite samples, BV can occasionally slightly exceed RV due to discretization noise
        bv = min(bv, rv)
        jv = max(0.0, rv - bv)
        jump_ratio = jv / rv if rv > 1e-15 else 0.0

        return rv, bv, jump_ratio

    def detect_jumps(
        self, timestamps: List[float], prices: List[float]
    ) -> Tuple[List[JumpEvent], float, float, float]:
        r"""
        Applies Lee-Mykland (2008) non-parametric test to isolate discrete jump arrivals.
        \mathcal{L}_k = \frac{|r_k|}{\hat{\sigma}_k}
        where \hat{\sigma}_k = \sqrt{BV / (n - 1)}.
        """
        n = len(prices)
        if n < 2:
            return [], 0.0, 0.0, 0.0

        log_returns = [
            math.log(max(1e-8, prices[k] / max(1e-8, prices[k - 1])))
            for k in range(1, n)
        ]

        rv, bv, jump_ratio = self.compute_bipower_variation(log_returns)
        num_ret = len(log_returns)

        # Local continuous volatility scale estimate
        local_sigma = math.sqrt(max(1e-12, bv / max(1, num_ret)))

        jump_events: List[JumpEvent] = []
        for k, r in enumerate(log_returns):
            t_sec = timestamps[k + 1] if len(timestamps) > k + 1 else float(k + 1)
            p_curr = prices[k + 1]
            lm_stat = abs(r) / local_sigma if local_sigma > 1e-12 else 0.0
            is_jump = lm_stat >= self.jump_thresh_sigma
            direction = 1 if r >= 0 else -1
            jump_size = math.exp(r) - 1.0

            jump_events.append(
                JumpEvent(
                    timestamp_sec=t_sec,
                    price=p_curr,
                    log_return=r,
                    jump_size=jump_size,
                    direction=direction,
                    lee_mykland_stat=round(lm_stat, 3),
                    is_jump=is_jump,
                )
            )

        return jump_events, rv, bv, jump_ratio

    def calibrate_merton_kou(
        self,
        symbol: str,
        timestamps: List[float],
        prices: List[float],
        annualization_factor: float = 252.0 * 6.5 * 3600.0,  # Trading seconds in year
    ) -> JumpDiffusionCalibration:
        r"""
        Calibrates Merton/Kou Lévy jump diffusion dynamics and issues quantitative directives:
        - Arrival intensity \lambda = N_{jumps} / T
        - Upward jump probability p = N^+ / N_{jumps}
        - Double exponential decays: \eta_1 = 1 / \bar{y}^+, \eta_2 = 1 / \bar{y}^-
        - Expected relative jump size \bar{k} = \frac{p \eta_1}{\eta_1 - 1} + \frac{(1-p)\eta_2}{\eta_2 + 1} - 1
        - Compensator drift adjustment = -\lambda \bar{k}
        """
        n = len(prices)
        if n < 3:
            return JumpDiffusionCalibration(
                symbol=symbol,
                n_observations=n,
                total_time_sec=0.0,
                realized_variance=0.0,
                bipower_variation=0.0,
                continuous_vol_annualized=0.0,
                total_vol_annualized=0.0,
                jump_variance=0.0,
                jump_ratio=0.0,
                jump_count=0,
                upward_jump_count=0,
                downward_jump_count=0,
                jump_arrival_intensity=0.0,
                jump_asymmetry=0.0,
                kou_p=0.5,
                kou_eta1=100.0,
                kou_eta2=100.0,
                expected_jump_size=0.0,
                drift_compensator=0.0,
                directive=LevyAlphaDirective.EQUILIBRIUM_CALM,
                quote_spread_multiplier=1.0,
                rationale="Insufficient tick observations (<3).",
            )

        total_time_sec = max(1.0, timestamps[-1] - timestamps[0])
        jump_events, rv, bv, jump_ratio = self.detect_jumps(timestamps, prices)

        # Annualized volatilities
        time_factor = annualization_factor / total_time_sec
        cont_vol_ann = math.sqrt(bv * time_factor)
        tot_vol_ann = math.sqrt(rv * time_factor)
        jump_var = max(0.0, rv - bv)

        actual_jumps = [evt for evt in jump_events if evt.is_jump]
        up_jumps = [evt for evt in actual_jumps if evt.direction > 0]
        down_jumps = [evt for evt in actual_jumps if evt.direction < 0]

        n_jumps = len(actual_jumps)
        n_up = len(up_jumps)
        n_down = len(down_jumps)

        jump_intensity = float(n_jumps) / total_time_sec

        # Directional jump asymmetry \mathcal{A}_J \in [-1.0, 1.0]
        if n_jumps > 0:
            jump_asymmetry = float(n_up - n_down) / float(n_jumps)
            p_up = float(n_up) / float(n_jumps)
        else:
            jump_asymmetry = 0.0
            p_up = 0.5

        # Double exponential decay parameters \eta_1, \eta_2
        if up_jumps:
            mean_up_log = sum(evt.log_return for evt in up_jumps) / float(n_up)
            eta_1 = 1.0 / max(1e-4, mean_up_log)
        else:
            eta_1 = 50.0  # Default steep decay

        if down_jumps:
            mean_down_log = sum(abs(evt.log_return) for evt in down_jumps) / float(n_down)
            eta_2 = 1.0 / max(1e-4, mean_down_log)
        else:
            eta_2 = 50.0

        # Kou expected jump size \bar{k} = \mathbb{E}[e^Y - 1]
        # Condition: \eta_1 > 1.0 for finite expectation
        safe_eta_1 = max(1.05, eta_1)
        term_up = (p_up * safe_eta_1) / (safe_eta_1 - 1.0)
        term_down = ((1.0 - p_up) * eta2 if 'eta2' in locals() else (1.0 - p_up) * eta_2) / (eta_2 + 1.0)
        expected_k = (term_up + term_down) - 1.0
        drift_compensator = -1.0 * jump_intensity * expected_k

        # Microstructure Alpha Directives
        spread_mult = 1.0
        if jump_ratio >= self.jump_ratio_thresh and jump_asymmetry <= -self.asymmetry_thresh:
            directive = LevyAlphaDirective.CASCADE_DOWNWARD_JUMP_VETO_BIDS
            spread_mult = min(3.0, 1.0 + 3.0 * abs(jump_asymmetry) * jump_ratio * 4.0)
            rationale = (
                f"Negative jump cascade detected (Asymmetry: {jump_asymmetry:.2f}, "
                f"JumpRatio: {jump_ratio*100:.1f}%, DownJumps: {n_down}). "
                f"VETO passive bids and widen maker spread by {spread_mult:.2f}x."
            )
        elif jump_ratio >= self.jump_ratio_thresh and jump_asymmetry >= self.asymmetry_thresh:
            directive = LevyAlphaDirective.MOMENTUM_UPWARD_JUMP_SWEEP
            spread_mult = 1.0
            rationale = (
                f"Aggressive upward jump sweep detected (Asymmetry: +{jump_asymmetry:.2f}, "
                f"JumpRatio: {jump_ratio*100:.1f}%, UpJumps: {n_up}). "
                f"Lift resting offers and piggyback positive momentum."
            )
        elif jump_ratio >= 0.35 and abs(jump_asymmetry) < self.asymmetry_thresh:
            directive = LevyAlphaDirective.SYMMETRIC_HIGH_JUMP_REGIME_WIDEN_SPREADS
            spread_mult = min(2.5, 1.0 + 2.0 * jump_ratio)
            rationale = (
                f"Symmetric high jump volatility regime (JumpRatio: {jump_ratio*100:.1f}%, "
                f"TotalJumps: {n_jumps}). Widen two-sided maker quotes by {spread_mult:.2f}x."
            )
        elif jump_ratio < 0.15 and abs(jump_asymmetry) <= 0.25:
            directive = LevyAlphaDirective.DIFFUSIVE_GAUSSIAN_MARKET_MAKING
            spread_mult = 0.90  # Tight quotes permitted
            rationale = (
                f"Continuous Gaussian diffusion dominant (JumpRatio: {jump_ratio*100:.1f}%, "
                f"ContinuousVol: {cont_vol_ann*100:.1f}%). Safe for tight two-sided Avellaneda-Stoikov quoting."
            )
        else:
            directive = LevyAlphaDirective.EQUILIBRIUM_CALM
            spread_mult = 1.0
            rationale = (
                f"Equilibrium flow. Jump ratio {jump_ratio*100:.1f}%, asymmetry {jump_asymmetry:.2f}."
            )

        calibration = JumpDiffusionCalibration(
            symbol=symbol,
            n_observations=n,
            total_time_sec=round(total_time_sec, 2),
            realized_variance=round(rv, 8),
            bipower_variation=round(bv, 8),
            continuous_vol_annualized=round(cont_vol_ann, 4),
            total_vol_annualized=round(tot_vol_ann, 4),
            jump_variance=round(jump_var, 8),
            jump_ratio=round(jump_ratio, 4),
            jump_count=n_jumps,
            upward_jump_count=n_up,
            downward_jump_count=n_down,
            jump_arrival_intensity=round(jump_intensity, 4),
            jump_asymmetry=round(jump_asymmetry, 4),
            kou_p=round(p_up, 4),
            kou_eta1=round(eta_1, 2),
            kou_eta2=round(eta_2, 2),
            expected_jump_size=round(expected_k, 6),
            drift_compensator=round(drift_compensator, 6),
            directive=directive,
            quote_spread_multiplier=round(spread_mult, 2),
            rationale=rationale,
        )

        self._record_telemetry(calibration)
        return calibration

    def _record_telemetry(self, cal: JumpDiffusionCalibration) -> None:
        """Persists jump diffusion calibration to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO jump_diffusion_telemetry (
                timestamp, symbol, n_obs, rv, bv, jump_variance, jump_ratio,
                jump_count, jump_intensity, jump_asymmetry, kou_p, kou_eta1,
                kou_eta2, expected_jump_k, drift_compensator, directive,
                spread_mult, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cal.timestamp,
                cal.symbol,
                cal.n_observations,
                cal.realized_variance,
                cal.bipower_variation,
                cal.jump_variance,
                cal.jump_ratio,
                cal.jump_count,
                cal.jump_arrival_intensity,
                cal.jump_asymmetry,
                cal.kou_p,
                cal.kou_eta1,
                cal.kou_eta2,
                cal.expected_jump_size,
                cal.drift_compensator,
                cal.directive.value,
                cal.quote_spread_multiplier,
                cal.rationale,
            ),
        )
        conn.commit()

    def get_recent_calibrations(
        self, symbol: Optional[str] = None, limit: int = 10
    ) -> List[Dict]:
        """Retrieves recent calibrations from SQLite telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        if symbol:
            cursor.execute(
                """
                SELECT timestamp, symbol, n_obs, rv, bv, jump_variance, jump_ratio,
                       jump_count, jump_intensity, jump_asymmetry, kou_p, kou_eta1,
                       kou_eta2, expected_jump_k, drift_compensator, directive, spread_mult, rationale
                FROM jump_diffusion_telemetry
                WHERE symbol = ?
                ORDER BY id DESC LIMIT ?
                """,
                (symbol, limit),
            )
        else:
            cursor.execute(
                """
                SELECT timestamp, symbol, n_obs, rv, bv, jump_variance, jump_ratio,
                       jump_count, jump_intensity, jump_asymmetry, kou_p, kou_eta1,
                       kou_eta2, expected_jump_k, drift_compensator, directive, spread_mult, rationale
                FROM jump_diffusion_telemetry
                ORDER BY id DESC LIMIT ?
                """,
                (limit,),
            )

        rows = cursor.fetchall()
        results = []
        for r in rows:
            results.append(
                {
                    "timestamp": r[0],
                    "symbol": r[1],
                    "n_obs": r[2],
                    "rv": r[3],
                    "bv": r[4],
                    "jump_variance": r[5],
                    "jump_ratio": r[6],
                    "jump_count": r[7],
                    "jump_intensity": r[8],
                    "jump_asymmetry": r[9],
                    "kou_p": r[10],
                    "kou_eta1": r[11],
                    "kou_eta2": r[12],
                    "expected_jump_k": r[13],
                    "drift_compensator": r[14],
                    "directive": r[15],
                    "spread_mult": r[16],
                    "rationale": r[17],
                }
            )
        return results

    @staticmethod
    def simulate_kou_path(
        s0: float,
        mu: float,
        sigma: float,
        lambd: float,
        p: float,
        eta1: float,
        eta2: float,
        t_total_sec: float,
        dt_sec: float,
        seed: Optional[int] = None,
    ) -> Tuple[List[float], List[float]]:
        r"""
        Simulates an exact trajectory of a Kou double-exponential jump diffusion process:
        dS_t / S_{t^-} = (\mu - \lambda \bar{k}) dt + \sigma dW_t + (e^Y - 1) dN_t
        Used for quantitative backtesting, synthetic stress verification, and calibration testing.
        """
        if seed is not None:
            random.seed(seed)

        safe_eta1 = max(1.05, eta1)
        term_up = (p * safe_eta1) / (safe_eta1 - 1.0)
        term_down = ((1.0 - p) * eta2) / (eta2 + 1.0)
        k_bar = (term_up + term_down) - 1.0
        drift_comp = mu - lambd * k_bar

        n_steps = int(t_total_sec / dt_sec)
        timestamps = [0.0]
        prices = [s0]
        current_s = s0

        for step in range(1, n_steps + 1):
            t = step * dt_sec
            # Brownian continuous component
            z = random.gauss(0.0, 1.0)
            dW = math.sqrt(dt_sec) * z
            continuous_drift = (drift_comp - 0.5 * sigma * sigma) * dt_sec
            continuous_diff = sigma * dW

            # Poisson jump component
            # Probability of jump in interval dt \approx \lambda * dt
            p_jump = 1.0 - math.exp(-lambd * dt_sec)
            jump_magnitude = 0.0
            if random.random() < p_jump:
                if random.random() < p:
                    # Upward exponential jump
                    jump_magnitude = random.expovariate(eta1)
                else:
                    # Downward exponential jump
                    jump_magnitude = -random.expovariate(eta2)

            log_increment = continuous_drift + continuous_diff + jump_magnitude
            current_s = current_s * math.exp(log_increment)

            timestamps.append(round(t, 4))
            prices.append(round(current_s, 4))

        return timestamps, prices
