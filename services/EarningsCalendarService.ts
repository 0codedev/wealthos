// EarningsCalendarService.ts
export interface EarningsEvent {
  ticker: string;
  name: string;
  earningsDate: string; // YYYY-MM-DD
  daysToEarnings: number;
  marketCap: 'MEGA' | 'LARGE' | 'MID';
  sector: string;
  expectedEPS?: number;
  expectedRevenue?: string;
}

class EarningsCalendarService {
  // Mock upcoming earnings dates for FY26 Q1 / Q2
  private mockEvents: Omit<EarningsEvent, 'daysToEarnings'>[] = [
    { ticker: 'RELIANCE', name: 'Reliance Industries Ltd.', earningsDate: '', marketCap: 'MEGA', sector: 'Energy & Oil', expectedEPS: 19.8, expectedRevenue: '₹2.3L Cr' },
    { ticker: 'TCS', name: 'Tata Consultancy Services', earningsDate: '', marketCap: 'MEGA', sector: 'IT Services', expectedEPS: 34.5, expectedRevenue: '₹62.5K Cr' },
    { ticker: 'HDFCBANK', name: 'HDFC Bank Ltd.', earningsDate: '', marketCap: 'MEGA', sector: 'Financial Services', expectedEPS: 23.1, expectedRevenue: '₹78.2K Cr' },
    { ticker: 'INFY', name: 'Infosys Ltd.', earningsDate: '', marketCap: 'MEGA', sector: 'IT Services', expectedEPS: 16.2, expectedRevenue: '₹41.8K Cr' },
    { ticker: 'ICICIBANK', name: 'ICICI Bank Ltd.', earningsDate: '', marketCap: 'LARGE', sector: 'Financial Services', expectedEPS: 18.5, expectedRevenue: '₹43.1K Cr' },
    { ticker: 'ITC', name: 'ITC Ltd.', earningsDate: '', marketCap: 'LARGE', sector: 'Consumer Goods', expectedEPS: 4.8, expectedRevenue: '₹18.9K Cr' },
    { ticker: 'BHARTIARTL', name: 'Bharti Airtel Ltd.', earningsDate: '', marketCap: 'LARGE', sector: 'Telecom', expectedEPS: 9.2, expectedRevenue: '₹38.5K Cr' },
    { ticker: 'LTIM', name: 'LTIMindtree Ltd.', earningsDate: '', marketCap: 'LARGE', sector: 'IT Services', expectedEPS: 52.4, expectedRevenue: '₹9.4K Cr' },
    { ticker: 'HINDUNILVR', name: 'Hindustan Unilever Ltd.', earningsDate: '', marketCap: 'LARGE', sector: 'FMCG', expectedEPS: 11.2, expectedRevenue: '₹15.8K Cr' },
    { ticker: 'SBIN', name: 'State Bank of India', earningsDate: '', marketCap: 'LARGE', sector: 'Financial Services', expectedEPS: 17.1, expectedRevenue: '₹1.1L Cr' }
  ];

  constructor() {
    this.generateDynamicDates();
  }

  // Generates realistic forward dates relative to today so they always look upcoming
  private generateDynamicDates() {
    const today = new Date();
    // Offset each event by a realistic number of days (2 to 20 days out)
    const offsets = [3, 5, 7, 9, 11, 14, 15, 17, 19, 21];
    this.mockEvents.forEach((event, idx) => {
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + (offsets[idx % offsets.length]));
      event.earningsDate = futureDate.toISOString().split('T')[0];
    });
  }

  public getUpcomingEvents(): EarningsEvent[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.mockEvents.map(event => {
      const eDate = new Date(event.earningsDate);
      eDate.setHours(0, 0, 0, 0);
      const diffTime = eDate.getTime() - today.getTime();
      const daysToEarnings = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

      return {
        ...event,
        daysToEarnings
      };
    }).sort((a, b) => a.daysToEarnings - b.daysToEarnings);
  }
}

export const earningsCalendarService = new EarningsCalendarService();
export default earningsCalendarService;
