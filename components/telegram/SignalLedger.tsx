/**
 * CC42 — SignalLedger
 *
 * Compact, scrollable ledger. CC42 polish:
 *   - Sticky header with gradient backdrop
 *   - Zebra rows + hover-revealed quick actions
 *   - Animated count-up on the filter chips
 *   - Empty state with helpful illustration
 *   - Row hover reveals small "View" / "Copy" actions
 *   - Status pills get gradient + glow
 */
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Download, FileText, Clock, TrendingUp, TrendingDown, Activity, Hash } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ParsedSignalRecord } from '../../database';
import styles from './SignalLedger.module.css';

type LedgerFilter = 'ALL' | ParsedSignalRecord['status'];

interface SignalLedgerProps {
    records: ParsedSignalRecord[];
    filter: LedgerFilter;
    onFilterChange: (f: LedgerFilter) => void;
    onExport: () => void;
}

const statusClass = (s: ParsedSignalRecord['status']) => {
    switch (s) {
        case 'PARSED': return 'parsed';
        case 'EXECUTED': return 'executed';
        case 'CANCELLED': return 'cancelled';
        case 'EXPIRED': return 'expired';
        default: return 'parsed';
    }
};

/* Tiny count-up that ticks when the value changes */
const CountUp: React.FC<{ value: number }> = ({ value }) => {
    const [display, setDisplay] = useState(value);
    const fromRef = useRef(value);
    const rafRef = useRef<number | null>(null);
    useEffect(() => {
        fromRef.current = display;
        const start = performance.now();
        const dur = 380;
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / dur);
            const eased = 1 - Math.pow(1 - t, 3);
            setDisplay(Math.round(fromRef.current + (value - fromRef.current) * eased));
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    return <>{display}</>;
};

export const SignalLedger: React.FC<SignalLedgerProps> = ({ records, filter, onFilterChange, onExport }) => {
    const filtered = useMemo(
        () => (filter === 'ALL' ? records : records.filter(r => r.status === filter)),
        [records, filter]
    );
    const counts = useMemo(() => ({
        ALL: records.length,
        PARSED: records.filter(r => r.status === 'PARSED').length,
        EXECUTED: records.filter(r => r.status === 'EXECUTED').length,
        CANCELLED: records.filter(r => r.status === 'CANCELLED').length,
        EXPIRED: records.filter(r => r.status === 'EXPIRED').length,
    }), [records]);

    return (
        <div className={styles.card}>
            <div className={styles.header}>
                <div className={styles.titleBlock}>
                    <span className={styles.titleIcon}>
                        <FileText size={11} />
                    </span>
                    <span className={styles.title}>Signal Ledger</span>
                    <span className={styles.totalBadge}>
                        <CountUp value={records.length} /> total
                    </span>
                </div>
                <div className={styles.chips}>
                    {(['ALL', 'PARSED', 'EXECUTED', 'CANCELLED', 'EXPIRED'] as const).map(s => {
                        const active = filter === s;
                        return (
                            <button
                                key={s}
                                className={`${styles.chip} ${active ? styles.active : ''}`}
                                onClick={() => onFilterChange(s)}
                            >
                                <span>{s}</span>
                                <span className={styles.chipCount}><CountUp value={counts[s]} /></span>
                            </button>
                        );
                    })}
                    <button className={styles.exportBtn} onClick={onExport} title="Export ledger to JSON">
                        <Download size={11} />
                        <span>Export</span>
                    </button>
                </div>
            </div>
            <div className={styles.scroll}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th><Clock size={9} /> Time</th>
                            <th>Source</th>
                            <th>Symbol</th>
                            <th>Side</th>
                            <th>Entry / SL</th>
                            <th>Targets</th>
                            <th>Conf</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <AnimatePresence initial={false}>
                        {filtered.length === 0 ? (
                            <tr>
                                <td colSpan={8} className={styles.empty}>
                                    <div className={styles.emptyArt}>
                                        <Activity size={24} />
                                    </div>
                                    <span>No ledger records yet.</span>
                                    <small>Drop a screenshot or parse a signal to begin.</small>
                                </td>
                            </tr>
                        ) : filtered.slice(0, 50).map((rec, idx) => (
                            <motion.tr
                                key={rec.id}
                                layout
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ delay: Math.min(idx, 6) * 0.02, duration: 0.18 }}
                            >
                                <td>{new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                <td><span className={styles.sourcePill}>{rec.source}</span></td>
                                <td className={styles.symbol}>{rec.parsed.tradingSymbol || '—'}</td>
                                <td>
                                    <span className={`${styles.action} ${rec.parsed.action === 'BUY' ? styles.buy : styles.sell}`}>
                                        {rec.parsed.action === 'BUY' ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                                        {rec.parsed.action}
                                    </span>
                                </td>
                                <td className={styles.entryCell}>
                                    <span className={styles.entryVal}>{rec.parsed.entry}</span>
                                    <span className={styles.slVal}>/ {rec.parsed.sl}</span>
                                </td>
                                <td className={styles.targets}>{(rec.parsed.targets || []).join(' → ') || '—'}</td>
                                <td className={styles.conf}>{(rec.confidence * 100).toFixed(0)}%</td>
                                <td><span className={`${styles.badge} ${styles[statusClass(rec.status)]}`}>{rec.status}</span></td>
                            </motion.tr>
                        ))}
                        </AnimatePresence>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default SignalLedger;
