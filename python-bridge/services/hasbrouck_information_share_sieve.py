"""
Multi-Asset Cross-Exchange Order Flow Toxicity Information Share & Hasbrouck Factor Sieve
Domain 229 / Work Package WP-EA

Implements Hasbrouck (1995) Information Share (IS) via Cholesky bounds,
Gonzalo-Granger (1995) Component Share (CS) common factor weights,
and cross-exchange price discovery dominance routing sentries.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class VenueDominanceState(str, Enum):
    LEADER_DOMINANT = "LEADER_DOMINANT"        # Single venue commands >60% price discovery
    FRAGMENTED_EQUAL = "FRAGMENTED_EQUAL"      # Balanced multi-venue price discovery
    LAGGING_FOLLOWER = "LAGGING_FOLLOWER"      # High latency lag, toxic passive quotes


@dataclass
class VenueDiscoveryMetric:
    venue: str
    is_lower: float
    is_upper: float
    is_midpoint: float
    gonzalo_granger_cs: float
    is_price_leader: bool


@dataclass
class DiscoveryDominanceReport:
    primary_leader_venue: str
    leader_information_share: float
    leader_component_share: float
    regime: VenueDominanceState
    venue_metrics: Dict[str, VenueDiscoveryMetric]
    recommended_routing: str
    details: Dict[str, float] = field(default_factory=dict)


class HasbrouckInformationShareSieve:
    """
    Measures the share of permanent fundamental price discovery across fragmented trading venues.
    Identifies the institutional anchor venue to front-run lagging exchange quotes.
    """

    def __init__(self, min_samples: int = 20):
        self.min_samples = min_samples

    @staticmethod
    def _compute_returns(prices: List[float]) -> List[float]:
        if len(prices) < 2:
            return []
        return [prices[i] - prices[i - 1] for i in range(1, len(prices))]

    def compute_bivariate_shares(
        self,
        prices_a: List[float],
        prices_b: List[float],
    ) -> Tuple[Tuple[float, float, float], Tuple[float, float, float], float, float]:
        """
        Computes Hasbrouck Information Share bounds and Gonzalo-Granger CS for 2 venues.
        Returns:
          (is_a_lower, is_a_upper, is_a_mid), (is_b_lower, is_b_upper, is_b_mid), cs_a, cs_b
        """
        n = min(len(prices_a), len(prices_b))
        if n < self.min_samples:
            return (0.5, 0.5, 0.5), (0.5, 0.5, 0.5), 0.5, 0.5

        pa = prices_a[:n]
        pb = prices_b[:n]

        # Log returns
        dp_a = [math.log(pa[i] / pa[i - 1]) for i in range(1, n)]
        dp_b = [math.log(pb[i] / pb[i - 1]) for i in range(1, n)]

        # Error correction term: spread = log(pa) - log(pb)
        spread = [math.log(pa[i - 1]) - math.log(pb[i - 1]) for i in range(1, n)]

        # VECM regression for adjustment speeds alpha_a and alpha_b:
        # dp_a = c_a + alpha_a * spread + e_a
        # dp_b = c_b + alpha_b * spread + e_b
        k = len(dp_a)
        mean_s = sum(spread) / k
        var_s = sum((s - mean_s) ** 2 for s in spread) / k

        if var_s <= 1e-12:
            alpha_a, alpha_b = 0.0, 0.0
        else:
            cov_a_s = sum((dp_a[i] - (sum(dp_a) / k)) * (spread[i] - mean_s) for i in range(k)) / k
            cov_b_s = sum((dp_b[i] - (sum(dp_b) / k)) * (spread[i] - mean_s) for i in range(k)) / k
            alpha_a = cov_a_s / var_s
            alpha_b = cov_b_s / var_s

        # Gonzalo-Granger common factor weights:
        # gamma is orthogonal to alpha: gamma_a * alpha_a + gamma_b * alpha_b = 0
        # gamma_a = -alpha_b, gamma_b = alpha_a
        denom_cs = abs(alpha_a) + abs(alpha_b)
        if denom_cs > 1e-8:
            # Venue that adjusts less has higher component share
            # If alpha_a is negative (pulls down to B) and alpha_b is positive (pulls up to A):
            cs_a = max(0.0, min(1.0, abs(alpha_b) / denom_cs))
            cs_b = 1.0 - cs_a
        else:
            cs_a, cs_b = 0.5, 0.5

        # Residuals covariance matrix Omega = [[s11, s12], [s12, s22]]
        # Compute innovations
        res_a = [dp_a[i] - alpha_a * spread[i] for i in range(k)]
        res_b = [dp_b[i] - alpha_b * spread[i] for i in range(k)]

        s11 = sum(r * r for r in res_a) / k
        s22 = sum(r * r for r in res_b) / k
        s12 = sum(res_a[i] * res_b[i] for i in range(k)) / k

        # Guard positive definiteness
        s11 = max(1e-10, s11)
        s22 = max(1e-10, s22)
        corr = s12 / math.sqrt(s11 * s22)
        corr = max(-0.999, min(0.999, corr))
        s12 = corr * math.sqrt(s11 * s22)

        # Permanent factor weight vector psi = (gamma_a, gamma_b)
        psi_1, psi_2 = cs_a, cs_b

        # Total permanent innovation variance: psi * Omega * psi'
        tot_var = (psi_1 ** 2) * s11 + 2.0 * psi_1 * psi_2 * s12 + (psi_2 ** 2) * s22
        tot_var = max(1e-12, tot_var)

        # Ordering 1: A first, then B (Cholesky: M = [[m11, 0], [m21, m22]])
        m11 = math.sqrt(s11)
        m21 = s12 / m11
        m22 = math.sqrt(max(1e-12, s22 - m21 * m21))

        # [psi * M] = [psi_1*m11 + psi_2*m21, psi_2*m22]
        is_a_order1 = ((psi_1 * m11 + psi_2 * m21) ** 2) / tot_var
        is_b_order1 = ((psi_2 * m22) ** 2) / tot_var

        # Ordering 2: B first, then A
        n22 = math.sqrt(s22)
        n12 = s12 / n22
        n11 = math.sqrt(max(1e-12, s11 - n12 * n12))

        is_b_order2 = ((psi_2 * n22 + psi_1 * n12) ** 2) / tot_var
        is_a_order2 = ((psi_1 * n11) ** 2) / tot_var

        is_a_lower = max(0.0, min(is_a_order1, is_a_order2))
        is_a_upper = min(1.0, max(is_a_order1, is_a_order2))
        is_a_mid = (is_a_lower + is_a_upper) / 2.0

        is_b_lower = max(0.0, min(is_b_order1, is_b_order2))
        is_b_upper = min(1.0, max(is_b_order1, is_b_order2))
        is_b_mid = (is_b_lower + is_b_upper) / 2.0

        return (is_a_lower, is_a_upper, is_a_mid), (is_b_lower, is_b_upper, is_b_mid), cs_a, cs_b

    def evaluate_multi_venue_dominance(
        self,
        venue_prices: Dict[str, List[float]],
    ) -> DiscoveryDominanceReport:
        """
        Evaluates cross-venue information share and identifies the dominant market maker anchor.
        """
        venues = list(venue_prices.keys())
        if len(venues) < 2:
            v_name = venues[0] if venues else "unknown"
            single_metric = VenueDiscoveryMetric(
                venue=v_name, is_lower=1.0, is_upper=1.0, is_midpoint=1.0,
                gonzalo_granger_cs=1.0, is_price_leader=True
            )
            return DiscoveryDominanceReport(
                primary_leader_venue=v_name,
                leader_information_share=1.0,
                leader_component_share=1.0,
                regime=VenueDominanceState.LEADER_DOMINANT,
                venue_metrics={v_name: single_metric},
                recommended_routing=f"SOLO_VENUE: All liquidity anchored on {v_name}.",
            )

        # For pairwise aggregation across venues
        # We compute average bivariate IS and CS for each venue against all peers
        venue_is_totals: Dict[str, float] = {v: 0.0 for v in venues}
        venue_cs_totals: Dict[str, float] = {v: 0.0 for v in venues}
        pair_counts: Dict[str, int] = {v: 0 for v in venues}
        venue_lower_map: Dict[str, float] = {v: 0.0 for v in venues}
        venue_upper_map: Dict[str, float] = {v: 0.0 for v in venues}

        for i in range(len(venues)):
            for j in range(i + 1, len(venues)):
                v1, v2 = venues[i], venues[j]
                (is1_l, is1_u, is1_m), (is2_l, is2_u, is2_m), cs1, cs2 = self.compute_bivariate_shares(
                    venue_prices[v1], venue_prices[v2]
                )

                venue_is_totals[v1] += is1_m
                venue_is_totals[v2] += is2_m
                venue_cs_totals[v1] += cs1
                venue_cs_totals[v2] += cs2
                venue_lower_map[v1] += is1_l
                venue_lower_map[v2] += is2_l
                venue_upper_map[v1] += is1_u
                venue_upper_map[v2] += is2_u

                pair_counts[v1] += 1
                pair_counts[v2] += 1

        # Normalize across all venues
        total_is = sum(venue_is_totals.values())
        total_cs = sum(venue_cs_totals.values())

        metrics: Dict[str, VenueDiscoveryMetric] = {}
        for v in venues:
            cnt = max(1, pair_counts[v])
            norm_is = (venue_is_totals[v] / total_is) if total_is > 0 else (1.0 / len(venues))
            norm_cs = (venue_cs_totals[v] / total_cs) if total_cs > 0 else (1.0 / len(venues))
            metrics[v] = VenueDiscoveryMetric(
                venue=v,
                is_lower=venue_lower_map[v] / cnt,
                is_upper=venue_upper_map[v] / cnt,
                is_midpoint=norm_is,
                gonzalo_granger_cs=norm_cs,
                is_price_leader=False,
            )

        # Identify primary leader
        leader_v = max(metrics, key=lambda k: metrics[k].is_midpoint)
        metrics[leader_v].is_price_leader = True

        leader_is = metrics[leader_v].is_midpoint
        leader_cs = metrics[leader_v].gonzalo_granger_cs

        # Sentry Regime Decision
        if leader_is >= 0.55:
            regime = VenueDominanceState.LEADER_DOMINANT
            action = (
                f"FRONT_RUN_ANCHOR: {leader_v} commands {leader_is:.1%} of price discovery. "
                f"Siphon lead signals from {leader_v} to execute on lagging peers."
            )
        else:
            regime = VenueDominanceState.FRAGMENTED_EQUAL
            action = f"MULTI_VENUE_AGGREGATE: Discovery is fragmented (top venue {leader_v} = {leader_is:.1%}). Cross-book sweeping advised."

        return DiscoveryDominanceReport(
            primary_leader_venue=leader_v,
            leader_information_share=leader_is,
            leader_component_share=leader_cs,
            regime=regime,
            venue_metrics=metrics,
            recommended_routing=action,
            details={
                "num_venues": float(len(venues)),
                "leader_is_midpoint": leader_is,
                "leader_cs": leader_cs,
            },
        )
