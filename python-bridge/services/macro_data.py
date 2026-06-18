"""
WealthOS Macro Data Service
Fetches, builds, and updates monthly macro dataset for NIFTY 50 regime modeling.
Consists of 43 global indicators (equity indices, commodities, FX, bonds, volatility, crypto).
"""

import os
import sys
import logging
import pandas as pd
import numpy as np
import yfinance as yf
from datetime import datetime, timedelta
from typing import List, Dict, Optional

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("macro_data")

MACRO_INDICATORS: Dict[str, str] = {
    # Target
    "NIFTY": "^NSEI",
    # Global Equities
    "SENSEX": "^BSESN",
    "SP500": "^GSPC",
    "NASDAQ": "^IXIC",
    "DOW": "^DJI",
    "FTSE": "^FTSE",
    "DAX": "^GDAXI",
    "CAC": "^FCHI",
    "NIKKEI": "^N225",
    "HANGSENG": "^HSI",
    "SHANGHAI": "000001.SS",
    "EEM": "EEM",
    # Commodities
    "GOLD": "GLD",
    "SILVER": "SLV",
    "CRUDE_OIL": "CL=F",
    "NAT_GAS": "NG=F",
    "COPPER": "HG=F",
    "AGRI": "DBA",
    "BALTIC_DRY": "BDRY",
    # Currencies / FX
    "USDINR": "USDINR=X",
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "USDJPY=X",
    "AUDUSD": "AUDUSD=X",
    "DXY": "DX-Y.NYB",
    # Interest Rates & Bonds
    "US10Y": "^TNX",
    "US03M": "^IRX",
    "US30Y": "^TYX",
    "US05Y": "^FVX",
    "HYG_CREDIT": "HYG",
    # Volatility
    "CBOE_VIX": "^VIX",
    "VVIX": "^VVIX",
    "VXN": "^VXN",
    # Crypto
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    # US Sector ETFs (Global Macro proxies)
    "XLF_FINANCIALS": "XLF",
    "XLK_TECH": "XLK",
    "XLE_ENERGY": "XLE",
    "XLI_INDUSTRIALS": "XLI",
    "XLB_MATERIALS": "XLB",
    "XLU_UTILITIES": "XLU",
    "XLP_STAPLES": "XLP",
    "XLY_DISCRETIONARY": "XLY",
    "XLV_HEALTHCARE": "XLV"
}


def fetch_indicator_monthly(ticker: str, start_date: str, end_date: str) -> Optional[pd.Series]:
    """Fetch monthly close prices for a single ticker."""
    try:
        data = yf.download(ticker, start=start_date, end=end_date, interval="1mo", progress=False)
        if data.empty:
            logger.warning(f"No data returned for ticker {ticker}")
            return None
        
        # yfinance multi-index column handling
        if isinstance(data.columns, pd.MultiIndex):
            close = data['Close'][ticker] if ticker in data['Close'] else data['Close'].iloc[:, 0]
        else:
            close = data['Close'] if 'Close' in data else data.iloc[:, 0]
            
        close.name = ticker
        return close
    except Exception as e:
        logger.error(f"Error downloading {ticker}: {e}")
        return None


def fetch_all_indicators(start_date: str = "2008-01-01", end_date: Optional[str] = None) -> pd.DataFrame:
    """
    Fetches all 43 macro indicators + NIFTY target monthly closes,
    resamples to monthly frequency, computes monthly log returns.
    """
    if end_date is None:
        end_date = datetime.now().strftime("%Y-%m-%d")
        
    logger.info(f"Downloading macro data from {start_date} to {end_date} for {len(MACRO_INDICATORS)} indicators...")
    
    close_dict = {}
    for name, ticker in MACRO_INDICATORS.items():
        series = fetch_indicator_monthly(ticker, start_date, end_date)
        if series is not None and not series.empty:
            close_dict[name] = series
            
    df_close = pd.DataFrame(close_dict)
    
    # Resample & forward-fill missing monthly data
    df_close.index = pd.to_datetime(df_close.index)
    df_monthly = df_close.resample("ME").last().ffill().bfill()
    
    # Compute log returns for all columns
    df_returns = np.log(df_monthly / df_monthly.shift(1))
    
    # Target column is NIFTY return shift(-1) because we want to predict NEXT month's return
    if "NIFTY" in df_returns:
        df_returns["target_nifty_next_ret"] = df_returns["NIFTY"].shift(-1)
    
    df_returns = df_returns.dropna(subset=["NIFTY"]).reset_index()
    df_returns.rename(columns={"index": "date", "Date": "date"}, inplace=True)
    
    logger.info(f"Successfully processed monthly dataset. Shape: {df_returns.shape}")
    return df_returns


def build_macro_csv(output_path: str = "data/macro/nifty_macro_monthly.csv") -> bool:
    """Builds the full historical macro dataset and saves to CSV."""
    try:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        df = fetch_all_indicators(start_date="2008-01-01")
        df.to_csv(output_path, index=False)
        logger.info(f"Macro dataset successfully saved to {output_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to build macro CSV: {e}")
        return False


def update_macro_csv(csv_path: str = "data/macro/nifty_macro_monthly.csv") -> bool:
    """Appends recent month data to existing CSV if new month is available."""
    if not os.path.exists(csv_path):
        return build_macro_csv(csv_path)
    
    try:
        df_existing = pd.read_csv(csv_path)
        last_date_str = str(df_existing["date"].iloc[-1])
        last_date = pd.to_datetime(last_date_str)
        
        # Download from last date - 2 months to ensure clean monthly boundary
        start_fetch = (last_date - timedelta(days=60)).strftime("%Y-%m-%d")
        df_new = fetch_all_indicators(start_date=start_fetch)
        
        # Merge & deduplicate by date
        df_combined = pd.concat([df_existing, df_new], ignore_index=True)
        df_combined["date"] = pd.to_datetime(df_combined["date"])
        df_combined = df_combined.drop_duplicates(subset=["date"], keep="last").sort_values("date")
        
        df_combined.to_csv(csv_path, index=False)
        logger.info(f"Updated {csv_path}. Total rows: {len(df_combined)}")
        return True
    except Exception as e:
        logger.error(f"Failed to update macro CSV: {e}")
        return False


if __name__ == "__main__":
    build_macro_csv()
