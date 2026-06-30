"""
Unit tests for fno_quant_engine.py
Verifies:
1. Cross-Sector Dispersion (CSD) and Z-score calculations under choppy markets.
2. Dip-and-Rebound validation (PVCR, support kiss, candle break).
3. FIQS score computation.
"""
import pytest
import sys
import os

# Ensure python-bridge is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.fno_quant_engine import (
    calculate_cross_sector_dispersion,
    detect_fno_dip_and_rebound,
    compute_fiqs_score,
    validate_institutional_participation
)


def test_cross_sector_dispersion_choppy_market():
    """
    Test scenario: NIFTY 50 is flat (+0.05%), but Auto is +2.6% and IT is -2.2%.
    Engine must identify extreme sector rotation rather than shutting down.
    """
    sectors_data = [
        {"sector": "AUTO", "percentChange": 2.60},
        {"sector": "METAL", "percentChange": 1.40},
        {"sector": "BANK", "percentChange": 0.30},
        {"sector": "PHARMA", "percentChange": -0.10},
        {"sector": "FMCG", "percentChange": -0.40},
        {"sector": "OIL & GAS", "percentChange": -0.80},
        {"sector": "IT", "percentChange": -2.20},
    ]

    res = calculate_cross_sector_dispersion(sectors_data)
    assert res["status"] == "SUCCESS"
    assert res["spread"] >= 4.0
    assert res["is_extreme"] is True
    # Auto has Z >= 1.35
    assert res["dominant_sector"]["sector"] == "AUTO"
    assert res["direction"] == "CALL"
    assert "EXTREME" in res["regime"]


def test_cross_sector_dispersion_bearish_market():
    """
    Test scenario: Broad market under pressure, Realty and PSU Banks collapsing.
    """
    sectors_data = [
        {"sector": "FMCG", "percentChange": 0.20},
        {"sector": "PHARMA", "percentChange": -0.40},
        {"sector": "AUTO", "percentChange": -1.10},
        {"sector": "METAL", "percentChange": -1.80},
        {"sector": "BANK", "percentChange": -2.40},
        {"sector": "REALTY", "percentChange": -3.20},
    ]

    res = calculate_cross_sector_dispersion(sectors_data)
    assert res["status"] == "SUCCESS"
    assert res["is_extreme"] is True
    assert res["direction"] == "PUT"
    assert res["dominant_sector"]["sector"] == "REALTY"


def test_dip_and_rebound_call_confirmation():
    """
    Simulate 1m candles for a stock:
    - 09:15 - 10:15: Strong impulse from 1000 to 1030 with heavy volume (avg 5000).
    - 10:15 - 10:35: Pullback (dip) from 1030 to 1018 (touches VWAP 1017) with low volume (avg 1800).
    - 10:36: Rebound candle closing above dip high (1022) with volume 3500.
    """
    candles = []
    # Morning Impulse (30 bars): 1000 -> 1030
    price = 1000.0
    for i in range(30):
        o = price
        c = price + 1.0
        h = c + 0.5
        l = o - 0.2
        v = 5000.0
        candles.append([f"10:{i:02d}:00", o, h, l, c, v])
        price = c

    # Pullback / Dip (10 bars): 1030 -> 1018 (testing VWAP = 1017.5)
    for i in range(10):
        o = price
        c = price - 1.2
        h = o + 0.2
        l = c - 0.3
        v = 1800.0  # PVCR = 1800 / 5000 = 0.36x (<= 0.75x)
        candles.append([f"10:{30+i:02d}:00", o, h, l, c, v])
        price = c

    # Rebound bar (bar 41): breaks above dip high with volume
    dip_high = max(b[2] for b in candles[-10:])
    candles.append(["10:41:00", price, dip_high + 2.0, price - 0.1, dip_high + 1.5, 3500.0])

    vwap = 1018.0
    ema_9 = 1019.0
    res = detect_fno_dip_and_rebound("RELIANCE", "CALL", candles, vwap=vwap, ema_9=ema_9)

    assert res["confirmed"] is True
    assert res["status"] == "REBOUND_CONFIRMED"
    assert res["pvcr"] <= 0.75
    assert res["is_low_vol_dip"] is True
    assert res["rebound_break"] is True


def test_fiqs_score_calculation():
    """
    Verifies FIQS score weighting.
    """
    score = compute_fiqs_score(
        stock_pct_chg=2.5,
        sector_z_score=1.8,
        rvol=2.4,
        pcr=1.25,
        clean_trend="CLEAN",
        pvcr=0.45,
        direction="CALL"
    )
    assert 70.0 <= score <= 100.0


def test_institutional_volume_participation_gate():
    """
    Verifies counterfactual root-cause gate:
    1. Rejects low-volume traps (< 500k shares and RVOL < 2.0x, e.g. FORTIS 390k).
    2. Accepts high institutional volume (> 500k shares, e.g. CDSL 4.65M shares).
    3. Accepts high RVOL breakouts (>= 2.0x even if raw shares are lower).
    """
    trap = validate_institutional_participation(volume=391445, rvol=1.35)
    assert trap["passed"] is False
    assert "Low liquidity trap" in trap["reason"]

    liquid = validate_institutional_participation(volume=4649432, rvol=1.80)
    assert liquid["passed"] is True
    assert liquid["is_liquid"] is True

    rvol_runner = validate_institutional_participation(volume=320000, rvol=2.85)
    assert rvol_runner["passed"] is True
    assert rvol_runner["is_rvol_expanded"] is True


def test_macro_benchmark_primacy_bull_day():
    """
    Forensic Replay of Today's Exact Failure:
    NIFTY 50 is ripping +1.66% (+350 points).
    IT is +1.10% (Z = 1.18).
    Capital Goods is an outlier loser at -2.58% (Z = -2.39).
    Macro Benchmark Primacy MUST lock direction to CALL and select an outperforming green sector,
    NEVER switching to PUT or picking Capital Goods shorts!
    """
    sectors_data = [
        {"sector": "IT", "percentChange": 1.10},
        {"sector": "BANK", "percentChange": 0.85},
        {"sector": "AUTO", "percentChange": 0.60},
        {"sector": "PHARMA", "percentChange": 0.40},
        {"sector": "FMCG", "percentChange": 0.20},
        {"sector": "CAPITAL GOODS", "percentChange": -2.58},
    ]

    res = calculate_cross_sector_dispersion(sectors_data, nifty_change=1.66)
    assert res["status"] == "SUCCESS"
    assert res["direction"] == "CALL"
    assert res["dominant_sector"]["sector"] == "IT"
    assert res["dominant_sector"]["percentChange"] > 0
    assert "BULL" in res["regime"]


def test_archetype_a_coiled_runner_icicibank():
    """
    ICICIBANK Coiled Shelf Runner Archetype:
    - Tight horizontal consolidation between 1360-1364 (ORC < 0.35 ATR)
    - 5m low defended (FLI)
    - Breakout with volume expansion
    Must confirm Archetype A upfront.
    """
    from services.fno_quant_engine import score_dual_archetype_momentum

    candles = []
    # 45 minutes of tight horizontal consolidation at ~1362 (Range = 3 pts on daily ATR = 20 pts -> ORC = 0.15)
    for i in range(45):
        o = 1362.0 + (0.3 if i % 2 == 0 else -0.3)
        c = 1362.0 + (0.2 if i % 2 == 1 else -0.2)
        h = 1363.2
        l = 1361.0
        v = 2000.0
        candles.append([f"09:{15+i:02d}:00", o, h, l, c, v])

    # Bar 46: Breakout above shelf high with volume
    candles.append(["10:01:00", 1363.0, 1365.0, 1362.8, 1364.5, 5500.0])

    res = score_dual_archetype_momentum(
        symbol="ICICIBANK",
        direction="CALL",
        candles_1m=candles,
        daily_atr=20.0,
        vwap=1362.0,
        ema_9=1362.5
    )

    assert res["confirmed"] is True
    assert res["archetype"] == "ARCHETYPE_A_COILED_RUNNER"
    assert res["score"] >= 60.0
    assert res["status"] == "UPFRONT_RUNNER_CONFIRMED"


def test_archetype_b_impulse_dip_rebound_bhartiartl():
    """
    BHARTIARTL Impulse Dip & Rebound Archetype:
    - Strong morning impulse (+2.2% thrust)
    - Low volume orderly pullback (PVCR <= 0.65)
    - Defended higher low above morning open
    - Rebound reclaim with volume
    """
    from services.fno_quant_engine import score_dual_archetype_momentum

    candles = []
    # 25 bars of morning impulse: 1800 -> 1840 (+2.2%)
    price = 1800.0
    for i in range(25):
        o = price
        c = price + 1.6
        h = c + 0.4
        l = o - 0.2
        v = 8000.0
        candles.append([f"09:{15+i:02d}:00", o, h, l, c, v])
        price = c

    # 10 bars of low-vol pullback to 1828 (VWAP = 1825, PVCR = 2500 / 8000 = 0.31x)
    for i in range(10):
        o = price
        c = price - 1.2
        h = o + 0.2
        l = c - 0.3
        v = 2500.0
        candles.append([f"09:{40+i:02d}:00", o, h, l, c, v])
        price = c

    # Bar 36: Rebound candle reclaiming dip high with expanding volume
    candles.append(["09:51:00", price, 1838.0, price - 0.2, 1836.0, 9500.0])

    res = score_dual_archetype_momentum(
        symbol="BHARTIARTL",
        direction="CALL",
        candles_1m=candles,
        daily_atr=35.0,
        vwap=1825.0,
        ema_9=1828.0
    )

    assert res["confirmed"] is True
    assert res["archetype"] == "ARCHETYPE_B_DIP_REBOUND"
    assert res["score"] >= 60.0
    assert res["status"] == "REBOUND_CONFIRMED"


def test_exhaustion_trap_disqualification_tataelxsi():
    """
    TATA ELXSI Exhaustion Trap:
    - Morning gap and blowout pump consuming 85% of daily ATR in 20 minutes
    - Severe drop below VWAP with red volume
    Must be immediately disqualified with EXHAUSTION_TRAP status.
    """
    from services.fno_quant_engine import score_dual_archetype_momentum

    candles = []
    # Huge spike in first 15 mins (Range 85 pts on daily ATR = 100 pts -> 85% ATR consumed!)
    price = 7000.0
    for i in range(15):
        o = price
        c = price + 5.5
        h = c + 1.0
        l = o - 0.5
        v = 5000.0
        candles.append([f"09:{15+i:02d}:00", o, h, l, c, v])
        price = c

    # Cascading dump below VWAP
    vwap = 7050.0
    for i in range(15):
        o = price
        c = price - 6.0
        h = o + 0.5
        l = c - 1.0
        v = 8000.0
        candles.append([f"09:{30+i:02d}:00", o, h, l, c, v])
        price = c

    res = score_dual_archetype_momentum(
        symbol="TATAELXSI",
        direction="CALL",
        candles_1m=candles,
        daily_atr=100.0,
        vwap=vwap,
        ema_9=7020.0
    )

    assert res["confirmed"] is False
    assert res["status"] == "EXHAUSTION_TRAP"
    assert "Exhaustion" in res["reason"] or "blowout" in res["reason"]


