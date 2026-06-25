import json
import urllib.request

BOT_TOKEN = "your_telegram_bot_token_here"
CHAT_IDS = ["-1004326362283", "-4326362283", "4326362283"]
TOPIC_ID = 26

for chat_id in CHAT_IDS:
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "message_thread_id": TOPIC_ID,
        "text": f"🇮🇳 *Test Market Intelligence Briefing Connected to Topic #{TOPIC_ID}*",
        "parse_mode": "Markdown"
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"Chat ID {chat_id} Success: {resp.status} {resp.read().decode('utf-8')}")
            break
    except Exception as e:
        print(f"Chat ID {chat_id} Error: {e}")
