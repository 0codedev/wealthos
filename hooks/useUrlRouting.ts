/**
 * Zero-dependency URL Path Routing & Deep Linking Hook
 * Synchronizes React state (category, subTab) with window.location.pathname.
 * Supports direct URL loading, bookmarking, and Browser Back/Forward navigation.
 */

import { useEffect } from 'react';

export interface RouteTarget {
    category: string;
    subTab: string;
    title: string;
}

// 1. Path slug -> { category, subTab, title }
const PATH_TO_ROUTE_MAP: Record<string, RouteTarget> = {
    '': { category: 'dashboard', subTab: 'dashboard', title: 'Dashboard' },
    'dashboard': { category: 'dashboard', subTab: 'dashboard', title: 'Dashboard' },
    
    // Portfolio
    'portfolio': { category: 'portfolio', subTab: 'portfolio', title: 'Portfolio Hub' },
    'goal-gps': { category: 'portfolio', subTab: 'gps', title: 'Goal GPS' },
    'gps': { category: 'portfolio', subTab: 'gps', title: 'Goal GPS' },
    'compliance': { category: 'portfolio', subTab: 'compliance', title: 'Compliance Shield' },
    'retirement': { category: 'portfolio', subTab: 'retirement', title: 'Retirement & FIRE' },
    'legacy': { category: 'portfolio', subTab: 'legacy', title: 'Legacy Vault' },
    'legacy-vault': { category: 'portfolio', subTab: 'legacy', title: 'Legacy Vault' },

    // Alpha Engine / Autopilot
    'alpha': { category: 'alpha', subTab: 'intraday', title: 'Alpha Engine' },
    'alpha-engine': { category: 'alpha', subTab: 'intraday', title: 'Alpha Engine' },
    'autopilot': { category: 'alpha', subTab: 'intraday', title: 'Alpha Autopilot' },
    'screener': { category: 'alpha', subTab: 'screener', title: 'Shadow Screener' },
    'heatmap': { category: 'alpha', subTab: 'heatmap', title: 'Market Heatmap' },
    'market-command': { category: 'alpha', subTab: 'market-command', title: 'Market Command' },
    'greeks': { category: 'alpha', subTab: 'greeks', title: 'Options Greeks' },
    'options-greeks': { category: 'alpha', subTab: 'greeks', title: 'Options Greeks' },

    // Telegram Intel & Ears
    'telegram': { category: 'telegram', subTab: 'telegram', title: 'Telegram Intel Hub' },
    'telegram-intel': { category: 'telegram', subTab: 'telegram', title: 'Telegram Intel Hub' },
    'ear': { category: 'telegram', subTab: 'telegram', title: 'Telegram Ear Monitor' },
    'ears': { category: 'telegram', subTab: 'telegram', title: 'Telegram Ear Monitor' },

    // IPO War Room & Syndicate
    'ipo': { category: 'ipo', subTab: 'ipo', title: 'IPO War Room' },
    'syndicate': { category: 'ipo', subTab: 'ipo', title: 'IPO Syndicate Tracker' },

    // Market Intel
    'market': { category: 'market', subTab: 'macro', title: 'Market Intel' },
    'macro': { category: 'market', subTab: 'macro', title: 'Macro Pulse' },
    'research': { category: 'market', subTab: 'research', title: 'Stock Research' },
    'option-chain': { category: 'market', subTab: 'intel', title: 'Option Chain Intel' },
    'crypto': { category: 'market', subTab: 'crypto-markets', title: 'Crypto & Predictions' },

    // Strategy Lab & Backtester
    'backtest': { category: 'backtester', subTab: 'backtester', title: 'Apex Backtester' },
    'backtester': { category: 'backtester', subTab: 'backtester', title: 'Apex Backtester' },
    'strategy-lab': { category: 'backtester', subTab: 'backtester', title: 'Strategy Lab' },
    'vectorbt': { category: 'backtester', subTab: 'vectorbt-lab', title: 'VectorBT Lab' },
    'backtrader': { category: 'backtester', subTab: 'backtrader-lab', title: 'Backtrader Sim' },
    'lumibot': { category: 'backtester', subTab: 'lumibot-lab', title: 'Lumibot Engine' },
    'simulators': { category: 'backtester', subTab: 'simulators', title: 'Legacy Lab' },
    'paper-trading': { category: 'backtester', subTab: 'paper', title: 'Algo Desk' },

    // Journal
    'journal': { category: 'journal', subTab: 'calendar', title: 'Trading Journal' },
    'mistakes': { category: 'journal', subTab: 'mistakes', title: 'Trading Mistakes' },
    'reports': { category: 'journal', subTab: 'reports', title: 'Journal Reports' },
    'playbook': { category: 'journal', subTab: 'playbook', title: 'Trade Playbook' },

    // Analytics & Quant
    'quant': { category: 'analytics', subTab: 'quant', title: 'Deep Quant Terminal' },
    'mathlab': { category: 'analytics', subTab: 'mathlab', title: 'Math Lab' },
    'oracle': { category: 'analytics', subTab: 'oracle', title: 'Predictive Oracle' },

    // Growth Engine
    'advisor': { category: 'growth', subTab: 'advisor', title: 'AI Advisor' },
    'predator': { category: 'growth', subTab: 'predator', title: 'Predator Engine' },
    'academy': { category: 'growth', subTab: 'academy', title: 'Financial Academy' },
    'mastery': { category: 'growth', subTab: 'mastery', title: 'Mastery Hub' },

    // Other Centers
    'tradefinder': { category: 'tradefinder', subTab: 'tradefinder', title: 'TradeFinder' },
    'signals': { category: 'signals', subTab: 'signals', title: 'Signal Intelligence' },
    'launchpad': { category: 'launchpad', subTab: 'launchpad', title: 'Launchpad' },
    'fortress': { category: 'fortress', subTab: 'dashboard', title: 'The Fortress' },
    'pool': { category: 'pool', subTab: 'watchlist', title: 'Momentum Pool' },
    'tools': { category: 'tools', subTab: 'sector-analytics', title: 'Advanced Tools' },
    'settings': { category: 'settings', subTab: 'settings', title: 'Settings & API Doctor' },

    // Innovation & Moonshot Lab
    'innovation': { category: 'innovation', subTab: 'boardroom', title: 'Moonshot Lab' },
    'moonshot': { category: 'innovation', subTab: 'boardroom', title: 'Moonshot Lab' },
    'boardroom': { category: 'innovation', subTab: 'boardroom', title: 'Strategic Council' },

    // Specialist Desks
    'vibe-trading': { category: 'vibe-trading', subTab: 'vibe-trading', title: 'Vibe-Trading AI' },
    'algo-bots': { category: 'algo-bots', subTab: 'algo-bots', title: 'Algo Bots' },
    'ai-research': { category: 'ai-research', subTab: 'ai-research', title: 'AI Research Lab' }
};

// 2. Resolve initial tab from current browser URL
export function getInitialRouteFromUrl(): RouteTarget {
    if (typeof window === 'undefined') {
        return { category: 'dashboard', subTab: 'dashboard', title: 'Dashboard' };
    }
    const rawPath = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    const route = PATH_TO_ROUTE_MAP[rawPath];
    if (route) {
        return route;
    }
    // Check if path matches any category directly
    for (const [key, val] of Object.entries(PATH_TO_ROUTE_MAP)) {
        if (key && (rawPath.startsWith(key) || key.startsWith(rawPath))) {
            return val;
        }
    }
    return { category: 'dashboard', subTab: 'dashboard', title: 'Dashboard' };
}

// 3. Bi-directional URL synchronization hook
export function useUrlRouting(
    activeCategory: string,
    activeSubTab: string,
    setActiveCategory: (cat: string) => void,
    setActiveSubTab: (subTab: string) => void
) {
    // A. Sync when user hits Browser Back / Forward buttons
    useEffect(() => {
        const handlePopState = () => {
            const route = getInitialRouteFromUrl();
            if (route.category !== activeCategory) {
                setActiveCategory(route.category);
            }
            if (route.subTab !== activeSubTab) {
                setActiveSubTab(route.subTab);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [activeCategory, activeSubTab, setActiveCategory, setActiveSubTab]);

    // B. Sync URL in address bar when user navigates inside app
    useEffect(() => {
        // Find canonical path for current category/subTab
        let targetSlug = 'dashboard';
        let pageTitle = 'Dashboard';

        for (const [slug, route] of Object.entries(PATH_TO_ROUTE_MAP)) {
            if (slug && route.category === activeCategory && route.subTab === activeSubTab) {
                targetSlug = slug;
                pageTitle = route.title;
                break;
            }
        }

        // Fallback to category slug if no exact subTab match
        if (targetSlug === 'dashboard' && activeCategory !== 'dashboard') {
            for (const [slug, route] of Object.entries(PATH_TO_ROUTE_MAP)) {
                if (slug && route.category === activeCategory) {
                    targetSlug = slug;
                    pageTitle = route.title;
                    break;
                }
            }
        }

        const expectedPath = targetSlug === 'dashboard' ? '/' : `/${targetSlug}`;
        const currentPath = window.location.pathname;

        if (currentPath !== expectedPath && !(currentPath === '/' && targetSlug === 'dashboard')) {
            window.history.pushState(
                { category: activeCategory, subTab: activeSubTab },
                '',
                expectedPath
            );
        }

        // Update document title for professional browser experience
        if (typeof document !== 'undefined') {
            document.title = pageTitle === 'Dashboard' ? 'WealthOS | Institutional Wealth Dashboard' : `WealthOS | ${pageTitle}`;
        }
    }, [activeCategory, activeSubTab]);
}
