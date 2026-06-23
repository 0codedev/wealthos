"""
telegram_ear.py
Telethon-based Telegram channel listener daemon.
Subscribes to advisory channels and forwards signals to the local
WebSocket bridge for consumption by TelegramEarManager.ts.
"""
import os
import json
import asyncio
import logging
from typing import List

from telethon import TelegramClient, events
from telethon.tl.types import MessageMediaPhoto

log = logging.getLogger("telegram_ear")

API_ID   = int(os.getenv("TELEGRAM_API_ID", "0"))
API_HASH = os.getenv("TELEGRAM_API_HASH", "")
SESSION  = os.getenv("TELEGRAM_SESSION", "ear_session")

# Loaded from scripts/ear-config.json
def load_channel_config() -> List[str]:
    # Check both ../scripts/ear-config.json and scripts/ear-config.json
    possible_paths = [
        os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "ear-config.json"),
        os.path.join(os.path.dirname(__file__), "..", "scripts", "ear-config.json"),
        os.path.join(os.path.dirname(__file__), "..", "ear-config.json")
    ]
    for config_path in possible_paths:
        if os.path.exists(config_path):
            try:
                with open(config_path) as f:
                    cfg = json.load(f)
                # ear-config.json shape: {"ears": [{"id": ..., "channelIds": [...]}, ...]}
                channel_ids: List[str] = []
                for ear in cfg.get("ears", []):
                    raw = ear.get("channelIds", [])
                    if isinstance(raw, list):
                        channel_ids.extend(str(cid) for cid in raw)
                    elif isinstance(raw, str) and raw.upper() != "ALL":
                        channel_ids.append(raw)
                if channel_ids:
                    log.info(f"Telethon ear loaded {len(channel_ids)} channel ids from {config_path}")
                else:
                    log.warning(f"No explicit channelIds found in {config_path} (catch-all ears are handled by the Node ear server)")
                return channel_ids
            except Exception as e:
                log.warning(f"Error reading config at {config_path}: {e}")
    log.warning("ear-config.json not found — using empty channel list")
    return []


# Shared signal queue consumed by the FastAPI WebSocket endpoint
signal_queue: asyncio.Queue = asyncio.Queue()


async def run_ear():
    """Start the Telethon client and subscribe to target channels."""
    # SAFETY: this daemon shares TELEGRAM_SESSION with scripts/telegram-ear-server.js
    # (GramJS). Two concurrent MTProto logins on one user session trigger
    # AUTH_KEY_DUPLICATED and kill BOTH listeners. The Node ear server is the
    # primary listener; this Telethon ear stays opt-in.
    if os.getenv("ENABLE_TELETHON_EAR", "false").strip().lower() not in ("1", "true", "yes"):
        log.info("Telethon ear disabled (ENABLE_TELETHON_EAR not set) - Node ear server owns the session.")
        return

    if not API_ID or API_ID == 0 or not API_HASH:
        log.info("Telegram API ID/Hash not configured. Telethon ear listener dormant.")
        return

    channels = load_channel_config()
    from telethon.sessions import StringSession
    client_kwargs = {"connection_retries": 1, "timeout": 5}

    try:
        if len(SESSION) > 100:
            client = TelegramClient(StringSession(SESSION), API_ID, API_HASH, **client_kwargs)
        else:
            raise ValueError("Session too short")
    except Exception as e:
        session_path = os.path.join(os.path.dirname(__file__), "ear_session")
        client = TelegramClient(session_path, API_ID, API_HASH, **client_kwargs)

    @client.on(events.NewMessage(chats=channels if channels else None))
    async def handle_message(event):
        msg = event.message
        signal_payload = {
            "channel_id": str(event.chat_id),
            "timestamp":  str(msg.date),
            "text":       msg.text or "",
            "has_image":  bool(msg.media and isinstance(msg.media, MessageMediaPhoto)),
            "image_bytes": None
        }

        if signal_payload["has_image"]:
            photo_bytes = await client.download_media(msg, bytes)
            signal_payload["image_bytes"] = list(photo_bytes)

        await signal_queue.put(signal_payload)

    try:
        await client.connect()
        if not await client.is_user_authorized():
            log.info("Telethon session not authorized. Disconnecting listener.")
            await client.disconnect()
            return
        await client.start()
        await client.run_until_disconnected()
    except (TimeoutError, OSError, Exception) as e:
        log.info(f"Telethon listener inactive: {e}")
    finally:
        try:
            if client.is_connected():
                await client.disconnect()
        except Exception:
            pass

if __name__ == "__main__":
    # If run directly, run the client
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_ear())
