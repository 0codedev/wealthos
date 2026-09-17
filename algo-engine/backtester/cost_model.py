"""
WealthOS Backtester — Institutional Transaction Cost & Friction Model (Indian Markets)
Calculates real-world exchange fees, taxes, slippage, and net PnL impact.
"""

# Zerodha / Dhan standard Indian fee structure
BROKERAGE_PCT = 0.0003          # 0.03% capped at ₹20 per order
MAX_BROKERAGE_PER_ORDER = 20.0  # ₹20 max fee per executed order leg

STT_EQUITY_BUY = 0.0            # 0% on equity delivery buy (0.1% on delivery sell)
STT_EQUITY_SELL_INTRADAY = 0.00025  # 0.025% on intraday equity sell
STT_FNO_FUTURES_SELL = 0.000125     # 0.0125% on futures sell
STT_FNO_OPTIONS_SELL = 0.000625     # 0.0625% on options premium sell

EXCHANGE_TXN_EQ = 0.0000345     # NSE Equity Turnover Fee (0.00345%)
EXCHANGE_TXN_FNO_FUT = 0.00002  # NSE Futures Turnover Fee (0.002%)
EXCHANGE_TXN_FNO_OPT = 0.00053  # NSE Options Premium Turnover Fee (0.053%)

GST_RATE = 0.18                 # 18% GST on (Brokerage + Exchange Txn Charges)
SEBI_TURNOVER_FEE = 0.000001    # ₹10 per Crore (0.0001%)
STAMP_DUTY_BUY_EQ = 0.00015     # 0.015% on Buy equity
STAMP_DUTY_BUY_OPT = 0.00003    # 0.003% on Buy options

DEFAULT_SLIPPAGE_PCT = 0.0005   # 0.05% default execution slippage

def calculate_transaction_cost(
    price: float,
    quantity: int,
    is_buy: bool = True,
    instrument_type: str = "OPT",
    slippage_pct: float = DEFAULT_SLIPPAGE_PCT
) -> dict:
    """
    Calculates detailed itemized transaction costs for an Indian market trade leg.
    
    instrument_type options: "EQ_INTRADAY", "EQ_DELIVERY", "FUT", "OPT"
    """
    notional = abs(price * quantity)
    if notional <= 0:
        return {
            "total_cost": 0.0,
            "brokerage": 0.0,
            "stt": 0.0,
            "exchange_txn": 0.0,
            "gst": 0.0,
            "sebi_fee": 0.0,
            "stamp_duty": 0.0,
            "slippage": 0.0
        }

    # 1. Brokerage
    brokerage = min(notional * BROKERAGE_PCT, MAX_BROKERAGE_PER_ORDER)

    # 2. STT (Securities Transaction Tax)
    stt = 0.0
    if instrument_type == "EQ_INTRADAY" and not is_buy:
        stt = notional * STT_EQUITY_SELL_INTRADAY
    elif instrument_type == "FUT" and not is_buy:
        stt = notional * STT_FNO_FUTURES_SELL
    elif instrument_type == "OPT" and not is_buy:
        stt = notional * STT_FNO_OPTIONS_SELL
    elif instrument_type == "EQ_DELIVERY" and not is_buy:
        stt = notional * 0.001

    # 3. Exchange Transaction Charges
    if instrument_type.startswith("EQ"):
        exchange_txn = notional * EXCHANGE_TXN_EQ
    elif instrument_type == "FUT":
        exchange_txn = notional * EXCHANGE_TXN_FNO_FUT
    else:  # OPT
        exchange_txn = notional * EXCHANGE_TXN_FNO_OPT

    # 4. GST
    gst = (brokerage + exchange_txn) * GST_RATE

    # 5. SEBI Turnover Charges
    sebi_fee = notional * SEBI_TURNOVER_FEE

    # 6. Stamp Duty (charged on BUY side only)
    stamp_duty = 0.0
    if is_buy:
        if instrument_type.startswith("EQ"):
            stamp_duty = notional * STAMP_DUTY_BUY_EQ
        else:
            stamp_duty = notional * STAMP_DUTY_BUY_OPT

    # 7. Slippage
    slippage = notional * max(0.0, slippage_pct)

    total_cost = round(brokerage + stt + exchange_txn + gst + sebi_fee + stamp_duty + slippage, 2)

    return {
        "total_cost": total_cost,
        "brokerage": round(brokerage, 2),
        "stt": round(stt, 2),
        "exchange_txn": round(exchange_txn, 2),
        "gst": round(gst, 2),
        "sebi_fee": round(sebi_fee, 2),
        "stamp_duty": round(stamp_duty, 2),
        "slippage": round(slippage, 2),
        "notional": round(notional, 2)
    }

def calculate_round_trip_cost(
    entry_price: float,
    exit_price: float,
    quantity: int,
    instrument_type: str = "OPT",
    slippage_pct: float = DEFAULT_SLIPPAGE_PCT
) -> dict:
    """Calculates combined round-trip transaction costs (Entry + Exit)."""
    entry_breakdown = calculate_transaction_cost(entry_price, quantity, is_buy=True, instrument_type=instrument_type, slippage_pct=slippage_pct)
    exit_breakdown = calculate_transaction_cost(exit_price, quantity, is_buy=False, instrument_type=instrument_type, slippage_pct=slippage_pct)

    gross_pnl = (exit_price - entry_price) * quantity
    total_friction = entry_breakdown["total_cost"] + exit_breakdown["total_cost"]
    net_pnl = gross_pnl - total_friction

    return {
        "gross_pnl": round(gross_pnl, 2),
        "total_friction": round(total_friction, 2),
        "net_pnl": round(net_pnl, 2),
        "entry_cost": entry_breakdown,
        "exit_cost": exit_breakdown
    }
