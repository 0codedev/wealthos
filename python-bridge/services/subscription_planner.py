import os
import sys
import logging
from datetime import datetime, timedelta
import asyncio
import threading

# Ensure parent directory is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
from upstox_ws import upstox_ws_client

logger = logging.getLogger("subscription_planner")

BUDGETS = {
    "full_d30": 50,
    "full": 2000,
    "option_greeks": 3000,
    "ltpc": 5000
}

# The hierarchy priorities
MODE_PRIORITY = {
    "full_d30": 4,
    "full": 3,
    "option_greeks": 2,
    "ltpc": 1
}

PRIORITY_TO_MODE = {v: k for k, v in MODE_PRIORITY.items()}

class SubscriptionPlanner:
    def __init__(self):
        self._lock = threading.Lock()
        self.running = False
        self.loop = None
        self.downgrade_timeout_seconds = 900  # Default 15 minutes (configurable 15 to 30 mins)
        self.delete_timeout_seconds = 1800     # Default 30 minutes

    def start(self, loop):
        """Starts the periodic pruning loop on the websocket client event loop thread."""
        with self._lock:
            if self.running:
                return
            self.running = True
            self.loop = loop
            asyncio.run_coroutine_threadsafe(self._periodic_pruning_loop(), loop)
            logger.info("Subscription Planner background loop started.")

    async def _periodic_pruning_loop(self):
        while self.running:
            try:
                await asyncio.sleep(30)
                await self.prune_and_sync()
            except Exception as e:
                logger.error(f"[PLANNER] Error in periodic pruning loop: {e}")

    async def prune_and_sync(self):
        """Prunes old active subscriptions and recalculates target websocket state."""
        # 1. Prune in database
        self._prune_database_records()
        
        # 2. Recalculate target state and sync to websocket
        await self.recalculate_and_sync()

    def _prune_database_records(self):
        """Internal helper to downgrade/delete idle records in SQLite."""
        conn = db.get_db_connection(write=True)
        cursor = conn.cursor()
        try:
            now = datetime.now()
            cutoff_downgrade = (now - timedelta(seconds=self.downgrade_timeout_seconds)).isoformat()
            cutoff_delete = (now - timedelta(seconds=self.delete_timeout_seconds)).isoformat()
            
            # Find subscriptions that should be deleted: mode='ltpc' and last_requested_at < cutoff_delete
            cursor.execute("""
                DELETE FROM active_subscriptions 
                WHERE mode = 'ltpc' AND last_requested_at < ?
            """, (cutoff_delete,))
            
            # Find subscriptions that should be downgraded: mode > 'ltpc' and last_requested_at < cutoff_downgrade
            cursor.execute("""
                SELECT client_id, instrument_key, mode FROM active_subscriptions 
                WHERE mode != 'ltpc' AND last_requested_at < ?
            """, (cutoff_downgrade,))
            to_downgrade = cursor.fetchall()
            
            if to_downgrade:
                for row in to_downgrade:
                    logger.info(f"[PLANNER] Downgrading idle key {row['instrument_key']} for client {row['client_id']} from {row['mode']} to ltpc due to visibility timeout.")
                    
                cursor.execute("""
                    UPDATE active_subscriptions 
                    SET mode = 'ltpc', last_requested_at = ?
                    WHERE mode != 'ltpc' AND last_requested_at < ?
                """, (now.isoformat(), cutoff_downgrade))
            
            conn.commit()
        except Exception as e:
            logger.error(f"[PLANNER DB ERROR] Failed to prune active subscriptions: {e}")
        finally:
            conn.close()

    async def recalculate_and_sync(self):
        """
        Reads active_subscriptions, groups by instrument, resolves mode conflicts,
        enforces budgets, and triggers sync on upstox_ws_client.
        """
        # Read all records
        conn = db.get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT client_id, instrument_key, mode, last_requested_at FROM active_subscriptions")
            rows = cursor.fetchall()
        except Exception as e:
            logger.error(f"[PLANNER DB ERROR] Failed to fetch active subscriptions: {e}")
            return
        finally:
            conn.close()

        # Group by instrument key: keep a list of (mode, last_requested_at)
        instrument_requests = {}
        for row in rows:
            key = row["instrument_key"]
            mode = row["mode"]
            req_time_str = row["last_requested_at"]
            try:
                req_time = datetime.fromisoformat(req_time_str)
            except Exception:
                req_time = datetime.now()
                
            if key not in instrument_requests:
                instrument_requests[key] = []
            instrument_requests[key].append({
                "mode": mode,
                "requested_at": req_time
            })

        # Resolve conflicts to find the highest requested mode and latest requested time for each instrument
        resolved_instruments = []
        for key, reqs in instrument_requests.items():
            max_priority = 0
            max_mode = "ltpc"
            latest_time = None
            
            for req in reqs:
                m = req["mode"]
                p = MODE_PRIORITY.get(m, 1)
                if p > max_priority:
                    max_priority = p
                    max_mode = m
                t = req["requested_at"]
                if latest_time is None or t > latest_time:
                    latest_time = t
                    
            resolved_instruments.append({
                "key": key,
                "mode": max_mode,
                "priority": max_priority,
                "requested_at": latest_time
            })

        # Enforce budget limits
        # Sort resolved instruments by requested_at descending (newest subscriptions first)
        resolved_instruments.sort(key=lambda x: x["requested_at"], reverse=True)

        final_subscriptions = {}
        counts = {m: 0 for m in BUDGETS}

        for inst in resolved_instruments:
            key = inst["key"]
            target_mode = inst["mode"]
            p = inst["priority"]
            
            # Walk down priority modes to find one that fits the budget
            assigned_mode = None
            for p_level in range(p, 0, -1):
                m_candidate = PRIORITY_TO_MODE[p_level]
                if counts[m_candidate] < BUDGETS[m_candidate]:
                    assigned_mode = m_candidate
                    counts[m_candidate] += 1
                    break
            
            if assigned_mode:
                final_subscriptions[key] = assigned_mode
            else:
                logger.warning(f"[PLANNER] Budget exceeded for key {key}. Dropped subscription entirely.")

        # Sync with upstox_ws_client
        upstox_ws_client.sync_subscriptions(final_subscriptions)

    def register_client_subscription(self, client_id: str, keys: list, mode: str, is_visible: bool = True):
        """Saves subscriptions for a client and triggers sync."""
        if not keys:
            return
            
        # Update client subscription cache in-memory for low-latency filtering
        with upstox_ws_client._listeners_lock:
            if client_id not in upstox_ws_client.client_subscriptions:
                upstox_ws_client.client_subscriptions[client_id] = set()
            upstox_ws_client.client_subscriptions[client_id].update(keys)

        # If client tab is backgrounded, force mode to ltpc
        effective_mode = mode if is_visible else "ltpc"
        
        # Save to database
        for key in keys:
            db.save_active_subscription(client_id, key, effective_mode)
            
        # Trigger immediate sync safely
        self._safe_schedule_recalculate()

            
    def _safe_schedule_recalculate(self):
        """Safely schedules recalculate_and_sync across sync/async event loops without asyncio.run collisions"""
        try:
            if self.loop and self.loop.is_running():
                asyncio.run_coroutine_threadsafe(self.recalculate_and_sync(), self.loop)
                return
            try:
                running_loop = asyncio.get_running_loop()
                if running_loop and running_loop.is_running():
                    running_loop.create_task(self.recalculate_and_sync())
                    return
            except RuntimeError:
                pass
            asyncio.run(self.recalculate_and_sync())
        except Exception as e:
            logger.error(f"[SubscriptionPlanner] Error scheduling recalculate: {e}")

    def add_client_subscriptions(self, client_id: str, keys: list, mode: str = "full", is_visible: bool = True):
        """Adds subscriptions for a client and triggers sync."""
        with upstox_ws_client._listeners_lock:
            if client_id not in upstox_ws_client.client_subscriptions:
                upstox_ws_client.client_subscriptions[client_id] = set()
            upstox_ws_client.client_subscriptions[client_id].update(keys)

        # If client tab is backgrounded, force mode to ltpc
        effective_mode = mode if is_visible else "ltpc"
        
        # Save to database
        for key in keys:
            db.save_active_subscription(client_id, key, effective_mode)
            
        # Trigger immediate sync safely
        self._safe_schedule_recalculate()

    def release_client_subscriptions(self, client_id: str, keys: list = None):
        """Releases subscriptions for a client and triggers sync."""
        with upstox_ws_client._listeners_lock:
            if keys is None:
                upstox_ws_client.client_subscriptions.pop(client_id, None)
            else:
                if client_id in upstox_ws_client.client_subscriptions:
                    upstox_ws_client.client_subscriptions[client_id].difference_update(keys)
                    if not upstox_ws_client.client_subscriptions[client_id]:
                        upstox_ws_client.client_subscriptions.pop(client_id, None)

        if keys is None:
            # Release all subscriptions for client
            db.remove_all_client_subscriptions(client_id)
        else:
            for key in keys:
                db.remove_active_subscription(client_id, key)
                
        # Trigger immediate sync safely
        self._safe_schedule_recalculate()

subscription_planner = SubscriptionPlanner()
