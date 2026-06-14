r"""
Cross-Exchange Latency Arbitrage & Lead-Lag Microstructure Engine (Domain 122 / WP-X)
=====================================================================================

Autonomous cross-exchange latency arbitrage and high-frequency lead-lag engine
tailored for dual-listed Indian equities across the National Stock Exchange (NSE)
and Bombay Stock Exchange (BSE).

Mathematical Specifications:
-----------------------------
1. Discrete Lead-Lag Cross-Correlation Function (CCF):
   For synchronized microsecond tick returns r^{NSE} and r^{BSE} across lag window \tau \in [-\tau_{max}, +\tau_{max}]:
       \rho(\tau) = \frac{\sum_t (r_t^{NSE} - \bar{r}^{NSE})(r_{t+\tau}^{BSE} - \bar{r}^{BSE})}{\sigma_{NSE} \cdot \sigma_{BSE}}
   Optimal lead-lag offset:
       \tau^* = \arg\max_\tau |\rho(\tau)|
   If \tau^* > 0: NSE leads BSE by \tau^* ms.
   If \tau^* < 0: BSE leads NSE by |\tau^*| ms.

2. Information Share (Hasbrouck / Gonzalo-Granger Proxy):
   Estimates empirical contribution to the common stochastic efficient price trend:
       IS_{NSE} \approx \frac{\sigma_{BSE}^2 - \rho \sigma_{NSE}\sigma_{BSE}}{\sigma_{NSE}^2 + \sigma_{BSE}^2 - 2\rho \sigma_{NSE}\sigma_{BSE}}

3. Dual-Exchange Cash Discrepancy & Hurdle Sieve:
   Path 1: Buy NSE Ask, Sell BSE Bid:
       \text{Spread}_{1} = \frac{P_{BSE}^{bid} - P_{NSE}^{ask}}{P_{NSE}^{ask}} \times 10,000 \quad \text{(bps)}
   Path 2: Buy BSE Ask, Sell NSE Bid:
       \text{Spread}_{2} = \frac{P_{NSE}^{bid} - P_{BSE}^{ask}}{P_{BSE}^{ask}} \times 10,000 \quad \text{(bps)}

   Indian Cash Equity Intraday (MIS) Statutory Friction Floor:
       - STT: 0.025% (sell side) = 2.5 bps
       - Stamp Duty: 0.003% (buy side) = 0.3 bp
       - Exchange Turnover: 0.0035% = 0.35 bp
       - Brokerage + GST: ~1.2 bps
       Total Friction Floor: \sim 4.35 \text{ to } 5.0 \text{ bps}
       Mandatory Net Hurdle:
           \text{NetSpread} = \text{Spread} - \text{Friction} \ge 3.0 \text{ bps}

4. Stale Quote Sniping with Millisecond TTL:
   When lead venue (NSE) price moves by >= \Delta_{threshold} (e.g. 2.0\sigma)
   and lag venue (BSE) depth remains un-updated, generates high-priority snipe
   order with Time-To-Live (TTL <= 250ms).
"""

from dataclasses import dataclass, field
from datetime import datetime
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class DualExchangeTick:
    symbol: str
    nse_bid: float
    nse_bid_qty: int
    nse_ask: float
    nse_ask_qty: int
    bse_bid: float
    bse_bid_qty: int
    bse_ask: float
    bse_ask_qty: int
    timestamp: datetime


@dataclass
class LeadLagMetrics:
    symbol: str
    optimal_lag_ms: int  # > 0 means NSE leads BSE; < 0 means BSE leads NSE
    peak_cross_correlation: float
    nse_information_share: float  # e.g., 0.88 (88%)
    bse_information_share: float  # e.g., 0.12 (12%)
    regime: str  # 'NSE_DOMINANT_LEAD', 'BSE_TRANSIENT_LEAD', 'SYNCHRONOUS'


@dataclass
class LatencyArbSignal:
    timestamp: datetime
    symbol: str
    path: str  # 'BUY_NSE_SELL_BSE' or 'BUY_BSE_SELL_NSE'
    buy_venue: str
    buy_price: float
    sell_venue: str
    sell_price: float
    gross_spread_bps: float
    friction_bps: float
    net_spread_bps: float
    is_actionable: bool
    executable_shares: int
    ttl_ms: int  # Time-To-Live in milliseconds


class CrossExchangeLatencyEngine:
    """
    Sub-millisecond lead-lag and cross-exchange latency arbitrage engine.
    """

    def __init__(
        self,
        min_net_hurdle_bps: float = 3.0,
        statutory_friction_bps: float = 4.8,
        max_position_shares: int = 1000,
        default_ttl_ms: int = 250,
        db_path: str = ":memory:",
    ):
        self.min_net_hurdle_bps = min_net_hurdle_bps
        self.statutory_friction_bps = statutory_friction_bps
        self.max_position_shares = max_position_shares
        self.default_ttl_ms = default_ttl_ms
        self.db_path = db_path

        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _get_connection() -> sqlite3.Connection:
        pass

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            if self._conn is None:
                self._conn = sqlite3.connect(":memory:")
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS latency_arb_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                path TEXT NOT NULL,
                gross_bps REAL NOT NULL,
                net_bps REAL NOT NULL,
                is_actionable INTEGER NOT NULL,
                executable_shares INTEGER NOT NULL
            )
            """
        )
        conn.commit()

    @staticmethod
    def compute_lead_lag_ccf(
        nse_returns: List[float],
        bse_returns: List[float],
        max_lag: int = 5,
    ) -> Tuple[int, float]:
        r"""
        Computes discrete cross-correlation function over lag offsets \tau \in [-max_lag, +max_lag].
        Returns (optimal_lag, peak_correlation).
        """
        n = len(nse_returns)
        if n < 10 or len(bse_returns) != n:
            return 0, 0.0

        mean_n = sum(nse_returns) / n
        mean_b = sum(bse_returns) / n

        var_n = sum((x - mean_n) ** 2 for x in nse_returns)
        var_b = sum((x - mean_b) ** 2 for x in bse_returns)
        denom = math.sqrt(var_n * var_b)
        if denom < 1e-12:
            return 0, 0.0

        best_lag = 0
        max_corr = -1.0

        for lag in range(-max_lag, max_lag + 1):
            cov = 0.0
            valid_pts = 0
            if lag >= 0:
                for t in range(n - lag):
                    cov += (nse_returns[t] - mean_n) * (bse_returns[t + lag] - mean_b)
                    valid_pts += 1
            else:
                abs_lag = abs(lag)
                for t in range(abs_lag, n):
                    cov += (nse_returns[t] - mean_n) * (bse_returns[t - abs_lag] - mean_b)
                    valid_pts += 1

            if valid_pts > 0:
                corr = cov / denom
                if abs(corr) > max_corr:
                    max_corr = abs(corr)
                    best_lag = lag

        return best_lag, max_corr

    @staticmethod
    def estimate_information_shares(
        nse_returns: List[float],
        bse_returns: List[float],
    ) -> Tuple[float, float]:
        """
        Estimates Hasbrouck Information Share (IS) proxy between NSE and BSE.
        """
        n = len(nse_returns)
        if n < 10:
            return 0.90, 0.10  # Default empirical prior: NSE 90%, BSE 10%

        var_n = sum(x ** 2 for x in nse_returns) / n
        var_b = sum(x ** 2 for x in bse_returns) / n
        cov = sum(a * b for a, b in zip(nse_returns, bse_returns)) / n

        denom = var_n + var_b - 2.0 * cov
        if denom < 1e-12:
            return 0.90, 0.10

        # Variance ratio proxy: asset with smaller error variance has higher information share
        is_nse = (var_b - cov) / denom
        is_nse = min(max(is_nse, 0.05), 0.95)
        return round(is_nse, 4), round(1.0 - is_nse, 4)

    def analyze_lead_lag(
        self,
        symbol: str,
        nse_returns: List[float],
        bse_returns: List[float],
        time_step_ms: int = 50,
    ) -> LeadLagMetrics:
        """
        Determines current exchange hierarchy, lead lag offset in milliseconds,
        and information share.
        """
        best_lag, peak_corr = self.compute_lead_lag_ccf(nse_returns, bse_returns, max_lag=6)
        is_n, is_b = self.estimate_information_shares(nse_returns, bse_returns)

        lag_ms = best_lag * time_step_ms
        if lag_ms > 0:
            regime = 'NSE_DOMINANT_LEAD'
        elif lag_ms < 0:
            regime = 'BSE_TRANSIENT_LEAD'
        else:
            regime = 'SYNCHRONOUS'

        return LeadLagMetrics(
            symbol=symbol,
            optimal_lag_ms=lag_ms,
            peak_cross_correlation=round(peak_corr, 4),
            nse_information_share=is_n,
            bse_information_share=is_b,
            regime=regime,
        )

    def evaluate_arbitrage(
        self,
        tick: DualExchangeTick,
    ) -> Optional[LatencyArbSignal]:
        """
        Evaluates cross-exchange pricing between NSE and BSE order books.
        """
        if (
            tick.nse_bid <= 0 or tick.nse_ask <= 0 or
            tick.bse_bid <= 0 or tick.bse_ask <= 0
        ):
            return None

        # Path 1: Buy NSE Ask, Sell BSE Bid
        spread_1_bps = ((tick.bse_bid - tick.nse_ask) / tick.nse_ask) * 10000.0
        # Path 2: Buy BSE Ask, Sell NSE Bid
        spread_2_bps = ((tick.nse_bid - tick.bse_ask) / tick.bse_ask) * 10000.0

        if spread_1_bps > spread_2_bps:
            chosen_path = 'BUY_NSE_SELL_BSE'
            gross_bps = spread_1_bps
            buy_v = 'NSE'
            buy_p = tick.nse_ask
            sell_v = 'BSE'
            sell_p = tick.bse_bid
            avail_shares = min(tick.nse_ask_qty, tick.bse_bid_qty)
        else:
            chosen_path = 'BUY_BSE_SELL_NSE'
            gross_bps = spread_2_bps
            buy_v = 'BSE'
            buy_p = tick.bse_ask
            sell_v = 'NSE'
            sell_p = tick.nse_bid
            avail_shares = min(tick.bse_ask_qty, tick.nse_bid_qty)

        net_bps = gross_bps - self.statutory_friction_bps
        is_actionable = net_bps >= self.min_net_hurdle_bps and avail_shares > 0
        exec_shares = min(avail_shares, self.max_position_shares) if is_actionable else 0

        signal = LatencyArbSignal(
            timestamp=tick.timestamp,
            symbol=tick.symbol,
            path=chosen_path,
            buy_venue=buy_v,
            buy_price=buy_p,
            sell_venue=sell_v,
            sell_price=sell_p,
            gross_spread_bps=round(gross_bps, 2),
            friction_bps=self.statutory_friction_bps,
            net_spread_bps=round(net_bps, 2),
            is_actionable=is_actionable,
            executable_shares=exec_shares,
            ttl_ms=self.default_ttl_ms,
        )

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO latency_arb_telemetry (
                timestamp, symbol, path, gross_bps, net_bps, is_actionable, executable_shares
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tick.timestamp.isoformat(),
                tick.symbol,
                chosen_path,
                signal.gross_spread_bps,
                signal.net_spread_bps,
                1 if is_actionable else 0,
                exec_shares,
            )
        )
        conn.commit()

        return signal
