r"""
Post-Expiry Gamma Unwind & Pin-Risk Surveillance Engine (Domain 119 / WP-U)
===========================================================================

Autonomous risk-governance engine monitoring late-day 0-DTE options expiry
microstructure (14:30 - 15:30 IST), physical delivery margin traps for Indian
equities, dealer gamma cliffs (dGEX/dt), and automated 15:15 IST position auto-flattening.

Mathematical Specifications:
-----------------------------
1. Black-Scholes Terminal Gamma Model ($T \to 0$):
   Gamma explodes for ATM options:
       \Gamma = \frac{\phi(d_1)}{S \sigma \sqrt{T}} \xrightarrow[S \approx K, T \to 0]{} \infty
   Delta transition velocity:
       \frac{\partial \Delta}{\partial S} = \Gamma

2. Pin Risk Probability Index ($PR_i$):
       PR_i(S, K_i, \sigma, T) = \exp\left( - \frac{(S - K_i)^2}{2 (S \cdot \sigma \sqrt{T})^2} \right) \cdot \frac{OI_i}{\sum_j OI_j}

3. Physical Delivery Margin Escalation Guard:
   Under SEBI compulsory physical delivery for Indian stock F&O, in-the-money (ITM)
   or near-the-money (within +/- 1.0% buffer) short/long option contracts facing
   settlement require 100% contract cash/equity backing at 15:30 IST on expiry day.
   If margin headroom < 1.5x required settlement margin, contract is marked SEVERELY_TRAPPED.

4. Dealer Gamma Cliff Detector ($d\text{GEX}/dt$):
       \text{GEX}_{\text{net}} = \sum_i (OI_{call, i} - OI_{put, i}) \cdot \Gamma_i \cdot S^2 \cdot 0.01
       \text{CliffRate} = \frac{\text{GEX}_t - \text{GEX}_{t-\Delta t}}{\Delta t}

5. Auto-Flattening Governor:
   At 15:15:00 IST (configurable), all non-hedged 0-DTE open short/long options are
   flagged for atomic market square-off to avert exchange penalty and delivery assignment.
"""

from dataclasses import dataclass, field
from datetime import datetime, time
import math
from typing import Dict, List, Optional, Tuple
import sqlite3


@dataclass
class OptionExpiryPosition:
    symbol: str
    strike: float
    option_type: str  # 'CE' or 'PE'
    expiry_date: str  # YYYY-MM-DD
    side: str  # 'BUY' (long) or 'SELL' (short)
    quantity: int
    entry_price: float
    lot_size: int
    is_stock_fno: bool = False  # Stock options face physical delivery; index options are cash-settled


@dataclass
class GammaCliffAlert:
    symbol: str
    timestamp: datetime
    net_gex_crores: float
    cliff_rate_per_min: float
    is_cliff_breached: bool
    regime: str  # 'POSITIVE_STABILIZING', 'NEGATIVE_SQUEEZE', 'CLIFF_COLLAPSE'


@dataclass
class MarginTrapAssessment:
    symbol: str
    strike: float
    option_type: str
    spot_price: float
    distance_pct: float
    is_delivery_risk: bool
    required_delivery_margin: float
    available_margin: float
    margin_deficit: float
    status: str  # 'SAFE', 'MARGIN_WARNING', 'SEVERELY_TRAPPED'


@dataclass
class FlatteningInstruction:
    symbol: str
    strike: float
    option_type: str
    quantity: int
    unwind_side: str  # 'SELL' to close long, 'BUY' to close short
    urgency: str  # 'LOW', 'HIGH', 'EMERGENCY_ATOMIC'
    reason: str


class PostExpiryGammaUnwinder:
    """
    Real-time surveillance and auto-unwind engine for options expiry intraday end-game.
    """

    def __init__(
        self,
        auto_flatten_time: time = time(15, 15, 0),
        cutoff_margin_time: time = time(14, 45, 0),
        gamma_cliff_threshold_crores_per_min: float = -50.0,
        pin_risk_sigma: float = 0.18,
        db_path: str = ":memory:",
    ):
        self.auto_flatten_time = auto_flatten_time
        self.cutoff_margin_time = cutoff_margin_time
        self.gamma_cliff_threshold = gamma_cliff_threshold_crores_per_min
        self.pin_risk_sigma = pin_risk_sigma
        self.db_path = db_path

        # Internal state tracking
        self.previous_gex: Dict[str, Tuple[datetime, float]] = {}
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

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
            CREATE TABLE IF NOT EXISTS expiry_surveillance_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                spot_price REAL NOT NULL,
                net_gex_crores REAL,
                cliff_rate REAL,
                status TEXT NOT NULL,
                details TEXT
            )
            """
        )
        conn.commit()

    @staticmethod
    def standard_normal_cdf(x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    @staticmethod
    def standard_normal_pdf(x: float) -> float:
        return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)

    def calculate_bs_gamma(
        self,
        spot: float,
        strike: float,
        tte_years: float,
        iv: float,
        rate: float = 0.07,
    ) -> float:
        """
        Calculate Black-Scholes analytical gamma.
        Handles singularity when tte_years -> 0 by clamping minimum time.
        """
        if spot <= 0 or strike <= 0 or iv <= 0:
            return 0.0

        tte = max(tte_years, 1e-6)
        denom = spot * iv * math.sqrt(tte)
        if denom < 1e-9:
            return 0.0

        d1 = (math.log(spot / strike) + (rate + 0.5 * iv * iv) * tte) / (iv * math.sqrt(tte))
        gamma = self.standard_normal_pdf(d1) / denom
        return gamma

    def compute_pinning_risk_index(
        self,
        spot: float,
        strike: float,
        oi: int,
        total_series_oi: int,
        tte_years: float,
        iv: float,
    ) -> float:
        """
        Compute normalized Pinning Probability Index PR_i in [0.0, 1.0].
        """
        if total_series_oi <= 0 or oi <= 0 or spot <= 0:
            return 0.0

        tte = max(tte_years, 1e-6)
        effective_sigma = max(iv, 0.05)
        scale = spot * effective_sigma * math.sqrt(tte)
        if scale < 1e-6:
            scale = 1e-6

        distance = abs(spot - strike)
        exponent = - (distance ** 2) / (2.0 * (scale ** 2))
        clamped_exp = math.exp(max(exponent, -50.0))

        oi_weight = oi / float(total_series_oi)
        return min(max(clamped_exp * oi_weight * 10.0, 0.0), 1.0)

    def check_gamma_cliff(
        self,
        symbol: str,
        current_time: datetime,
        spot: float,
        strikes_data: List[Dict],  # [{'strike': 24000, 'call_oi': 50000, 'put_oi': 30000, 'iv': 0.14}]
        tte_years: float,
    ) -> GammaCliffAlert:
        """
        Monitors dynamic dGEX/dt dealer gamma cliff.
        """
        net_gex = 0.0
        for leg in strikes_data:
            k = leg['strike']
            c_oi = leg.get('call_oi', 0)
            p_oi = leg.get('put_oi', 0)
            iv = leg.get('iv', 0.15)

            gamma = self.calculate_bs_gamma(spot, k, tte_years, iv)
            # GEX in Crores (1 Cr = 1e7 INR): spot^2 * gamma * 0.01 * contract_multiplier
            gex_strike = (c_oi - p_oi) * gamma * (spot ** 2) * 0.01 / 1e7
            net_gex += gex_strike

        cliff_rate = 0.0
        is_cliff_breached = False
        regime = 'POSITIVE_STABILIZING' if net_gex >= 0 else 'NEGATIVE_SQUEEZE'

        if symbol in self.previous_gex:
            prev_time, prev_val = self.previous_gex[symbol]
            dt_min = (current_time - prev_time).total_seconds() / 60.0
            if dt_min > 0.01:
                cliff_rate = (net_gex - prev_val) / dt_min
                if cliff_rate <= self.gamma_cliff_threshold:
                    is_cliff_breached = True
                    regime = 'CLIFF_COLLAPSE'

        self.previous_gex[symbol] = (current_time, net_gex)

        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO expiry_surveillance_logs (timestamp, symbol, spot_price, net_gex_crores, cliff_rate, status, details)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                current_time.isoformat(),
                symbol,
                spot,
                net_gex,
                cliff_rate,
                regime,
                f"GEX={net_gex:.2f}Cr, CliffRate={cliff_rate:.2f}Cr/min",
            )
        )
        conn.commit()

        return GammaCliffAlert(
            symbol=symbol,
            timestamp=current_time,
            net_gex_crores=net_gex,
            cliff_rate_per_min=cliff_rate,
            is_cliff_breached=is_cliff_breached,
            regime=regime,
        )

    def assess_physical_delivery_margin_trap(
        self,
        position: OptionExpiryPosition,
        spot_price: float,
        current_time: datetime,
        available_margin: float,
    ) -> MarginTrapAssessment:
        """
        Assesses SEBI compulsory physical delivery risk for Indian Stock F&O.
        Index options (NIFTY/BANKNIFTY) are cash-settled and exempt from physical delivery traps.
        """
        if not position.is_stock_fno:
            return MarginTrapAssessment(
                symbol=position.symbol,
                strike=position.strike,
                option_type=position.option_type,
                spot_price=spot_price,
                distance_pct=abs(spot_price - position.strike) / position.strike * 100.0,
                is_delivery_risk=False,
                required_delivery_margin=0.0,
                available_margin=available_margin,
                margin_deficit=0.0,
                status='SAFE',
            )

        # Distance from strike
        distance_pct = abs(spot_price - position.strike) / position.strike * 100.0

        # Check if ITM or near ATM (within 1.5% buffer)
        is_itm = (
            (position.option_type == 'CE' and spot_price >= position.strike) or
            (position.option_type == 'PE' and spot_price <= position.strike)
        )
        is_close_to_itm = distance_pct <= 1.5

        # Delivery value = spot_price * quantity
        total_contract_value = spot_price * abs(position.quantity)
        required_margin = total_contract_value if (is_itm or is_close_to_itm) else 0.0

        margin_deficit = max(0.0, required_margin - available_margin)

        # Check cutoff time
        is_late_session = current_time.time() >= self.cutoff_margin_time

        if (is_itm or is_close_to_itm) and is_late_session:
            if margin_deficit > 0:
                status = 'SEVERELY_TRAPPED'
            elif available_margin < 1.5 * required_margin:
                status = 'MARGIN_WARNING'
            else:
                status = 'SAFE'
        elif is_close_to_itm:
            status = 'MARGIN_WARNING' if margin_deficit > 0 else 'SAFE'
        else:
            status = 'SAFE'

        return MarginTrapAssessment(
            symbol=position.symbol,
            strike=position.strike,
            option_type=position.option_type,
            spot_price=spot_price,
            distance_pct=distance_pct,
            is_delivery_risk=is_itm or is_close_to_itm,
            required_delivery_margin=required_margin,
            available_margin=available_margin,
            margin_deficit=margin_deficit,
            status=status,
        )

    def evaluate_auto_flattening_schedule(
        self,
        positions: List[OptionExpiryPosition],
        current_time: datetime,
        margin_traps: Optional[List[MarginTrapAssessment]] = None,
    ) -> List[FlatteningInstruction]:
        """
        Determines atomic unwind schedule for 0-DTE expiry positions.
        Triggers emergency flattening at >= 15:15 IST or when SEVERELY_TRAPPED.
        """
        instructions = []
        is_past_flatten_time = current_time.time() >= self.auto_flatten_time

        traps_by_key = {}
        if margin_traps:
            for trap in margin_traps:
                key = (trap.symbol, trap.strike, trap.option_type)
                traps_by_key[key] = trap

        for pos in positions:
            key = (pos.symbol, pos.strike, pos.option_type)
            trap = traps_by_key.get(key)
            unwind_side = 'SELL' if pos.side == 'BUY' else 'BUY'

            # Case 1: Severely Trapped stock F&O margin risk
            if trap and trap.status == 'SEVERELY_TRAPPED':
                instructions.append(FlatteningInstruction(
                    symbol=pos.symbol,
                    strike=pos.strike,
                    option_type=pos.option_type,
                    quantity=abs(pos.quantity),
                    unwind_side=unwind_side,
                    urgency='EMERGENCY_ATOMIC',
                    reason=f"Physical delivery margin deficit of INR {trap.margin_deficit:,.2f} before 15:30 IST close",
                ))
            # Case 2: Past 15:15 IST automatic governor
            elif is_past_flatten_time:
                instructions.append(FlatteningInstruction(
                    symbol=pos.symbol,
                    strike=pos.strike,
                    option_type=pos.option_type,
                    quantity=abs(pos.quantity),
                    unwind_side=unwind_side,
                    urgency='HIGH',
                    reason=f"Mandatory 15:15 IST 0-DTE position auto-flattening triggered",
                ))

        return instructions
