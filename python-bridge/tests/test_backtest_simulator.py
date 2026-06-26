import pytest
import pandas as pd
from unittest.mock import patch, MagicMock
from backtest_simulator import BacktestSimulator

@pytest.fixture
def mock_underlying_data():
    # 20 bars of mock daily candles
    data = []
    # Spot moves from 20000 to 20500 slowly
    for i in range(20):
        data.append([
            f"2024-01-{i+1:02d}T09:15:00+05:30", # timestamp
            20000 + i * 25,                      # open
            20010 + i * 25,                      # high
            19990 + i * 25,                      # low
            20005 + i * 25,                      # close
            100000 + i,                          # volume
            0                                    # open_interest
        ])
    return data

@patch('backtest_simulator.BacktestSimulator._load_underlying_data')
def test_equity_simulation_run(mock_load, mock_underlying_data):
    # Convert mock candles to DataFrame
    df = pd.DataFrame(mock_underlying_data, columns=["timestamp", "open", "high", "low", "close", "volume", "open_interest"])
    df['timestamp_str'] = df['timestamp'].astype(str)
    df['date_only'] = df['timestamp_str'].apply(lambda x: x[:10])
    df['sma_20'] = df['close'].rolling(window=20).mean().fillna(df['close'])
    df['sma_50'] = df['close'].rolling(window=50).mean().fillna(df['close'])
    df['rsi_14'] = 50.0
    df['vwap'] = df['close']
    mock_load.return_value = df

    config = {
        "symbol": "NIFTY",
        "asset_class": "EQUITY",
        "interval": "day",
        "from_date": "2024-01-01",
        "to_date": "2024-01-20",
        "initial_capital": 500000.0,
        "position_sizing": {"type": "PCT_OF_CAPITAL", "value": 10.0},
        "slippage_pct": 0.05,
        "entry_rules": [], # enter immediately
        "exit_rules": [
            {"type": "STOP_LOSS_PCT", "params": {"value": 2.0}},
            {"type": "TARGET_PCT", "params": {"value": 5.0}}
        ]
    }

    simulator = BacktestSimulator(config)
    result = simulator.run()

    assert result["status"] == "success"
    assert "metrics" in result
    assert result["metrics"]["initial_capital"] == 500000.0
    assert "equity_curve" in result
    assert len(result["equity_curve"]) == len(mock_underlying_data)

def test_indicator_conditions_evaluation(mock_underlying_data):
    config = {
        "symbol": "NIFTY",
        "asset_class": "EQUITY",
        "interval": "day",
        "from_date": "2024-01-01",
        "to_date": "2024-01-20",
        "initial_capital": 500000.0,
        "position_sizing": {"type": "PCT_OF_CAPITAL", "value": 10.0},
        "slippage_pct": 0.05,
        "entry_rules": [
            {
                "id": "r1",
                "logic": "AND",
                "leftType": "INDICATOR",
                "leftIndicator": "ema",
                "leftPeriod": 9,
                "operator": "GREATER_THAN",
                "rightType": "INDICATOR",
                "rightIndicator": "ema",
                "rightPeriod": 21
            },
            {
                "id": "r2",
                "logic": "AND",
                "leftType": "INDICATOR",
                "leftIndicator": "rsi",
                "leftPeriod": 14,
                "operator": "GREATER_THAN",
                "rightType": "VALUE",
                "rightValue": 50.0
            }
        ],
        "exit_rules": [
            {"type": "STOP_LOSS_PCT", "params": {"value": 2.0}},
            {"type": "TARGET_PCT", "params": {"value": 5.0}}
        ]
    }

    df = pd.DataFrame(mock_underlying_data, columns=["timestamp", "open", "high", "low", "close", "volume", "open_interest"])
    df['timestamp_str'] = df['timestamp'].astype(str)
    df['date_only'] = df['timestamp_str'].apply(lambda x: x[:10])

    simulator = BacktestSimulator(config)
    # Inject our df and compute indicators manually
    simulator.underlying_df = df
    simulator._compute_indicators(df)

    assert "ema_9" in df.columns
    assert "ema_21" in df.columns
    assert "rsi_14" in df.columns

    # First few bars won't pass since periods are not fully satisfied
    assert not simulator._evaluate_entry_rules(0, df.iloc[0])

