import { FNO_STOCKS } from '../data/fno_stocks';
import { SECTOR_CONSTITUENTS } from '../data/sectorConstituents';
import { upstoxInstrumentService } from '../services/UpstoxInstrumentService';

export async function buildTier1Keys(): Promise<string[]> {
  // 1. Index symbols
  const indexSymbols = [
    'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'INDIA VIX',
    'NIFTY AUTO', 'NIFTY METAL', 'NIFTY IT', 'NIFTY PHARMA', 'NIFTY FMCG',
    'NIFTY REALTY', 'NIFTY PSU BANK', 'NIFTY PVT BANK', 'NIFTY IND DEFENCE',
    'NIFTY OIL AND GAS', 'NIFTY CONSR DURBL', 'NIFTY CEMENT', 'NIFTY MEDIA',
    'NIFTY HEALTHCARE', 'NIFTY CHEMICALS', 'NIFTY ENERGY', 'NIFTY CAPITAL MKT',
    'NIFTY SERV SECTOR'
  ];
  
  // 2. FNO stocks
  const fnoSymbols = FNO_STOCKS.map(s => s.symbol);
  
  // 3. Sector constituents (deduplicated)
  const sectorSymbolsSet = new Set<string>();
  Object.values(SECTOR_CONSTITUENTS).forEach((list) => {
    list.forEach((sym) => sectorSymbolsSet.add(sym));
  });
  const sectorSymbols = Array.from(sectorSymbolsSet);

  // Combine and deduplicate stock symbols
  const allStockSymbols = Array.from(new Set([...fnoSymbols, ...sectorSymbols]));

  // Resolve keys
  const indexKeysMap = await upstoxInstrumentService.getInstrumentKeys(indexSymbols, 'NSE_INDEX');
  const stockKeysMap = await upstoxInstrumentService.getInstrumentKeys(allStockSymbols, 'NSE_EQ');

  const keysSet = new Set<string>();
  keysSet.add('BSE_INDEX|SENSEX');
  Object.values(indexKeysMap).forEach(k => { if (k) keysSet.add(k); });
  Object.values(stockKeysMap).forEach(k => { if (k) keysSet.add(k); });

  return Array.from(keysSet);
}

export async function buildTier2Keys(): Promise<string[]> {
  const fnoSymbols = FNO_STOCKS.map(s => s.symbol);
  const stockKeysMap = await upstoxInstrumentService.getInstrumentKeys(fnoSymbols, 'NSE_EQ');
  
  const keysSet = new Set<string>();
  Object.values(stockKeysMap).forEach(k => { if (k) keysSet.add(k); });
  
  return Array.from(keysSet);
}
