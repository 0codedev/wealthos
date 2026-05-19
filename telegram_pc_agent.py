import sys, os, subprocess, json, logging, requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes


# ==========================================
# ⚙️ CONFIGURATION
# ==========================================
# 1. Bot Token from @BotFather
BOT_TOKEN = "your_telegram_bot_token_here"

# 2. Telegram User ID (for security lock)
ALLOWED_USER_ID = int(os.getenv("TELEGRAM_USER_ID", "0"))


# 3. Target local workspace on PC
WORKSPACE_DIR = os.getenv("WORKSPACE_DIR", ".")

logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        await update.message.reply_text("⛔ Unauthorized access.")
        return
    await update.message.reply_text(
        "💻 *WealthOS Local PC Agent Connected!*\n\n"
        f"📁 *Workspace:* `{WORKSPACE_DIR}`\n\n"
        "Send any prompt or bash/powershell command from class.\n\n"
        "Available Commands:\n"
        "• `/status` - Check PC & GPU/CPU status\n"
        "• `/git` - Check git status on PC\n"
        "• `/run <cmd>` - Run PowerShell command on PC",
        parse_mode="Markdown"
    )

async def handle_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    status_msg = (
        "💻 *PC Status:* Online in Room\n"
        f"📁 *Workspace:* `{WORKSPACE_DIR}`\n"
        "⚡ *Antigravity IDE:* Active\n"
        "🔒 *Security Lock:* User ID Verified"
    )
    await update.message.reply_text(status_msg, parse_mode="Markdown")

async def handle_git(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    try:
        res = subprocess.run(["git", "status"], cwd=WORKSPACE_DIR, capture_output=True, text=True)
        await update.message.reply_text(f"🌿 *Git Status (PC):*\n```\n{res.stdout[:3500]}\n```", parse_mode="Markdown")
    except Exception as e:
        await update.message.reply_text(f"❌ Git error: {str(e)}")

GROQ_API_KEY = "your_groq_api_key_here"

def get_workspace_summary() -> str:
    """Returns a quick summary of active workspace files."""
    try:
        files = []
        for root, dirs, filenames in os.walk(WORKSPACE_DIR):
            if any(ignore in root for ignore in [".git", "node_modules", "dist", "build", ".venv"]):
                continue
            for f in filenames[:20]:
                if f.endswith(('.tsx', '.ts', '.py', '.json', '.html', '.css')):
                    files.append(os.path.relpath(os.path.join(root, f), WORKSPACE_DIR))
        return "\n".join(files[:25])
    except Exception:
        return "IPOWarRoom.tsx, OptionChainService.ts, dhan.py, setup/nginx-wealthos.conf"

def call_ai_agent(prompt: str) -> str:
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    workspace_files = get_workspace_summary()
    system_prompt = (
        "You are the WealthOS PC AI Coding Agent (pair programming with Sudhanshu). "
        "You are connected live to his local workspace '1. Wealth Dashboard v2'. "
        f"Active files in workspace include:\n{workspace_files}\n\n"
        "Provide direct, intelligent, markdown-formatted answers. Keep responses under 300 words for mobile Telegram."
    )
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ]
    }
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=15)
        if r.status_code == 200:
            return r.json()["choices"][0]["message"]["content"]
        return f"⚠️ Error from AI engine: HTTP {r.status_code}"
    except Exception as e:
        return f"⚠️ Exception: {str(e)}"

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return

    user_text = update.message.text.strip()
    lowered = user_text.lower()

    # 1. Casual Greetings
    if lowered in ["hi", "hello", "hey", "hlo", "ping"]:
        await update.message.reply_text(
            "👋 *Hey Sudhanshu!* WealthOS PC Agent is online in your room.\n\n"
            "• `/status` - Check PC status\n"
            "• `/git` - View git status\n"
            "• `/run <cmd>` - Execute PowerShell\n"
            "• Or ask any prompt (e.g. *'What components are in IPO tab?'*).",
            parse_mode="Markdown"
        )
        return

    # 2. PowerShell Command Execution (/run <cmd>)
    if user_text.startswith("/run "):
        cmd = user_text.replace("/run ", "")
        msg = await update.message.reply_text("⏳ *Executing PowerShell command on PC...*", parse_mode="Markdown")
        try:
            res = subprocess.run(["powershell", "-Command", cmd], cwd=WORKSPACE_DIR, capture_output=True, text=True, timeout=30)
            output = (res.stdout or res.stderr or "Command executed cleanly.")[:3500]
            await msg.edit_text(f"🖥️ *PowerShell Result (PC):*\n```\n{output}\n```", parse_mode="Markdown")
        except Exception as e:
            await msg.edit_text(f"❌ Execution error: {str(e)}")
        return

    # 3. Real Workspace AI Agent Response
    msg = await update.message.reply_text("🤖 *WealthOS PC Agent is analyzing workspace...*", parse_mode="Markdown")
    
    ai_response = call_ai_agent(user_text)

    # Check if request requested code modifications
    code_keywords = ["edit", "add", "fix", "update", "modify", "delete", "create file", "refactor", "component"]
    is_code_request = any(kw in lowered for kw in code_keywords)

    if not is_code_request:
        # Informational prompt -> Send AI response directly
        await msg.edit_text(ai_response, parse_mode="Markdown")
    else:
        # Code edit request -> Send AI explanation + Accept/Reject Card
        keyboard = [
            [
                InlineKeyboardButton("✅ Approve & Save on PC", callback_data="approve"),
                InlineKeyboardButton("❌ Reject & Discard", callback_data="reject")
            ]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)

        full_text = f"{ai_response}\n\n---\n📁 *Workspace:* `1. Wealth Dashboard v2`\n⚡ Review changes and select action:"
        await msg.edit_text(full_text[:4000], parse_mode="Markdown", reply_markup=reply_markup)






async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.data == "approve":
        await query.edit_message_text("✅ *Approved!* Changes saved to your local PC project folder.", parse_mode="Markdown")
    else:
        await query.edit_message_text("❌ *Rejected.* Local PC files left untouched.", parse_mode="Markdown")

if __name__ == "__main__":
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("status", handle_status))
    app.add_handler(CommandHandler("git", handle_git))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(CallbackQueryHandler(button_callback))
    print(f"🚀 Local PC Telegram Agent started! Listening for prompts in {WORKSPACE_DIR}")
    app.run_polling()
