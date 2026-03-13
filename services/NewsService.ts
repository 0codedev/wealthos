import { logger } from './Logger';

export interface NewsArticle {
    id: string;
    title: string;
    description: string;
    source: string;
    url: string;
    publishedAt: string;
    imageUrl?: string;
    sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    category: 'BREAKING' | 'MARKET' | 'CORPORATE' | 'GLOBAL';
}

class NewsService {
    private cachedArticles: NewsArticle[] = [];
    private cacheExpiresAt = 0;
    private rateLimitedUntil = 0;

    private getApiKeys(): { primary: string, fallback: string } {
        try {
            const storeData = localStorage.getItem('wealth-aggregator-logic');
            if (storeData) {
                const parsed = JSON.parse(storeData);
                return {
                    primary: parsed.state?.apiKeys?.newsApi || '',
                    fallback: parsed.state?.apiKeys?.newsApiFallback || ''
                };
            }
        } catch (e) { /* ignore */ }
        return { primary: '', fallback: '' };
    }

    async fetchMarketNews(useFallback = false): Promise<NewsArticle[]> {
        const now = Date.now();
        // Serve memory cache if still valid
        if (this.cachedArticles.length > 0 && now < this.cacheExpiresAt) {
            return this.cachedArticles;
        }

        // Check if under 429 cooldown
        if (now < this.rateLimitedUntil) {
            logger.warn('NewsService: Under rate-limit cooldown. Serving cached/mock news.');
            return this.cachedArticles.length > 0 ? this.cachedArticles : this.getMockNews();
        }

        const keys = this.getApiKeys();
        const apiKey = useFallback ? (keys.fallback || keys.primary) : (keys.primary || keys.fallback);
        
        if (!apiKey) {
            logger.warn('NewsService: NEWS_API_KEY missing. Returning mock news.');
            return this.getMockNews();
        }

        try {
            const query = encodeURIComponent('nifty OR sensex OR "indian stock market" OR "RBI" OR "bank nifty"');
            
            const [headlinesResponse, everythingResponse] = await Promise.all([
                fetch(`https://newsapi.org/v2/top-headlines?country=in&category=business&apiKey=${apiKey}`),
                fetch(`https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&language=en&pageSize=40&apiKey=${apiKey}`)
            ]);
            
            // Check for rate limits (429) - apply 15 min cooldown, do NOT recurse
            if (headlinesResponse.status === 429 || everythingResponse.status === 429) {
                this.rateLimitedUntil = now + 15 * 60 * 1000;
                logger.warn('NewsService: 429 Rate limit hit. Backing off for 15 minutes.');
                return this.cachedArticles.length > 0 ? this.cachedArticles : this.getMockNews();
            }

            if (!headlinesResponse.ok && !everythingResponse.ok) {
                return this.cachedArticles.length > 0 ? this.cachedArticles : this.getMockNews();
            }

            const headlinesData = headlinesResponse.ok ? await headlinesResponse.json() : {};
            const everythingData = everythingResponse.ok ? await everythingResponse.json() : {};
            
            const articles: any[] = [];
            
            if (headlinesData.status === 'ok' && headlinesData.articles) {
                articles.push(...headlinesData.articles.map((a: any) => ({ ...a, category: 'BREAKING' })));
            }

            if (everythingData.status === 'ok' && everythingData.articles) {
                articles.push(...everythingData.articles.map((a: any) => ({ ...a, category: 'MARKET' })));
            }

            if (articles.length > 0) {
                // Deduplicate by title
                const seen = new Set();
                const unique = articles.filter(a => {
                    const title = a.title?.toLowerCase().trim();
                    if (!title || seen.has(title)) return false;
                    seen.add(title);
                    return true;
                });

                const mapped = unique.map((a: any, i: number) => ({
                    id: `news-${i}-${Date.now()}`,
                    title: a.title,
                    description: a.description || '',
                    source: a.source?.name || 'Unknown',
                    url: a.url,
                    publishedAt: a.publishedAt,
                    imageUrl: a.urlToImage,
                    category: a.category || 'MARKET',
                    sentiment: this.analyzeSentiment(a.title + ' ' + (a.description || ''))
                }));

                this.cachedArticles = mapped;
                this.cacheExpiresAt = Date.now() + 5 * 60 * 1000;
                return mapped;
            }
        } catch (error) {
            logger.error('NewsService: Failed to fetch news', error);
        }

        return this.getMockNews();
    }

    private analyzeSentiment(text: string): 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' {
        const positiveWords = ['agreement', 'bullish', 'rally', 'surge', 'growth', 'gain', 'buy', 'win', 'positive', 'breakthrough', 'deal', 'expansion'];
        const negativeWords = ['war', 'conflict', 'crash', 'drop', 'slump', 'bearish', 'sell', 'loss', 'negative', 'tension', 'failed', 'recession', 'hike'];
        
        const lowerText = text.toLowerCase();
        let score = 0;
        
        positiveWords.forEach(w => { if (lowerText.includes(w)) score++; });
        negativeWords.forEach(w => { if (lowerText.includes(w)) score--; });
        
        if (score > 0) return 'POSITIVE';
        if (score < 0) return 'NEGATIVE';
        return 'NEUTRAL';
    }

    async fetchUpstoxNews(symbols: string[]): Promise<NewsArticle[]> {
        if (!symbols || symbols.length === 0) {
            return [];
        }
        
        try {
            const symsParam = symbols.join(',');
            const response = await fetch(`/api/python-nse/api/upstox/news?symbols=${encodeURIComponent(symsParam)}`);
            if (!response.ok) {
                throw new Error(`Upstox news HTTP error: ${response.status}`);
            }
            
            const res = await response.json();
            if (res.status === 'success' && res.data) {
                const articles: NewsArticle[] = [];
                const data = res.data;
                
                if (typeof data === 'object' && !Array.isArray(data)) {
                    // It's a dictionary of symbol -> articles
                    Object.entries(data).forEach(([sym, items]) => {
                        if (Array.isArray(items)) {
                            items.forEach((art: any, i: number) => {
                                const title = art.title || art.heading || 'Market Update';
                                const description = art.description || art.summary || '';
                                articles.push({
                                    id: art.id || `upstox-${sym}-${art.published_time || Date.now()}-${i}`,
                                    title,
                                    description,
                                    source: 'Upstox News',
                                    url: art.article_link || '#',
                                    publishedAt: art.published_at || (art.published_time ? new Date(art.published_time).toISOString() : new Date().toISOString()),
                                    imageUrl: art.thumbnail || undefined,
                                    category: 'MARKET',
                                    sentiment: art.sentiment || this.analyzeSentiment(title + ' ' + description)
                                });
                            });
                        }
                    });
                } else if (Array.isArray(data)) {
                    data.forEach((art: any, i: number) => {
                        const title = art.title || art.heading || 'Market Update';
                        const description = art.description || art.summary || '';
                        articles.push({
                            id: art.id || `upstox-general-${art.published_time || Date.now()}-${i}`,
                            title,
                            description,
                            source: 'Upstox News',
                            url: art.article_link || '#',
                            publishedAt: art.published_at || (art.published_time ? new Date(art.published_time).toISOString() : new Date().toISOString()),
                            imageUrl: art.thumbnail || undefined,
                            category: 'MARKET',
                            sentiment: art.sentiment || this.analyzeSentiment(title + ' ' + description)
                        });
                    });
                }
                
                // Deduplicate by title
                const seen = new Set();
                const unique = articles.filter(a => {
                    const title = a.title?.toLowerCase().trim();
                    if (!title || seen.has(title)) return false;
                    seen.add(title);
                    return true;
                });
                
                // Sort by publishedAt desc
                return unique.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
            }
        } catch (error) {
            logger.error('NewsService: Failed to fetch Upstox news', error);
        }
        return [];
    }

    async fetchPortfolioNews(): Promise<NewsArticle[]> {
        try {
            // Get holdings tickers
            const { usePortfolioStore } = await import('../store/portfolioStore');
            const investments = usePortfolioStore.getState().investments || [];
            const holdingTickers = investments
                .filter(inv => inv.ticker)
                .map(inv => inv.ticker!.toUpperCase().trim());
                
            // Get positions tickers
            const { useDhanStore } = await import('../store/dhanStore');
            const positions = useDhanStore.getState().positions || [];
            const positionTickers = positions
                .filter(pos => pos.tradingSymbol)
                .map(pos => {
                    const cleanSymbol = pos.tradingSymbol.split('-')[0].toUpperCase().trim();
                    return cleanSymbol;
                });
                
            // Combine and unique
            const allTickers = Array.from(new Set([...holdingTickers, ...positionTickers])).filter(Boolean);
            
            if (allTickers.length === 0) {
                return [];
            }
            
            return await this.fetchUpstoxNews(allTickers);
        } catch (err) {
            logger.error('NewsService: Failed to fetch portfolio news', err);
            return [];
        }
    }

    private getMockNews(): NewsArticle[] {
        return [
            {
                id: 'mock-1',
                title: 'Sensex Hits Record High as Global Tensions Ease',
                description: 'The Indian benchmark indices opened at a fresh high today following positive cues from global markets and a potential trade agreement.',
                source: 'Wealth Pulse',
                url: '#',
                publishedAt: new Date().toISOString(),
                category: 'MARKET',
                sentiment: 'POSITIVE'
            },
            {
                id: 'mock-2',
                title: 'RBI Keeps Repo Rate Unchanged, Maintains Stance',
                description: 'The Reserve Bank of India Monetary Policy Committee has decided to keep the repo rate unchanged at 6.5% for the seventh consecutive time.',
                source: 'Wealth Pulse',
                url: '#',
                publishedAt: new Date(Date.now() - 3600000).toISOString(),
                category: 'CORPORATE',
                sentiment: 'NEUTRAL'
            },
            {
                id: 'mock-3',
                title: 'Crude Oil Prices Surge Amid Supply Concerns',
                description: 'Brent crude prices rose above $90 a barrel today as geopolitical tensions in the Middle East raised fears of a supply disruption.',
                source: 'Global Wire',
                url: '#',
                publishedAt: new Date(Date.now() - 7200000).toISOString(),
                category: 'GLOBAL',
                sentiment: 'NEGATIVE'
            }
        ];
    }
}

export const newsService = new NewsService();
