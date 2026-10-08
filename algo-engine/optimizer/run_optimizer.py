import os
import sys
import argparse
import json
import pandas as pd

# Add the parent directory and backtester directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backtester.run_backtest import load_data, run_backtest

def run_optimization(symbol: str, quantity: int, from_date: str, to_date: str, data_root: str):
    print(f"[OPTIMIZER] Loading historical data for {symbol}...")
    try:
        data_df = load_data(symbol, data_root)
    except Exception as e:
        print(f"[ERROR] Failed to load data: {e}")
        return
        
    print(f"[OPTIMIZER] Running parameter grid sweep for ORB Breakout...")
    
    # Define Parameter Grid
    target_sweeps = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0]
    stop_sweeps = [0.5, 0.8, 1.0, 1.2, 1.5]
    
    results = []
    
    total_combinations = len(target_sweeps) * len(stop_sweeps)
    run_count = 0
    
    for target in target_sweeps:
        for stop in stop_sweeps:
            run_count += 1
            sys.stdout.write(f"\r[OPTIMIZER] Progress: {run_count}/{total_combinations} sweeps...")
            sys.stdout.flush()
            
            try:
                stats = run_backtest(
                    symbol=symbol,
                    data_df=data_df,
                    quantity=quantity,
                    from_date=from_date,
                    to_date=to_date,
                    target_multiplier=target,
                    stop_multiplier=stop,
                    verbose=False
                )
                
                if stats and stats.get("total_trades", 0) > 0:
                    results.append({
                        "target_multiplier": target,
                        "stop_multiplier": stop,
                        "total_trades": stats["total_trades"],
                        "win_rate": stats["win_rate"],
                        "total_pnl": stats["total_pnl"],
                        "profit_factor": stats["profit_factor"],
                        "max_drawdown": stats["max_drawdown"],
                        # Reward risk-adjusted P&L
                        "score": stats["total_pnl"] / (stats["max_drawdown"] + 1.0)
                    })
            except Exception as e:
                # Silently bypass errors during parameter combination evaluation
                pass
                
    print("\n[OPTIMIZER] Grid sweep completed.\n")
    
    if not results:
        print("[OPTIMIZER] No valid trade results generated during sweep.")
        return
        
    # Convert to DataFrame and sort by PNL
    df_results = pd.DataFrame(results)
    df_results = df_results.sort_values(by="total_pnl", ascending=False).reset_index(drop=True)
    
    # Display top 10 configurations
    print("="*65)
    print(f" ORB BREAKOUT GRID SEARCH RESULTS (TOP 10) - {symbol}")
    print("="*65)
    print(f"{'Target':<8} | {'Stop':<6} | {'Trades':<6} | {'Win Rate':<10} | {'Total P&L':<12} | {'Drawdown':<10}")
    print("-"*65)
    
    for idx, row in df_results.head(10).iterrows():
        print(f"{row['target_multiplier']:<8.2f} | {row['stop_multiplier']:<6.2f} | {int(row['total_trades']):<6} | {row['win_rate']:<9.2f}% | Rs. {row['total_pnl']:<8.2f} | Rs. {row['max_drawdown']:<8.2f}")
    print("="*65 + "\n")
    
    # Save the absolute best configuration
    best_config = df_results.iloc[0]
    config_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config")
    os.makedirs(config_dir, exist_ok=True)
    
    best_params = {
        "target_multiplier": float(best_config["target_multiplier"]),
        "stop_multiplier": float(best_config["stop_multiplier"])
    }
    
    best_params_path = os.path.join(config_dir, "orb_best_params.json")
    with open(best_params_path, "w") as f:
        json.dump(best_params, f, indent=4)
        
    print(f"[OPTIMIZER] Absolute best configuration saved to: {best_params_path}")
    print(f"  - Target Multiplier: {best_params['target_multiplier']:.2f}")
    print(f"  - Stop Multiplier  : {best_params['stop_multiplier']:.2f}")
    print(f"  - Expected Win Rate: {best_config['win_rate']:.2f}%")
    print(f"  - Expected P&L     : Rs. {best_config['total_pnl']:,.2f} (with qty {quantity})")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ORB Breakout Strategy Parameter Optimizer")
    parser.add_argument("--symbol", type=str, default="RELIANCE", help="Symbol to optimize (e.g. RELIANCE, NIFTY)")
    parser.add_argument("--quantity", type=int, default=100, help="Order quantity per trade")
    parser.add_argument("--from-date", type=str, default="2025-12-03", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--to-date", type=str, default="2026-06-28", help="End date (YYYY-MM-DD)")
    parser.add_argument("--data-root", type=str, default=None, help="Root folder of parquet data")
    
    args = parser.parse_args()
    
    if args.data_root is None:
        args.data_root = os.path.abspath(os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "..",
            "python-bridge",
            "data",
            "underlying"
        ))
        
    run_optimization(args.symbol, args.quantity, args.from_date, args.to_date, args.data_root)
