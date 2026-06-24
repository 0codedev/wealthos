r"""
Cross-Strike Vega Risk Budgeting & Dynamic Variance Swap Rebalancer (Domain 133 / WP-AI)
========================================================================================

Autonomous options portfolio risk management and volatility surface replication engine
implementing Demeterfi-Derman-Kamal-Zou (1999) log-contract variance swap synthesis,
cross-strike Vega/Volga/Vanna budgeting, and minimal-theta-bleed auto-rebalancing.

Mathematical Formulations:
--------------------------
1. Black-Scholes Higher-Order Volatility Greeks:
       d_1 = \frac{\ln(S/K) + (r + \frac{1}{2}\sigma^2)T}{\sigma \sqrt{T}}, \quad d_2 = d_1 - \sigma \sqrt{T}
       \phi(x) = \frac{1}{\sqrt{2\pi}} e^{-\frac{1}{2}x^2}
       \mathcal{V}_{\text{single}} = S \sqrt{T} \phi(d_1) \cdot 0.01 \quad (\text{Vega per 1\% vol})
       \text{Volga} = \mathcal{V} \cdot \frac{d_1 d_2}{\sigma}
       \text{Vanna} = \frac{\mathcal{V}}{S} \left(1 - \frac{d_1}{\sigma \sqrt{T}}\right)

2. Demeterfi-Derman-Kamal-Zou (1999) Variance Swap Replication:
       \mathbb{E}[\text{Var}] = \frac{2 e^{rT}}{T} \left[ \sum_{K_i \le F_0} \frac{\Delta K_i}{K_i^2} P(K_i) + \sum_{K_i > F_0} \frac{\Delta K_i}{K_i^2} C(K_i) \right]
       \sigma_{\text{fair}} = \sqrt{\max(\mathbb{E}[\text{Var}], 0)} \times 100\%

3. Minimal-Theta-Bleed Vega Rebalancer:
   Let \bar{\mathcal{V}} be the absolute Vega budget. If |\sum \mathcal{V}| > \bar{\mathcal{V}}:
   Select hedging candidate maximizing Vega-to-Theta efficiency:
       \text{Eff}(K) = \frac{\mathcal{V}(K)}{|\Theta(K)|}
       N_{\text{hedge}} = \text{round}\left(\frac{-\sum \mathcal{V}}{\mathcal{V}_{\text{single}}(K^*)}\right)
"""

from dataclasses import dataclass
from datetime import datetime
import math
import sqlite3
from typing import Dict, List, Optional, Tuple


@dataclass
class OptionPosition:
    strike: float
    expiry_days: float
    option_type: str  # 'CE' or 'PE'
    quantity: int  # contracts (+ = long, - = short)
    iv: float  # e.g., 0.15 for 15%
    spot: float
    rate: float = 0.065  # 6.5% standard RBI repo rate
    lot_size: int = 25  # NIFTY lot size


@dataclass
class OptionGreeks:
    price: float
    vega: float  # total vega in INR per 1% vol shift
    volga: float
    vanna: float
    theta: float  # daily theta in INR


@dataclass
class PortfolioVegaReport:
    timestamp: datetime
    total_vega_inr: float
    total_volga: float
    total_vanna: float
    total_daily_theta: float
    synthetic_fair_var: float
    synthetic_fair_vol_pct: float
    vega_budget_inr: float
    is_within_budget: bool
    hedging_required: bool
    hedge_action: Optional[str]  # e.g., 'BUY 25000 CE x 4 lots'
    rationale: str


class VegaRiskVarianceSwapEngine:
    """
    Sub-millisecond Cross-Strike Vega Risk Budgeting & Dynamic Variance Swap Engine.
    """

    def __init__(
        self,
        vega_budget_inr: float = 50000.0,  # Max allowable net Vega risk (INR per 1% vol)
        db_path: str = ":memory:",
    ):
        self.vega_budget = vega_budget_inr
        self.db_path = db_path

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
            CREATE TABLE IF NOT EXISTS vega_risk_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                total_vega REAL NOT NULL,
                total_volga REAL NOT NULL,
                total_vanna REAL NOT NULL,
                total_theta REAL NOT NULL,
                synthetic_fair_vol REAL NOT NULL,
                is_within_budget INTEGER NOT NULL,
                hedge_action TEXT
            )
            """
        )
        conn.commit()

    @staticmethod
    def _std_norm_pdf(x: float) -> float:
        return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)

    @staticmethod
    def _std_norm_cdf(x: float) -> float:
        return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

    def calculate_greeks(self, pos: OptionPosition) -> OptionGreeks:
        """
        Calculates Black-Scholes price, Vega, Volga, Vanna, and Theta.
        """
        S = pos.spot
        K = pos.strike
        T = max(pos.expiry_days / 365.0, 1e-4)
        sigma = max(pos.iv, 1e-3)
        r = pos.rate
        multiplier = pos.quantity * pos.lot_size

        d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)

        pdf_d1 = self._std_norm_pdf(d1)
        cdf_d1 = self._std_norm_cdf(d1)
        cdf_d2 = self._std_norm_cdf(d2)

        # Price
        if pos.option_type.upper() == 'CE':
            price = S * cdf_d1 - K * math.exp(-r * T) * cdf_d2
            theta_annual = -(S * pdf_d1 * sigma) / (2.0 * math.sqrt(T)) - r * K * math.exp(-r * T) * cdf_d2
        else:
            price = K * math.exp(-r * T) * self._std_norm_cdf(-d2) - S * self._std_norm_cdf(-d1)
            theta_annual = -(S * pdf_d1 * sigma) / (2.0 * math.sqrt(T)) + r * K * math.exp(-r * T) * self._std_norm_cdf(-d2)

        # Vega per 1% vol shift (0.01)
        vega_single = S * math.sqrt(T) * pdf_d1 * 0.01
        total_vega = vega_single * multiplier

        # Volga & Vanna
        volga_single = vega_single * (d1 * d2 / sigma)
        total_volga = volga_single * multiplier

        vanna_single = (vega_single / S) * (1.0 - d1 / (sigma * math.sqrt(T)))
        total_vanna = vanna_single * multiplier

        # Daily Theta
        daily_theta = (theta_annual / 365.0) * multiplier

        return OptionGreeks(
            price=round(price, 2),
            vega=round(total_vega, 2),
            volga=round(total_volga, 2),
            vanna=round(total_vanna, 2),
            theta=round(daily_theta, 2),
        )

    def replicate_fair_variance(
        self,
        spot: float,
        expiry_days: float,
        rate: float,
        strike_chain: List[Tuple[float, str, float]],  # (strike, 'CE'/'PE', price)
    ) -> Tuple[float, float]:
        """
        Demeterfi et al. (1999) discrete log-contract variance replication.
        strike_chain: sorted list of (strike, type, market_price)
        Returns: (fair_variance, fair_vol_percent)
        """
        if len(strike_chain) < 3:
            return 0.0, 0.0

        T = max(expiry_days / 365.0, 1e-4)
        F0 = spot * math.exp(rate * T)

        # Sort strikes
        chain_sorted = sorted(strike_chain, key=lambda x: x[0])
        var_accum = 0.0

        for i in range(len(chain_sorted)):
            K_i, opt_type, p_i = chain_sorted[i]
            # Delta K computation
            if i == 0:
                delta_k = chain_sorted[1][0] - chain_sorted[0][0]
            elif i == len(chain_sorted) - 1:
                delta_k = chain_sorted[-1][0] - chain_sorted[-2][0]
            else:
                delta_k = (chain_sorted[i + 1][0] - chain_sorted[i - 1][0]) / 2.0

            weight = delta_k / (K_i * K_i)
            # Use P(K) for K <= F0, C(K) for K > F0
            if K_i <= F0 and opt_type.upper() == 'PE':
                var_accum += weight * p_i
            elif K_i > F0 and opt_type.upper() == 'CE':
                var_accum += weight * p_i

        factor = (2.0 * math.exp(rate * T)) / T
        fair_var = factor * var_accum
        fair_vol = math.sqrt(max(fair_var, 0.0)) * 100.0

        return round(fair_var, 6), round(fair_vol, 2)

    def evaluate_portfolio_risk(
        self,
        positions: List[OptionPosition],
        available_hedging_strikes: Optional[List[OptionPosition]] = None,
        timestamp: Optional[datetime] = None,
    ) -> PortfolioVegaReport:
        now = timestamp if timestamp is not None else datetime.utcnow()

        tot_vega = 0.0
        tot_volga = 0.0
        tot_vanna = 0.0
        tot_theta = 0.0

        # Construct strike chain for variance swap replication
        strike_chain: List[Tuple[float, str, float]] = []
        spot_ref = positions[0].spot if positions else 25000.0
        t_ref = positions[0].expiry_days if positions else 7.0
        r_ref = positions[0].rate if positions else 0.065

        for pos in positions:
            g = self.calculate_greeks(pos)
            tot_vega += g.vega
            tot_volga += g.volga
            tot_vanna += g.vanna
            tot_theta += g.theta
            strike_chain.append((pos.strike, pos.option_type, g.price))

        fair_var, fair_vol = self.replicate_fair_variance(spot_ref, t_ref, r_ref, strike_chain)

        is_within_budget = abs(tot_vega) <= self.vega_budget
        hedging_required = not is_within_budget
        hedge_action = None

        if hedging_required:
            vega_deficit = -tot_vega  # what we need to add to restore Vega to 0
            # Find best candidate from available hedging strikes
            candidates = available_hedging_strikes if available_hedging_strikes else positions
            best_candidate = None
            best_efficiency = -1.0

            for cand in candidates:
                cand_single = OptionPosition(
                    strike=cand.strike,
                    expiry_days=cand.expiry_days,
                    option_type=cand.option_type,
                    quantity=1,
                    iv=cand.iv,
                    spot=cand.spot,
                    rate=cand.rate,
                    lot_size=cand.lot_size,
                )
                g_c = self.calculate_greeks(cand_single)
                if abs(g_c.theta) > 1e-4 and g_c.vega > 0:
                    eff = g_c.vega / abs(g_c.theta)
                    if eff > best_efficiency:
                        best_efficiency = eff
                        best_candidate = (cand, g_c.vega)

            if best_candidate is not None:
                cand_pos, vega_per_lot = best_candidate
                lots_needed = int(round(vega_deficit / vega_per_lot))
                action_str = "BUY" if lots_needed > 0 else "SELL"
                hedge_action = f"{action_str} {abs(lots_needed)} lots {cand_pos.strike:.0f} {cand_pos.option_type}"
                rationale = (
                    f"Portfolio Vega (₹{tot_vega:+.2f}) breaches limit (₹{self.vega_budget:.2f}). "
                    f"Recommended hedge: {hedge_action} to neutralize net exposure."
                )
            else:
                rationale = f"Portfolio Vega (₹{tot_vega:+.2f}) breaches limit. No viable hedge strike found."
        else:
            rationale = (
                f"Portfolio Vega within budget (₹{tot_vega:+.2f} / ₹{self.vega_budget:.2f}). "
                f"Synthetic Fair Vol={fair_vol:.2f}%. Daily Theta Bleed=₹{tot_theta:+.2f}."
            )

        # Relational persistence
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO vega_risk_telemetry (
                timestamp, total_vega, total_volga, total_vanna, total_theta,
                synthetic_fair_vol, is_within_budget, hedge_action
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now.isoformat(),
                round(tot_vega, 2),
                round(tot_volga, 2),
                round(tot_vanna, 2),
                round(tot_theta, 2),
                fair_vol,
                1 if is_within_budget else 0,
                hedge_action,
            ),
        )
        conn.commit()

        return PortfolioVegaReport(
            timestamp=now,
            total_vega_inr=round(tot_vega, 2),
            total_volga=round(tot_volga, 2),
            total_vanna=round(tot_vanna, 2),
            total_daily_theta=round(tot_theta, 2),
            synthetic_fair_var=fair_var,
            synthetic_fair_vol_pct=fair_vol,
            vega_budget_inr=self.vega_budget,
            is_within_budget=is_within_budget,
            hedging_required=hedging_required,
            hedge_action=hedge_action,
            rationale=rationale,
        )
