"""
Domain 166 (WP-BP): Intraday Volume POC Transition & Market Profile Value Area Sieve

Implements Steidlmayer / CBOT Market Profile value area (70% volume distribution),
dynamic Volume Point of Control (VPOC) detection, intraday POC migration velocity,
and Virgin POC (vPOC) magnet attractor telemetry for institutional auction market trading.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class CandleBar:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class ValueAreaResult:
    poc: float
    vah: float
    val: float
    total_volume: float
    poc_volume: float
    va_volume: float
    va_ratio: float


@dataclass
class VolumePOCReport:
    symbol: str
    current_price: float
    poc: float
    vah: float
    val: float
    total_volume: float
    poc_volume: float
    poc_migration_velocity: float
    nearest_vpoc: Optional[float]
    distance_to_nearest_vpoc_bps: Optional[float]
    regime: str
    trade_directive: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VolumePOCTransitionSieve:
    """
    Intraday Volume POC Transition & Market Profile Value Area Sieve.
    Calculates 70% Value Area (VAH/VAL), VPOC, Migration Velocity, and Virgin POC Gravitational Pull.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        bin_size: float = 0.50,
        va_ratio_target: float = 0.70,
    ):
        self.db_path = db_path
        self.bin_size = max(0.01, bin_size)
        self.va_ratio_target = va_ratio_target
        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Volume Profile telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS volume_poc_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                current_price REAL NOT NULL,
                poc REAL NOT NULL,
                vah REAL NOT NULL,
                val REAL NOT NULL,
                total_volume REAL NOT NULL,
                poc_volume REAL NOT NULL,
                poc_migration_velocity REAL NOT NULL,
                nearest_vpoc REAL,
                distance_to_vpoc_bps REAL,
                regime TEXT NOT NULL,
                trade_directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def _quantize_price(self, price: float) -> float:
        """Rounds price to nearest bin multiple."""
        return round(round(price / self.bin_size) * self.bin_size, 4)

    def build_volume_profile(self, bars: List[CandleBar]) -> Dict[float, float]:
        """
        Discretizes candle volumes across price bins.
        Distributes candle volume using a triangular kernel centered at the typical price
        (open + high + low + 2*close)/5 to reflect higher trade intensity at fair value.
        """
        if not bars:
            return {}

        profile: Dict[float, float] = {}

        for bar in bars:
            if bar.volume <= 0:
                continue

            low_bin = self._quantize_price(bar.low)
            high_bin = self._quantize_price(bar.high)

            if low_bin == high_bin:
                profile[low_bin] = profile.get(low_bin, 0.0) + bar.volume
            else:
                steps = max(1, int(round((high_bin - low_bin) / self.bin_size)))
                p_center = (bar.open + bar.high + bar.low + 2.0 * bar.close) / 5.0
                half_span = max(self.bin_size, (bar.high - bar.low) / 2.0)

                bin_prices = [round(low_bin + s * self.bin_size, 4) for s in range(steps + 1)]
                raw_weights = [
                    max(0.15, 1.0 - (abs(p - p_center) / (half_span * 1.25)))
                    for p in bin_prices
                ]
                total_w = sum(raw_weights)

                for p, w in zip(bin_prices, raw_weights):
                    allocated_vol = bar.volume * (w / total_w)
                    profile[p] = profile.get(p, 0.0) + allocated_vol

        return profile

    def calculate_value_area(self, profile: Dict[float, float]) -> ValueAreaResult:
        """
        Calculates CBOT Steidlmayer 70% Value Area:
        1. Identifies VPOC (bin with highest volume).
        2. Iteratively expands outward from VPOC by comparing volume above vs below.
        3. Stops when cumulative volume reaches target (default 70%).
        """
        if not profile:
            return ValueAreaResult(
                poc=0.0, vah=0.0, val=0.0, total_volume=0.0, poc_volume=0.0, va_volume=0.0, va_ratio=0.0
            )

        sorted_prices = sorted(profile.keys())
        total_vol = sum(profile.values())
        target_va_vol = total_vol * self.va_ratio_target

        # Find POC with robust tie-breaking (median candidate)
        max_vol = max(profile.values())
        top_candidates = [p for p in sorted_prices if profile[p] >= max_vol - 1e-5]
        poc_price = top_candidates[len(top_candidates) // 2]
        poc_vol = profile[poc_price]

        poc_idx = sorted_prices.index(poc_price)
        idx_above = poc_idx + 1
        idx_below = poc_idx - 1

        va_vol = poc_vol
        va_indices = {poc_idx}

        while va_vol < target_va_vol and (idx_above < len(sorted_prices) or idx_below >= 0):
            vol_above = 0.0
            vol_below = 0.0

            if idx_above < len(sorted_prices):
                vol_above += profile[sorted_prices[idx_above]]
                if idx_above + 1 < len(sorted_prices):
                    vol_above += profile[sorted_prices[idx_above + 1]]

            if idx_below >= 0:
                vol_below += profile[sorted_prices[idx_below]]
                if idx_below - 1 >= 0:
                    vol_below += profile[sorted_prices[idx_below - 1]]

            if idx_above < len(sorted_prices) and (idx_below < 0 or vol_above >= vol_below):
                va_indices.add(idx_above)
                va_vol += profile[sorted_prices[idx_above]]
                if idx_above + 1 < len(sorted_prices) and vol_above >= vol_below:
                    va_indices.add(idx_above + 1)
                    va_vol += profile[sorted_prices[idx_above + 1]]
                    idx_above += 2
                else:
                    idx_above += 1
            elif idx_below >= 0:
                va_indices.add(idx_below)
                va_vol += profile[sorted_prices[idx_below]]
                if idx_below - 1 >= 0 and vol_below > vol_above:
                    va_indices.add(idx_below - 1)
                    va_vol += profile[sorted_prices[idx_below - 1]]
                    idx_below -= 2
                else:
                    idx_below -= 1
            else:
                break

        va_prices = [sorted_prices[i] for i in va_indices]
        vah = max(va_prices)
        val = min(va_prices)
        va_ratio = va_vol / total_vol if total_vol > 0 else 0.0

        return ValueAreaResult(
            poc=poc_price,
            vah=vah,
            val=val,
            total_volume=round(total_vol, 2),
            poc_volume=round(poc_vol, 2),
            va_volume=round(va_vol, 2),
            va_ratio=round(va_ratio, 4),
        )

    def calculate_poc_migration_velocity(
        self,
        bar_windows: List[List[CandleBar]],
        window_minutes: float = 15.0,
    ) -> float:
        """
        Calculates migration velocity of VPOC across consecutive time windows:
        v_poc = (POC_t - POC_0) / Delta_t (points/hour or points/min).
        """
        if len(bar_windows) < 2:
            return 0.0

        pocs = []
        for win in bar_windows:
            if not win:
                continue
            prof = self.build_volume_profile(win)
            if prof:
                va = self.calculate_value_area(prof)
                pocs.append(va.poc)

        if len(pocs) < 2:
            return 0.0

        total_time_hours = (len(pocs) - 1) * (window_minutes / 60.0)
        if total_time_hours <= 0:
            return 0.0

        delta_poc = pocs[-1] - pocs[0]
        return round(delta_poc / total_time_hours, 4)

    def find_virgin_pocs(
        self,
        historical_pocs: List[float],
        subsequent_bars: List[CandleBar],
    ) -> List[float]:
        """
        Filters historical POCs that have NEVER been traversed by subsequent price action.
        A POC is considered tested/filled if any bar has Low <= POC <= High.
        """
        if not historical_pocs:
            return []

        virgin_pocs = []
        for hpoc in historical_pocs:
            tested = False
            for bar in subsequent_bars:
                if bar.low <= hpoc <= bar.high:
                    tested = True
                    break
            if not tested:
                virgin_pocs.append(hpoc)

        return virgin_pocs

    def analyze_market_profile(
        self,
        symbol: str,
        current_bars: List[CandleBar],
        prior_windows: Optional[List[List[CandleBar]]] = None,
        historical_pocs: Optional[List[float]] = None,
    ) -> VolumePOCReport:
        """
        Runs comprehensive Market Profile auction market sieve.
        Classifies auction state into:
        - VALUE_AREA_EXPANSION_BULLISH
        - VALUE_AREA_EXPANSION_BEARISH
        - ROTATIONAL_POC_EQUILIBRIUM
        - VPOC_MAGNET_ATTRACTION
        - VALUE_REJECTION_SPRING
        - VALUE_REJECTION_UPTHRUST
        """
        if not current_bars:
            raise ValueError("current_bars cannot be empty")

        profile = self.build_volume_profile(current_bars)
        va = self.calculate_value_area(profile)
        current_price = current_bars[-1].close

        # Calculate POC migration velocity
        windows = prior_windows if prior_windows else [current_bars]
        migration_velocity = self.calculate_poc_migration_velocity(windows)

        # Check Virgin POCs
        nearest_vpoc = None
        dist_vpoc_bps = None
        if historical_pocs:
            v_pocs = self.find_virgin_pocs(historical_pocs, current_bars)
            if v_pocs:
                # Find nearest
                nearest_vpoc = min(v_pocs, key=lambda p: abs(p - current_price))
                dist_vpoc_bps = round(((nearest_vpoc - current_price) / current_price) * 10000, 2)

        # Determine Auction Regime and Directives
        regime = "ROTATIONAL_POC_EQUILIBRIUM"
        directive = "HOLD_DELTA_NEUTRAL"

        # Check VPOC Magnet Condition (within 30 bps of virgin POC)
        if dist_vpoc_bps is not None and abs(dist_vpoc_bps) <= 30.0:
            regime = "VPOC_MAGNET_ATTRACTION"
            if dist_vpoc_bps > 0:
                directive = "EXECUTE_LONG_MAGNET_TARGET"
            else:
                directive = "EXECUTE_SHORT_MAGNET_TARGET"
        elif current_price > va.vah:
            if migration_velocity > 5.0:
                regime = "VALUE_AREA_EXPANSION_BULLISH"
                directive = "INITIATIVE_LONG_BREAKOUT"
            else:
                regime = "VALUE_REJECTION_UPTHRUST"
                directive = "FADE_OVERBOUGHT_RETURN_TO_VAH"
        elif current_price < va.val:
            if migration_velocity < -5.0:
                regime = "VALUE_AREA_EXPANSION_BEARISH"
                directive = "INITIATIVE_SHORT_BREAKDOWN"
            else:
                regime = "VALUE_REJECTION_SPRING"
                directive = "FADE_OVERSOLD_RETURN_TO_VAL"
        else:
            # Inside Value Area
            if abs(current_price - va.poc) / va.poc < 0.0015:
                regime = "ROTATIONAL_POC_EQUILIBRIUM"
                directive = "QUOTING_MARKET_MAKING"
            elif current_price > va.poc:
                regime = "ROTATIONAL_POC_UPPER_HALF"
                directive = "MEAN_REVERSION_SHORT_TO_POC"
            else:
                regime = "ROTATIONAL_POC_LOWER_HALF"
                directive = "MEAN_REVERSION_LONG_TO_POC"

        report = VolumePOCReport(
            symbol=symbol,
            current_price=round(current_price, 2),
            poc=round(va.poc, 2),
            vah=round(va.vah, 2),
            val=round(va.val, 2),
            total_volume=va.total_volume,
            poc_volume=va.poc_volume,
            poc_migration_velocity=migration_velocity,
            nearest_vpoc=nearest_vpoc,
            distance_to_nearest_vpoc_bps=dist_vpoc_bps,
            regime=regime,
            trade_directive=directive,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: VolumePOCReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO volume_poc_telemetry (
                timestamp, symbol, current_price, poc, vah, val,
                total_volume, poc_volume, poc_migration_velocity,
                nearest_vpoc, distance_to_vpoc_bps, regime, trade_directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.current_price,
                rep.poc,
                rep.vah,
                rep.val,
                rep.total_volume,
                rep.poc_volume,
                rep.poc_migration_velocity,
                rep.nearest_vpoc,
                rep.distance_to_nearest_vpoc_bps,
                rep.regime,
                rep.trade_directive,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest persisted telemetry rows."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, current_price, poc, vah, val, regime, trade_directive
            FROM volume_poc_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
