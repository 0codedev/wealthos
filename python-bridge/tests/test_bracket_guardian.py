"""
Unit tests for Sovereign Trade Guardian (python-bridge/services/bracket_guardian.py).
Tests tick normalization, multi-bagger ratchet calculation, atomic bracket arming,
single-lot runner protocol (Option A), multi-lot scale-out, and OCO cancellation.
"""

import os
import sys
import pytest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.bracket_guardian import (
    to_tick,
    calculate_ratchet_sl,
    arm_protective_brackets,
    modify_broker_sl,
    cancel_broker_orders,
    BracketGuardian,
    BracketRequest,
    BracketState,
)


def test_to_tick_normalization():
    """Verify tick size conforms strictly to 0.05 multiples."""
    assert to_tick(25.82) == 25.80
    assert to_tick(25.83) == 25.85
    assert to_tick(25.84) == 25.85
    assert to_tick(16.77) == 16.75
    assert to_tick(36.12) == 36.10
    assert to_tick(-5.0) == 0.05


def test_calculate_ratchet_sl_milestones():
    """
    Verify multi-milestone and 80% MFE super-runner ratchet:
    Entry = 100.0, Initial SL = 65.0 (-35%).
    """
    entry = 100.0
    initial_sl = 65.0
    rules = {
        "trail_trigger_pct": 40.0,
        "dynamic_trail_lock_pct": 75.0,
        "dynamic_trail_step_pct": 20.0,
    }

    # 1. Under +40% gain: SL should remain initial
    sl_120 = calculate_ratchet_sl(entry, highest_price=120.0, current_sl=initial_sl, rules=rules)
    assert sl_120 == initial_sl

    # 2. At +40% gain (Target 1): SL should ratchet to Breakeven (+0.05)
    sl_140 = calculate_ratchet_sl(entry, highest_price=140.0, current_sl=initial_sl, rules=rules)
    assert sl_140 == 100.05

    # 3. At +60% gain: SL should lock at +25% profit (125.0)
    sl_160 = calculate_ratchet_sl(entry, highest_price=160.0, current_sl=sl_140, rules=rules)
    assert sl_160 == 125.0

    # 4. Super-Runner at +100% gain (peak = 200.0):
    # Excursion = 100.0. 80% MFE lock = 100.0 + 80.0 = 180.0
    # Cushion = 200 - 20% of 200 = 160.0. Max = 180.0
    sl_200 = calculate_ratchet_sl(entry, highest_price=200.0, current_sl=sl_160, rules=rules)
    assert sl_200 == 180.0


def test_arm_protective_brackets_single_lot():
    """
    Verify Option A: Single-lot contract places broker SL-M but OMITS broker LIMIT target
    so position can run into multi-bagger territory with dynamic trailing.
    """
    mock_session = MagicMock()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "success", "orderid": "SL_ORDER_12345"}
    mock_session.post.return_value = mock_resp

    res = arm_protective_brackets(
        openalgo_host="http://127.0.0.1:5000",
        api_key="mock_key",
        symbol="HCLTECH27OCT261310CE",
        exchange="NFO",
        product="MIS",
        filled_qty=400,
        fill_price=25.80,
        sl_price=16.77,
        target1_price=36.12,
        strategy_tag="FNO_SectorRotation",
        lot_size=400,  # 400 shares = exactly 1 lot
        session=mock_session
    )

    assert res["status"] == "ARMED"
    assert res["runner_mode"] is True
    assert res["target_order_id"] is None
    assert res["sl_order_id"] == "SL_ORDER_12345"
    assert res["sl_price"] == 16.75  # to_tick(16.77)

    # Verify only ONE POST was dispatched (for SL-M, none for Target LIMIT)
    assert mock_session.post.call_count == 1
    call_args = mock_session.post.call_args
    payload = call_args.kwargs["json"]
    assert payload["strategy"] == "SL_FNO_SectorRotation"
    assert payload["pricetype"] == "SL-M"
    assert payload["quantity"] == 400
    assert payload["trigger_price"] == 16.75


def test_arm_protective_brackets_multi_lot():
    """
    Verify Multi-lot contract (e.g. 2 lots = 800 qty) places BOTH broker LIMIT Target 1
    for 50% lots (400 qty) and broker SL-M for 100% lots (800 qty).
    """
    mock_session = MagicMock()

    def mock_post(url, **kwargs):
        resp = MagicMock()
        resp.status_code = 200
        payload = kwargs.get("json", {})
        if payload.get("pricetype") == "LIMIT":
            resp.json.return_value = {"status": "success", "orderid": "TGT_ORDER_999"}
        else:
            resp.json.return_value = {"status": "success", "orderid": "SL_ORDER_888"}
        return resp

    mock_session.post.side_effect = mock_post

    res = arm_protective_brackets(
        openalgo_host="http://127.0.0.1:5000",
        api_key="mock_key",
        symbol="HCLTECH27OCT261310CE",
        exchange="NFO",
        product="MIS",
        filled_qty=800,
        fill_price=25.80,
        sl_price=16.77,
        target1_price=36.12,
        strategy_tag="FNO_SectorRotation",
        lot_size=400,  # 800 shares = 2 lots
        session=mock_session
    )

    assert res["status"] == "ARMED"
    assert res["runner_mode"] is False
    assert res["target_order_id"] == "TGT_ORDER_999"
    assert res["sl_order_id"] == "SL_ORDER_888"
    assert res["target_qty"] == 400
    assert res["filled_qty"] == 800

    # Verify TWO POSTs were dispatched: Target LIMIT (400 qty) and SL-M (800 qty)
    assert mock_session.post.call_count == 2
    calls = mock_session.post.call_args_list
    tgt_payload = calls[0].kwargs["json"]
    sl_payload = calls[1].kwargs["json"]

    assert tgt_payload["strategy"] == "TGT_FNO_SectorRotation"
    assert tgt_payload["pricetype"] == "LIMIT"
    assert tgt_payload["quantity"] == 400
    assert tgt_payload["price"] == 36.10

    assert sl_payload["strategy"] == "SL_FNO_SectorRotation"
    assert sl_payload["pricetype"] == "SL-M"
    assert sl_payload["quantity"] == 800
    assert sl_payload["trigger_price"] == 16.75


def test_modify_broker_sl():
    """Verify modify_broker_sl sends proper payload to OpenAlgo /modifyorder."""
    mock_session = MagicMock()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "success"}
    mock_session.post.return_value = mock_resp

    res = modify_broker_sl(
        openalgo_host="http://127.0.0.1:5000",
        api_key="mock_key",
        sl_order_id="SL_ORDER_888",
        symbol="HCLTECH27OCT261310CE",
        exchange="NFO",
        product="MIS",
        qty=400,
        new_trigger_price=25.85,
        strategy_tag="FNO_SectorRotation",
        session=mock_session
    )

    assert res["status"] == "success"
    payload = mock_session.post.call_args.kwargs["json"]
    assert payload["orderid"] == "SL_ORDER_888"
    assert payload["strategy"] == "SL_FNO_SectorRotation"
    assert payload["trigger_price"] == 25.85
    assert payload["quantity"] == 400


def test_cancel_broker_orders():
    """Verify cancel_broker_orders dispatches cancellation for all provided order IDs."""
    mock_session = MagicMock()
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "success"}
    mock_session.post.return_value = mock_resp

    res = cancel_broker_orders(
        openalgo_host="http://127.0.0.1:5000",
        api_key="mock_key",
        order_ids=["SL_ORDER_888", "TGT_ORDER_999"],
        strategy_tag="FNO_SectorRotation",
        session=mock_session
    )

    assert len(res) == 2
    assert "SL_ORDER_888" in res
    assert "TGT_ORDER_999" in res
    assert mock_session.post.call_count == 2
