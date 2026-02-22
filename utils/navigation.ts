/**
 * Utility for external navigation and trading tool integration
 */

export const openTradingView = (symbol: string) => {
    if (!symbol) return;
    
    const firstPart = symbol.split('.')[0];
    if (firstPart === undefined) return;
    const cleanSymbol = firstPart.replace('NSE:', '').replace('BSE:', '');
    const url = `https://www.tradingview.com/chart/?symbol=NSE:${cleanSymbol}`;
    
    window.open(url, '_blank');
};

export const openSectorTradingView = (sector: string) => {
    if (!sector) return;
    const cleanSector = sector.toUpperCase().trim();
    
    const SECTOR_TICKER_MAP: Record<string, string> = {
        'AUTO': 'CNXAUTO',
        'BANK': 'BANKNIFTY',
        'CAP GOODS': 'NIFTY_CAPITAL_GOODS',
        'CEMENT': 'NIFTY_CEMENT',
        'CONSUMER DURABLES': 'NIFTY_CONSR_DURBL',
        'DEFENSE': 'NIFTY_IND_DEFENCE',
        'FIN SERVICE': 'CNXFINANCE',
        'FMCG': 'CNXFMCG',
        'HEALTHCARE': 'NIFTY_HEALTHCARE',
        'IT': 'CNXIT',
        'MEDIA': 'CNXMEDIA',
        'METAL': 'CNXMETAL',
        'NIFTY 50': 'NIFTY',
        'NIFTY MID SELECT': 'MIDCPNIFTY',
        'NIFTY NEXT 50': 'JUNIOR',
        'OIL & GAS': 'NIFTY_OIL_AND_GAS',
        'PHARMA': 'CNXPHARMA',
        'PSU BANK': 'CNXPSUBANK',
        'PVT BANK': 'NIFTYPVTBANK',
        'REALTY': 'CNXREALTY',
        'SENSEX': 'SENSEX',
        'SERVICES': 'CNXSERVICE',
    };

    const key = cleanSector.replace(/^NIFTY\s+/, '');
    const ticker = SECTOR_TICKER_MAP[cleanSector] || SECTOR_TICKER_MAP[key] || `NIFTY_${cleanSector.replace(/\s+/g, '_')}`;
    const exchange = ticker === 'SENSEX' ? 'BSE' : 'NSE';
    const url = `https://www.tradingview.com/chart/?symbol=${exchange}:${ticker}`;
    
    window.open(url, '_blank');
};
