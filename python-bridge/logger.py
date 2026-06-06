import os
import sys
import logging

if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:
        pass
from logging.handlers import TimedRotatingFileHandler
from datetime import datetime

# Read log level from environment, defaulting to INFO
LOG_LEVEL_STR = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_LEVEL = getattr(logging, LOG_LEVEL_STR, logging.INFO)

# Setup log directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "bridge.log")

# Colors for console output
COLORS = {
    "DEBUG":    "\033[90m",   # Dark Gray
    "INFO":     "\033[36m",   # Cyan
    "WARNING":  "\033[33m",   # Yellow
    "ERROR":    "\033[31m",   # Red
    "CRITICAL": "\033[35m",   # Magenta
    "RESET":    "\033[0m",
}

ICONS = {
    "DEBUG": "🔍",
    "INFO": "ℹ️ ",
    "WARNING": "⚠️ ",
    "ERROR": "🔴",
    "CRITICAL": "🚨"
}

class ConsoleFormatter(logging.Formatter):
    def format(self, record):
        ts = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        color = COLORS.get(record.levelname, "")
        reset = COLORS["RESET"]
        icon = ICONS.get(record.levelname, "")
        tag = getattr(record, "tag", record.name.upper()[:10])
        message = record.getMessage()
        
        return f"{color}[{ts}] {icon} {tag:<12} {message}{reset}"

class FileFormatter(logging.Formatter):
    def format(self, record):
        ts = datetime.fromtimestamp(record.created).strftime("%Y-%m-%d %H:%M:%S")
        tag = getattr(record, "tag", record.name.upper()[:10])
        return f"[{ts}] [{record.levelname:<8}] [{tag:<10}] {record.getMessage()}"

# Setup root-level logger configuration
root_logger = logging.getLogger("bridge")
root_logger.setLevel(LOG_LEVEL)
root_logger.propagate = False

# Clear any existing handlers to prevent duplicate messages
if root_logger.handlers:
    root_logger.handlers.clear()

# Console handler
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(ConsoleFormatter())
console_handler.setLevel(LOG_LEVEL)
root_logger.addHandler(console_handler)

# File handler with Daily rotation, keeping last 7 days
file_handler = TimedRotatingFileHandler(
    LOG_FILE,
    when="midnight",
    interval=1,
    backupCount=7,
    encoding="utf-8"
)
file_handler.setFormatter(FileFormatter())
file_handler.setLevel(LOG_LEVEL)
root_logger.addHandler(file_handler)

# NDJSON Error Sink for Automated Diagnostic Engine
ERROR_LOGS_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "Extras", "ErrorLogs"))
os.makedirs(ERROR_LOGS_DIR, exist_ok=True)
NDJSON_ERROR_FILE = os.path.join(ERROR_LOGS_DIR, "python-bridge-errors.ndjson")

class NDJSONErrorHandler(logging.Handler):
    def emit(self, record):
        if record.levelno >= logging.WARNING:
            try:
                import json
                entry = {
                    "timestamp": datetime.fromtimestamp(record.created).isoformat(),
                    "level": record.levelname,
                    "tag": getattr(record, "tag", record.name),
                    "message": record.getMessage(),
                    "source": f"{record.filename}:{record.lineno}",
                    "subsystem": "PYTHON_BRIDGE"
                }
                with open(NDJSON_ERROR_FILE, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")
            except Exception:
                pass

ndjson_handler = NDJSONErrorHandler()
ndjson_handler.setLevel(logging.WARNING)
root_logger.addHandler(ndjson_handler)

def get_logger(name: str, tag: str = None) -> logging.Logger:
    """
    Returns a child logger configured with a specific tag for visual formatting.
    """
    logger = root_logger.getChild(name)
    logger.tag = tag or name.upper()[:10]
    return logger
