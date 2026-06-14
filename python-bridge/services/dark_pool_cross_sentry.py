"""
Multi-Venue Dark Pool Ping & Hidden Liquidity Cross Sentry
Domain 240 / Work Package WP-EL

Evaluates non-displayed dark pool liquidity crossing, detects predatory HFT ping
probing and information leakage, calculates post-fill adverse selection markouts,
and optimizes stealth parent order routing across dark and lit venues.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Dict, List, Optional, Tuple


class DarkPoolRegimeState(str, Enum):
    TRANQUIL_CLEAN_CROSS = "TRANQUIL_CLEAN_CROSS"              # High fill rate, minimal post-fill drift, safe stealth
    SNIFFING_PROBE_DETECTED = "SNIFFING_PROBE_DETECTED"        # Odd-lot pings followed by lit fading, information leak
    TOXIC_ADVERSE_SELECTION = "TOXIC_ADVERSE_SELECTION"        # Severe post-fill adverse drift, predatory fill venue
    ZERO_LIQUIDITY_DESERT = "ZERO_LIQUIDITY_DESERT"            # Dark pools empty, routing misses, revert to lit


class DarkRoutingDirective(str, Enum):
    ALLOCATE_STEALTH_DARK = "ALLOCATE_STEALTH_DARK"            # Maximize dark midpoint cross to capture half-spread
    ABORT_DARK_AND_FALLBACK_LIT = "ABORT_DARK_AND_FALLBACK_LIT" # Pull resting dark pegs, route to lit central book
    BLACKLIST_TOXIC_VENUES = "BLACKLIST_TOXIC_VENUES"          # Blacklist identified predatory pools, route clean venues
    DEPLOY_RANDOMIZED_DELAY_SLICE = "DEPLOY_RANDOMIZED_DELAY_SLICE" # Desynchronize order slices with Poisson jitter


@dataclass
class DarkVenueProfile:
    venue_id: str
    historical_fill_rate: float        # 0.0 to 1.0
    avg_post_fill_drift_bps: float     # Basis points of price move against order within 100ms
    avg_latency_ms: float
    capacity_shares: float
    is_blacklisted: bool = False


@dataclass
class PingProbeObservation:
    venue_id: str
    probe_size: float
    was_filled: bool
    fill_latency_ms: float
    post_fill_mid_drift_bps: float     # Positive means price drifted adversely (against order)


@dataclass
class VenueRoutingRecommendation:
    venue_id: str
    venue_type: str                    # "DARK" or "LIT"
    allocated_shares: float
    expected_savings_bps: float        # Half-spread savings minus adverse drift
    adverse_risk_score: float          # 0.0 (safe) to 1.0 (toxic)


@dataclass
class DarkPoolCrossAssessment:
    timestamp_sec: float
    target_shares: float
    total_allocated_dark: float
    total_allocated_lit: float
    dark_participation_ratio: float
    state: DarkPoolRegimeState
    directive: DarkRoutingDirective
    recommendations: List[VenueRoutingRecommendation]
    blacklisted_venues: List[str]
    rationales: List[str] = field(default_factory=list)


class DarkPoolCrossSentry:
    """
    Guards institutional parent orders against predatory ping sniffing and adverse
    selection in dark crossing networks while harvesting midpoint half-spread savings.
    """

    def __init__(
        self,
        toxic_drift_threshold_bps: float = 2.50,     # > 2.5 bps adverse drift indicates predatory venue
        sniffing_probe_size_max: float = 100.0,      # Pings <= 100 shares considered potential probes
        min_acceptable_fill_rate: float = 0.15,      # Venues < 15% fill rate considered illiquid
        lit_half_spread_bps: float = 4.0,            # Typical lit half-spread savings
    ):
        self.toxic_drift_threshold_bps = toxic_drift_threshold_bps
        self.sniffing_probe_size_max = sniffing_probe_size_max
        self.min_acceptable_fill_rate = min_acceptable_fill_rate
        self.lit_half_spread_bps = lit_half_spread_bps

    def detect_sniffing_probes(self, observations: List[PingProbeObservation]) -> Tuple[bool, List[str]]:
        """
        Detects whether small probing orders are triggering immediate adverse price moves.
        """
        flagged_venues: List[str] = []
        for obs in observations:
            if obs.probe_size <= self.sniffing_probe_size_max and obs.was_filled:
                if obs.post_fill_mid_drift_bps >= self.toxic_drift_threshold_bps:
                    flagged_venues.append(obs.venue_id)
        return len(flagged_venues) > 0, list(set(flagged_venues))

    def evaluate_routing(
        self,
        target_shares: float,
        dark_venues: List[DarkVenueProfile],
        recent_probes: List[PingProbeObservation],
        lit_capacity_shares: float = 100_000.0,
        current_time_sec: float = 0.0,
    ) -> DarkPoolCrossAssessment:
        """
        Synthesizes dark pool health metrics, detects sniffing attacks, and solves
        the optimal share allocation across clean dark venues and lit order books.
        """
        rationales: List[str] = []
        sniffing_detected, sniffed_venues = self.detect_sniffing_probes(recent_probes)

        # Update blacklisted status for venues exceeding toxic threshold or caught sniffing
        blacklisted: List[str] = []
        clean_venues: List[DarkVenueProfile] = []

        for v in dark_venues:
            is_toxic = v.avg_post_fill_drift_bps >= self.toxic_drift_threshold_bps
            is_sniffed = v.venue_id in sniffed_venues
            if is_toxic or is_sniffed or v.is_blacklisted:
                blacklisted.append(v.venue_id)
            else:
                clean_venues.append(v)

        # Check aggregate dark liquidity
        total_clean_capacity = sum(v.capacity_shares for v in clean_venues)
        avg_clean_fill_rate = (
            sum(v.historical_fill_rate for v in clean_venues) / len(clean_venues)
            if clean_venues else 0.0
        )

        # State and Directive Determination
        if sniffing_detected:
            state = DarkPoolRegimeState.SNIFFING_PROBE_DETECTED
            directive = DarkRoutingDirective.DEPLOY_RANDOMIZED_DELAY_SLICE
            rationales.append(
                f"Predatory ping probes detected on {', '.join(sniffed_venues)} with adverse drift >= {self.toxic_drift_threshold_bps:.1f} bps. Information leak in progress; randomize slicing."
            )
        elif len(blacklisted) >= max(1, len(dark_venues) * 0.5):
            state = DarkPoolRegimeState.TOXIC_ADVERSE_SELECTION
            directive = DarkRoutingDirective.BLACKLIST_TOXIC_VENUES
            rationales.append(
                f"Majority of dark venues ({len(blacklisted)}/{len(dark_venues)}) exhibiting toxic adverse selection. Blacklist and isolate flow to lit venues."
            )
        elif total_clean_capacity <= 0 or avg_clean_fill_rate < self.min_acceptable_fill_rate:
            state = DarkPoolRegimeState.ZERO_LIQUIDITY_DESERT
            directive = DarkRoutingDirective.ABORT_DARK_AND_FALLBACK_LIT
            rationales.append(
                f"Dark pools dry (clean capacity={total_clean_capacity:.0f}, fill rate={avg_clean_fill_rate*100:.1f}%). Abort dark routing to prevent execution starvation."
            )
        else:
            state = DarkPoolRegimeState.TRANQUIL_CLEAN_CROSS
            directive = DarkRoutingDirective.ALLOCATE_STEALTH_DARK
            rationales.append(
                f"Dark crossing environment healthy ({len(clean_venues)} clean venues, avg fill rate={avg_clean_fill_rate*100:.1f}%). Route stealth midpoint slices."
            )

        # Allocate shares
        recommendations: List[VenueRoutingRecommendation] = []
        remaining_shares = target_shares
        allocated_dark = 0.0

        # If safe or randomized delay, allocate to clean dark venues first up to capacity
        if directive in [DarkRoutingDirective.ALLOCATE_STEALTH_DARK, DarkRoutingDirective.DEPLOY_RANDOMIZED_DELAY_SLICE]:
            # Sort clean venues by net savings (half-spread savings - adverse drift) * fill_rate
            def score_venue(v: DarkVenueProfile) -> float:
                net_savings = self.lit_half_spread_bps - v.avg_post_fill_drift_bps
                return net_savings * v.historical_fill_rate

            ranked_clean = sorted(clean_venues, key=score_venue, reverse=True)

            for v in ranked_clean:
                if remaining_shares <= 0:
                    break
                alloc = min(remaining_shares, v.capacity_shares)
                if alloc > 0:
                    net_sav = self.lit_half_spread_bps - v.avg_post_fill_drift_bps
                    risk = min(1.0, max(0.0, v.avg_post_fill_drift_bps / self.toxic_drift_threshold_bps))
                    recommendations.append(
                        VenueRoutingRecommendation(
                            venue_id=v.venue_id,
                            venue_type="DARK",
                            allocated_shares=round(alloc, 2),
                            expected_savings_bps=round(net_sav, 2),
                            adverse_risk_score=round(risk, 3),
                        )
                    )
                    allocated_dark += alloc
                    remaining_shares -= alloc

        # Allocate remaining shares to lit central book
        allocated_lit = min(remaining_shares, lit_capacity_shares)
        if allocated_lit > 0:
            recommendations.append(
                VenueRoutingRecommendation(
                    venue_id="LIT_CENTRAL_BOOK",
                    venue_type="LIT",
                    allocated_shares=round(allocated_lit, 2),
                    expected_savings_bps=0.0,
                    adverse_risk_score=0.10,
                )
            )

        dark_ratio = (allocated_dark / target_shares) if target_shares > 0 else 0.0

        return DarkPoolCrossAssessment(
            timestamp_sec=current_time_sec,
            target_shares=target_shares,
            total_allocated_dark=round(allocated_dark, 2),
            total_allocated_lit=round(allocated_lit, 2),
            dark_participation_ratio=round(dark_ratio, 3),
            state=state,
            directive=directive,
            recommendations=recommendations,
            blacklisted_venues=blacklisted,
            rationales=rationales,
        )
