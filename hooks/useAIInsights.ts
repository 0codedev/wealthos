import { useState, useEffect, useCallback, useRef } from 'react';
import { AmbientAIBrain, TabAIResult, TabName } from '../services/AmbientAIBrain';
import { Investment } from '../types';

interface UseAIInsightsReturn {
    insights: TabAIResult['insights'];
    coachMessage: string;
    tradeSignal: TabAIResult['tradeSignal'];
    tradeSignalReason: string | undefined;
    isLoading: boolean;
    lastUpdated: number;
    model: string | undefined;
    refresh: () => void;
}

export function useAIInsights(
    tab: TabName,
    investments: Investment[],
    totalNetWorth: string,
    enabled: boolean = true
): UseAIInsightsReturn {
    const [result, setResult] = useState<TabAIResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const isMounted = useRef(true);

    // Create a stable reference for investments to prevent infinite loops from array recreation
    const investmentsRef = useRef(investments);
    const prevInvestmentsStr = useRef('');
    
    const currentInvestmentsStr = JSON.stringify(investments || []);
    if (prevInvestmentsStr.current !== currentInvestmentsStr) {
        investmentsRef.current = investments;
        prevInvestmentsStr.current = currentInvestmentsStr;
    }
    const stableInvestments = investmentsRef.current;

    const fetch = useCallback(() => {
        if (!enabled) return;
        setIsLoading(true);

        // Check if we already have a fresh cached result
        const cached = AmbientAIBrain.getCached(tab);
        if (cached) {
            setResult(cached);
            setIsLoading(false);
            return;
        }

        AmbientAIBrain.getInsights(tab, stableInvestments, totalNetWorth, (fresh) => {
            if (isMounted.current) {
                setResult(fresh);
                setIsLoading(false);
            }
        }).then((initial) => {
            if (isMounted.current && initial.fetchedAt > 0) {
                setResult(initial);
                setIsLoading(false);
            }
        });
    }, [tab, stableInvestments, totalNetWorth, enabled]);

    useEffect(() => {
        isMounted.current = true;
        fetch();
        return () => { isMounted.current = false; };
    }, [fetch]);

    const refresh = useCallback(() => {
        AmbientAIBrain.invalidateTab(tab);
        fetch();
    }, [tab, fetch]);

    return {
        insights: result?.insights || [],
        coachMessage: result?.coachMessage || '',
        tradeSignal: result?.tradeSignal,
        tradeSignalReason: result?.tradeSignalReason,
        isLoading: isLoading && !result,
        lastUpdated: result?.fetchedAt || 0,
        model: result?.model,
        refresh,
    };
}
