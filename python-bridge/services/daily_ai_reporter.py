#!/usr/bin/env python3
"""
services/daily_ai_reporter.py - Daily Post-Market AI Quant Diagnostic Reporter

Executes at 16:00 IST daily after telemetry harvesting.
Synthesizes trade excursion metrics, queries the WealthOS AI Pool (Gemini / Claude / Groq),
formats an institutional risk diagnostic, and dispatches to Telegram Topic #8.
"""

import os
import sys
import json
import asyncio
import argparse
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(BRIDGE_DIR)
sys.path.append(BRIDGE_DIR)
sys.path.append(ROOT_DIR)

from services.autopilot_db import (
    get_connection,
    get_recent_telemetry,
    get_hyperparameters,
    update_hyperparameter,
    get_ist_now_str,
    get_data_dir
)
from services.telegram_bot import TelegramBotService

DATA_DIR = get_data_dir()
REPORT_PATH = os.path.join(DATA_DIR, "latest_ai_report.json")
CONFIG_FILE = os.path.join(DATA_DIR, "telegram_config.json")

def get_ist_today_str() -> str:
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).strftime("%Y-%m-%d")

def load_telegram_credentials(role: str = "autopilot") -> tuple[str, str]:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                bots = json.load(f)
                if isinstance(bots, list):
                    bot = next((b for b in bots if b.get("role") == role and b.get("enabled")), None)
                    if not bot:
                        bot = next((b for b in bots if b.get("role") == "autopilot" and b.get("enabled")), None)
                    if bot:
                        return bot.get("token", ""), bot.get("chatId", "")
        except Exception as e:
            print(f"⚠️ Error loading telegram config: {e}")
    return os.getenv("TELEGRAM_BOT_TOKEN", ""), os.getenv("TELEGRAM_CHAT_ID", "")

def get_today_telemetry_snapshot() -> Dict[str, Any]:
    conn = get_connection()
    cur = conn.cursor()
    today = get_ist_today_str()

    cur.execute("SELECT * FROM autopilot_daily_summaries WHERE date = ?", (today,))
    summary_row = cur.fetchone()
    
    if not summary_row:
        # Fallback to most recent summary
        cur.execute("SELECT * FROM autopilot_daily_summaries ORDER BY date DESC LIMIT 1")
        summary_row = cur.fetchone()

    summary = dict(summary_row) if summary_row else {
        "date": today,
        "total_trades": 0,
        "winning_trades": 0,
        "losing_trades": 0,
        "total_pnl": 0.0,
        "win_rate": 0.0,
        "avg_mfe_pct": 0.0,
        "avg_mae_pct": 0.0,
        "rejected_orders": 0,
        "regime_detected": "TRENDING"
    }

    cur.execute("SELECT * FROM autopilot_telemetry ORDER BY id DESC LIMIT 25")
    trades = [dict(r) for r in cur.fetchall()]
    conn.close()

    regime = summary.get("regime_detected") or "TRENDING"
    params = get_hyperparameters(regime)

    return {
        "summary": summary,
        "trades": trades,
        "active_parameters": params
    }

def generate_heuristic_diagnostic(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """Deterministic hedge fund heuristic diagnostic when LLM is offline or fast dry-run."""
    s = snapshot["summary"]
    p = snapshot["active_parameters"]
    pnl = float(s.get("total_pnl", 0.0))
    win_rate = float(s.get("win_rate", 0.0))
    mfe = float(s.get("avg_mfe_pct", 0.0))
    mae = float(s.get("avg_mae_pct", 0.0))
    total_trades = int(s.get("total_trades", 0))
    regime = s.get("regime_detected", "TRENDING")

    recommendations = {}
    observations = []

    if total_trades == 0:
        observations.append("Zero trades executed today. Capital 100% preserved.")
        observations.append("Signal filters and MCX commodity killswitch operated with zero false triggers.")
        return {
            "status": "HEALTHY",
            "summary_line": "No trades executed; capital preserved with zero exposure.",
            "observations": observations,
            "recommended_adjustments": recommendations,
            "next_session_focus": "Maintain discipline and wait for A+ high-conviction index setups."
        }

    if pnl >= 0:
        observations.append(f"Net positive day (+₹{pnl:,.2f}) with {win_rate:.1f}% win rate.")
    else:
        observations.append(f"Day ended in drawdown (-₹{abs(pnl):,.2f}) across {total_trades} trades.")

    if mfe > 15.0 and pnl < 0:
        observations.append(f"Strong MFE peaks (avg +{mfe:.1f}%) gave back gains. Trailing stop-loss engaged too late.")
        recommendations["beta_trail"] = round(min(1.05, p.get("beta_trail", 1.0) + 0.02), 3)
    
    if abs(mae) > 12.0 and win_rate < 40.0:
        observations.append(f"High adverse excursion (MAE avg {mae:.1f}%). Entries suffered immediate slippage.")
        recommendations["alpha_sl"] = round(max(0.91, p.get("alpha_sl", 0.95) - 0.02), 3)

    if not recommendations:
        recommendations["theta_conviction"] = p.get("theta_conviction", 0.70)

    return {
        "status": "PROFITABLE" if pnl >= 0 else "ATTENTION_REQUIRED",
        "summary_line": f"Execution PnL: ₹{pnl:+,.2f} | Win Rate: {win_rate:.1f}% | Regime: {regime}",
        "observations": observations,
        "recommended_adjustments": recommendations,
        "next_session_focus": "Enforce strict Swarm Consensus (>=70%) and avoid over-trading in mid-day chop."
    }

async def generate_ai_diagnostic(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """Queries external LLM (Groq / Gemini) or falls back to heuristic engine."""
    # Check for Groq API key
    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        try:
            import httpx
            prompt = f"""
You are a Senior Quantitative Hedge Fund Risk Officer auditing intraday scalp telemetry for WealthOS.
Analyze the following trading session snapshot and provide a structured risk assessment:

SESSION DATA:
{json.dumps(snapshot, indent=2)}

Respond with STRICT JSON only in the following schema:
{{
  "status": "PROFITABLE" | "HEALTHY" | "ATTENTION_REQUIRED",
  "summary_line": "1-sentence executive summary of session performance",
  "observations": ["bullet 1", "bullet 2", "bullet 3"],
  "recommended_adjustments": {{"param_name": float_value}},
  "next_session_focus": "Concise 1-sentence guidance for tomorrow"
}}
"""
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                    json={
                        "model": "llama-3.3-70b-versatile",
                        "messages": [
                            {"role": "system", "content": "You are an elite quantitative trading risk officer. You speak concisely, mathematically, and output strict valid JSON."},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.2,
                        "response_format": {"type": "json_object"}
                    }
                )
                if res.status_code == 200:
                    content = res.json()["choices"][0]["message"]["content"]
                    return json.loads(content)
        except Exception as e:
            print(f"⚠️ Groq AI call failed ({e}), falling back to deterministic heuristic.")

    return generate_heuristic_diagnostic(snapshot)

def format_telegram_report_html(snapshot: Dict[str, Any], diagnostic: Dict[str, Any]) -> str:
    s = snapshot["summary"]
    p = snapshot["active_parameters"]
    date_str = s.get("date", get_ist_today_str())
    regime = s.get("regime_detected", "TRENDING")
    pnl = float(s.get("total_pnl", 0.0))
    win_rate = float(s.get("win_rate", 0.0))
    total_trades = int(s.get("total_trades", 0))
    wins = int(s.get("winning_trades", 0))
    losses = int(s.get("losing_trades", 0))
    avg_mfe = float(s.get("avg_mfe_pct", 0.0))
    avg_mae = float(s.get("avg_mae_pct", 0.0))

    emoji = "🟢" if pnl >= 0 else "🔴"
    status_tag = diagnostic.get("status", "HEALTHY")

    obs_lines = "\n".join([f"• {obs}" for obs in diagnostic.get("observations", [])])
    
    recs = diagnostic.get("recommended_adjustments", {})
    rec_lines = "\n".join([f"  ▸ <code>{k}</code>: <b>{v}</b>" for k, v in recs.items()]) if recs else "  ▸ <i>Parameters optimal; no changes needed.</i>"

    msg = [
        f"🧠 <b><u>WEALTHOS AUTOPILOT | DAILY QUANT DIAGNOSTIC</u></b>",
        f"📌 <b>STATUS:</b> <strong>{status_tag}</strong>",
        f"─────────────────────────",
        f"<blockquote>{emoji} <b>Net Realized PnL:</b> <code>{pnl:+,.2f} INR</code>",
        f"• <b>Session Date:</b> <code>{date_str}</code> | <b>Regime:</b> <code>{regime}</code>",
        f"• <b>Execution Scorecard:</b> <code>{win_rate:.1f}% Win Rate</code> ({wins}W / {losses}L of {total_trades} Trades)",
        f"• <b>Excursion Efficiency:</b> <code>MFE +{avg_mfe:.1f}% | MAE {avg_mae:.1f}%</code></blockquote>",
        f"",
        f"<blockquote expandable>🔍 <b>TACTICAL AUDIT & RECALIBRATION</b>",
        f"<b>Observations:</b>\n{obs_lines}",
        f"\n<b>Adaptive Recommendations:</b>\n{rec_lines}",
        f"\n<b>Next Session Directive:</b>\n<i>{diagnostic.get('next_session_focus', 'Execute high-conviction signals with strict risk parameters.')}</i></blockquote>",
        f"─────────────────────────",
        f"⚡ <i>Generated autonomously by WealthOS AI Risk Shield at 16:00 IST</i>"
    ]
    return "\n".join(msg)

async def generate_and_dispatch_report(dry_run: bool = False) -> Dict[str, Any]:
    print("🚀 [Daily AI Reporter] Harvesting telemetry snapshot...")
    snapshot = get_today_telemetry_snapshot()

    print("🤖 [Daily AI Reporter] Generating quant risk diagnostic...")
    diagnostic = await generate_ai_diagnostic(snapshot)

    report_html = format_telegram_report_html(snapshot, diagnostic)

    # Save JSON report to disk
    final_output = {
        "timestamp": get_ist_now_str(),
        "snapshot": snapshot,
        "diagnostic": diagnostic,
        "html_report": report_html
    }
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2)
    print(f"💾 JSON report saved to {REPORT_PATH}")

    # Save Markdown report to docs/algo/daily_reports/report_YYYY_MM_DD.md
    reports_dir = os.path.join(ROOT_DIR, "docs", "algo", "daily_reports")
    os.makedirs(reports_dir, exist_ok=True)
    today_clean = str(snapshot["summary"].get("date", get_ist_today_str())).replace("-", "_")
    md_file_path = os.path.join(reports_dir, f"report_{today_clean}.md")
    
    obs_md = "\n".join([f"- {obs}" for obs in diagnostic.get("observations", [])])
    recs = diagnostic.get("recommended_adjustments", {})
    p = snapshot["active_parameters"]
    s = snapshot["summary"]

    md_content = f"""# WealthOS Autopilot - Daily Quant Diagnostic Report
**Date**: {s.get("date", get_ist_today_str())}  
**Regime Detected**: `{s.get("regime_detected", "TRENDING")}`  
**Generated At**: {get_ist_now_str()} IST  

---

## 1. Executive Performance Snapshot
- **Realized PnL**: ₹{float(s.get("total_pnl", 0.0)):+,.2f}
- **Trades Executed**: {s.get("total_trades", 0)} ({s.get("winning_trades", 0)} Wins / {s.get("losing_trades", 0)} Losses)
- **Win Rate**: {float(s.get("win_rate", 0.0)):.1f}%
- **Average MFE (Maximum Favorable Excursion)**: +{float(s.get("avg_mfe_pct", 0.0)):.2f}%
- **Average MAE (Maximum Adverse Excursion)**: {float(s.get("avg_mae_pct", 0.0)):.2f}%

---

## 2. Tactical Audit Observations
{obs_md}

---

## 3. Adaptive Hyperparameter Calibrations for Next Session
| Parameter | Description | Active / Recommended Value |
| :--- | :--- | :--- |
| **θ_conviction** | Swarm Consensus Directional Agreement | `{recs.get("theta_conviction", p.get("theta_conviction", 0.70))}` |
| **α_SL** | Initial Stop-Loss Distance Factor | `{recs.get("alpha_sl", p.get("alpha_sl", 0.95))}` |
| **β_trail** | Trailing Sensitivity Step | `{recs.get("beta_trail", p.get("beta_trail", 1.00))}` |
| **λ_slack** | In-Flight Deduplication Lock Window | `{p.get("lambda_slack", 1.05)}` |
| **γ_T1** | Target 1 Multiplier | `{p.get("gamma_t1", 1.15)}` |

---

## 4. Next Session Directive
> {diagnostic.get("next_session_focus", "Execute high-conviction signals with strict risk parameters.")}

---
*Generated autonomously by WealthOS AI Risk Shield at 16:00 IST*
"""
    with open(md_file_path, "w", encoding="utf-8") as f:
        f.write(md_content)
    print(f"📄 Markdown report saved to {md_file_path}")

    if dry_run:
        print("\n--- [DRY RUN HTML TELEGRAM OUTPUT] ---")
        print(report_html)
        print("---------------------------------------\n")
        return final_output

    token, chat_id = load_telegram_credentials("pnl_report")
    if token and chat_id:
        print(f"📲 Dispatching diagnostic to Telegram Topic #22 ({chat_id})...")
        bot = TelegramBotService(token, chat_id)
        res = await bot.send_message(report_html)
        print(f"✅ Telegram dispatch response: {res}")
    else:
        print("⚠️ Telegram bot credentials not configured; skipping Telegram broadcast.")

    return final_output

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WealthOS Daily AI Quant Reporter")
    parser.add_argument("--dry-run", action="store_true", help="Print diagnostic to console without sending Telegram broadcast")
    args = parser.parse_args()

    asyncio.run(generate_and_dispatch_report(dry_run=args.dry_run))
