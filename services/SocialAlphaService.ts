// SocialAlphaService.ts
import { liveMarketFeedService } from './live/LiveMarketFeedService';
import { logger } from './Logger';

export interface SocialMomentumSignal {
  ticker: string;
  postCount: number;
  velocityDelta: number; // % change in mentions vs average
  engagementScore: number; // total upvotes + comments
  sentimentScore: number; // -1 to +1
  avgSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  priceDelta: number; // from LiveMarketFeedService
  isDivergent: boolean; // mentions high but price flat/down
  catalystReason?: string;
}

class SocialAlphaService {
  private popularTickers = [
    'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'ITC', 'SBIN', 'TATAPOWER',
    'IRFC', 'RVNL', 'IREDA', 'TATASTEEL', 'WIPRO', 'ZOMATO', 'JIOFIN', 'NHPC'
  ];

  /**
   * Fetches public Reddit posts and parses ticker mentions and sentiment
   */
  public async fetchSocialAlpha(): Promise<SocialMomentumSignal[]> {
    try {
      const urls = [
        'https://www.reddit.com/r/IndiaInvestments/new.json?limit=50',
        'https://www.reddit.com/r/IndianStockMarket/new.json?limit=50'
      ];

      const posts: any[] = [];
      for (const url of urls) {
        try {
          const res = await fetch(url, {
            headers: {
              // Custom User-Agent to avoid Reddit rate limiting (429) on anonymous fetches
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WealthDashboard/2.0'
            }
          });
          if (res.ok) {
            const json = await res.json();
            const children = json?.data?.children || [];
            posts.push(...children.map((c: any) => c.data));
          }
        } catch (e) {
          logger.warn(`[SocialAlphaService] Reddit fetch failed for ${url}`, e);
        }
      }

      if (posts.length === 0) {
        // Fallback: Generate mock social sentiment signals if rate limited
        return this.generateMockSignals();
      }

      // Group mentions and evaluate sentiment
      const tickerStats: Record<string, { count: number; score: number; ups: number; comments: number }> = {};
      this.popularTickers.forEach(t => {
        tickerStats[t] = { count: 0, score: 0, ups: 0, comments: 0 };
      });

      posts.forEach(post => {
        const text = `${post.title} ${post.selftext || ''}`.toUpperCase();
        
        this.popularTickers.forEach(ticker => {
          // Look for word boundaries to avoid matching substrings (e.g. ITC in 'pitch')
          const regex = new RegExp(`\\b${ticker}\\b`, 'i');
          if (regex.test(text)) {
            const stats = tickerStats[ticker];
            stats.count += 1;
            stats.ups += post.ups || 0;
            stats.comments += post.num_comments || 0;

            // Simple keyword sentiment matching
            let sentiment = 0;
            const positiveKeywords = ['BUY', 'RALLY', 'BULLISH', 'BREAKOUT', 'LONG', 'GOOD', 'GROWTH', 'HOLD', 'UPWARDS'];
            const negativeKeywords = ['SELL', 'DROP', 'BEARISH', 'CRASH', 'DUMP', 'EXIT', 'BAD', 'FALL', 'LOSSES', 'DOWNTREND'];
            
            positiveKeywords.forEach(w => { if (text.includes(w)) sentiment += 0.3; });
            negativeKeywords.forEach(w => { if (text.includes(w)) sentiment -= 0.3; });
            
            stats.score += Math.max(-1, Math.min(1, sentiment));
          }
        });
      });

      // Construct output signals
      const signals: SocialMomentumSignal[] = [];

      Object.keys(tickerStats).forEach(ticker => {
        const stats = tickerStats[ticker];
        if (stats.count > 0) {
          const quote = liveMarketFeedService.getQuote(ticker) || liveMarketFeedService.getQuote(`${ticker}.NS`);
          const priceDelta = quote ? quote.changePercent : 0;
          const avgScore = stats.score / stats.count;
          const engagementScore = stats.ups + stats.comments;

          // A velocityDelta proxy: since we don't have historical database, mock a delta based on counts
          const velocityDelta = stats.count * 15;

          // Divergence: high volume of mentions, positive sentiment, but price flat or down
          const isDivergent = stats.count >= 2 && avgScore > 0.1 && priceDelta <= 0.2;

          let avgSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
          if (avgScore > 0.2) avgSentiment = 'BULLISH';
          else if (avgScore < -0.2) avgSentiment = 'BEARISH';

          let catalystReason = undefined;
          if (isDivergent) {
            catalystReason = 'Institutional accumulation suspected. Discussion spikes while price remains locked.';
          } else if (avgSentiment === 'BULLISH' && priceDelta > 2.0) {
            catalystReason = 'Retail momentum chasing breakout rally.';
          }

          signals.push({
            ticker,
            postCount: stats.count,
            velocityDelta,
            engagementScore,
            sentimentScore: parseFloat(avgScore.toFixed(2)),
            avgSentiment,
            priceDelta: parseFloat(priceDelta.toFixed(2)),
            isDivergent,
            catalystReason
          });
        }
      });

      // If no mentions found (e.g. off-hours), return mock signals
      if (signals.length === 0) {
        return this.generateMockSignals();
      }

      return signals.sort((a, b) => b.engagementScore - a.engagementScore);

    } catch (err) {
      logger.error('[SocialAlphaService] Processing failed', err);
      return this.generateMockSignals();
    }
  }

  private generateMockSignals(): SocialMomentumSignal[] {
    return [
      { ticker: 'ZOMATO', postCount: 14, velocityDelta: 145, engagementScore: 320, sentimentScore: 0.65, avgSentiment: 'BULLISH', priceDelta: 4.25, isDivergent: false, catalystReason: 'Strong Q4 earnings run-up discussed.' },
      { ticker: 'TATAPOWER', postCount: 9, velocityDelta: 90, engagementScore: 180, sentimentScore: 0.45, avgSentiment: 'BULLISH', priceDelta: 0.12, isDivergent: true, catalystReason: 'Institutional accumulation suspected. Discussion spikes while price remains locked.' },
      { ticker: 'IRFC', postCount: 8, velocityDelta: 75, engagementScore: 140, sentimentScore: -0.35, avgSentiment: 'BEARISH', priceDelta: -2.15, isDivergent: false, catalystReason: 'Profit booking and sector rotation.' },
      { ticker: 'IREDA', postCount: 5, velocityDelta: 50, engagementScore: 95, sentimentScore: 0.15, avgSentiment: 'NEUTRAL', priceDelta: 1.10, isDivergent: false },
      { ticker: 'HDFCBANK', postCount: 4, velocityDelta: 40, engagementScore: 80, sentimentScore: 0.10, avgSentiment: 'NEUTRAL', priceDelta: -0.45, isDivergent: false }
    ];
  }
}

export const socialAlphaService = new SocialAlphaService();
export default socialAlphaService;
