
export type CalendarCategory = 'holiday' | 'fno_expiry' | 'rbi' | 'earnings_season';
export type CalendarImportance = 'high' | 'medium' | 'low';

export interface CalendarEvent {
    date: Date;
    title: string;
    category: CalendarCategory;
    importance: CalendarImportance;
}

export interface NSEHoliday {
    date: string;
    name: string;
    type: 'trading_holiday' | 'settlement_holiday';
}

const NSE_HOLIDAYS_2025: NSEHoliday[] = [
    { date: '2025-01-26', name: 'Republic Day', type: 'trading_holiday' },
    { date: '2025-02-26', name: 'Mahashivratri', type: 'trading_holiday' },
    { date: '2025-03-14', name: 'Holi', type: 'trading_holiday' },
    { date: '2025-03-31', name: 'Id-ul-Fitr (Ramzan Id)', type: 'trading_holiday' },
    { date: '2025-04-10', name: 'Mahavir Jayanti', type: 'trading_holiday' },
    { date: '2025-04-14', name: 'Dr. Baba Saheb Ambedkar Jayanti', type: 'trading_holiday' },
    { date: '2025-04-18', name: 'Good Friday', type: 'trading_holiday' },
    { date: '2025-05-01', name: 'Maharashtra Day', type: 'trading_holiday' },
    { date: '2025-08-15', name: 'Independence Day', type: 'trading_holiday' },
    { date: '2025-08-27', name: 'Ganesh Chaturthi', type: 'trading_holiday' },
    { date: '2025-10-02', name: 'Mahatma Gandhi Jayanti', type: 'trading_holiday' },
    { date: '2025-10-21', name: 'Diwali-Laxmi Pujan', type: 'trading_holiday' },
    { date: '2025-10-22', name: 'Diwali-Balipratipada', type: 'trading_holiday' },
    { date: '2025-11-05', name: 'Gurunanak Jayanti', type: 'trading_holiday' },
    { date: '2025-12-25', name: 'Christmas', type: 'trading_holiday' }
];

const NSE_HOLIDAYS_2026: NSEHoliday[] = [
    { date: '2026-01-26', name: 'Republic Day', type: 'trading_holiday' },
    { date: '2026-03-06', name: 'Holi', type: 'trading_holiday' },
    { date: '2026-03-20', name: 'Id-ul-Fitr (Ramzan Id)', type: 'trading_holiday' },
    { date: '2026-04-02', name: 'Good Friday', type: 'trading_holiday' },
    { date: '2026-04-14', name: 'Dr. Baba Saheb Ambedkar Jayanti', type: 'trading_holiday' },
    { date: '2026-05-01', name: 'Maharashtra Day', type: 'trading_holiday' },
    { date: '2026-08-15', name: 'Independence Day', type: 'trading_holiday' },
    { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti', type: 'trading_holiday' },
    { date: '2026-10-21', name: 'Dussehra', type: 'trading_holiday' },
    { date: '2026-11-08', name: 'Diwali-Laxmi Pujan', type: 'trading_holiday' },
    { date: '2026-12-25', name: 'Christmas', type: 'trading_holiday' }
];

const RBI_POLICY_DATES: { date: string, description: string }[] = [
    { date: '2025-02-05', description: 'RBI MPC Meeting' },
    { date: '2025-04-03', description: 'RBI MPC Meeting' },
    { date: '2025-06-04', description: 'RBI MPC Meeting' },
    { date: '2025-08-06', description: 'RBI MPC Meeting' },
    { date: '2025-10-06', description: 'RBI MPC Meeting' },
    { date: '2025-12-03', description: 'RBI MPC Meeting' },
    { date: '2026-02-04', description: 'RBI MPC Meeting' }
];

export class IndianFinancialCalendarService {
    private static instance: IndianFinancialCalendarService;

    private constructor() {}

    public static getInstance(): IndianFinancialCalendarService {
        if (!IndianFinancialCalendarService.instance) {
            IndianFinancialCalendarService.instance = new IndianFinancialCalendarService();
        }
        return IndianFinancialCalendarService.instance;
    }

    public getNSEHolidays(year: number): NSEHoliday[] {
        if (year === 2025) return NSE_HOLIDAYS_2025;
        if (year === 2026) return NSE_HOLIDAYS_2026;
        return [];
    }

    public getFnOExpiryDates(year: number, month: number): { weekly: Date[], monthly: Date } {
        const weekly: Date[] = [];
        let monthly: Date | null = null;

        // Start from the first day of the month
        const date = new Date(year, month, 1);
        const holidays = this.getNSEHolidays(year).map(h => h.date);

        while (date.getMonth() === month) {
            if (date.getDay() === 4) { // Thursday
                let expiryDate = new Date(date);
                // If holiday, move to previous day
                while (holidays.includes(expiryDate.toISOString().split('T')[0])) {
                    expiryDate.setDate(expiryDate.getDate() - 1);
                }
                weekly.push(expiryDate);
            }
            date.setDate(date.getDate() + 1);
        }

        monthly = weekly[weekly.length - 1];
        return { weekly, monthly };
    }

    public getRBIPolicyDates(year: number): { date: string, description: string }[] {
        return RBI_POLICY_DATES.filter(d => d.date.startsWith(year.toString()));
    }

    public getEarningsSeasonDates() {
        return {
            q1: { start: '04-01', end: '05-31' }, // Results for Q4 (FY ending March)
            q2: { start: '07-01', end: '08-31' }, // Results for Q1
            q3: { start: '10-01', end: '11-30' }, // Results for Q2
            q4: { start: '01-01', end: '02-28' }  // Results for Q3
        };
    }

    public getUpcomingEvents(daysAhead: number): CalendarEvent[] {
        const events: CalendarEvent[] = [];
        const now = new Date();
        const endRange = new Date();
        endRange.setDate(now.getDate() + daysAhead);

        const years = [now.getFullYear(), endRange.getFullYear()];
        const uniqueYears = [...new Set(years)];

        uniqueYears.forEach(year => {
            // Holidays
            this.getNSEHolidays(year).forEach(h => {
                const d = new Date(h.date);
                if (d >= now && d <= endRange) {
                    events.push({ date: d, title: h.name, category: 'holiday', importance: 'high' });
                }
            });

            // RBI
            this.getRBIPolicyDates(year).forEach(r => {
                const d = new Date(r.date);
                if (d >= now && d <= endRange) {
                    events.push({ date: d, title: r.description, category: 'rbi', importance: 'high' });
                }
            });

            // FnO Expiry (for each month in range)
            for (let m = 0; m < 12; m++) {
                const { weekly, monthly } = this.getFnOExpiryDates(year, m);
                weekly.forEach(d => {
                    if (d >= now && d <= endRange) {
                        const isMonthly = d.getTime() === monthly.getTime();
                        events.push({ 
                            date: d, 
                            title: `FnO ${isMonthly ? 'Monthly' : 'Weekly'} Expiry`, 
                            category: 'fno_expiry', 
                            importance: isMonthly ? 'high' : 'medium' 
                        });
                    }
                });
            }
        });

        return events.sort((a, b) => a.date.getTime() - b.date.getTime());
    }

    public isMarketOpen(datetime: Date = new Date()): boolean {
        // Mon-Fri
        const day = datetime.getDay();
        if (day === 0 || day === 6) return false;

        // Holiday Check (IST)
        const dateStr = datetime.toISOString().split('T')[0];
        const holidays = this.getNSEHolidays(datetime.getFullYear()).map(h => h.date);
        if (holidays.includes(dateStr)) return false;

        // Hours Check (9:15 AM - 3:30 PM IST)
        // Note: Simplified assuming server/client time is reasonably aligned or handled via UTC offsets
        // In a real app, you'd use a library like date-fns-tz to lock this to Asia/Kolkata
        const hours = datetime.getHours();
        const minutes = datetime.getMinutes();
        const currentTimeInMinutes = hours * 60 + minutes;
        
        const openTime = 9 * 60 + 15;
        const closeTime = 15 * 60 + 30;

        return currentTimeInMinutes >= openTime && currentTimeInMinutes <= closeTime;
    }

    public getDaysToNextExpiry(): { days: number, date: Date, type: 'weekly' | 'monthly' } {
        const now = new Date();
        const upcoming = this.getUpcomingEvents(31).filter(e => e.category === 'fno_expiry');
        
        if (upcoming.length === 0) {
            // Fallback for edge cases
            return { days: 0, date: now, type: 'weekly' };
        }

        const next = upcoming[0];
        const diffTime = next.date.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return {
            days: diffDays,
            date: next.date,
            type: next.title.includes('Monthly') ? 'monthly' : 'weekly'
        };
    }
}

export const indianFinancialCalendarService = IndianFinancialCalendarService.getInstance();
