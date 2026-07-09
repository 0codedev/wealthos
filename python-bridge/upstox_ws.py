import asyncio
import json
import logging
import threading
import uuid
import websockets
from typing import Dict, Set, List, Generator, Tuple
from datetime import datetime

import MarketDataFeedV3_pb2 as pb
from google.protobuf.json_format import MessageToDict
from upstox import upstox_client

# Configure logging
from logger import get_logger
logger = get_logger("upstox_ws", tag="WS")

class UpstoxWebSocketClient:
    def __init__(self):
        import gc
        gc.set_threshold(400, 5, 5)
        self.subscribed_keys: Set[str] = set()
        self.subscription_modes: Dict[str, str] = {}
        self.latest_ticks: Dict[str, dict] = {}
        self.listeners: Dict[str, Tuple[asyncio.Queue, str, asyncio.AbstractEventLoop]] = {} # connection_id -> (queue, client_id, loop)
        self.client_subscriptions: Dict[str, Set[str]] = {} # client_id -> set(keys)
        self.command_queue: asyncio.Queue = asyncio.Queue()
        self.loop: asyncio.AbstractEventLoop = None
        self.connection_status = "disconnected"
        self.thread: threading.Thread = None
        self.websocket = None
        self.ping_latency_ms = -1.0
        self._ticks_lock = threading.Lock()
        self._listeners_lock = threading.Lock()
        self.prev_ltp: Dict[str, float] = {}
        self.cvd: Dict[str, float] = {}
        self.prev_vtt: Dict[str, float] = {}
        self.current_session_date = None

    @property
    def is_connected(self) -> bool:
        """Returns True if the WebSocket is actively connected and authenticated."""
        return self.connection_status == "connected"

    def add_listener(self, connection_id: str, queue: asyncio.Queue, client_id: str):
        """Thread-safely adds an ASGI listener queue mapped to client_id"""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = self.loop
        with self._listeners_lock:
            self.listeners[connection_id] = (queue, client_id, loop)

    def remove_listener(self, connection_id: str):
        """Thread-safely removes an ASGI listener queue"""
        with self._listeners_lock:
            self.listeners.pop(connection_id, None)

    def push_to_client(self, client_id: str, payload: List[dict]):
        """Thread-safely pushes an immediate tick/snapshot payload to all active queues for a client_id"""
        if not payload:
            return
        with self._listeners_lock:
            client_queues = [
                (q, loop) for q, cid, loop in self.listeners.values()
                if cid == client_id and loop is not None and loop.is_running()
            ]
        for q, loop in client_queues:
            def safe_put(queue=q, data=payload):
                if queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                queue.put_nowait(data)
            loop.call_soon_threadsafe(safe_put)

    def start(self):
        """Starts the WebSocket client in a background thread"""
        if self.thread and self.thread.is_alive():
            logger.info("Upstox WebSocket thread is already running.")
            return
        
        self.thread = threading.Thread(target=self._run_event_loop, daemon=True, name="UpstoxWebSocketThread")
        self.thread.start()
        logger.info("Spawned Upstox WebSocket background thread.")

    def _run_event_loop(self):
        """Initializes and runs the asyncio event loop"""
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self.reconnect_event = asyncio.Event()
        self.loop.run_until_complete(self._main_loop())

    def trigger_reconnect(self):
        """Thread-safe trigger to immediately wake up the WebSocket connection loop and close active connection"""
        if not self.thread or not self.thread.is_alive():
            logger.info("[WS] WebSocket thread not running. Starting Upstox WebSocket thread...")
            self.start()
            return

        if self.loop and self.loop.is_running():
            logger.info("[WS] Received external reconnect trigger. Forcing websocket close and waking up event loop...")
            if self.reconnect_event:
                self.loop.call_soon_threadsafe(self.reconnect_event.set)
            if self.websocket:
                async def close_ws(ws):
                    try:
                        await ws.close()
                    except Exception as e:
                        logger.error(f"[WS] Error closing websocket during trigger: {e}")
                asyncio.run_coroutine_threadsafe(close_ws(self.websocket), self.loop)

    async def _main_loop(self):
        """Main connection and reconnection loop"""
        logger.info("Upstox WebSocket main loop started.")
        
        try:
            from services.subscription_planner import subscription_planner
            subscription_planner.start(self.loop)
        except Exception as planner_err:
            logger.error(f"[WS INIT ERROR] Failed to start subscription planner background loop: {planner_err}")
            
        retry_attempt = 0
        import random
        while True:
            # 1. Check if token is available (either interactive or analytics token)
            if not upstox_client.token and not upstox_client.analytics_token:
                self.connection_status = "waiting_for_token"
                logger.info("[WS] Upstox access tokens are missing. Paused until authentication.")
                try:
                    await self.reconnect_event.wait()
                    self.reconnect_event.clear()
                except Exception:
                    pass
                continue

            # 2. Get Authorized WebSocket URI
            self.connection_status = "authorizing"
            try:
                # Market Data Feed WebSocket REQUIRES interactive token (analytics token is rejected with HTTP 401 by Upstox WS)
                t_mode = "interactive"

                # The request is synchronous, offload to run_in_executor
                res = await self.loop.run_in_executor(
                    None, 
                    lambda: upstox_client.request("GET", "v3/feed/market-data-feed/authorize", token_mode=t_mode)
                )
                
                if res.get("status") != "success" or "data" not in res:
                    logger.debug(f"Failed to get WebSocket authorize URL: {res}")
                    try:
                        await asyncio.wait_for(self.reconnect_event.wait(), timeout=10)
                        self.reconnect_event.clear()
                    except asyncio.TimeoutError:
                        pass
                    continue
                    
                auth_uri = res["data"].get("authorizedRedirectUri") or res["data"].get("authorized_redirect_uri")
                if not auth_uri:
                    logger.debug(f"Authorized redirect URI not found in response: {res}")
                    try:
                        await asyncio.wait_for(self.reconnect_event.wait(), timeout=10)
                        self.reconnect_event.clear()
                    except asyncio.TimeoutError:
                        pass
                    continue

            except Exception as e:
                err_msg = str(e)
                
                # Catch 401 Unauthorized or expired token specifically
                if "401" in err_msg or "unauthorized" in err_msg.lower():
                    logger.info("[WS] Upstox daily token is expired or unauthorized (401). WebSocket paused; REST polling active with 1-Year Analytics Token.")
                    self.connection_status = "unauthorized"
                    try:
                        # Wait silently for user OAuth login trigger without spamming API
                        await self.reconnect_event.wait()
                        self.reconnect_event.clear()
                        logger.info("[WS] Daily token refreshed! Retrying WebSocket connection immediately...")
                    except Exception:
                        pass
                    continue
                # Check for 410 Gone or 403 Forbidden (read-only/analytics tokens)
                elif any(code in err_msg for code in ["410", "403"]):
                    logger.info("[WS] Upstox token lacks WebSocket stream permissions. Using REST polling fallback.")
                    self.connection_status = "degraded"
                    try:
                        await self.reconnect_event.wait()
                        self.reconnect_event.clear()
                    except Exception:
                        pass
                    continue
                else:
                    logger.error(f"[WS] Error during WebSocket authorization: {err_msg}")
                    try:
                        await asyncio.wait_for(self.reconnect_event.wait(), timeout=5)
                        self.reconnect_event.clear()
                    except asyncio.TimeoutError:
                        pass
                    continue
                continue

            # 3. Connect to the WebSocket URI
            logger.info(f"Connecting to Upstox WebSocket: {auth_uri}")
            self.connection_status = "connecting"
            
            try:
                async with websockets.connect(auth_uri, ping_interval=10, ping_timeout=10) as ws:
                    self.websocket = ws
                    self.connection_status = "connected"
                    logger.info("Successfully connected to Upstox WebSocket.")
                    retry_attempt = 0

                    # Re-subscribe to all previously subscribed keys upon reconnection
                    if self.subscribed_keys:
                        logger.info(f"Re-subscribing to {len(self.subscribed_keys)} instruments...")
                        mode_groups = {}
                        for key in self.subscribed_keys:
                            mode = self.subscription_modes.get(key, "full")
                            if mode not in mode_groups:
                                mode_groups[mode] = []
                            mode_groups[mode].append(key)
                        for mode, group_keys in mode_groups.items():
                            await self._send_subscription(group_keys, "sub", mode)

                    # Handle messages, commands, ping, and GC loops concurrently
                    receive_task = asyncio.create_task(self._receive_messages(), name="WS_Receive")
                    command_task = asyncio.create_task(self._process_commands(), name="WS_Command")
                    ping_task = asyncio.create_task(self._ping_loop(), name="WS_Ping")
                    gc_task = asyncio.create_task(self._gc_loop(), name="WS_GC")

                    done, pending = await asyncio.wait(
                        [receive_task, command_task, ping_task, gc_task],
                        return_when=asyncio.FIRST_COMPLETED
                    )

                    # Cancel pending tasks (e.g. command and ping loops) since connection is closing
                    for task in pending:
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass

                    # Propagate exceptions from completed tasks if any
                    for task in done:
                        try:
                            task.result()
                        except Exception as task_err:
                            logger.error(f"[WS] Task {task.get_name()} failed with exception: {task_err}", exc_info=True)
            except websockets.exceptions.ConnectionClosed as e:
                logger.warning(f"WebSocket connection closed: {e}.")
            except Exception as e:
                err_str = str(e).lower()
                is_auth_issue = any(k in err_str for k in ["certificate", "ssl", "401", "unauthorized", "forbidden", "handshake"])
                if is_auth_issue and retry_attempt >= 3:
                    logger.warning(f"[WS] WebSocket auth/certificate rejected ({e}). Reconnection paused; waiting for credentials or user reconnect trigger.")
                    self.connection_status = "auth_required"
                    try:
                        await self.reconnect_event.wait()
                        self.reconnect_event.clear()
                        retry_attempt = 0
                    except Exception:
                        pass
                    continue
                else:
                    logger.warning(f"WebSocket connection attempt failed: {e}.")
            finally:
                self.websocket = None
                if self.connection_status != "auth_required":
                    self.connection_status = "disconnected"
                self.ping_latency_ms = -1.0
                
                # Adaptive exponential backoff with jitter (capped at 60.0s)
                base_delay = 2.0
                max_delay = 60.0
                backoff_delay = min(max_delay, base_delay * (2.0 ** min(retry_attempt, 5)))
                total_delay = min(max_delay, backoff_delay + random.uniform(0.5, 2.0))
                logger.info(f"Reconnecting in {total_delay:.1f} seconds...")
                
                retry_attempt += 1
                try:
                    await asyncio.wait_for(self.reconnect_event.wait(), timeout=total_delay)
                    self.reconnect_event.clear()
                    # Reset retry attempt on explicit reconnect triggers
                    retry_attempt = 0
                except asyncio.TimeoutError:
                    pass

    async def _send_subscription(self, keys: List[str], method: str, mode: str = "full"):
        """Sends a subscription or unsubscription frame to Upstox"""
        if not self.websocket or self.connection_status != "connected":
            logger.warning(f"Cannot send subscription command. WebSocket not connected. Status: {self.connection_status}")
            return

        payload = {
            "guid": str(uuid.uuid4()),
            "method": method, # "sub" or "unsub"
            "data": {
                "mode": mode,  # Can be "full", "ltpc", "option_greeks", "full_d30"
                "instrumentKeys": keys
            }
        }
        
        try:
            logger.info(f"Sending WebSocket command: {method} in mode {mode} for {len(keys)} keys")
            await self.websocket.send(json.dumps(payload).encode("utf-8"))
        except Exception as e:
            logger.error(f"Failed to send subscription frame over WebSocket: {e}")

    async def _ping_loop(self):
        """Periodically pings the server to calculate round-trip latency"""
        import time
        while self.websocket and self.connection_status == "connected":
            try:
                start_time = time.perf_counter()
                pong_waiter = await self.websocket.ping()
                await pong_waiter
                self.ping_latency_ms = (time.perf_counter() - start_time) * 1000.0
            except Exception:
                self.ping_latency_ms = -1.0
            await asyncio.sleep(15.0)

    async def _gc_loop(self):
        """Periodically runs garbage collection to prevent memory ballooning under high-throughput ticks"""
        import gc
        logger.info("[WS GC] Started real-time garbage collection optimizer loop.")
        while self.websocket and self.connection_status == "connected":
            try:
                gc.collect()
            except Exception as e:
                logger.warning(f"[WS GC] Error running garbage collection: {e}")
            await asyncio.sleep(4.0)

    async def _receive_messages(self):
        """Receives and decodes binary WebSocket frames"""
        while self.websocket:
            try:
                message = await self.websocket.recv()
                if isinstance(message, bytes):
                    await self._decode_and_broadcast(message)
                else:
                    # Text messages might be ping/pong or responses from Upstox
                    logger.debug(f"Received text message from WebSocket: {message}")
            except websockets.exceptions.ConnectionClosed:
                logger.warning("WebSocket connection closed in receive loop.")
                break
            except Exception as e:
                logger.error(f"Error receiving/decoding WebSocket message: {e}")
                await asyncio.sleep(0.1)

    async def _decode_and_broadcast(self, binary_data: bytes):
        """Decodes Protobuf bytes into dict and notifies all active listeners"""
        try:
            feed_response = pb.FeedResponse()
            feed_response.ParseFromString(binary_data)
            
            # Convert to dictionary (preserving field names)
            feed_dict = MessageToDict(feed_response, preserving_proto_field_name=True)
            
            feeds = feed_dict.get("feeds", {})
            if not feeds:
                return

            timestamp_str = datetime.now().isoformat()
            
            # Reset session on new calendar day
            today_date = datetime.now().date()
            if today_date != self.current_session_date:
                logger.info(f"[WS] New session date: {today_date}. Clearing CVD cache.")
                with self._ticks_lock:
                    self.prev_ltp.clear()
                    self.cvd.clear()
                    self.prev_vtt.clear()
                    self.current_session_date = today_date
                    
            broadcast_payload = []

            for key, feed in feeds.items():
                # Format tick data with standard shapes
                tick = {
                    "instrument_key": key,
                    "timestamp": timestamp_str,
                    "ltp": None,
                    "close": None,
                    "volume": None,
                    "oi": None,
                    "iv": None,
                    "greeks": None,
                    "ltt": None,
                    "ltq": None
                }

                # 1. Parse LTPC
                if "ltpc" in feed:
                    ltpc_val = feed["ltpc"]
                    tick["ltp"] = ltpc_val.get("ltp")
                    tick["close"] = ltpc_val.get("cp")
                    tick["ltt"] = int(ltpc_val.get("ltt")) if ltpc_val.get("ltt") is not None else None
                    tick["ltq"] = float(ltpc_val.get("ltq")) if ltpc_val.get("ltq") is not None else None
                
                # 2. Parse Full Feed or First Level with Greeks
                if "fullFeed" in feed:
                    full_feed = feed["fullFeed"]
                    ff = None
                    if "marketFF" in full_feed:
                        ff = full_feed["marketFF"]
                    elif "indexFF" in full_feed:
                        ff = full_feed["indexFF"]
                        
                    if ff:
                        tick["oi"] = ff.get("oi")
                        tick["iv"] = ff.get("iv")
                        tick["volume"] = int(ff.get("vtt")) if ff.get("vtt") is not None else None
                        tick["atp"] = ff.get("atp")
                        
                        if "ltpc" in ff:
                            ltpc_val = ff["ltpc"]
                            tick["ltp"] = ltpc_val.get("ltp")
                            tick["close"] = ltpc_val.get("cp")
                            tick["ltt"] = int(ltpc_val.get("ltt")) if ltpc_val.get("ltt") is not None else None
                            tick["ltq"] = float(ltpc_val.get("ltq")) if ltpc_val.get("ltq") is not None else None
                        
                        if "optionGreeks" in ff:
                            tick["greeks"] = ff["optionGreeks"]
                            
                        if "marketOHLC" in ff and "ohlc" in ff["marketOHLC"]:
                            # Extract the daily OHLC candle
                            candles = ff["marketOHLC"]["ohlc"]
                            daily_candle = next((c for c in candles if c.get("interval") == "1d"), None)
                            if daily_candle:
                                tick["ohlc"] = {
                                    "open": daily_candle.get("open"),
                                    "high": daily_candle.get("high"),
                                    "low": daily_candle.get("low"),
                                    "close": daily_candle.get("close")
                                }
                            # Extract all OHLC candles
                            ohlc_intervals = {}
                            for c in candles:
                                interval = c.get("interval")
                                if interval:
                                    ohlc_intervals[interval] = {
                                        "open": c.get("open"),
                                        "high": c.get("high"),
                                        "low": c.get("low"),
                                        "close": c.get("close"),
                                        "volume": c.get("vol"),
                                        "timestamp": c.get("ts")
                                    }
                            tick["ohlc_intervals"] = ohlc_intervals
                        
                        if "marketLevel" in ff and ff["marketLevel"] and "bidAskQuote" in ff["marketLevel"]:
                            quotes = ff["marketLevel"]["bidAskQuote"]
                            buy_levels = []
                            sell_levels = []
                            for q in quotes:
                                bid_price = q.get("bidP", 0.0)
                                bid_qty = q.get("bidQ", 0)
                                ask_price = q.get("askP", 0.0)
                                ask_qty = q.get("askQ", 0)
                                if bid_price and float(bid_price) > 0:
                                    buy_levels.append({
                                        "price": float(bid_price),
                                        "quantity": int(bid_qty),
                                        "orders": 0
                                    })
                                if ask_price and float(ask_price) > 0:
                                    sell_levels.append({
                                        "price": float(ask_price),
                                        "quantity": int(ask_qty),
                                        "orders": 0
                                    })
                            buy_levels.sort(key=lambda x: x["price"], reverse=True)
                            sell_levels.sort(key=lambda x: x["price"])
                            tick["depth"] = {
                                "buy": buy_levels,
                                "sell": sell_levels
                            }
                elif "firstLevelWithGreeks" in feed:
                    flg = feed["firstLevelWithGreeks"]
                    tick["oi"] = flg.get("oi")
                    tick["iv"] = flg.get("iv")
                    tick["volume"] = int(flg.get("vtt")) if flg.get("vtt") is not None else None
                    if "optionGreeks" in flg:
                        tick["greeks"] = flg["optionGreeks"]
                    if "ltpc" in flg:
                        ltpc_val = flg["ltpc"]
                        tick["ltp"] = ltpc_val.get("ltp")
                        tick["close"] = ltpc_val.get("cp")
                        tick["ltt"] = int(ltpc_val.get("ltt")) if ltpc_val.get("ltt") is not None else None
                        tick["ltq"] = float(ltpc_val.get("ltq")) if ltpc_val.get("ltq") is not None else None

                # 3. Compute CVD
                if tick["ltp"] is not None:
                    tick_vol = 0.0
                    if tick["ltq"] is not None:
                        tick_vol = float(tick["ltq"])
                    elif tick["volume"] is not None:
                        prev_v = self.prev_vtt.get(key)
                        if prev_v is not None:
                            tick_vol = max(0.0, float(tick["volume"]) - float(prev_v))
                        else:
                            tick_vol = 0.0
                        self.prev_vtt[key] = tick["volume"]

                    prev_l = self.prev_ltp.get(key)
                    if prev_l is not None and tick_vol > 0:
                        with self._ticks_lock:
                            if tick["ltp"] > prev_l:
                                self.cvd[key] = self.cvd.get(key, 0.0) + tick_vol
                            elif tick["ltp"] < prev_l:
                                self.cvd[key] = self.cvd.get(key, 0.0) - tick_vol
                    
                    self.prev_ltp[key] = tick["ltp"]

                # Cache the latest tick thread-safely
                with self._ticks_lock:
                    tick["cvd"] = self.cvd.get(key, 0.0)
                    self.latest_ticks[key] = tick
                    try:
                        from services.feed_watchdog import record_tick
                        record_tick()
                    except Exception:
                        pass
                broadcast_payload.append(tick)

            # Broadcast to all listener queues and in-process multicaster thread-safely
            if broadcast_payload:
                try:
                    from ws_multiplexer import multicaster
                    multicaster.publish(broadcast_payload)
                except Exception as mc_err:
                    logger.debug(f"[WS] Error publishing to multicaster: {mc_err}")

                with self._listeners_lock:
                    listeners_copy = list(self.listeners.values())
                
                for queue, client_id, q_loop in listeners_copy:
                    client_keys = self.client_subscriptions.get(client_id, set())
                    client_payload = [tick for tick in broadcast_payload if tick["instrument_key"] in client_keys]
                    if not client_payload or q_loop is None or not q_loop.is_running():
                        continue
                        
                    def safe_put(q=queue, payload=client_payload):
                        if q.full():
                            try:
                                q.get_nowait()
                            except asyncio.QueueEmpty:
                                pass
                        q.put_nowait(payload)
                    q_loop.call_soon_threadsafe(safe_put)

        except Exception as e:
            logger.error(f"Error parsing protobuf binary: {e}")

    async def _process_commands(self):
        """Processes commands pushed to the command queue (subscribe/unsubscribe/sync)"""
        while self.websocket:
            try:
                cmd = await self.command_queue.get()
                action = cmd.get("action")
                keys = cmd.get("keys", [])
                mode = cmd.get("mode", "full")

                if action == "sync":
                    target_subs = cmd.get("subscriptions", {})
                    # 1. Determine keys to unsubscribe (unsubscribed or mode changed)
                    keys_to_unsub = []
                    for key, curr_mode in list(self.subscription_modes.items()):
                        if key not in target_subs or target_subs[key] != curr_mode:
                            keys_to_unsub.append(key)
                            
                    if keys_to_unsub:
                        await self._send_subscription(keys_to_unsub, "unsub", "full")
                        for k in keys_to_unsub:
                            self.subscribed_keys.discard(k)
                            self.subscription_modes.pop(k, None)
                            
                    # 2. Determine keys to subscribe (newly subscribed or mode changed)
                    mode_groups = {}
                    for key, target_mode in target_subs.items():
                        if key not in self.subscription_modes:
                            if target_mode not in mode_groups:
                                mode_groups[target_mode] = []
                            mode_groups[target_mode].append(key)
                            
                    for target_mode, keys_to_sub in mode_groups.items():
                        if keys_to_sub:
                            await self._send_subscription(keys_to_sub, "sub", target_mode)
                            self.subscribed_keys.update(keys_to_sub)
                            for k in keys_to_sub:
                                self.subscription_modes[k] = target_mode
                elif action == "subscribe" and keys:
                    new_keys = [k for k in keys if k not in self.subscribed_keys]
                    if new_keys:
                        self.subscribed_keys.update(new_keys)
                        for k in new_keys:
                            self.subscription_modes[k] = mode
                        await self._send_subscription(new_keys, "sub", mode)
                elif action == "unsubscribe" and keys:
                    target_keys = [k for k in keys if k in self.subscribed_keys]
                    if target_keys:
                        self.subscribed_keys.difference_update(target_keys)
                        for k in target_keys:
                            self.subscription_modes.pop(k, None)
                        await self._send_subscription(target_keys, "unsub", "full")

                self.command_queue.task_done()
            except Exception as e:
                logger.error(f"Error in command processor queue: {e}")
                await asyncio.sleep(0.5)

    def sync_subscriptions(self, subscriptions: Dict[str, str]):
        """Public method to synchronize WebSocket subscriptions with target state"""
        if not self.loop:
            # Synchronous state update for testing/offline support
            keys_to_unsub = []
            for key, curr_mode in list(self.subscription_modes.items()):
                if key not in subscriptions or subscriptions[key] != curr_mode:
                    keys_to_unsub.append(key)
            for k in keys_to_unsub:
                self.subscribed_keys.discard(k)
                self.subscription_modes.pop(k, None)
            for key, target_mode in subscriptions.items():
                self.subscribed_keys.add(key)
                self.subscription_modes[key] = target_mode
            return
            
        asyncio.run_coroutine_threadsafe(
            self.command_queue.put({"action": "sync", "subscriptions": subscriptions}),
            self.loop
        )

    def subscribe(self, keys: List[str], mode: str = "full"):
        """Public method to subscribe to instrument keys"""
        if not keys or not self.loop:
            return
        
        # Safely submit command to queue running in the background loop thread
        asyncio.run_coroutine_threadsafe(
            self.command_queue.put({"action": "subscribe", "keys": keys, "mode": mode}), 
            self.loop
        )

    def unsubscribe(self, keys: List[str]):
        """Public method to unsubscribe from instrument keys"""
        if not keys or not self.loop:
            return
        
        asyncio.run_coroutine_threadsafe(
            self.command_queue.put({"action": "unsubscribe", "keys": keys}), 
            self.loop
        )

    def get_latest_tick(self, key: str) -> dict:
        """Returns the latest cached tick for an instrument key"""
        with self._ticks_lock:
            return self.latest_ticks.get(key)

    def get_cvd(self, key: str) -> float:
        """Returns the current CVD value for an instrument key"""
        with self._ticks_lock:
            return self.cvd.get(key, 0.0)

    def get_all_cvd(self) -> Dict[str, float]:
        """Returns all CVD values mapped by instrument key"""
        with self._ticks_lock:
            return dict(self.cvd)

# Global singleton client
upstox_ws_client = UpstoxWebSocketClient()
