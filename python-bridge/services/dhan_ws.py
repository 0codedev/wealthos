import asyncio
import json
import logging
import threading
import uuid
import hashlib
from datetime import datetime
import websockets
import sys
import os

# Ensure root python-bridge is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from services.credential_store import SecureCredentialStore
from services.instrument_registry import resolve_symbol
from services.market_context import build_market_context

logger = logging.getLogger("dhan_ws")
logger.setLevel(logging.INFO)

class DhanWebSocketClient:
    def __init__(self):
        self.connection_status = "disconnected"
        self.thread = None
        self.loop = None
        self.websocket = None
        self.reconnect_event = None
        self._running = False

    def start(self):
        """Starts the Dhan WebSocket thread"""
        self._running = True
        self.thread = threading.Thread(target=self._run_event_loop, daemon=True, name="DhanWebSocketThread")
        self.thread.start()
        logger.info("Spawned Dhan WebSocket background thread.")

    def stop(self):
        """Stops the Dhan WebSocket client"""
        self._running = False
        if self.loop and self.loop.is_running():
            if self.reconnect_event:
                self.loop.call_soon_threadsafe(self.reconnect_event.set)
            if self.websocket:
                async def close_ws(ws):
                    try:
                        await ws.close()
                    except Exception as e:
                        logger.error(f"Error closing Dhan websocket: {e}")
                asyncio.run_coroutine_threadsafe(close_ws(self.websocket), self.loop)

    def _run_event_loop(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.reconnect_event = asyncio.Event()
        self.loop.run_until_complete(self._main_loop())

    async def _main_loop(self):
        logger.info("Dhan WebSocket main loop started.")
        while self._running:
            client_id = SecureCredentialStore.get_credential("dhan_client_id")
            access_token = SecureCredentialStore.get_credential("dhan_access_token")
            
            if not client_id or not access_token:
                self.connection_status = "waiting_for_credentials"
                logger.warning("Dhan client_id or access_token missing. Retrying in 10 seconds...")
                try:
                    await asyncio.wait_for(self.reconnect_event.wait(), timeout=10)
                    self.reconnect_event.clear()
                except asyncio.TimeoutError:
                    pass
                continue

            try:
                self.connection_status = "connecting"
                url = "wss://api-order-update.dhan.co"
                logger.info(f"Connecting to Dhan Order Update WS at {url}...")
                
                async with websockets.connect(url) as ws:
                    self.websocket = ws
                    self.connection_status = "connected"
                    logger.info("Dhan WebSocket connected. Sending login request...")
                    
                    auth_msg = {
                        "LoginReq": {
                            "MsgCode": 42,
                            "ClientId": client_id,
                            "Token": access_token
                        },
                        "UserType": "SELF"
                    }
                    await ws.send(json.dumps(auth_msg))
                    
                    while self._running:
                        try:
                            message = await ws.recv()
                            await self.handle_message(message)
                        except websockets.ConnectionClosed:
                            logger.warning("Dhan WebSocket connection closed by server.")
                            break
            except Exception as e:
                logger.error(f"Dhan WebSocket connection error: {e}")
                self.connection_status = "error"
                await asyncio.sleep(5)

    async def handle_message(self, message):
        try:
            payload = json.loads(message)
            logger.info(f"Dhan WebSocket received message: {payload}")
            
            # Map standard fields
            order_id = payload.get("orderId") or payload.get("OrderNo") or payload.get("orderNo")
            order_status = payload.get("orderStatus") or payload.get("Status") or payload.get("status")
            traded_qty = payload.get("tradedQty") or payload.get("TradedQty") or payload.get("tradedQty", 0)
            
            if not order_id or not order_status:
                logger.warning(f"Skipping malformed/non-order Dhan WS message: {payload}")
                return
                
            # Create a unique idempotency key based on status & traded quantity
            idempotency_key = f"dhan_ws_{order_id}_{order_status}_{traded_qty}"
            event_id = hashlib.md5(idempotency_key.encode()).hexdigest()
            timestamp = payload.get("updateTime") or payload.get("UpdateTime") or payload.get("timestamp") or datetime.now().isoformat()
            
            # Save the execution event in the append-only ledger
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, db.save_execution_event, 
                                       event_id, idempotency_key, order_id, order_status, timestamp, payload, "pending")
            
            # If order is filled/traded, capture post-trade context and auto-append to journal
            if order_status in ("TRADED", "FILLED"):
                logger.info(f"Dhan Order {order_id} filled. Triggering post-trade context capture.")
                await self.process_journal_handoff(order_id, payload)
                
        except Exception as ex:
            logger.error(f"Error handling Dhan WS message: {ex}")

    async def process_journal_handoff(self, order_id, payload):
        try:
            trading_symbol = payload.get("tradingSymbol") or payload.get("TradingSymbol") or payload.get("Symbol")
            if not trading_symbol:
                return
                
            loop = asyncio.get_running_loop()
            inst = await loop.run_in_executor(None, resolve_symbol, trading_symbol)
            if not inst:
                logger.warning(f"Could not resolve symbol {trading_symbol} for post-trade context.")
                return
                
            canonical_id = inst.get("canonical_id")
            
            # Build and save post-trade context envelope
            post_context = await loop.run_in_executor(None, build_market_context, canonical_id)
            await loop.run_in_executor(None, db.save_feature_snapshot, canonical_id, f"post_trade_context:{order_id}", post_context)
            
        except Exception as ex:
            logger.error(f"Error in process_journal_handoff: {ex}")

dhan_ws_client = DhanWebSocketClient()
