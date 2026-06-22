import httpx
import logging

logger = logging.getLogger("telegram_bot")

class TelegramBotService:
    def __init__(self, bot_token: str, chat_id: str):
        self.bot_token = bot_token
        
        # Support thread ID appended via # (e.g. -1004326362283#8)
        self.chat_id = chat_id
        self.thread_id = None
        if chat_id and "#" in str(chat_id):
            parts = str(chat_id).split("#", 1)
            self.chat_id = parts[0]
            try:
                self.thread_id = int(parts[1])
            except ValueError:
                pass
                
        self.api_base = f"https://api.telegram.org/bot{bot_token}"

    async def send_message(self, text: str, parse_mode: str = "HTML") -> dict:
        """
        Sends an HTML formatted message to the configured Telegram chat.
        """
        url = f"{self.api_base}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True
        }
        if self.thread_id is not None:
            payload["message_thread_id"] = self.thread_id

        try:
            async with httpx.AsyncClient(timeout=10.0, trust_env=False) as client:
                response = await client.post(url, json=payload)
                if response.status_code == 200:
                    return {"status": "success", "data": response.json()}
                else:
                    err_msg = f"Telegram API returned status {response.status_code}: {response.text}"
                    logger.error(err_msg)
                    return {"status": "error", "error": err_msg}
        except Exception as e:
            err_msg = f"Failed to send Telegram message due to exception: {str(e)}"
            logger.error(err_msg)
            return {"status": "error", "error": err_msg}

    async def send_photo(self, photo_path: str, caption: str = "", parse_mode: str = "HTML") -> dict:
        """
        Sends a photo/image file to the configured Telegram chat / topic thread.
        """
        full_text_to_follow = None
        if caption and len(caption) > 1024:
            full_text_to_follow = caption
            caption = caption[:1020] + "..."

        url = f"{self.api_base}/sendPhoto"
        data = {
            "chat_id": self.chat_id,
            "caption": caption,
            "parse_mode": parse_mode
        }
        if self.thread_id is not None:
            data["message_thread_id"] = self.thread_id

        try:
            async with httpx.AsyncClient(timeout=30.0, trust_env=False) as client:
                with open(photo_path, "rb") as f:
                    files = {"photo": f}
                    response = await client.post(url, data=data, files=files)
                    if response.status_code == 200:
                        if full_text_to_follow:
                            await self.send_message(full_text_to_follow, parse_mode=parse_mode)
                        return {"status": "success", "data": response.json()}
                    else:
                        err_msg = f"Telegram sendPhoto API returned status {response.status_code}: {response.text}"
                        logger.error(err_msg)
                        return {"status": "error", "error": err_msg}
        except Exception as e:
            err_msg = f"Failed to send Telegram photo due to exception: {str(e)}"
            logger.error(err_msg)
            return {"status": "error", "error": err_msg}

    async def test_connection(self) -> bool:
        """
        Verifies if the bot token is valid and retrieves bot details.
        """
        url = f"{self.api_base}/getMe"
        try:
            async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
                response = await client.get(url)
                return response.status_code == 200
        except Exception:
            return False

    async def get_bot_details(self) -> dict:
        """
        Returns bot info if token is valid.
        """
        url = f"{self.api_base}/getMe"
        try:
            async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("ok"):
                        bot_info = data.get("result", {})
                        return {
                            "status": "success",
                            "bot_name": bot_info.get("first_name"),
                            "username": bot_info.get("username")
                        }
                return {"status": "error", "error": "Invalid token"}
        except Exception as e:
            return {"status": "error", "error": str(e)}
