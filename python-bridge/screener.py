import os
import json
import math
import time
import pandas as pd
import duckdb
from datetime import datetime

from logger import get_logger
log = get_logger("screener", tag="SCREENER")

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
FNO_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fno_stocks_generated.json")

# Standard normal CDF approximation (polynomial) to match OptionsSimulator.ts
def cnd(x):
    a1 = 0.31938153
    a2 = -0.356563782
    a3 = 1.781477937
    a4 = -1.821255978
    a5 = 1.330274429
    L = abs(x)
    K = 1.0 / (1.0 + 0.2316419 * L)
    d = 1.0 - 1.0 / math.sqrt(2 * math.pi) * math.exp(-L * L / 2.0) * (
        a1 * K + a2 * K**2 + a3 * K**3 + a4 * K**4 + a5 * K**5
    )
    if x < 0:
        d = 1.0 - d
    return d

def npdf(x):
    return (1.0 / math.sqrt(2.0 * math.pi)) * math.exp(-0.5 * x * x)

def calculate_option_price(S, K, T, r, v, option_type):
    if T <= 0:
        price = max(0.0, S - K) if option_type == 'CE' else max(0.0, K - S)
        return {
            "price": price,
            "greeks": {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}
        }
    if v <= 0:
        v = 0.01

    d1 = (math.log(S / K) + (r + (v * v) / 2.0) * T) / (v * math.sqrt(T))
    d2 = d1 - v * math.sqrt(T)

    if option_type == 'CE':
        price = S * cnd(d1) - K * math.exp(-r * T) * cnd(d2)
        delta = cnd(d1)
        rho = K * T * math.exp(-r * T) * cnd(d2) / 100.0
    else:
        price = K * math.exp(-r * T) * cnd(-d2) - S * cnd(-d1)
        delta = cnd(d1) - 1.0
        rho = -K * T * math.exp(-r * T) * cnd(-d2) / 100.0

    gamma = npdf(d1) / (S * v * math.sqrt(T))
    vega = (S * math.sqrt(T) * npdf(d1)) / 100.0

    theta_part1 = -(S * v * npdf(d1)) / (2.0 * math.sqrt(T))
    theta_part2 = r * K * math.exp(-r * T) * (cnd(d2) if option_type == 'CE' else cnd(-d2))
    theta = (theta_part1 - theta_part2) / 365.0

    return {
        "price": price,
        "greeks": {"delta": delta, "gamma": gamma, "theta": theta, "vega": vega, "rho": rho}
    }

import analytics_engine

def get_active_expiry(underlying, date_str):
    underlying_upper = underlying.upper().strip()
    underlying_options_dir = os.path.join(DATA_DIR, "options", underlying_upper)
    if not os.path.exists(underlying_options_dir):
        return None
    expiries = []
    for d in os.listdir(underlying_options_dir):
        if os.path.isdir(os.path.join(underlying_options_dir, d)):
            try:
                datetime.strptime(d, "%Y-%m-%d")
                expiries.append(d)
            except:
                continue
    expiries.sort()
    for expiry in expiries:
        if expiry >= date_str:
            return expiry
    return None

def get_option_close(underlying, expiry, strike, option_type, date_str):
    underlying_upper = underlying.upper().strip()
    parquet_path = os.path.join(DATA_DIR, "options", underlying_upper, expiry, "data.parquet")
    if not os.path.exists(parquet_path):
        return None
    try:
        conn = duckdb.connect()
        query = """
            SELECT close 
            FROM '{}'
            WHERE CAST(timestamp AS DATE) = ? AND strike_price = ? AND upper(option_type) = ?
        """.format(parquet_path.replace("'", "''"))
        res = conn.execute(query, [date_str, float(strike), option_type.upper()]).fetchone()
        conn.close()
        return float(res[0]) if res else None
    except Exception as e:
        log.error("Error reading option close: %s", e)
        return None

def calculate_strategy_payoff(S, legs, T, r, v_list):
    total_value = 0.0
    net_greeks = {"delta": 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}

    for idx, leg in enumerate(legs):
        leg_type = leg.get('type', 'CE')
        action = leg.get('action', 'BUY')
        strike_offset = float(leg.get('strikeOffset', 0.0))
        multiplier = float(leg.get('quantityMultiplier', 1.0))

        v = v_list[idx] if isinstance(v_list, list) and idx < len(v_list) else (v_list if isinstance(v_list, (int, float)) else 0.18)

        # Strike K is calculated relative to underlying Spot S at entry
        K = S + strike_offset
        res = calculate_option_price(S, K, T, r, v, leg_type)
        direction_mult = 1.0 if action == 'BUY' else -1.0
        
        leg_value = res['price'] * multiplier * direction_mult
        total_value += leg_value

        for gk in net_greeks:
            net_greeks[gk] += res['greeks'][gk] * multiplier * direction_mult

    return {"totalValue": total_value, "netGreeks": net_greeks}

def evaluate_single_rule(trade, rule, context):
    field = rule.get('field')
    condition = rule.get('condition')
    rule_val = rule.get('value')

    if field == 'timeOfDay':
        entry_time = trade.get('entryTime', '09:30')
        if not entry_time or ':' not in entry_time:
            return False
        h, m = map(int, entry_time.split(':'))
        trade_val = h * 60 + m
    elif field == 'dayOfWeek':
        try:
            trade_val = datetime.strptime(trade['date'], '%Y-%m-%d').strftime('%A')
        except:
            return False
    elif field == 'ticker':
        trade_val = trade.get('ticker')
    elif field == 'direction':
        trade_val = trade.get('direction')
    elif field == 'consecutiveLosses':
        trade_val = context.get('currentLossStreak', 0)
    elif field == 'dailyPnL':
        trade_val = context.get('todaysPnL', 0.0)
    else:
        trade_val = trade.get(field)

    if trade_val is None:
        return False

    try:
        if condition == 'EQUALS':
            return str(trade_val).upper() == str(rule_val).upper()
        elif condition == 'NOT_EQUALS':
            return str(trade_val).upper() != str(rule_val).upper()
        elif condition == 'GREATER_THAN':
            return float(trade_val) > float(rule_val)
        elif condition == 'LESS_THAN':
            return float(trade_val) < float(rule_val)
        elif condition == 'CONTAINS':
            if isinstance(trade_val, list):
                return str(rule_val).upper() in [str(x).upper() for x in trade_val]
            return str(rule_val).upper() in str(trade_val).upper()
        elif condition == 'NOT_CONTAINS':
            if isinstance(trade_val, list):
                return str(rule_val).upper() not in [str(x).upper() for x in trade_val]
            return str(rule_val).upper() not in str(trade_val).upper()
        elif condition == 'IN':
            if isinstance(rule_val, list):
                return str(trade_val).upper() in [str(x).upper() for x in rule_val]
            elif isinstance(rule_val, str):
                return str(trade_val).upper() in [x.strip().upper() for x in rule_val.split(',')]
            return False
        elif condition == 'NOT_IN':
            if isinstance(rule_val, list):
                return str(trade_val).upper() not in [str(x).upper() for x in rule_val]
            elif isinstance(rule_val, str):
                return str(trade_val).upper() not in [x.strip().upper() for x in rule_val.split(',')]
            return False
        elif condition == 'BETWEEN':
            if isinstance(rule_val, list) and len(rule_val) == 2:
                return float(rule_val[0]) <= float(trade_val) <= float(rule_val[1])
            elif isinstance(rule_val, str) and '-' in rule_val:
                parts = rule_val.split('-')
                if field == 'timeOfDay' and ':' in parts[0]:
                    def parse_t(t_str):
                        h, m = map(int, t_str.strip().split(':'))
                        return h * 60 + m
                    return parse_t(parts[0]) <= trade_val <= parse_t(parts[1])
                return float(parts[0]) <= float(trade_val) <= float(parts[1])
            return False
    except Exception as e:
        log.error("Error evaluating condition %s on field %s: %s", condition, field, e)
        return False

    return False

def evaluate_entry(trade, strategy, context):
    entry_rules = strategy.get('entryRules', [])
    if not entry_rules:
        return True

    is_entry_valid = True

    for rule in entry_rules:
        result = evaluate_single_rule(trade, rule, context)
        logical_operator = rule.get('logicalOperator', 'AND')

        if logical_operator == 'OR':
            is_entry_valid = is_entry_valid or result
        else:
            is_entry_valid = is_entry_valid and result

        if not is_entry_valid and (logical_operator == 'AND' or 'logicalOperator' not in rule):
            return False

    return is_entry_valid

def apply_exit_rules(strategy, trade, entry_price, quantity):
    exit_rules = strategy.get('exitRules', [])
    direction = trade.get('direction', 'Long')
    high_price = trade.get('high', entry_price)
    low_price = trade.get('low', entry_price)
    exit_price = trade.get('exitPrice', entry_price)

    for rule in exit_rules:
        rule_type = rule.get('type')
        rule_val = float(rule.get('value', 0.0))
        unit = rule.get('unit', 'PERCENT')

        if rule_type == 'FIXED_STOP_LOSS':
            if direction == 'Long':
                sl_price = entry_price * (1.0 - rule_val / 100.0) if unit == 'PERCENT' else entry_price - rule_val
                if low_price <= sl_price:
                    return {
                        "triggered": True,
                        "price": sl_price,
                        "pnl": (sl_price - entry_price) * quantity,
                        "reason": "STOP_LOSS_HIT"
                    }
            else: # Short
                sl_price = entry_price * (1.0 + rule_val / 100.0) if unit == 'PERCENT' else entry_price + rule_val
                if high_price >= sl_price:
                    return {
                        "triggered": True,
                        "price": sl_price,
                        "pnl": (entry_price - sl_price) * quantity,
                        "reason": "STOP_LOSS_HIT"
                    }

        elif rule_type == 'FIXED_TARGET':
            if direction == 'Long':
                target_price = entry_price * (1.0 + rule_val / 100.0) if unit == 'PERCENT' else entry_price + rule_val
                if high_price >= target_price:
                    return {
                        "triggered": True,
                        "price": target_price,
                        "pnl": (target_price - entry_price) * quantity,
                        "reason": "TARGET_REACHED"
                    }
            else: # Short
                target_price = entry_price * (1.0 - rule_val / 100.0) if unit == 'PERCENT' else entry_price - rule_val
                if low_price <= target_price:
                    return {
                        "triggered": True,
                        "price": target_price,
                        "pnl": (entry_price - target_price) * quantity,
                        "reason": "TARGET_REACHED"
                    }

        elif rule_type == 'TRAILING_STOP':
            if direction == 'Long':
                trail_price = high_price * (1.0 - rule_val / 100.0) if unit == 'PERCENT' else high_price - rule_val
                if low_price <= trail_price:
                    return {
                        "triggered": True,
                        "price": trail_price,
                        "pnl": (trail_price - entry_price) * quantity,
                        "reason": "TRAILING_STOP_HIT"
                    }
            else: # Short
                trail_price = low_price * (1.0 + rule_val / 100.0) if unit == 'PERCENT' else low_price + rule_val
                if high_price >= trail_price:
                    return {
                        "triggered": True,
                        "price": trail_price,
                        "pnl": (entry_price - trail_price) * quantity,
                        "reason": "TRAILING_STOP_HIT"
                    }

    pnl = (exit_price - entry_price) * quantity if direction == 'Long' else (entry_price - exit_price) * quantity
    return {
        "triggered": False,
        "price": exit_price,
        "pnl": pnl,
        "reason": "ORIGINAL_TRADE_EXIT"
    }

def calculate_quantity(strategy, candidate, current_capital):
    sizing = strategy.get('positionSizing', {})
    sizing_type = sizing.get('type', 'FIXED_QUANTITY')
    value = float(sizing.get('value', 1.0))
    entry_price = float(candidate['entryPrice'])

    qty = 1
    if sizing_type == 'FIXED_QUANTITY':
        qty = int(value)
    elif sizing_type == 'PERCENT_OF_CAPITAL':
        capital_to_use = current_capital * (value / 100.0)
        qty = int(capital_to_use // entry_price)
    elif sizing_type == 'FIXED_RISK_AMOUNT':
        sl_rule = None
        for r in strategy.get('exitRules', []):
            if r.get('type') == 'FIXED_STOP_LOSS':
                sl_rule = r
                break
        if sl_rule:
            sl_val = float(sl_rule.get('value', 2.0))
            unit = sl_rule.get('unit', 'PERCENT')
            risk_per_share = entry_price * (sl_val / 100.0) if unit == 'PERCENT' else sl_val
        else:
            risk_per_share = entry_price * 0.02

        qty = int(value // risk_per_share)
    elif sizing_type == 'KELLY':
        qty = int((current_capital * 0.02) // entry_price)

    max_exposure = sizing.get('maxExposure')
    if max_exposure is not None and float(max_exposure) > 0:
        max_qty = int(float(max_exposure) // entry_price)
        qty = min(qty, max_qty)

    return max(1, qty)

def calculate_metrics(trades, initial_capital):
    if not trades:
        return {
            "initialCapital": initial_capital,
            "finalCapital": initial_capital,
            "netProfit": 0.0,
            "totalReturnPercent": 0.0,
            "cagr": 0.0,
            "maxDrawdownAmount": 0.0,
            "maxDrawdownPercent": 0.0,
            "avgDrawdownPercent": 0.0,
            "recoveryFactor": 0.0,
            "sharpeRatio": 0.0,
            "sortinoRatio": 0.0,
            "calmarRatio": 0.0,
            "profitFactor": 0.0,
            "totalTrades": 0,
            "winningTrades": 0,
            "losingTrades": 0,
            "winRate": 0.0,
            "avgWin": 0.0,
            "avgLoss": 0.0,
            "payoffRatio": 0.0,
            "expectancy": 0.0,
            "maxConsecutiveWins": 0,
            "maxConsecutiveLosses": 0,
            "totalBrokeragePaid": 0.0,
            "totalTaxesPaid": 0.0,
            "valueAtRisk95": 0.0,
            "conditionalVaR": 0.0
        }

    current_capital = initial_capital
    peak_capital = initial_capital

    max_dd_amount = 0.0
    max_dd_percent = 0.0
    sum_drawdowns = 0.0
    drawdown_count = 0

    total_brokerage = 0.0
    total_taxes = 0.0

    winning_trades = 0
    losing_trades = 0
    sum_wins = 0.0
    sum_losses = 0.0

    current_win_streak = 0
    current_loss_streak = 0
    max_consecutive_wins = 0
    max_consecutive_losses = 0

    returns_array = []

    for trade in trades:
        capital_at_risk = trade['capitalAtRisk']
        if capital_at_risk > 0:
            returns_array.append(trade['netPnL'] / capital_at_risk)
        else:
            returns_array.append(0.0)

        current_capital += trade['netPnL']
        total_brokerage += trade['totalCosts']

        if current_capital > peak_capital:
            peak_capital = current_capital

        dd_amount = peak_capital - current_capital
        dd_pct = dd_amount / peak_capital if peak_capital > 0 else 0.0

        if dd_amount > max_dd_amount:
            max_dd_amount = dd_amount
        if dd_pct > max_dd_percent:
            max_dd_percent = dd_pct

        if dd_pct > 0:
            sum_drawdowns += dd_pct
            drawdown_count += 1

        if trade['netPnL'] > 0:
            winning_trades += 1
            sum_wins += trade['netPnL']
            current_win_streak += 1
            current_loss_streak = 0
            if current_win_streak > max_consecutive_wins:
                max_consecutive_wins = current_win_streak
        elif trade['netPnL'] < 0:
            losing_trades += 1
            sum_losses += abs(trade['netPnL'])
            current_loss_streak += 1
            current_win_streak = 0
            if current_loss_streak > max_consecutive_losses:
                max_consecutive_losses = current_loss_streak

    total_trades_count = winning_trades + losing_trades
    win_rate = winning_trades / total_trades_count if total_trades_count > 0 else 0.0
    loss_rate = 1.0 - win_rate

    avg_win = sum_wins / winning_trades if winning_trades > 0 else 0.0
    avg_loss = sum_losses / losing_trades if losing_trades > 0 else 0.0

    payoff_ratio = avg_win / avg_loss if avg_loss > 0 else (999.0 if avg_win > 0 else 0.0)
    expectancy = (win_rate * avg_win) - (loss_rate * avg_loss)
    profit_factor = sum_wins / sum_losses if sum_losses > 0 else (999.0 if sum_wins > 0 else 0.0)

    net_profit = current_capital - initial_capital
    total_return_percent = (net_profit / initial_capital) * 100.0 if initial_capital > 0 else 0.0

    cagr = total_return_percent
    if trades:
        try:
            first_date = datetime.strptime(trades[0]['date'][:10], '%Y-%m-%d')
            last_date = datetime.strptime(trades[-1]['date'][:10], '%Y-%m-%d')
            years = (last_date - first_date).days / 365.25
            if years > 0 and current_capital > 0:
                cagr = ((current_capital / initial_capital) ** (1.0 / years) - 1.0) * 100.0
        except Exception as e:
            log.error("Error calculating CAGR: %s", e)

    recovery_factor = net_profit / max_dd_amount if max_dd_amount > 0 else (999.0 if net_profit > 0 else 0.0)
    avg_dd_percent = sum_drawdowns / drawdown_count if drawdown_count > 0 else 0.0

    # Sharpe / Sortino standard annualized calculations
    avg_return = sum(returns_array) / len(returns_array) if returns_array else 0.0
    variance = sum((r - avg_return) ** 2 for r in returns_array) / len(returns_array) if returns_array else 0.0
    std_dev = math.sqrt(variance)

    downside_returns = [r for r in returns_array if r < 0]
    downside_variance = sum(r ** 2 for r in downside_returns) / len(downside_returns) if downside_returns else 0.0
    downside_std_dev = math.sqrt(downside_variance)

    trades_per_year = len(trades) / (total_return_percent / cagr) if len(trades) > 0 and cagr != total_return_percent and cagr != 0 else 252
    annualization_factor = math.sqrt(trades_per_year)

    sharpe = (avg_return / std_dev) * annualization_factor if std_dev > 0 else 0.0
    sortino = (avg_return / downside_std_dev) * annualization_factor if downside_std_dev > 0 else 0.0
    calmar = cagr / (max_dd_percent * 100.0) if max_dd_percent > 0 else 0.0

    var_95 = 0.0
    cvar_95 = 0.0
    if len(returns_array) >= 10:
        sorted_returns = sorted(returns_array)
        idx = int(math.floor(len(sorted_returns) * 0.05))
        var_95 = sorted_returns[idx] * 100.0
        tail_returns = sorted_returns[:idx+1]
        cvar_95 = (sum(tail_returns) / len(tail_returns)) * 100.0

    return {
        "initialCapital": initial_capital,
        "finalCapital": current_capital,
        "netProfit": net_profit,
        "totalReturnPercent": total_return_percent,
        "cagr": cagr,
        "maxDrawdownAmount": max_dd_amount,
        "maxDrawdownPercent": max_dd_percent,  # keep as decimal
        "avgDrawdownPercent": avg_dd_percent,  # keep as decimal
        "recoveryFactor": recovery_factor,
        "sharpeRatio": sharpe,
        "sortinoRatio": sortino,
        "calmarRatio": calmar,
        "profitFactor": profit_factor,
        "totalTrades": len(trades),
        "winningTrades": winning_trades,
        "losingTrades": losing_trades,
        "winRate": win_rate,
        "avgWin": avg_win,
        "avgLoss": avg_loss,
        "payoffRatio": payoff_ratio,
        "expectancy": expectancy,
        "maxConsecutiveWins": max_consecutive_wins,
        "maxConsecutiveLosses": max_consecutive_losses,
        "totalBrokeragePaid": total_brokerage,
        "totalTaxesPaid": total_taxes,
        "valueAtRisk95": var_95,
        "conditionalVaR": cvar_95
    }

def run_screener(config):
    start_time_ns = time.perf_counter_ns()
    strategy = config['strategy']
    universe = config['universe']
    custom_symbols_str = config.get('customSymbols', '')
    selected_sectors = config.get('sectors', [])
    portfolio_mode = config.get('portfolioMode', 'independent')
    max_concurrent_trades = config.get('maxConcurrentTrades', 5)
    date_range = config['dateRange']
    initial_capital = config.get('initialCapital', 100000.0)
    costs = config.get('costs', {
        "brokeragePerOrder": 20.0,
        "sttRate": 0.000625,
        "exchangeFeeRate": 0.0005,
        "stampDutyRate": 0.0001,
        "estimatedSlippagePercent": 0.05
    })

    # Resolve target symbols based on universe & sectors
    target_symbols = []
    if universe == 'indices':
        target_symbols = [
            {"symbol": "NIFTY", "sector": "INDEX"},
            {"symbol": "BANKNIFTY", "sector": "INDEX"},
            {"symbol": "FINNIFTY", "sector": "INDEX"},
            {"symbol": "MIDCPNIFTY", "sector": "INDEX"}
        ]
    else:
        # Load F&O List
        fno_list = []
        if os.path.exists(FNO_FILE):
            try:
                with open(FNO_FILE, "r") as f:
                    fno_list = json.load(f)
            except Exception as e:
                log.error("Error loading F&O file: %s", e)

        # Filter by custom list
        if universe == 'custom' and custom_symbols_str:
            custom_keys = [s.strip().upper() for s in custom_symbols_str.split(',') if s.strip()]
            for key in custom_keys:
                # Find sector
                matched = next((item for item in fno_list if item['symbol'].upper() == key), None)
                sector = matched['sector'] if matched else 'CUSTOM'
                target_symbols.append({"symbol": key, "sector": sector})
        else:
            # All from F&O
            for item in fno_list:
                target_symbols.append({"symbol": item['symbol'], "sector": item['sector']})

        # Apply sector filter if specified
        if selected_sectors:
            target_symbols = [
                s for s in target_symbols 
                if s['sector'].upper() in [sec.upper() for sec in selected_sectors]
            ]

    # Query all candles using DuckDB
    symbol_candles = {}
    unique_dates = set()

    for s_info in target_symbols:
        symbol = s_info['symbol'].upper().strip()
        sector = s_info['sector']
        parquet_path = os.path.join(DATA_DIR, "underlying", symbol, "day", "data.parquet")
        if not os.path.exists(parquet_path):
            continue

        try:
            conn = duckdb.connect()
            query = """
                SELECT timestamp, open, high, low, close, volume, open_interest 
                FROM '{}'
                WHERE CAST(timestamp AS DATE) >= ? AND CAST(timestamp AS DATE) <= ?
                ORDER BY timestamp ASC
            """.format(parquet_path.replace("'", "''")) # escape single quotes in path if any
            
            df = conn.execute(query, [date_range['from'], date_range['to']]).df()
            conn.close()

            if not df.empty:
                candles_list = df.to_dict('records')
                symbol_candles[symbol] = {
                    "candles": candles_list,
                    "sector": sector
                }
                for row in candles_list:
                    date_str = str(row['timestamp']).split()[0]
                    unique_dates.add(date_str)
        except Exception as e:
            log.error("Error reading parquet for %s: %s", symbol, e)

    sorted_dates = sorted(list(unique_dates))
    
    # Generate candidates
    candidates_by_date = {}
    for symbol, sym_data in symbol_candles.items():
        sector = sym_data['sector']
        for row in sym_data['candles']:
            date_str = str(row['timestamp']).split()[0]
            direction = 'Long' if row['close'] >= row['open'] else 'Short'
            
            cand = {
                "date": date_str,
                "ticker": symbol,
                "sector": sector,
                "open": float(row['open']),
                "high": float(row['high']),
                "low": float(row['low']),
                "close": float(row['close']),
                "volume": float(row['volume']) if pd.notna(row['volume']) else 0.0,
                "oi": float(row['open_interest']) if pd.notna(row['open_interest']) else 0.0,
                "direction": direction,
                "entryPrice": float(row['open']),
                "exitPrice": float(row['close']),
                "entryTime": "09:30",
                "exitTime": "15:15"
            }
            if date_str not in candidates_by_date:
                candidates_by_date[date_str] = []
            candidates_by_date[date_str].append(cand)

    executed_trades = []
    symbol_performance = {}

    # Initialise performance tracking per symbol
    for s_info in target_symbols:
        symbol = s_info['symbol'].upper()
        symbol_performance[symbol] = {
            "symbol": symbol,
            "sector": s_info['sector'],
            "tradesCount": 0,
            "wins": 0,
            "netPnL": 0.0
        }

    equity_curve = []
    drawdown_curve = []

    if portfolio_mode == 'independent':
        # INDEPENDENT MODE:
        # Each symbol is simulated independently with its own initial_capital
        # Combine results into one chronological log
        all_trades = []
        for symbol, sym_data in symbol_candles.items():
            current_cap = initial_capital
            current_loss_streak = 0
            todays_pnl = 0.0
            last_date = ""

            for row in sym_data['candles']:
                date_str = str(row['timestamp']).split()[0]
                direction = 'Long' if row['close'] >= row['open'] else 'Short'
                
                trade_cand = {
                    "date": date_str,
                    "ticker": symbol,
                    "open": float(row['open']),
                    "high": float(row['high']),
                    "low": float(row['low']),
                    "close": float(row['close']),
                    "direction": direction,
                    "entryPrice": float(row['open']),
                    "exitPrice": float(row['close']),
                    "entryTime": "09:30",
                    "exitTime": "15:15"
                }

                if date_str != last_date:
                    todays_pnl = 0.0
                    last_date = date_str

                context = {"currentLossStreak": current_loss_streak, "todaysPnL": todays_pnl}
                if not evaluate_entry(trade_cand, strategy, context):
                    continue

                qty = calculate_quantity(strategy, trade_cand, current_cap)
                slippage_factor = costs.get('estimatedSlippagePercent', 0.05) / 100.0
                entry_price = trade_cand['entryPrice'] * (1.0 + slippage_factor)
                exit_price = trade_cand['exitPrice'] * (1.0 - slippage_factor)

                if strategy.get('assetClass') == 'Options' and strategy.get('legs'):
                    expiry = get_active_expiry(symbol, date_str)
                    iv_list = []
                    T_ENTRY = 0.019
                    T_EXIT = T_ENTRY * 0.8
                    r = 0.07
                    
                    if expiry:
                        try:
                            expiry_dt = datetime.strptime(expiry, "%Y-%m-%d")
                            curr_dt = datetime.strptime(date_str, "%Y-%m-%d")
                            dte = max(1, (expiry_dt - curr_dt).days)
                            T_ENTRY = dte / 365.0
                            T_EXIT = max(0.0001, dte - 0.2) / 365.0
                        except Exception as e:
                            log.error("Error calculating option DTE: %s", e)
                        
                        for leg in strategy['legs']:
                            leg_type = leg.get('type', 'CE')
                            strike_offset = float(leg.get('strikeOffset', 0.0))
                            K = entry_price + strike_offset
                            
                            opt_close = get_option_close(symbol, expiry, K, leg_type, date_str)
                            if opt_close is not None:
                                leg_iv = analytics_engine.calculate_implied_volatility(
                                    S=entry_price,
                                    market_price=opt_close,
                                    K=K,
                                    T=T_ENTRY,
                                    r=r,
                                    option_type=leg_type
                                )
                            else:
                                leg_iv = 0.18
                            iv_list.append(leg_iv)
                    else:
                        iv_list = [0.18] * len(strategy['legs'])

                    entry_payoff = calculate_strategy_payoff(entry_price, strategy['legs'], T_ENTRY, r, iv_list)
                    exit_payoff = calculate_strategy_payoff(exit_price, strategy['legs'], T_EXIT, r, iv_list)
                    gross_pnl = (exit_payoff['totalValue'] - entry_payoff['totalValue']) * qty
                    reason = 'OPTIONS_STRATEGY_EXIT'
                else:
                    exit_res = apply_exit_rules(strategy, trade_cand, entry_price, qty)
                    exit_price = exit_res['price']
                    gross_pnl = exit_res['pnl']
                    reason = exit_res['reason']

                turnover = (entry_price + exit_price) * qty
                brokerage = costs.get('brokeragePerOrder', 20.0) * 2.0
                stt = (exit_price * qty) * costs.get('sttRate', 0.000625)
                other_taxes = turnover * (costs.get('exchangeFeeRate', 0.0005) + costs.get('stampDutyRate', 0.0001))
                total_costs = brokerage + stt + other_taxes
                net_pnl = gross_pnl - total_costs

                current_cap += net_pnl
                todays_pnl += net_pnl
                if net_pnl < 0:
                    current_loss_streak += 1
                else:
                    current_loss_streak = 0

                executed = {
                    "id": f"{symbol}_{date_str}_{len(all_trades)}",
                    "date": date_str,
                    "ticker": symbol,
                    "direction": direction,
                    "entryPrice": entry_price,
                    "exitPrice": exit_price,
                    "quantity": qty,
                    "grossPnL": gross_pnl,
                    "netPnL": net_pnl,
                    "totalCosts": total_costs,
                    "reason": reason,
                    "capitalAtRisk": entry_price * qty,
                    "postTradeEquity": current_cap
                }
                all_trades.append(executed)

                # Track breakdown
                perf = symbol_performance[symbol]
                perf["tradesCount"] += 1
                if net_pnl > 0:
                    perf["wins"] += 1
                perf["netPnL"] += net_pnl

        # Sort all trades chronologically to build consolidated equity curve
        executed_trades = sorted(all_trades, key=lambda x: x['date'])
        
        # Build combined equity curve starting at initial_capital
        current_eq = initial_capital
        peak_eq = initial_capital
        
        # Group by date to update equity
        trades_by_date = {}
        for t in executed_trades:
            d = t['date']
            if d not in trades_by_date:
                trades_by_date[d] = []
            trades_by_date[d].append(t)

        for d in sorted_dates:
            if d in trades_by_date:
                day_net = sum(t['netPnL'] for t in trades_by_date[d])
                current_eq += day_net
                if current_eq > peak_eq:
                    peak_eq = current_eq
            
            # Update postTradeEquity for trades on this date
            if d in trades_by_date:
                for t in trades_by_date[d]:
                    t['postTradeEquity'] = current_eq

            dd = (peak_eq - current_eq) / peak_eq if peak_eq > 0 else 0.0
            equity_curve.append({"date": d, "equity": current_eq})
            drawdown_curve.append({"date": d, "drawdown": dd * 100.0})

    else:
        # CONSOLIDATED MODE:
        # Shares a single capital pool, max_concurrent_trades limit per day
        current_eq = initial_capital
        peak_eq = initial_capital
        current_loss_streak_by_symbol = {}
        
        for d in sorted_dates:
            day_candidates = candidates_by_date.get(d, [])
            # Sort by ticker alphabetically for deterministic execution order
            day_candidates = sorted(day_candidates, key=lambda x: x['ticker'])
            
            day_executed = []
            active_slots = len(day_executed)
            
            for cand in day_candidates:
                if active_slots >= max_concurrent_trades:
                    break
                    
                symbol = cand['ticker']
                loss_streak = current_loss_streak_by_symbol.get(symbol, 0)
                todays_pnl = 0.0 # reset daily in consolidated
                
                context = {"currentLossStreak": loss_streak, "todaysPnL": todays_pnl}
                if not evaluate_entry(cand, strategy, context):
                    continue

                qty = calculate_quantity(strategy, cand, current_eq)
                slippage_factor = costs.get('estimatedSlippagePercent', 0.05) / 100.0
                entry_price = cand['entryPrice'] * (1.0 + slippage_factor)
                exit_price = cand['exitPrice'] * (1.0 - slippage_factor)

                if strategy.get('assetClass') == 'Options' and strategy.get('legs'):
                    expiry = get_active_expiry(symbol, d)
                    iv_list = []
                    T_ENTRY = 0.019
                    T_EXIT = T_ENTRY * 0.8
                    r = 0.07
                    
                    if expiry:
                        try:
                            expiry_dt = datetime.strptime(expiry, "%Y-%m-%d")
                            curr_dt = datetime.strptime(d, "%Y-%m-%d")
                            dte = max(1, (expiry_dt - curr_dt).days)
                            T_ENTRY = dte / 365.0
                            T_EXIT = max(0.0001, dte - 0.2) / 365.0
                        except Exception as e:
                            log.error("Error calculating option DTE: %s", e)
                        
                        for leg in strategy['legs']:
                            leg_type = leg.get('type', 'CE')
                            strike_offset = float(leg.get('strikeOffset', 0.0))
                            K = entry_price + strike_offset
                            
                            opt_close = get_option_close(symbol, expiry, K, leg_type, d)
                            if opt_close is not None:
                                leg_iv = analytics_engine.calculate_implied_volatility(
                                    S=entry_price,
                                    market_price=opt_close,
                                    K=K,
                                    T=T_ENTRY,
                                    r=r,
                                    option_type=leg_type
                                )
                            else:
                                leg_iv = 0.18
                            iv_list.append(leg_iv)
                    else:
                        iv_list = [0.18] * len(strategy['legs'])

                    entry_payoff = calculate_strategy_payoff(entry_price, strategy['legs'], T_ENTRY, r, iv_list)
                    exit_payoff = calculate_strategy_payoff(exit_price, strategy['legs'], T_EXIT, r, iv_list)
                    gross_pnl = (exit_payoff['totalValue'] - entry_payoff['totalValue']) * qty
                    reason = 'OPTIONS_STRATEGY_EXIT'
                else:
                    exit_res = apply_exit_rules(strategy, cand, entry_price, qty)
                    exit_price = exit_res['price']
                    gross_pnl = exit_res['pnl']
                    reason = exit_res['reason']

                turnover = (entry_price + exit_price) * qty
                brokerage = costs.get('brokeragePerOrder', 20.0) * 2.0
                stt = (exit_price * qty) * costs.get('sttRate', 0.000625)
                other_taxes = turnover * (costs.get('exchangeFeeRate', 0.0005) + costs.get('stampDutyRate', 0.0001))
                total_costs = brokerage + stt + other_taxes
                net_pnl = gross_pnl - total_costs

                executed = {
                    "id": f"{symbol}_{d}_{len(executed_trades)}",
                    "date": d,
                    "ticker": symbol,
                    "direction": cand['direction'],
                    "entryPrice": entry_price,
                    "exitPrice": exit_price,
                    "quantity": qty,
                    "grossPnL": gross_pnl,
                    "netPnL": net_pnl,
                    "totalCosts": total_costs,
                    "reason": reason,
                    "capitalAtRisk": entry_price * qty,
                    "postTradeEquity": current_eq # provisional
                }
                executed_trades.append(executed)
                day_executed.append(executed)
                active_slots += 1

                # Update streams & streak
                if net_pnl < 0:
                    current_loss_streak_by_symbol[symbol] = loss_streak + 1
                else:
                    current_loss_streak_by_symbol[symbol] = 0

                # Track breakdown
                perf = symbol_performance[symbol]
                perf["tradesCount"] += 1
                if net_pnl > 0:
                    perf["wins"] += 1
                perf["netPnL"] += net_pnl

            # End of day updates
            day_net = sum(t['netPnL'] for t in day_executed)
            current_eq += day_net
            if current_eq > peak_eq:
                peak_eq = current_eq

            # Update postTradeEquity for trades executed today
            for t in day_executed:
                t['postTradeEquity'] = current_eq

            dd = (peak_eq - current_eq) / peak_eq if peak_eq > 0 else 0.0
            equity_curve.append({"date": d, "equity": current_eq})
            drawdown_curve.append({"date": d, "drawdown": dd * 100.0})

    # Prepare symbol breakdown output format
    symbol_breakdown = []
    for sym, perf in symbol_performance.items():
        if perf['tradesCount'] > 0:
            win_rate = perf['wins'] / perf['tradesCount']
            symbol_breakdown.append({
                "symbol": sym,
                "sector": perf['sector'],
                "tradesCount": perf['tradesCount'],
                "winRate": win_rate,
                "netPnL": perf['netPnL']
            })

    # Calculate final consolidated analytics
    metrics = calculate_metrics(executed_trades, initial_capital)
    execution_time_ms = (time.perf_counter_ns() - start_time_ns) / 1_000_000.0

    return {
        "config": config,
        "trades": executed_trades,
        "metrics": metrics,
        "equityCurve": equity_curve,
        "drawdownCurve": drawdown_curve,
        "symbolBreakdown": symbol_breakdown,
        "executionTimeMs": execution_time_ms
    }
