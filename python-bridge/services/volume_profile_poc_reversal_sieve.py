r"""
Domain 193 (WP-CQ): Intraday Volume Profile Point-of-Control (POC) & Value Area Reversal Sieve

Implements Steidlmayer (1986) & Dalton (2007) market profile volume-at-price decomposition:
- Point-of-Control (POC) modal price discovery
- 70% Value Area [VAL, VAH] iterative dual-step volume expansion
- High-Volume Nodes (HVN) institutional fair-value consensus identification
- Low-Volume Nodes (LVN) liquidity voids / breakout slippage cavity identification
- Quantitative market profile trading directives:
    * Responsive buyer reversal long from Value Area Low (VAL -> POC)
    * Responsive seller reversal short from Value Area High (VAH -> POC)
    * Initiative breakout acceleration chase through LVN cavities
    * POC magnetic equilibrium market making chop
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


class VolumeProfileDirective(str, Enum):
    VALUE_AREA_REJECTION_REVERSAL_LONG = "VALUE_AREA_REJECTION_REVERSAL_LONG"
    VALUE_AREA_REJECTION_REVERSAL_SHORT = "VALUE_AREA_REJECTION_REVERSAL_SHORT"
    VALUE_AREA_BREAKOUT_EXPANSION_CHASE = "VALUE_AREA_BREAKOUT_EXPANSION_CHASE"
    POC_MAGNETIC_EQUILIBRIUM_CHOP = "POC_MAGNETIC_EQUILIBRIUM_CHOP"


@dataclass
class TradeTick:
    timestamp_sec: float
    price: float
    volume: float


@dataclass
class VolumeProfileBucket:
    price_level: float
    volume: float
    volume_fraction: float
    is_poc: bool
    is_hvn: bool
    is_lvn: bool
    in_value_area: bool


@dataclass
class VolumeProfileReport:
    symbol: str
    current_price: float
    poc_price: float
    vah_price: float
    val_price: float
    total_volume: float
    value_area_volume: float
    value_area_fraction: float
    hvn_levels: List[float]
    lvn_levels: List[float]
    directive: VolumeProfileDirective
    recommended_entry: float
    recommended_stop_loss: float
    recommended_take_profit: float
    rationale: str
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class VolumeProfilePOCReversalSieve:
    r"""
    Microstructure Volume Profile & Point-of-Control (POC) Sieve.
    Bins high-frequency execution flow into volume-at-price nodes to establish
    institutional fair value, identify liquidity voids, and execute responsive reversals.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        price_step: float = 1.0,  # Price bucket size in points (e.g. 1.0 INR for NIFTY)
        value_area_ratio: float = 0.70,  # Standard 70% value area
    ):
        self.db_path = db_path
        self.price_step = max(0.01, price_step)
        self.va_ratio = value_area_ratio

        self._conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for volume profile telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS volume_profile_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                current_price REAL NOT NULL,
                poc REAL NOT NULL,
                vah REAL NOT NULL,
                val REAL NOT NULL,
                total_vol REAL NOT NULL,
                va_vol REAL NOT NULL,
                directive TEXT NOT NULL,
                entry REAL NOT NULL,
                stop_loss REAL NOT NULL,
                take_profit REAL NOT NULL,
                rationale TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def _round_price(self, p: float) -> float:
        """Snaps price to discrete bucket increment."""
        return round(round(p / self.price_step) * self.price_step, 4)

    def build_profile(
        self, ticks: List[TradeTick]
    ) -> Tuple[Dict[float, float], float, float, float, List[float], List[float]]:
        r"""
        Constructs Volume-at-Price distribution and applies Dalton Value Area expansion algorithm:
        1. Bin volumes: V(p)
        2. Identify POC = \arg\max V(p)
        3. Iteratively expand outward from POC until \sum V(p) >= 0.70 * V_{tot}
        4. Detect High-Volume Nodes (HVN) and Low-Volume Nodes (LVN)
        """
        if not ticks:
            return {}, 0.0, 0.0, 0.0, [], []

        # 1. Bin volumes
        profile: Dict[float, float] = {}
        total_vol = 0.0
        for tk in ticks:
            bp = self._round_price(tk.price)
            profile[bp] = profile.get(bp, 0.0) + tk.volume
            total_vol += tk.volume

        if total_vol <= 0:
            return {}, 0.0, 0.0, 0.0, [], []

        sorted_prices = sorted(profile.keys())

        # 2. Identify Point-of-Control (POC)
        poc_price = max(sorted_prices, key=lambda p: profile[p])

        # 3. Dalton Value Area Algorithm (expand 70% around POC)
        target_va_vol = self.va_ratio * total_vol
        va_vol = profile[poc_price]
        va_prices = {poc_price}

        poc_idx = sorted_prices.index(poc_price)
        up_idx = poc_idx + 1
        down_idx = poc_idx - 1

        while va_vol < target_va_vol and (up_idx < len(sorted_prices) or down_idx >= 0):
            # Inspect 2 levels up vs 2 levels down
            up_vol = 0.0
            if up_idx < len(sorted_prices):
                up_vol += profile[sorted_prices[up_idx]]
                if up_idx + 1 < len(sorted_prices):
                    up_vol += profile[sorted_prices[up_idx + 1]]

            down_vol = 0.0
            if down_idx >= 0:
                down_vol += profile[sorted_prices[down_idx]]
                if down_idx - 1 >= 0:
                    down_vol += profile[sorted_prices[down_idx - 1]]

            if up_vol >= down_vol and up_idx < len(sorted_prices):
                va_vol += profile[sorted_prices[up_idx]]
                va_prices.add(sorted_prices[up_idx])
                up_idx += 1
            elif down_idx >= 0:
                va_vol += profile[sorted_prices[down_idx]]
                va_prices.add(sorted_prices[down_idx])
                down_idx -= 1
            else:
                break

        val_price = min(va_prices)
        vah_price = max(va_prices)

        # 4. Statistical High-Volume Nodes (HVN) and Low-Volume Nodes (LVN)
        vol_values = list(profile.values())
        mean_vol = sum(vol_values) / float(len(vol_values))
        var_vol = sum((v - mean_vol) ** 2 for v in vol_values) / max(1, len(vol_values))
        std_vol = math.sqrt(var_vol)

        hvn_levels: List[float] = []
        lvn_levels: List[float] = []

        for p in sorted_prices:
            v = profile[p]
            if v >= mean_vol + 1.25 * std_vol:
                hvn_levels.append(p)
            elif v <= max(0.0, mean_vol - 0.75 * std_vol):
                lvn_levels.append(p)

        return profile, poc_price, vah_price, val_price, hvn_levels, lvn_levels

    def evaluate_market_profile(
        self, symbol: str, current_price: float, ticks: List[TradeTick]
    ) -> VolumeProfileReport:
        r"""
        Evaluates current price location relative to POC, VAH, VAL, and LVN cavities.
        Issues high-frequency reversal or breakout momentum directives.
        """
        now_ts = datetime.now(timezone.utc).isoformat()
        if not ticks:
            return VolumeProfileReport(
                symbol=symbol,
                current_price=current_price,
                poc_price=current_price,
                vah_price=current_price,
                val_price=current_price,
                total_volume=0.0,
                value_area_volume=0.0,
                value_area_fraction=0.0,
                hvn_levels=[],
                lvn_levels=[],
                directive=VolumeProfileDirective.POC_MAGNETIC_EQUILIBRIUM_CHOP,
                recommended_entry=current_price,
                recommended_stop_loss=current_price,
                recommended_take_profit=current_price,
                rationale="No trade ticks available.",
                timestamp=now_ts,
            )

        profile, poc, vah, val, hvns, lvns = self.build_profile(ticks)
        total_vol = sum(profile.values())
        va_vol = sum(profile[p] for p in profile if val <= p <= vah)
        va_frac = (va_vol / total_vol) if total_vol > 0 else 0.0

        # Proximity threshold: within 0.25% of key levels
        prox_val = abs(current_price - val) / max(1.0, current_price)
        prox_vah = abs(current_price - vah) / max(1.0, current_price)
        prox_poc = abs(current_price - poc) / max(1.0, current_price)

        # Directive Sieve
        tolerance = max(2.0 * self.price_step, 0.001 * current_price)

        # Case 1: Initiative Breakout into LVN Void (Price clearly outside Value Area)
        if current_price > vah + 1.5 * self.price_step or current_price < val - 1.5 * self.price_step:
            directive = VolumeProfileDirective.VALUE_AREA_BREAKOUT_EXPANSION_CHASE
            entry = current_price
            if current_price > vah:
                stop_loss = round(vah - 2.0 * self.price_step, 2)
                take_profit = round(current_price + (vah - val) * 0.5, 2)
                side_str = "Bullish"
            else:
                stop_loss = round(val + 2.0 * self.price_step, 2)
                take_profit = round(current_price - (vah - val) * 0.5, 2)
                side_str = "Bearish"

            rationale = (
                f"{side_str} initiative breakout outside Value Area [{val:.2f}, {vah:.2f}]. "
                f"Accelerating through Low-Volume Node cavity."
            )
        # Case 2: Rejection at VAH (Price in upper region testing VAH)
        elif abs(current_price - vah) <= tolerance and current_price > poc:
            directive = VolumeProfileDirective.VALUE_AREA_REJECTION_REVERSAL_SHORT
            entry = current_price
            stop_loss = round(vah + 3.0 * self.price_step, 2)
            take_profit = poc
            rationale = (
                f"Responsive sellers rejecting Value Area High ({vah:.2f}). "
                f"Mean-reversion target to POC ({poc:.2f}) with stop above VAH."
            )
        # Case 3: Rejection at VAL (Price in lower region testing VAL)
        elif abs(current_price - val) <= tolerance and current_price < poc:
            directive = VolumeProfileDirective.VALUE_AREA_REJECTION_REVERSAL_LONG
            entry = current_price
            stop_loss = round(val - 3.0 * self.price_step, 2)
            take_profit = poc
            rationale = (
                f"Responsive buyers defending Value Area Low ({val:.2f}). "
                f"Mean-reversion target to POC ({poc:.2f}) with tight risk below VAL."
            )
        # Case 4: Magnetic POC Equilibrium
        else:
            directive = VolumeProfileDirective.POC_MAGNETIC_EQUILIBRIUM_CHOP
            entry = current_price
            stop_loss = round(val, 2)
            take_profit = round(vah, 2)
            rationale = (
                f"Price oscillating near POC fair value ({poc:.2f}). "
                f"Two-sided market making chop within Value Area [{val:.2f}, {vah:.2f}]."
            )

        report = VolumeProfileReport(
            symbol=symbol,
            current_price=round(current_price, 2),
            poc_price=round(poc, 2),
            vah_price=round(vah, 2),
            val_price=round(val, 2),
            total_volume=round(total_vol, 2),
            value_area_volume=round(va_vol, 2),
            value_area_fraction=round(va_frac, 4),
            hvn_levels=hvns,
            lvn_levels=lvns,
            directive=directive,
            recommended_entry=round(entry, 2),
            recommended_stop_loss=round(stop_loss, 2),
            recommended_take_profit=round(take_profit, 2),
            rationale=rationale,
            timestamp=now_ts,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: VolumeProfileReport) -> None:
        """Persists profile metrics to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO volume_profile_telemetry (
                timestamp, symbol, current_price, poc, vah, val,
                total_vol, va_vol, directive, entry, stop_loss, take_profit, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.current_price,
                rep.poc_price,
                rep.vah_price,
                rep.val_price,
                rep.total_volume,
                rep.value_area_volume,
                rep.directive.value,
                rep.recommended_entry,
                rep.recommended_stop_loss,
                rep.recommended_take_profit,
                rep.rationale,
            ),
        )
        conn.commit()

    def get_recent_profiles(
        self, symbol: Optional[str] = None, limit: int = 10
    ) -> List[Dict]:
        """Retrieves recent profile telemetry from SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        if symbol:
            cursor.execute(
                """
                SELECT timestamp, symbol, current_price, poc, vah, val,
                       total_vol, va_vol, directive, entry, stop_loss, take_profit, rationale
                FROM volume_profile_telemetry
                WHERE symbol = ?
                ORDER BY id DESC LIMIT ?
                """,
                (symbol, limit),
            )
        else:
            cursor.execute(
                """
                SELECT timestamp, symbol, current_price, poc, vah, val,
                       total_vol, va_vol, directive, entry, stop_loss, take_profit, rationale
                FROM volume_profile_telemetry
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
                    "current_price": r[2],
                    "poc": r[3],
                    "vah": r[4],
                    "val": r[5],
                    "total_vol": r[6],
                    "va_vol": r[7],
                    "directive": r[8],
                    "entry": r[9],
                    "stop_loss": r[10],
                    "take_profit": r[11],
                    "rationale": r[12],
                }
            )
        return results
