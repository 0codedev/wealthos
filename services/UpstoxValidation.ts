/**
 * Upstox Validation Service
 * Validates inputs for Upstox integration endpoints and services.
 */

export function validateInstrumentKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  // Upstox instrument key format: EXCHANGE_SEGMENT|IDENTIFIER (e.g. NSE_EQ|INE002A01018, NSE_FO|54321)
  return key.includes('|') && key.split('|').length === 2 && key.split('|')[0].length > 0 && key.split('|')[1].length > 0;
}

export function validateISIN(isin: string): boolean {
  if (!isin || typeof isin !== 'string') return false;
  // ISIN standard format: 12 alphanumeric characters, starting with 2 letters
  const isinRegex = /^[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]$/;
  return isinRegex.test(isin.trim());
}

export function validateDate(date: string): boolean {
  if (!date || typeof date !== 'string') return false;
  // Date format: YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date.trim())) return false;
  const parsed = Date.parse(date);
  return !isNaN(parsed);
}

export function validateExpiry(expiry: string): boolean {
  return validateDate(expiry);
}

export function validateOptionType(type: string): boolean {
  if (!type || typeof type !== 'string') return false;
  const upper = type.toUpperCase().trim();
  return upper === 'CE' || upper === 'PE';
}

export function validateExchangeSegment(segment: string): boolean {
  if (!segment || typeof segment !== 'string') return false;
  const upper = segment.toUpperCase().trim();
  const validSegments = ['NSE_EQ', 'NSE_FO', 'BSE_EQ', 'BSE_FO', 'MCX', 'NCDEX', 'NSE', 'NFO', 'BSE', 'BFO'];
  return validSegments.includes(upper);
}
