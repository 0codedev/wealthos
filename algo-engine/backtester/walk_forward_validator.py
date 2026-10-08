"""Walk-forward validator and statistical robustness tester.

This script performs Phase 4 validation checks including In-Sample/Out-of-Sample splits,
Monte Carlo sequence shuffling (5,000 iterations), and Runs-test checks for trade returns.
"""

import os
import sys
import argparse
import numpy as np
import pandas as pd
import math

# Adjust path to import from parent folders
PARENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PARENT_DIR not in sys.path:
    sys.path.insert(0, PARENT_DIR)

REPORTS_DIR = os.path.join(PARENT_DIR, "backtester", "reports")
OUTPUT_DOC = os.path.join(PARENT_DIR, "..", "docs", "backtesting", "leaderboard_robustness.md")

def compute_runs_test(win_loss_seq) -> tuple:
    """Perform Wald-Wolfowitz runs test for randomness."""
    n = len(win_loss_seq)
    if n < 2:
        return 0.0, 1.0
        
    n1 = sum(1 for x in win_loss_seq if x == 1)
    n2 = sum(1 for x in win_loss_seq if x == 0)
    
    if n1 == 0 or n2 == 0:
        return 0.0, 1.0
        
    runs = 1
    for i in range(1, n):
        if win_loss_seq[i] != win_loss_seq[i-1]:
            runs += 1
            
    mu = ((2.0 * n1 * n2) / n) + 1.0
    var = (2.0 * n1 * n2 * (2.0 * n1 * n2 - n)) / (n * n * (n - 1))
    
    if var <= 0:
        return 0.0, 1.0
        
    z = (runs - mu) / math.sqrt(var)
    
    # Normal approximation p-value
    # erfc approximation
    t = 1.0 / (1.0 + 0.5 * abs(z) / math.sqrt(2.0))
    ans = 1.0 - t * math.exp(-0.5 * z * z - 1.26551223 +
                             t * (1.00002368 +
                             t * (0.37389870 +
                             t * (-0.18121876 +
                             t * (0.09101490 +
                             t * (-0.01894150 +
                             t * (0.00903005 +
                             t * (-0.00035820 +
                             t * 0.02637711))))))))
    p_val = 1.0 - ans if z > 0 else ans
    p_val = 2.0 * min(p_val, 1.0 - p_val)
    return z, p_val

def run_monte_carlo(pnls, iterations=5000, initial_capital=100000.0, max_dd_limit=15000.0) -> tuple:
    """Run Monte Carlo simulation shuffling trades to find risk of ruin."""
    n = len(pnls)
    if n == 0:
        return 0.0, 0.0
        
    ruin_count = 0
    max_dds = []
    
    for _ in range(iterations):
        shuffled = np.random.choice(pnls, size=n, replace=True)
        equity = initial_capital + np.cumsum(shuffled)
        peaks = np.maximum.accumulate(equity)
        dds = peaks - equity
        mdd = np.max(dds)
        max_dds.append(mdd)
        if mdd > max_dd_limit:
            ruin_count += 1
            
    prob_ruin = (ruin_count / iterations) * 100.0
    median_dd = np.median(max_dds)
    return prob_ruin, median_dd

def validate_strategy(strategy_name: str, symbol: str):
    csv_file = f"report_{strategy_name}_{symbol}.csv"
    
    # Fallback to search if name format differs (e.g. including uppercase)
    csv_path = os.path.join(REPORTS_DIR, csv_file)
    if not os.path.exists(csv_path):
        files = os.listdir(REPORTS_DIR)
        for f in files:
            if f.lower().startswith(f"report_{strategy_name.lower()}_") and f.endswith(".csv"):
                csv_path = os.path.join(REPORTS_DIR, f)
                break
                
    if not os.path.exists(csv_path):
        print(f"[ERROR] CSV report not found for strategy '{strategy_name}' on symbol '{symbol}'.")
        print(f"Please run generate_reports.py or backtester first to generate the report CSV.")
        return
        
    df = pd.read_csv(csv_path)
    if df.empty or "pnl" not in df.columns:
        print(f"[ERROR] CSV report {csv_path} is empty or has no 'pnl' column.")
        return
        
    df["pnl"] = df["pnl"].astype(float)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    
    # 1. In-Sample / Out-of-Sample Split
    train_end = pd.to_datetime("2024-12-31")
    is_df = df[df["date"] <= train_end].copy()
    oos_df = df[df["date"] > train_end].copy()
    
    # 2. Runs Test on win/loss sequence
    win_loss_seq = (df["pnl"] > 0).astype(int).tolist()
    z_stat, runs_p = compute_runs_test(win_loss_seq)
    
    # 3. Monte Carlo Simulation
    prob_ruin, median_dd = run_monte_carlo(df["pnl"].values)
    
    # Render and append results to leaderboard markdown
    title = f"# Validation Report: {strategy_name.upper()} ({symbol})"
    is_pnl = is_df["pnl"].sum()
    oos_pnl = oos_df["pnl"].sum()
    
    runs_pass = "PASS" if runs_p >= 0.05 else "FAIL (Trend/Cluster bias)"
    ruin_pass = "PASS" if prob_ruin < 2.0 else "FAIL (Risk too high)"
    
    output = f"""
{title}
*   **Report File:** `{os.path.basename(csv_path)}`
*   **Total Trades:** {len(df)}

## 1. Walk-Forward Split Analysis
*   **In-Sample (Train: Jan 2023 - Dec 2024):**
    *   Trades: {len(is_df)}
    *   Net P&L: Rs. {is_pnl:.2f}
    *   Win Rate: {((is_df["pnl"] > 0).sum() / len(is_df) * 100 if len(is_df) > 0 else 0):.1f}%
*   **Out-of-Sample (Test: Jan 2025 - Jun 2026):**
    *   Trades: {len(oos_df)}
    *   Net P&L: Rs. {oos_pnl:.2f}
    *   Win Rate: {((oos_df["pnl"] > 0).sum() / len(oos_df) * 100 if len(oos_df) > 0 else 0):.1f}%

## 2. Statistical Independence (Runs Test)
*   **Z-Statistic:** {z_stat:.4f}
*   **P-Value:** {runs_p:.4f}
*   **Random Walk Verification:** **{runs_pass}** (p-value >= 0.05 signifies returns are independent)

## 3. Monte Carlo Drawdown Assessment (5,000 runs)
*   **Initial Capital:** Rs. 100,000.00
*   **Max Allowed DD:** Rs. 15,000.00 (15%)
*   **Probability of Breaching Max DD:** {prob_ruin:.2f}%
*   **Ruin Constraint Verification:** **{ruin_pass}** (Threshold < 2%)
*   **Median Simulated Max DD:** Rs. {median_dd:.2f}

---
"""
    # Write to leaderboard_robustness.md
    mode = "a" if os.path.exists(OUTPUT_DOC) else "w"
    with open(OUTPUT_DOC, mode, encoding="utf-8") as f:
        f.write(output)
        
    print(f"[VALIDATION SUCCESS] Robustness report generated in: {OUTPUT_DOC}")
    print(f" - Runs-test: {runs_pass} (p={runs_p:.4f})")
    print(f" - Monte Carlo Ruin Prob: {prob_ruin:.2f}% (Constraint: {ruin_pass})")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Walk-Forward & Monte Carlo statistical validator")
    parser.add_argument("--strategy", type=str, required=True, help="Strategy name")
    parser.add_argument("--symbol", type=str, required=True, help="Whitelisted symbol name")
    args = parser.parse_args()
    
    validate_strategy(args.strategy, args.symbol)
