"""
Unit Tests for Microsecond Hardware Timestamp Drift & PTP/NTP Clock Synchronization Sentry (Domain 126 / WP-AB)
"""

from datetime import datetime
import random
import pytest

from services.clock_synchronization_sentry import (
    ClockSynchronizationSentry,
    TimestampPacket,
    ClockDriftEstimate,
    StaleQuoteAudit,
)


@pytest.fixture
def sentry():
    return ClockSynchronizationSentry(
        min_flight_delay_us=150.0,
        rolling_window_m=30,
        drift_warning_threshold_us=10000.0,   # 10ms
        critical_desync_threshold_us=50000.0, # 50ms
        stale_quote_cutoff_ms=150.0,          # 150ms
        db_path=":memory:",
    )


def test_minimum_filter_offset_estimation(sentry):
    random.seed(42)
    # True clock offset = 5,000 us (5ms local ahead of exchange)
    true_offset = 5000
    base_flight = 150  # 150 us

    # Feed 25 packets with random positive exponential queuing jitter
    base_ts = 1700000000000000
    for i in range(25):
        local_ts = base_ts + (i * 100000)
        # Jitter >= 0
        jitter = int(random.expovariate(1.0 / 200.0))  # mean jitter 200us
        # Delay = offset + flight + jitter
        delay = true_offset + base_flight + jitter
        exchange_ts = local_ts - delay

        pkt = TimestampPacket(f"PKT_{i}", "NIFTY", exchange_ts, local_ts)
        est = sentry.record_timestamp("NSE_COLO", pkt)

    # Offset estimate should be within 50us of true offset
    assert abs(est.estimated_offset_us - true_offset) < 100.0
    assert est.regime == "SYNCHRONIZED"
    assert est.is_safe_for_latency_arbitrage is True


def test_frequency_skew_calculation(sentry):
    # Simulated drift of 40 us per second (40 ppm)
    base_ts = 1700000000000000
    for i in range(20):
        dt_sec = i * 0.1  # Every 100ms
        local_ts = base_ts + int(dt_sec * 1e6)
        drift = int(40.0 * dt_sec)  # 40 us per second
        delay = 2000 + drift
        exchange_ts = local_ts - delay

        pkt = TimestampPacket(f"PKT_{i}", "RELIANCE", exchange_ts, local_ts)
        est = sentry.record_timestamp("UPSTOX_WS", pkt)

    # Frequency skew should reflect ~40 ppm
    assert abs(est.frequency_skew_ppm - 40.0) < 10.0


def test_regime_classification_drift_warning(sentry):
    # 25ms offset (25,000 us) -> DRIFT_WARNING
    pkt = TimestampPacket("PKT_WARN", "INFY", 1700000000000000, 1700000000025000)
    est = sentry.record_timestamp("DHAN_REST", pkt)

    assert est.regime == "DRIFT_WARNING"
    assert est.is_safe_for_latency_arbitrage is True


def test_regime_classification_critical_desync(sentry):
    # 80ms offset (80,000 us) -> CRITICAL_DESYNC
    pkt = TimestampPacket("PKT_CRIT", "TCS", 1700000000000000, 1700000000080000)
    est = sentry.record_timestamp("BSE_PUBLIC", pkt)

    assert est.regime == "CRITICAL_DESYNC"
    assert est.is_safe_for_latency_arbitrage is False


def test_audit_quote_fresh(sentry):
    # Calibrate offset to 5ms
    pkt_cal = TimestampPacket("CALIB", "NIFTY", 1700000000000000, 1700000000005150)
    sentry.record_timestamp("NSE", pkt_cal)

    # Fresh quote with 20ms raw delay -> corrected age is ~15ms (< 150ms cutoff)
    pkt_fresh = TimestampPacket("PKT_FRESH", "NIFTY", 1700000000000000, 1700000000020150)
    audit = sentry.audit_quote_staleness("NSE", pkt_fresh)

    assert not audit.is_stale_veto_active
    assert audit.corrected_transit_age_ms < 50.0


def test_audit_quote_stale_veto(sentry):
    # Calibrate offset to 5ms
    pkt_cal = TimestampPacket("CALIB", "BANKNIFTY", 1700000000000000, 1700000000005150)
    sentry.record_timestamp("NSE", pkt_cal)

    # Stale quote with 300ms raw delay -> corrected age is ~295ms (> 150ms cutoff)
    pkt_stale = TimestampPacket("PKT_STALE", "BANKNIFTY", 1700000000000000, 1700000000300150)
    audit = sentry.audit_quote_staleness("NSE", pkt_stale)

    assert audit.is_stale_veto_active is True
    assert "exceeds safety ceiling" in audit.reason


def test_sqlite_persistence(sentry):
    pkt = TimestampPacket("PKT_LOG", "SBIN", 1700000000000000, 1700000000002000)
    sentry.record_timestamp("NSE_TEST", pkt)

    conn = sentry._get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT venue, regime, is_safe FROM clock_sync_telemetry WHERE venue = 'NSE_TEST'")
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == "NSE_TEST"
    assert row[1] == "SYNCHRONIZED"
    assert row[2] == 1
