/**
 * CC42 — FeedControls
 *
 * Search box + filter chips above the message feed. CC42 polish:
 *   - Search box morphs on focus (icon rotates, border glows, label floats)
 *   - Filter chips are larger pills with gradient fill on active
 *   - Each chip shows a count badge
 *   - Sticky inside the scroll container so it stays visible
 */
import React, { useState, useEffect } from 'react';
import { Search, X, Filter, SlidersHorizontal, Database } from 'lucide-react';

type FilterType = 'all' | 'signals' | 'news' | 'starred';

interface FeedControlsProps {
    activeEarName: string | undefined;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    filterType: FilterType;
    onFilterChange: (f: FilterType) => void;
    activeEarId: string;
    counts?: { all: number; signals: number; news: number; starred: number };
    onOpenLedger: () => void;
}

export const FeedControls: React.FC<FeedControlsProps> = ({
    activeEarName, searchQuery, onSearchChange, filterType, onFilterChange, activeEarId,
    counts, onOpenLedger,
}) => {
    const [focused, setFocused] = useState(false);
    const [, setTick] = useState(0);

    // Refresh "n seconds ago" feel by re-rendering; kept simple since
    // the input itself is what the user actually interacts with.
    useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 30_000); return () => clearInterval(i); }, []);

    const chips: Array<{ key: FilterType; label: string; show: boolean; count?: number }> = ([
        { key: 'all',     label: 'All',     show: true, count: counts?.all },
        { key: 'signals', label: 'Signals', show: activeEarId === 'premium_signals', count: counts?.signals },
        { key: 'news',    label: 'News',    show: activeEarId === 'news_data', count: counts?.news },
        { key: 'starred', label: 'Starred', show: true, count: counts?.starred },
    ] as Array<{ key: FilterType; label: string; show: boolean; count?: number }>).filter(c => c.show);

    return (
        <div className="feed-controls">
            <div className={`search-wrapper ${focused ? 'is-focused' : ''} ${searchQuery ? 'has-value' : ''}`}>
                <Search size={14} className={`search-icon ${focused ? 'rot' : ''}`} />
                <input
                    type="text"
                    placeholder={`Search ${activeEarName || 'ear'}…`}
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                />
                {searchQuery && (
                    <button className="clear-search" onClick={() => onSearchChange('')} title="Clear search">
                        <X size={12} />
                    </button>
                )}
            </div>
            <div className="filter-chips" style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <div className="filter-prefix">
                        <SlidersHorizontal size={10} />
                        <span>FILTER</span>
                    </div>
                    {chips.map(c => (
                        <button
                            key={c.key}
                            className={`chip ${filterType === c.key ? 'active' : ''}`}
                            onClick={() => onFilterChange(c.key)}
                        >
                            <span>{c.label}</span>
                            {typeof c.count === 'number' && c.count > 0 && (
                                <span className="chip-count">{c.count > 999 ? '999+' : c.count}</span>
                            )}
                        </button>
                    ))}
                </div>

                <button
                    className="chip"
                    onClick={onOpenLedger}
                    style={{
                        marginLeft: 'auto',
                        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(99, 102, 241, 0.08))',
                        borderColor: 'rgba(168, 85, 247, 0.25)',
                        color: 'var(--tlh-violet)',
                        gap: '6px',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                    title="Open Signal Ledger"
                >
                    <Database size={10} />
                    <span>Signal Ledger</span>
                </button>
            </div>
        </div>
    );
};

export default FeedControls;
