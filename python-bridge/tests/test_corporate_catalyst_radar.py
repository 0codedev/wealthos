"""Unit tests for services/corporate_catalyst_radar.py — parser + asymmetric scorer."""

import os
import sys
from datetime import date, datetime, timedelta

import pytest
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.corporate_catalyst_radar import (  # noqa: E402
    IST,
    RadarConfig,
    build_radar,
    classify_catalyst,
    events_to_frame,
    mock_announcements,
    parse_amount_inr,
    parse_date,
    parse_event,
    parse_pct,
    scan_radar,
    score_catalyst,
    select_btst_candidates,
)

_NOW = datetime(2026, 10, 17, 15, 0, tzinfo=IST)


# --------------------------------------------------------------------------- #
# Primitive parsers
# --------------------------------------------------------------------------- #


def test_parse_amount_crore_lakh_million():
    assert parse_amount_inr("order worth Rs 2,450 Crore")[0] == pytest.approx(2450 * 1e7)
    assert parse_amount_inr("Rs 45 lakh")[0] == pytest.approx(45 * 1e5)
    assert parse_amount_inr("USD 5 million")[0] == pytest.approx(5e6 * 83.0)
    assert parse_amount_inr("no amount here")[0] is None


def test_parse_pct_keyword_scoped():
    assert parse_pct("net profit rose 22% YoY while revenue grew 12%") == 22.0
    assert parse_pct("net profit rose 22% YoY while revenue grew 12%", keyword="revenue") == 12.0
    assert parse_pct("nothing") is None


def test_parse_date_formats():
    assert parse_date("20-Oct-2026") == date(2026, 10, 20)
    assert parse_date("Ex-date 19/10/2026") == date(2026, 10, 19)
    assert parse_date("Record Date: 2026-10-21") == date(2026, 10, 21)
    assert parse_date("gibberish") is None


# --------------------------------------------------------------------------- #
# Classification
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "headline,expected",
    [
        ("Bagged order worth Rs 500 crore from NTPC", "ORDER_WIN"),
        ("Q2 FY27 financial results approved", "EARNINGS"),
        ("Board recommends interim dividend", "DIVIDEND"),
        ("Board approves buyback of equity shares", "CORPORATE_ACTION"),
        ("SEBI imposes penalty for disclosure lapses", "REGULATORY"),
        ("Resignation of Chief Financial Officer", "MANAGEMENT"),
        ("Newspaper publication of results", "NOISE"),
        ("Intimation of trading window closure", "NOISE"),
        ("Random unrelated disclosure", "OTHER"),
    ],
)
def test_classify_catalyst(headline, expected):
    assert classify_catalyst(headline) == expected


# --------------------------------------------------------------------------- #
# Event parsing
# --------------------------------------------------------------------------- #


def test_parse_nse_style_event():
    raw = {
        "symbol": "BEL",
        "company": "Bharat Electronics Ltd",
        "subject": "Bagged order worth Rs 2,450 Crore",
        "desc": "Order for radar systems from MoD.",
        "an_dt": "17-Oct-2026 14:10:00",
        "attchmntFile": "https://nse.example/x.pdf",
    }
    event = parse_event(raw, source="NSE")
    assert event is not None
    assert event.symbol == "BEL"
    assert event.category == "ORDER_WIN"
    assert event.order_value_inr == pytest.approx(2450 * 1e7)
    assert event.source == "NSE"
    assert event.published_at.tzinfo is not None
    assert event.url is not None


def test_parse_bse_style_event():
    raw = {
        "SLONGNAME": "Some SME Ltd",
        "NEWSSUB": "Board approves dividend of Rs 5 per share",
        "NEWS_DT": "16-Oct-2026 11:00:00",
        "NSURL": "https://bse.example/y.pdf",
    }
    event = parse_event(raw, source="BSE")
    assert event is not None
    assert event.category == "DIVIDEND"
    assert event.source == "BSE"
    assert event.dividend is not None
    assert event.dividend.dividend_type == "interim" or event.dividend.amount_inr is not None


def test_parse_event_rejects_empty():
    assert parse_event({}) is None
    assert parse_event("not a dict") is None


def test_dividend_ex_and_record_dates_extracted():
    event = parse_event(
        {
            "symbol": "ITC",
            "subject": "Interim Dividend Rs 8 per share; Ex-date 19-Oct-2026 Record Date 20-Oct-2026",
            "desc": "",
            "an_dt": "17-Oct-2026 12:00:00",
        }
    )
    assert event is not None and event.dividend is not None
    assert event.dividend.ex_date == date(2026, 10, 19)
    assert event.dividend.record_date == date(2026, 10, 20)


def test_earnings_growth_extracted():
    event = parse_event(
        {
            "symbol": "TATAMOTORS",
            "subject": "Q2 FY27 Financial Results",
            "desc": (
                "Revenue from operations Rs 1,05,000 crore; "
                "net profit rose 22% YoY to Rs 5,120 crore."
            ),
            "an_dt": "17-Oct-2026 13:00:00",
        }
    )
    assert event is not None and event.earnings is not None
    assert event.earnings.quarter == "Q2 FY27"
    assert event.earnings.profit_growth_pct == pytest.approx(22.0)


# --------------------------------------------------------------------------- #
# Asymmetric scoring
# --------------------------------------------------------------------------- #


def _order_event(value_cr: float = 2450.0) -> "object":
    return parse_event(
        {
            "symbol": "BEL",
            "subject": f"Bagged order worth Rs {value_cr:,.0f} Crore from MoD",
            "desc": "Order for radar systems.",
            "an_dt": "17-Oct-2026 14:00:00",
        }
    )


def test_order_win_over_15pct_mcap_hits_tier1_and_btst():
    event = _order_event(2450.0)
    score = score_catalyst(
        event, market_cap_inr=8000 * 1e7, adv_inr=50 * 1e7, now=_NOW
    )
    assert score.direction == "bullish"
    assert score.impact_tier == 1
    assert score.asymmetry_score > 50
    assert score.btst_eligible is True
    assert any("market cap" in r for r in score.rationale)


def test_small_liquidity_kills_btst_eligibility():
    event = _order_event(2450.0)
    score = score_catalyst(event, market_cap_inr=8000 * 1e7, adv_inr=1 * 1e7, now=_NOW)
    assert score.btst_eligible is False
    assert score.liquidity_factor < 1.0


def test_decay_reduces_score_as_event_ages():
    event = _order_event(500.0)
    fresh = score_catalyst(event, market_cap_inr=10_000 * 1e7, now=event.published_at)
    stale = score_catalyst(
        event, market_cap_inr=10_000 * 1e7, now=event.published_at + timedelta(hours=24)
    )
    assert fresh.asymmetry_score > stale.asymmetry_score
    assert stale.decay_factor < fresh.decay_factor


def test_regulatory_event_is_bearish_negative_asymmetry():
    event = parse_event(
        {
            "symbol": "YESBANK",
            "subject": "SEBI imposes penalty of Rs 12 crore",
            "desc": "Show cause notice issued.",
            "an_dt": "17-Oct-2026 14:00:00",
        }
    )
    score = score_catalyst(event, market_cap_inr=30_000 * 1e7, now=_NOW)
    assert score.direction == "bearish"
    assert score.asymmetry_score < 0
    assert score.btst_eligible is False


def test_dividend_yield_boost_uses_price():
    event = parse_event(
        {
            "symbol": "ITC",
            "subject": "Interim dividend of Rs 8 per share",
            "desc": "",
            "an_dt": "17-Oct-2026 14:00:00",
        }
    )
    with_price = score_catalyst(event, price=400.0, now=_NOW)
    without_price = score_catalyst(event, price=None, now=_NOW)
    assert with_price.asymmetry_score > without_price.asymmetry_score


def test_noise_event_scores_low_and_not_btst():
    event = parse_event(
        {
            "symbol": "RELIANCE",
            "subject": "Newspaper Publication of Unaudited Results",
            "desc": "Routine compliance.",
            "an_dt": "17-Oct-2026 14:00:00",
        }
    )
    assert event.category == "NOISE"
    score = score_catalyst(event, market_cap_inr=20_00_000 * 1e7, now=_NOW)
    assert score.btst_eligible is False
    assert abs(score.asymmetry_score) < 10


def test_asymmetry_is_clamped_to_bounds():
    event = _order_event(50_000.0)
    score = score_catalyst(event, market_cap_inr=100 * 1e7, adv_inr=1000 * 1e7, now=_NOW)
    assert -100.0 <= score.asymmetry_score <= 100.0


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def test_offline_scan_produces_ranked_btst_candidates():
    report = scan_radar(offline=True, now=_NOW)
    assert report.events_scanned == len(mock_announcements(_NOW))
    assert report.candidates, "expected at least one bullish BTST candidate"
    # Candidates are sorted by asymmetry descending.
    scores = [c.asymmetry_score for c in report.candidates]
    assert scores == sorted(scores, reverse=True)
    assert all(c.direction == "bullish" for c in report.candidates)


def test_build_radar_uses_map_overrides_for_liquidity():
    event = _order_event(2450.0)
    report = build_radar(
        [event],
        market_cap_map={"BEL": 8000 * 1e7},
        adv_map={"BEL": 100 * 1e7},
        now=_NOW,
    )
    assert report.candidates and report.candidates[0].symbol == "BEL"


def test_select_btst_candidates_respects_threshold():
    report = scan_radar(offline=True, now=_NOW, config=RadarConfig(btst_min_asymmetry=65.0))
    selected = select_btst_candidates(report, min_asymmetry=65.0)
    assert all(c.asymmetry_score >= 65.0 for c in selected)


def test_events_to_frame_roundtrips():
    report = scan_radar(offline=True, now=_NOW)
    frame = events_to_frame(report.all_scores)
    assert frame is not None
    assert frame.height == len(report.all_scores)
    assert "asymmetry_score" in frame.columns
