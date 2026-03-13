import { newsService, NewsArticle } from './NewsService';
import { db } from '../database';
import { logger } from './Logger';

class NewsCorrelationService {
  async matchNewsForSymbol(symbol: string, lookbackMinutes = 30): Promise<NewsArticle | null> {
    try {
      const cleanSym = symbol.split(':').pop() || symbol;
      const articles = await newsService.fetchUpstoxNews([cleanSym]);
      const cutoff = Date.now() - lookbackMinutes * 60 * 1000;

      // Try to find exact matches from Upstox symbol-specific news first
      let matched = articles.find(a => new Date(a.publishedAt).getTime() > cutoff);
      if (matched) return matched;

      // Resolve company name from local Dhan instruments database
      const inst = await db.instruments.where('symbol').equals(cleanSym.toUpperCase()).first();
      const companyName = inst?.name?.toLowerCase().replace(/limited|ltd|corp|corporation/gi, '').trim() || '';
      const symbolLower = cleanSym.toLowerCase();

      // Fallback: Fetch general market news and scan for symbol or company name matches
      const marketNews = await newsService.fetchMarketNews();
      matched = marketNews.find(a => {
        const pubTime = new Date(a.publishedAt).getTime();
        if (pubTime < cutoff) return false;

        const titleLower = a.title.toLowerCase();
        const descLower = a.description.toLowerCase();

        return (
          titleLower.includes(symbolLower) ||
          descLower.includes(symbolLower) ||
          (companyName && (titleLower.includes(companyName) || descLower.includes(companyName)))
        );
      });

      return matched || null;
    } catch (err) {
      logger.error(`NewsCorrelationService: Error matching news for ${symbol}`, err);
      return null;
    }
  }

  async matchNewsForSymbols(symbols: string[]): Promise<Map<string, NewsArticle>> {
    const results = new Map<string, NewsArticle>();
    for (const symbol of symbols) {
      const matched = await this.matchNewsForSymbol(symbol);
      if (matched) {
        results.set(symbol, matched);
      }
    }
    return results;
  }

  getNewsAge(article: NewsArticle): string {
    const elapsedMs = Date.now() - new Date(article.publishedAt).getTime();
    const elapsedMins = Math.floor(elapsedMs / 60000);
    if (elapsedMins < 1) return 'just now';
    if (elapsedMins === 1) return '1 minute ago';
    return `${elapsedMins} minutes ago`;
  }

  isBreakingNews(article: NewsArticle): boolean {
    const elapsedMs = Date.now() - new Date(article.publishedAt).getTime();
    return article.category === 'BREAKING' || elapsedMs < 10 * 60 * 1000; // < 10 mins
  }

  buildNewsSnippet(article: NewsArticle): string {
    return `📰 "${article.title}" (${this.getNewsAge(article)})`;
  }
}

export const newsCorrelationService = new NewsCorrelationService();
export default newsCorrelationService;
