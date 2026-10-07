import os
import sys
import subprocess
import pandas as pd
import numpy as np
import datetime
import math

ALGO_ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS_DIR = os.path.abspath(os.path.join(ALGO_ENGINE_DIR, "..", "docs", "backtesting"))
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

STRATEGIES = ["orb", "vwap", "squeeze", "gap", "router", "snap", "mtf"]

strategy_file_mapping = {
    "squeeze": ("volatility_squeezev2.py", "Mean Reversion"),
    "snap": ("ema_snap.py", "Momentum"),
    "vwap": ("vwap_mean_reversion.py", "Mean Reversion"),
    "mtf": ("mtf_momentum.py", "Momentum"),
    "gap": ("gap_fade.py", "Breakout"),
    "orb": ("orb_enhanced.py", "Breakout"),
    "router": ("regime_router.py", "Meta / Routing"),
    "pairs": ("pairs_arbitrage.py", "Statistical Arb"),
    "theta": ("theta_harvester.py", "Options")
}

def format_number(val, suffix="", decimals=2):
    if val is None or pd.isna(val):
        return "N/A"
    return f"{val:,.{decimals}f}{suffix}"

def run_strategy_universe(strategy, core_only=False):
    print(f"\n==================================================")
    print(f" Running FNO Universe Backtest for {strategy.upper()} (Core Only: {core_only})...")
    print(f"==================================================")
    
    script_path = os.path.join(ALGO_ENGINE_DIR, "backtester", "run_universe_backtest.py")
    interpreter = sys.executable
    
    cmd = [
        interpreter,
        script_path,
        "--strategy", strategy,
        "--from-date", "2023-01-01",
        "--to-date", "2026-06-28",
        "--capital", "100000.0"
    ]
    if core_only:
        cmd.append("--core-only")
    if strategy.lower() == "orb":
        cmd.extend(["--select-top", "3"])
    
    try:
        res = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(f"[SUCCESS] Finished FNO Universe Backtest for {strategy.upper()}.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] Failed to run backtest for {strategy.upper()}:")
        print(e.stderr)
        return False

def parse_metrics_from_report(strategy):
    report_name = f"portfolio_{strategy}_report.md"
    report_path = os.path.join(ARTIFACTS_DIR, report_name)
    
    if not os.path.exists(report_path):
        return None
        
    metrics = {
        "win_rate": 0.0,
        "profit_factor": 0.0,
        "sharpe": 0.0,
        "max_dd_pct": 0.0,
        "net_pnl": 0.0,
        "total_trades": 0,
        "cagr": 0.0,
        "score": 0.0,
        "calmar": 0.0,
        "max_dd_duration": 0.0
    }
    
    try:
        with open(report_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            
        for line in lines:
            if "**Win Rate (%)**" in line:
                parts = line.split("|")
                metrics["win_rate"] = float(parts[2].replace("%", "").strip().replace(",", ""))
            elif "**Profit Factor**" in line:
                parts = line.split("|")
                metrics["profit_factor"] = float(parts[2].strip().replace(",", ""))
            elif "**Sharpe Ratio**" in line:
                parts = line.split("|")
                metrics["sharpe"] = float(parts[3].strip().replace(",", ""))
            elif "**Max Drawdown (%)**" in line:
                parts = line.split("|")
                metrics["max_dd_pct"] = float(parts[2].replace("%", "").strip().replace(",", ""))
            elif "**Net P&L (₹)**" in line:
                parts = line.split("|")
                metrics["net_pnl"] = float(parts[2].strip().replace(",", ""))
            elif "**Total Trades**" in line:
                parts = line.split("|")
                metrics["total_trades"] = int(parts[2].strip().replace(",", ""))
            elif "**Annualized Return (%)**" in line:
                parts = line.split("|")
                metrics["cagr"] = float(parts[2].replace("%", "").strip().replace(",", ""))
            elif "**Calmar Ratio**" in line:
                parts = line.split("|")
                metrics["calmar"] = float(parts[3].strip().replace(",", ""))
            elif "**Max Drawdown Duration**" in line:
                parts = line.split("|")
                val_str = parts[2].replace("days", "").strip().replace(",", "")
                metrics["max_dd_duration"] = float(val_str)
            elif "**TOTAL**" in line and "/10" in line:
                parts = line.split("|")
                metrics["score"] = float(parts[4].replace("/10", "").replace("*", "").strip())
                
        return metrics
    except Exception as e:
        print(f"[ERROR] Failed parsing metrics for {strategy}: {e}")
        return None

def generate_portfolio_master_report(all_results):
    filepath = os.path.join(ARTIFACTS_DIR, "portfolio_master_comparison_report.md")
    
    # Sort strategies by score
    sorted_strategies = sorted(all_results.keys(), key=lambda x: all_results[x]["score"], reverse=True)
    
    # 2.1 Master Rankings Table
    table_rows = ""
    for idx, strat in enumerate(sorted_strategies, 1):
        m = all_results[strat]
        filename, stype = strategy_file_mapping.get(strat, ("unknown.py", "Unknown"))
        medal = "🥇 " if idx == 1 else ("🥈 " if idx == 2 else ("🥉 " if idx == 3 else ""))
        table_rows += f"| {medal}{idx} | {strat.upper()} | `{filename}` | {stype} | {format_number(m['win_rate'], '%')} | {format_number(m['profit_factor'])} | {format_number(m['sharpe'])} | {format_number(m['max_dd_pct'], '%')} | {format_number(m['calmar'])} | **{m['score']:.2f}** |\n"
        
    # Map for the 14 standard strategies
    standard_14_labels = ["Squeeze", "Snap", "VWAP", "MTF", "Gap", "ORB", "Pairs", "Regime", "Zscore", "Pullback", "SqzV2", "VWAP-Rev", "ORB-Enh", "Theta"]
    standard_mapping = {
        "Squeeze": "squeeze",
        "Snap": "snap",
        "VWAP": "vwap",
        "MTF": "mtf",
        "Gap": "gap",
        "ORB": "orb",
        "Regime": "router",
        "Pairs": "pairs",
        "Theta": "theta"
    }
    
    # Build Diagram 1 (Net P&L) bar data
    diagram1_bars = []
    for label in standard_14_labels:
        strat_key = standard_mapping.get(label)
        if strat_key and strat_key in all_results:
            diagram1_bars.append(int(all_results[strat_key]["net_pnl"]))
        else:
            diagram1_bars.append(0)
            
    # Build Diagram 3 (Win Rate) line/bar data
    diagram3_xaxis = ["Squeeze", "Snap", "VWAP", "MTF", "Gap", "ORB", "Pairs", "Regime", "Zscore", "Pullback"]
    diagram3_values = []
    for label in diagram3_xaxis:
        strat_key = standard_mapping.get(label)
        if strat_key and strat_key in all_results:
            diagram3_values.append(f"{all_results[strat_key]['win_rate']:.1f}")
        else:
            diagram3_values.append("0.0")
            
    # Build Diagram 2 (Risk vs Return quadrant chart) coordinates
    # We rank-scale or scale coordinates between 0.1 and 0.9 for standard quadrant rendering
    quadrant_lines = []
    for strat in sorted_strategies:
        m = all_results[strat]
        # x-axis: High DD% = High Risk (closer to 1.0). Let's use sigmoidal scaling
        x = 1.0 - (1.0 / (1.0 + (m["max_dd_pct"] / 100.0)))
        x = max(0.05, min(0.95, x))
        # y-axis: High Sharpe = High Return (closer to 1.0)
        # Scale between -12 and 1
        y = (m["sharpe"] + 12.0) / 13.0
        y = max(0.05, min(0.95, y))
        
        name_display = strat.upper().replace("ROUTER", "Regime Router")
        quadrant_lines.append(f"    {name_display}: [{x:.2f}, {y:.2f}]")
        
    # Build Diagram 4 (Drawdown Recovery Categorization)
    fast_recovery = []
    moderate_recovery = []
    slow_recovery = []
    for strat in sorted_strategies:
        m = all_results[strat]
        days = m["max_dd_duration"]
        name_display = strat.upper()
        # Relative buckets based on historical data
        if days < 30:
            fast_recovery.append(name_display)
        elif days <= 365:
            moderate_recovery.append(name_display)
        else:
            slow_recovery.append(name_display)
            
    # Format graph LR subgraphs
    graph_fast_str = "\n".join([f"        A{idx}[\"{name}\"]" for idx, name in enumerate(fast_recovery)]) if fast_recovery else "        A1[\"None\"]"
    graph_mod_str = "\n".join([f"        B{idx}[\"{name}\"]" for idx, name in enumerate(moderate_recovery)]) if moderate_recovery else "        B1[\"None\"]"
    graph_slow_str = "\n".join([f"        C{idx}[\"{name}\"]" for idx, name in enumerate(slow_recovery)]) if slow_recovery else "        C1[\"None\"]"
    
    # Build Diagram 6 (Monthly Equity Curve) from ledger files
    months_labels = ["Dec 25", "Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26", "Jun 26"]
    month_ends = [
        pd.Timestamp("2025-12-31"),
        pd.Timestamp("2026-01-31"),
        pd.Timestamp("2026-02-28"),
        pd.Timestamp("2026-03-31"),
        pd.Timestamp("2026-04-30"),
        pd.Timestamp("2026-05-31"),
        pd.Timestamp("2026-06-30")
    ]
    
    equity_lines = ""
    min_equity_pnl = 0.0
    max_equity_pnl = 0.0
    
    for strat in sorted_strategies:
        ledger_path = os.path.join(ALGO_ENGINE_DIR, "backtester", "reports", f"portfolio_ledger_{strat}.csv")
        pnl_vals = [0.0] * len(month_ends)
        
        if os.path.exists(ledger_path):
            try:
                df = pd.read_csv(ledger_path)
                if not df.empty:
                    df['time'] = pd.to_datetime(df['entry_time'])
                    df = df.sort_values('time')
                    df['cum_pnl'] = df['pnl'].cumsum()
                    
                    for idx, end_dt in enumerate(month_ends):
                        sub_df = df[df['time'] <= end_dt]
                        if not sub_df.empty:
                            val = float(sub_df['cum_pnl'].iloc[-1])
                            pnl_vals[idx] = val
                            min_equity_pnl = min(min_equity_pnl, val)
                            max_equity_pnl = max(max_equity_pnl, val)
            except Exception as e:
                print(f"[ERROR] Equity curve load failed for {strat}: {e}")
                
        pnl_vals_str = ", ".join([f"{v:.0f}" for v in pnl_vals])
        equity_lines += f"    line [{pnl_vals_str}]\n"

    # 3. Correlation Matrix computation
    corr_matrix_str = "| | " + " | ".join([s.upper() for s in sorted_strategies]) + " |\n"
    corr_matrix_str += "|---|" + "|".join(["---"] * len(sorted_strategies)) + "|\n"
    
    pnl_df = pd.DataFrame()
    for strat in sorted_strategies:
        ledger_path = os.path.join(ALGO_ENGINE_DIR, "backtester", "reports", f"portfolio_ledger_{strat}.csv")
        if os.path.exists(ledger_path):
            try:
                df = pd.read_csv(ledger_path)
                if not df.empty:
                    df['date'] = pd.to_datetime(df['entry_time']).dt.date
                    daily_pnl = df.groupby('date')['pnl'].sum()
                    pnl_df[strat] = daily_pnl
            except Exception as e:
                pass
                
    pnl_df = pnl_df.fillna(0.0)
    corr_df = pnl_df.corr().fillna(0.0)
    for s1 in sorted_strategies:
        row_str = f"| **{s1.upper()}** | "
        cols = []
        for s2 in sorted_strategies:
            corr_val = corr_df.loc[s1, s2] if s2 in corr_df.columns and s1 in corr_df.index else (1.0 if s1 == s2 else 0.0)
            cols.append(f"{corr_val:.2f}")
        row_str += " | ".join(cols) + " |\n"
        corr_matrix_str += row_str
        
    # 4. Capital allocation model
    allocation_pie_str = ""
    scores_sum = sum(max(0.0, all_results[s]["score"]) for s in sorted_strategies)
    for s in sorted_strategies:
        w_score = max(0.0, all_results[s]["score"])
        alloc_pct = (w_score / scores_sum * 100) if scores_sum > 0 else (100.0 / len(sorted_strategies))
        allocation_pie_str += f"    \"{s.upper()}\" : {alloc_pct:.0f}\n"

    best_strat = sorted_strategies[0]
    best_score = all_results[best_strat]["score"]

    content = f"""# 🏆 Master Portfolio Universe Comparison Report
> Quantitative rankings, portfolio correlation, and regime routing dashboard for the 45 FNO Leader stocks.

---

## 2.1 Master Rankings Table

| Rank | Strategy | File | Type | Win Rate | Profit Factor | Sharpe | Max DD% | Calmar | Score |
|---|---|---|---|---|---|---|---|---|---|
{table_rows}
---

## 2.2 Comparison Diagram 1: Net P&L Bar Chart

```mermaid
xychart-beta
    title "Net P&L Comparison — All Strategies (₹)"
    x-axis {str(standard_14_labels).replace("'", '"')}
    y-axis "Net P&L (₹)" {int(min_equity_pnl * 1.1)} --> {int(max(100000, max_equity_pnl * 1.1))}
    bar {str(diagram1_bars)}
```

---

## 2.3 Comparison Diagram 2: Risk vs Return (Sharpe vs Max DD)

```mermaid
quadrantChart
    title Risk-Return Matrix (All Strategies)
    x-axis "Low Risk (Low Max DD)" --> "High Risk (High Max DD)"
    y-axis "Low Return (Low Sharpe)" --> "High Return (High Sharpe)"
    quadrant-1 "🏆 Star Strategies"
    quadrant-2 "🔬 High Return, High Risk"
    quadrant-3 "💀 Avoid"
    quadrant-4 "🧪 Low Risk, Low Return"
{"\n".join(quadrant_lines)}
```

---

## 2.4 Comparison Diagram 3: Win Rate vs Profit Factor

```mermaid
xychart-beta
    title "Win Rate (%) — Strategy Comparison"
    x-axis {str(diagram3_xaxis).replace("'", '"')}
    y-axis "Win Rate (%)" 0 --> 100
    line [{", ".join(diagram3_values)}]
    bar [{", ".join(diagram3_values)}]
```

---

## 2.5 Comparison Diagram 4: Drawdown Duration Heatmap

```mermaid
graph LR
    subgraph "⚡ Fast Recovery (< 30 days)"
{graph_fast_str}
    end
    subgraph "⚠️ Moderate Recovery (30-365 days)"
{graph_mod_str}
    end
    subgraph "🚨 Slow Recovery (> 365 days)"
{graph_slow_str}
    end
```

---

## 2.6 Comparison Diagram 5: Strategy Type Ecosystem

```mermaid
mindmap
    root((📊 Strategy\nEcosystem))
        Momentum
            MTF Momentum
            EMA Snap
            ORB Enhanced
        Mean Reversion
            VWAP Reversion
            ZScore Reversion
            Volatility Squeeze
        Breakout
            ORB Breakout
            Gap Fade
        Statistical Arb
            Pairs Arbitrage
        Meta / Routing
            Regime Router
        Options
            Theta Harvester
        Pullback
            EMA Trend Pullback
```

---

## 2.7 Comparison Diagram 6: Equity Curve Comparison (Template)

```mermaid
xychart-beta
    title "Cumulative Equity Curve — Month-by-Month"
    x-axis {str(months_labels).replace("'", '"')}
    y-axis "Cumulative P&L (₹)" {int(min_equity_pnl * 1.1)} --> {int(max(100000, max_equity_pnl * 1.1))}
{equity_lines}```

---

## 2.8 Capital Allocation Model

> Based on final scores, how much of the portfolio should each strategy get?

```mermaid
pie title Recommended Portfolio Capital Allocation (%)
{allocation_pie_str}```

---

## 2.9 Regime-Strategy Compatibility Matrix

| Strategy | Bull Trend | Bear Trend | Sideways | High VIX | Low VIX | Expiry Day |
|---|---|---|---|---|---|---|
| Volatility Squeeze | 🟡 | 🟡 | 🟢 | 🟢 | 🔴 | 🟡 |
| EMA Snap | 🟢 | 🟢 | 🔴 | 🟡 | 🟢 | 🔴 |
| VWAP Reversion | 🟡 | 🟡 | 🟢 | 🔴 | 🟢 | 🔴 |
| MTF Momentum | 🟢 | 🟢 | 🔴 | 🟡 | 🟡 | 🔴 |
| Gap Fade | 🟡 | 🟡 | 🟡 | 🟢 | 🟡 | 🟡 |
| ORB Enhanced | 🟢 | 🟢 | 🔴 | 🟢 | 🟡 | 🔴 |
| Pairs Arbitrage | 🟡 | 🟡 | 🟢 | 🔴 | 🟢 | 🔴 |
| ZScore Reversion | 🟡 | 🟡 | 🟢 | 🔴 | 🟢 | 🔴 |
| Theta Harvester | 🟡 | 🟡 | 🟢 | 🔴 | 🟢 | 🟢 |

> 🟢 = Works Well | 🟡 = Use with Caution | 🔴 = Avoid

---

## 2.10 Correlation Matrix — Strategy Returns

> Low correlation between strategies indicates excellent diversification and a smoother combined portfolio equity curve.

{corr_matrix_str}
---

## 🚀 Final Portfolio Verdict & Recommendation

Based on the 45 FNO Leader stock universe backtest sweep:
1. **Top Performing Strategy**: Strategy **{best_strat.upper()}** achieved the highest score of **{best_score:.2f}/10** across the universe.
2. **Diversification Edge**: The correlation matrix shows how combining momentum (SNAP/MTF) with mean-reversion (SQUEEZE/VWAP) creates a highly diversified market exposure.
3. **Execution Ready**: All trades are computed dynamically using the **2% Capital Risk Sizing Rule** (₹2,000 max risk per trade) and factor in full transaction costs (brokerage, STT, and slippage).
"""
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"\n[MASTER SUCCESS] Portfolio Master Report written to: {filepath}")

def main():
    import argparse
    parser = argparse.ArgumentParser(description="WealthOS All Strategies Portfolio Runner")
    parser.add_argument("--core-only", action="store_true", default=False, help="Only run on the 9 core symbols with full 3.5 year data")
    args = parser.parse_args()

    print("==================================================")
    print(" WEALTHOS UNIVERSE ALL-STRATEGIES RUNNER & MASTER")
    print(f" Core Only Mode: {args.core_only}")
    print("==================================================")
    
    success_strategies = []
    for strat in STRATEGIES:
        success = run_strategy_universe(strat, core_only=args.core_only)
        if success:
            success_strategies.append(strat)
            
    print("\n[INFO] Finished backtesting. Gathering metrics...")
    all_results = {}
    for strat in success_strategies:
        metrics = parse_metrics_from_report(strat)
        if metrics:
            all_results[strat] = metrics
            
    if all_results:
        generate_portfolio_master_report(all_results)
        print("\n[SUCCESS] PORTFOLIO MASTER COMPARISON COMPLETED!")
    else:
        print("\n[ERROR] No portfolio metrics could be gathered.")

if __name__ == "__main__":
    main()
