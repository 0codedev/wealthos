r"""Unit Tests for Cross-Market Order Flow Microstructure Adverse Selection & VPIN Drift Sieve (Domain 222 / WP-DT)
WealthOS Sovereign Quantitative Research & Trading Fabric
"""

import pytest
from services.vpin_adverse_selection_sieve import (
    VPINAdverseSelectionSieve,
    VolumeBucket,
    VPINToxicityRegime,
    VPINQuoteAction,
)


@pytest.fixture
def sieve() -> VPINAdverseSelectionSieve:
    return VPINAdverseSelectionSieve(
        rolling_window_buckets=50,
        critical_cdf_threshold=0.90,
        elevated_cdf_threshold=0.60,
        base_half_spread_bps=1.50,
    )


def test_bvc_bucket_creation(sieve: VPINAdverseSelectionSieve):
    # Zero price change -> 50% buy, 50% sell
    b_zero = sieve.create_bucket_from_trade(
        bucket_id=1,
        bucket_size=1000.0,
        price_change=0.0,
        sigma_price=0.50,
    )
    assert b_zero.buy_volume == 500.0
    assert b_zero.sell_volume == 500.0

    # Positive price change -> >50% buy
    b_up = sieve.create_bucket_from_trade(
        bucket_id=2,
        bucket_size=1000.0,
        price_change=0.50, # 1 std dev up
        sigma_price=0.50,
    )
    assert b_up.buy_volume > 800.0
    assert b_up.sell_volume < 200.0


def test_empty_buckets_safety(sieve: VPINAdverseSelectionSieve):
    res = sieve.evaluate_vpin_toxicity("NIFTY", [], [])
    assert res.current_vpin == 0.0
    assert res.toxicity_regime == VPINToxicityRegime.BENIGN_UNINFORMED_FLOW
    assert res.recommended_action == VPINQuoteAction.MAINTAIN_PASSIVE_MAKING


def test_benign_uninformed_flow(sieve: VPINAdverseSelectionSieve):
    # 50 balanced buckets (nearly equal buy/sell volume)
    buckets = [
        VolumeBucket(bucket_id=i, buy_volume=510.0, sell_volume=490.0, total_volume=1000.0, price_change=0.01)
        for i in range(50)
    ]
    # Historical VPIN distribution centered around 0.25
    hist = [0.10 + 0.005 * i for i in range(50)]

    res = sieve.evaluate_vpin_toxicity("NIFTY", buckets, hist)
    # Imbalance = |510 - 490| = 20 per bucket -> VPIN = 20 / 1000 = 0.02
    assert res.current_vpin < 0.10
    assert res.vpin_cdf_percentile < 0.60
    assert res.toxicity_regime == VPINToxicityRegime.BENIGN_UNINFORMED_FLOW
    assert res.recommended_action == VPINQuoteAction.MAINTAIN_PASSIVE_MAKING
    assert res.spread_multiplier == 1.0


def test_elevated_toxicity_warning(sieve: VPINAdverseSelectionSieve):
    # 50 buckets with 65% buy volume
    buckets = [
        VolumeBucket(bucket_id=i, buy_volume=650.0, sell_volume=350.0, total_volume=1000.0, price_change=0.05)
        for i in range(50)
    ]
    # Historical VPINs ranging from 0.05 to 0.40
    hist = [0.05 + 0.005 * i for i in range(60)] # Max is 0.345

    res = sieve.evaluate_vpin_toxicity("BANKNIFTY", buckets, hist)
    # VPIN = (650 - 350) / 1000 = 0.30
    assert pytest.approx(res.current_vpin, 0.01) == 0.30
    assert 0.60 <= res.vpin_cdf_percentile < 0.90
    assert res.toxicity_regime == VPINToxicityRegime.ELEVATED_TOXICITY_WARNING
    assert res.recommended_action == VPINQuoteAction.SHADE_INVENTORY_SPREAD
    assert res.spread_multiplier == 1.60
    assert "Widen quoting spread" in res.tactical_directive


def test_acute_toxic_tsunami_evacuation(sieve: VPINAdverseSelectionSieve):
    # 50 buckets of pure aggressive market sweeps (95% buy)
    buckets = [
        VolumeBucket(bucket_id=i, buy_volume=950.0, sell_volume=50.0, total_volume=1000.0, price_change=0.25)
        for i in range(50)
    ]
    # Historical VPIN distribution
    hist = [0.10 + 0.005 * i for i in range(50)] # max 0.345

    res = sieve.evaluate_vpin_toxicity("RELIANCE", buckets, hist)
    # VPIN = 900 / 1000 = 0.90!
    assert res.current_vpin >= 0.65
    assert res.vpin_cdf_percentile >= 0.90
    assert res.toxicity_regime == VPINToxicityRegime.ACUTE_TOXIC_TSUNAMI
    assert res.recommended_action == VPINQuoteAction.EVACUATE_MAKER_QUOTES
    assert res.spread_multiplier == 5.0
    assert "ACUTE TOXICITY TSUNAMI" in res.tactical_directive
