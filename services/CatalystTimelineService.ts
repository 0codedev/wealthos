import { NewsArticle } from './NewsService';

export type CatalystCategory = 'earnings' | 'corporate_action' | 'regulation' | 'sector' | 'macro' | 'management' | 'rumor' | 'general';

export interface CatalystItem extends NewsArticle {
  catalystCategory: CatalystCategory;
  sentimentRating: 'bullish' | 'bearish' | 'neutral';
}

export class CatalystTimelineService {
  /**
   * Categorizes a flat list of NewsArticles into CatalystItems and sorts them by publishedAt desc.
   */
  static categorizeNews(articles: NewsArticle[]): CatalystItem[] {
    if (!articles) return [];

    return articles
      .map(article => {
        const titleAndDesc = `${article.title} ${article.description}`.toLowerCase();
        
        let category: CatalystCategory = 'general';

        if (
          titleAndDesc.includes('earnings') ||
          titleAndDesc.includes('net profit') ||
          titleAndDesc.includes('profit rises') ||
          titleAndDesc.includes('profit falls') ||
          titleAndDesc.includes('revenue') ||
          titleAndDesc.includes('ebitda') ||
          titleAndDesc.includes('quarterly') ||
          titleAndDesc.includes('financial results') ||
          /\bq[1-4]\b/.test(titleAndDesc) ||
          titleAndDesc.includes('eps')
        ) {
          category = 'earnings';
        } else if (
          titleAndDesc.includes('dividend') ||
          titleAndDesc.includes('bonus') ||
          titleAndDesc.includes('split') ||
          titleAndDesc.includes('merger') ||
          titleAndDesc.includes('acquisition') ||
          titleAndDesc.includes('buyback') ||
          titleAndDesc.includes('corporate action') ||
          titleAndDesc.includes('board meeting') ||
          titleAndDesc.includes('ex-date') ||
          titleAndDesc.includes('amalgamation')
        ) {
          category = 'corporate_action';
        } else if (
          titleAndDesc.includes('sebi') ||
          titleAndDesc.includes('rbi') ||
          titleAndDesc.includes('regulation') ||
          titleAndDesc.includes('compliance') ||
          titleAndDesc.includes('penalty') ||
          titleAndDesc.includes('fine') ||
          titleAndDesc.includes('lawsuit') ||
          titleAndDesc.includes('court') ||
          titleAndDesc.includes('gst') ||
          titleAndDesc.includes('tax')
        ) {
          category = 'regulation';
        } else if (
          titleAndDesc.includes('ceo') ||
          titleAndDesc.includes('cfo') ||
          titleAndDesc.includes('resign') ||
          titleAndDesc.includes('appoint') ||
          titleAndDesc.includes('management') ||
          titleAndDesc.includes('board of directors') ||
          titleAndDesc.includes('promoter') ||
          titleAndDesc.includes('insider') ||
          titleAndDesc.includes('shares pledge')
        ) {
          category = 'management';
        } else if (
          titleAndDesc.includes('rumor') ||
          titleAndDesc.includes('speculation') ||
          titleAndDesc.includes('sources say') ||
          titleAndDesc.includes('likely to') ||
          titleAndDesc.includes('may buy') ||
          titleAndDesc.includes('potential deal') ||
          titleAndDesc.includes('talks')
        ) {
          category = 'rumor';
        } else if (
          titleAndDesc.includes('inflation') ||
          titleAndDesc.includes('gdp') ||
          titleAndDesc.includes('interest rate') ||
          titleAndDesc.includes('fed') ||
          titleAndDesc.includes('fomc') ||
          titleAndDesc.includes('macro') ||
          titleAndDesc.includes('crude') ||
          titleAndDesc.includes('oil') ||
          titleAndDesc.includes('currency') ||
          titleAndDesc.includes('rupee') ||
          titleAndDesc.includes('economy')
        ) {
          category = 'macro';
        } else if (
          titleAndDesc.includes('sector') ||
          titleAndDesc.includes('industry') ||
          titleAndDesc.includes('peer') ||
          titleAndDesc.includes('competitor') ||
          titleAndDesc.includes('demand') ||
          titleAndDesc.includes('supply')
        ) {
          category = 'sector';
        }

        // Map POSITIVE/NEGATIVE/NEUTRAL to lowercase bullish/bearish/neutral
        let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        if (article.sentiment === 'POSITIVE') sentiment = 'bullish';
        else if (article.sentiment === 'NEGATIVE') sentiment = 'bearish';

        return {
          ...article,
          catalystCategory: category,
          sentimentRating: sentiment
        };
      })
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }
}
