import Papa from 'papaparse';
import { db, HistoricalPoint } from '../../database';

/**
 * DataVaultService
 * 
 * Handles parsing and ingestion of historical market data files (Bhavcopy).
 * Supports NSE Equity and F&O formats.
 */
export class DataVaultService {

  /**
   * Parses an NSE Bhavcopy CSV file and converts it to HistoricalPoints.
   */
  static async parseBhavcopy(file: File): Promise<HistoricalPoint[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const data = results.data as any[];
            const points: HistoricalPoint[] = [];

            for (const row of data) {
              // Normalize headers (NSE sometimes uses uppercase, sometimes mixed)
              const normalized = this.normalizeRow(row);
              
              if (normalized.SYMBOL) {
                const point = this.mapToHistoricalPoint(normalized);
                if (point) points.push(point);
              }
            }
            resolve(points);
          } catch (error) {
            reject(error);
          }
        },
        error: (error) => reject(error)
      });
    });
  }

  /**
   * Maps a raw CSV row to our HistoricalPoint schema.
   */
  private static mapToHistoricalPoint(row: any): HistoricalPoint | null {
    const isOptions = !!row.INSTRUMENT && (row.INSTRUMENT.includes('OPT') || row.OPTION_TYP);
    
    const dateStr = row.TIMESTAMP || row.DATE1;
    if (!dateStr) return null;
    const formattedDate = this.formatDate(dateStr);

    return {
      symbol: row.SYMBOL,
      date: formattedDate,
      open: parseFloat(row.OPEN) || 0,
      high: parseFloat(row.HIGH) || 0,
      low: parseFloat(row.LOW) || 0,
      close: parseFloat(row.CLOSE) || 0,
      volume: parseInt(row.TOTTRDQTY || row.CONTRACTS) || 0,
      oi: parseInt(row.OPEN_INT) || 0,
      assetClass: isOptions ? 'Options' : 'Equity',
      timestamp: new Date(formattedDate).getTime(),
      // Option Specifics
      optionType: row.OPTION_TYP as 'CE' | 'PE',
      strike: parseFloat(row.STRIKE_PR),
      expiry: row.EXPIRY_DT ? this.formatDate(row.EXPIRY_DT) : undefined
    };
  }

  /**
   * Efficiently imports a large batch of data to Dexie.
   */
  static async importToVault(points: HistoricalPoint[]): Promise<number> {
    if (points.length === 0) return 0;

    // Use bulkPut to handle updates (overwrite if symbol+date already exists)
    // Dexie's bulkPut is very fast, but for millions of rows, chunking prevents UI thread blocking.
    const CHUNK_SIZE = 5000;
    for (let i = 0; i < points.length; i += CHUNK_SIZE) {
      const chunk = points.slice(i, i + CHUNK_SIZE);
      await db.historical_data.bulkPut(chunk);
      // Yield to the main thread to prevent UI freezing during large imports
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    
    return points.length;
  }

  /**
   * Helper to normalize CSV headers (strips spaces, toUpperCase).
   */
  private static normalizeRow(row: any): any {
    const normalized: any = {};
    for (const key in row) {
      normalized[key.trim().toUpperCase()] = row[key];
    }
    return normalized;
  }

  /**
   * Formats DD-MON-YYYY or DD-MM-YYYY to YYYY-MM-DD.
   */
  private static formatDate(str: string): string {
    const months: Record<string, string> = {
      'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
      'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
    };

    const parts = str.split(/[-/]/);
    if (parts.length !== 3) return str;

    let day = parts[0].padStart(2, '0');
    let month = parts[1].toUpperCase();
    let year = parts[2];

    // Handle numeric months
    if (months[month]) {
      month = months[month];
    } else {
      month = month.padStart(2, '0');
    }

    return `${year}-${month}-${day}`;
  }

  /**
   * Get total counts for the vault inventory.
   */
  static async getVaultStats() {
    const count = await db.historical_data.count();
    const symbols = await db.historical_data.orderBy('symbol').uniqueKeys();
    const lastPoint = await db.historical_data.orderBy('date').last();
    
    return {
      totalPoints: count,
      symbolCount: symbols.length,
      lastUpdated: lastPoint?.date || 'Never'
    };
  }
}
