import { scoreIPOBreakdown } from './IPOWarRoomService';
import { fetchIPOCalendar } from './RealDataService';
import { useCapabilityStore } from '../store/capabilityStore';

export interface IPOListing {
    id: string;
    name: string;
    symbol?: string;
    issueOpenDate: string;
    issueCloseDate: string;
    allotmentDate?: string;
    refundDate?: string;
    listingDate?: string;
    priceRange: { min: number; max: number };
    lotSize: number;
    issueSize: number; // in Crores
    gmp?: number; // Grey Market Premium
    subscriptionData?: {
        qib: number; // times
        nii: number;
        retail: number;
        total: number;
    };
    status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';
    category: 'MAINBOARD' | 'SME';
    sector: string;
    registrar?: string;
    lotValue?: number;
    rating?: 'SUBSCRIBE' | 'AVOID' | 'NEUTRAL';
    score?: number;
    scoreFactors?: { label: string; impact: 'positive' | 'neutral' | 'negative'; points: number; rationale: string }[];
    timeline?: {
        pre_apply_start_date?: string;
        application_start_date?: string;
        application_end_date?: string;
        allotment_start_date?: string;
        allotment_date?: string;
        refund_initiation_date?: string;
        listing_date?: string;
        mandate_end_date?: string;
    };
}

export class IPOCalendarService {
    // Get all IPOs from institutional mirror
    async getAllIPOs(force?: boolean): Promise<IPOListing[]> {
        const cacheKey = 'alpha_cached_ipos';
        if (!force && typeof window !== 'undefined') {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed;
                    }
                } catch (e) {
                    console.warn('Failed to parse cached IPOs:', e);
                }
            }
        }

        // TIER 1: Try Upstox
        const cap = useCapabilityStore.getState().capabilities['ipo'];
        if (cap.state === 'available') {
            try {
                const statuses = ['upcoming', 'open', 'closed', 'listed'];
                const upstoxIPOsPromises = statuses.map(async (status) => {
                    try {
                        const response = await fetch(`/api/python-nse/api/upstox/ipos?status=${status}${force ? '&force=true' : ''}`);
                        if (response.ok) {
                            const json = await response.json();
                            return (json.data || []).map((ipo: any) => ({
                                ...ipo,
                                _upstoxStatus: status.toUpperCase()
                            }));
                        }
                        throw new Error(response.statusText || 'Response not ok');
                    } catch (e: any) {
                        console.warn(`Upstox IPO fetch failed for status ${status}:`, e);
                        useCapabilityStore.getState().setCapabilityState('ipo', 'unavailable', e.message || 'Fetch failed');
                    }
                    return [];
                });
                const results = await Promise.all(upstoxIPOsPromises);
                const combined = results.flat();

                if (combined && combined.length > 0) {
                    const mapped = combined.map((ipo: any) => {
                        const statusVal = ipo.status?.toUpperCase() || ipo._upstoxStatus || 'UPCOMING';
                        const minPrice = parseFloat(ipo.minimum_price || ipo.min_price || ipo.price_band?.min || ipo.priceRange?.min || 0);
                        const maxPrice = parseFloat(ipo.maximum_price || ipo.max_price || ipo.price_band?.max || ipo.priceRange?.max || 0);
                        const issueSize = parseFloat(ipo.issue_size || ipo.issue_size_crores || 0);
                        const isSme = ipo.category?.toUpperCase() === 'SME' || ipo.issue_type?.toUpperCase() === 'SME' || ipo.issueType?.toUpperCase() === 'SME';
                        return {
                            id: String(ipo.ipo_id || ipo.id),
                            name: ipo.company_name || ipo.name || 'Unknown IPO',
                            symbol: ipo.symbol,
                            issueOpenDate: ipo.bidding_start_date || ipo.start_date || ipo.issueOpenDate || '',
                            issueCloseDate: ipo.bidding_end_date || ipo.end_date || ipo.issueCloseDate || '',
                            allotmentDate: ipo.allotment_date || ipo.allotmentDate,
                            refundDate: ipo.refund_date || ipo.refundDate,
                            listingDate: ipo.listing_date || ipo.listingDate,
                            priceRange: { min: minPrice, max: maxPrice },
                            lotSize: parseInt(ipo.lot_size || ipo.lotSize) || 1,
                            issueSize: issueSize,
                            status: (statusVal === 'OPEN' ? 'OPEN' :
                                    statusVal === 'CLOSED' ? 'CLOSED' :
                                    statusVal === 'LISTED' ? 'LISTED' : 'UPCOMING') as 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED',
                            category: (isSme ? 'SME' : 'MAINBOARD') as 'SME' | 'MAINBOARD',
                            sector: ipo.industry || ipo.sector || ipo.sector_name || 'General'
                        };
                    });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem(cacheKey, JSON.stringify(mapped));
                    }
                    return mapped;
                }
            } catch (err) {
                console.warn('IPOCalendarService: Upstox fetch failed, falling back to mirror', err);
            }
        }

        // TIER 2: Fallback
        try {
            const live = await fetchIPOCalendar();
            if (live && live.length > 0) {
                const mapped = live.map((ipo: any, index: number) => ({
                    id: ipo.ipoId || `live-${index}`,
                    name: ipo.companyName || ipo.issueName,
                    symbol: ipo.shortCode,
                    issueOpenDate: ipo.startDate || '',
                    issueCloseDate: ipo.endDate || '',
                    allotmentDate: ipo.allotmentDate,
                    listingDate: ipo.listingDate,
                    priceRange: { 
                        min: parseFloat(ipo.minPrice) || 0, 
                        max: parseFloat(ipo.maxPrice) || 0 
                    },
                    lotSize: parseInt(ipo.lotSize) || 0,
                    issueSize: parseFloat(ipo.issueSize) || 0,
                    status: (ipo.ipoStatus?.toUpperCase() === 'OPEN' ? 'OPEN' : 
                            ipo.ipoStatus?.toUpperCase() === 'CLOSED' ? 'CLOSED' : 
                            ipo.ipoStatus?.toUpperCase() === 'LISTED' ? 'LISTED' : 'UPCOMING') as 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED',
                    category: (ipo.ipoType === 'SME' ? 'SME' : 'MAINBOARD') as 'SME' | 'MAINBOARD',
                    sector: ipo.sectorName || 'General',
                    rating: (ipo.rating === 'Subscribe' ? 'SUBSCRIBE' : 
                            ipo.rating === 'Avoid' ? 'AVOID' : 'NEUTRAL') as 'SUBSCRIBE' | 'AVOID' | 'NEUTRAL'
                }));
                if (typeof window !== 'undefined') {
                    localStorage.setItem(cacheKey, JSON.stringify(mapped));
                }
                return mapped;
            }
        } catch (err) {
            console.error('IPOCalendarService: Live Mirror failed', err);
        }

        // Final fallback to cache
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        return parsed;
                    }
                } catch (e) {}
            }
        }

        return [];
    }

    // Get detailed IPO info by ID
    async getIPODetails(ipoId: string, force?: boolean): Promise<any> {
        const cap = useCapabilityStore.getState().capabilities['ipo'];
        if (cap.state === 'available') {
            try {
                const response = await fetch(`/api/python-nse/api/upstox/ipos/${ipoId}${force ? '?force=true' : ''}`);
                if (response.ok) {
                    const json = await response.json();
                    return json.data || json;
                }
                throw new Error(response.statusText || 'Response not ok');
            } catch (e: any) {
                console.warn(`Upstox IPO details fetch failed for ${ipoId}:`, e);
            }
        }
        return null;
    }

    // Get upcoming IPOs
    async getUpcomingIPOs(): Promise<IPOListing[]> {
        const all = await this.getAllIPOs();
        return all.filter(ipo => ipo.status === 'UPCOMING');
    }

    // Get currently open IPOs
    async getOpenIPOs(): Promise<IPOListing[]> {
        const all = await this.getAllIPOs();
        return all.filter(ipo => ipo.status === 'OPEN');
    }

    // Get IPOs by status
    async getIPOsByStatus(status: IPOListing['status']): Promise<IPOListing[]> {
        const all = await this.getAllIPOs();
        return all.filter(ipo => ipo.status === status);
    }

    // Calculate lot value
    calculateLotValue(ipo: IPOListing): number {
        return ipo.lotSize * ipo.priceRange.max;
    }

    // Calculate expected listing gain
    calculateExpectedGain(ipo: IPOListing): { amount: number; percentage: number } {
        if (!ipo.gmp) return { amount: 0, percentage: 0 };
        const lotValue = this.calculateLotValue(ipo);
        const gainAmount = ipo.gmp * ipo.lotSize;
        const gainPercentage = (ipo.gmp / ipo.priceRange.max) * 100;
        return { amount: gainAmount, percentage: gainPercentage };
    }

    scoreIPO(ipo: IPOListing): number {
        return scoreIPOBreakdown(ipo).score;
    }

    withDerivedFields(ipo: IPOListing): IPOListing {
        const scoreBreakdown = scoreIPOBreakdown(ipo);
        return {
            ...ipo,
            lotValue: ipo.lotValue || this.calculateLotValue(ipo),
            score: scoreBreakdown.score,
            scoreFactors: scoreBreakdown.factors,
        };
    }

    // Get IPO status badge color
    getStatusColor(status: IPOListing['status']): string {
        switch (status) {
            case 'UPCOMING': return '#6366f1';
            case 'OPEN': return '#10b981';
            case 'CLOSED': return '#f59e0b';
            case 'LISTED': return '#64748b';
            default: return '#64748b';
        }
    }

    // Get rating color
    getRatingColor(rating?: IPOListing['rating']): string {
        switch (rating) {
            case 'SUBSCRIBE': return '#10b981';
            case 'AVOID': return '#ef4444';
            case 'NEUTRAL': return '#f59e0b';
            default: return '#64748b';
        }
    }

    // Calculate days until open/close
    getDaysUntil(dateStr: string): number {
        if (!dateStr) return 0;
        const target = new Date(dateStr);
        const today = new Date();
        const diff = target.getTime() - today.getTime();
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }
}

export const ipoCalendarService = new IPOCalendarService();
export default IPOCalendarService;
