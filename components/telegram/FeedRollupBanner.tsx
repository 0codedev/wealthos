/**
 * CC42 — FeedRollupBanner
 *
 * The "📌 TRACK FOR TOMORROW" banner. CC42 polish:
 *   - Animated marquee when there are more symbols than fit on one line
 *   - Hover-pause on the marquee
 *   - Subtle gradient background + floating icons
 *   - The icons gently float
 */
import React, { useMemo } from 'react';
import { Pin, TrendingUp, ArrowUpRight } from 'lucide-react';
import { PoolTelegramPushButton } from '../pool/PoolTelegramPushButton';
import { TelegramMessage } from '../../database';
import styles from './FeedRollupBanner.module.css';
import anim from './animations.module.css';

interface FeedRollupBannerProps {
    messages: TelegramMessage[];
}

export const FeedRollupBanner: React.FC<FeedRollupBannerProps> = ({ messages }) => {
    const rollup = useMemo(() => {
        const oneHourAgo = Date.now() - 60 * 60_000;
        const seen = new Set<string>();
        const list: string[] = [];
        for (const m of messages) {
            if (m.receivedAt < oneHourAgo) continue;
            if (m.messageType !== 'PARSED_SIGNAL' || !m.parsedJson) continue;
            try {
                const parsed: any = typeof m.parsedJson === 'object' ? m.parsedJson : JSON.parse(m.parsedJson);
                if (parsed?.tradingSymbol && !seen.has(parsed.tradingSymbol)) {
                    seen.add(parsed.tradingSymbol);
                    list.push(parsed.tradingSymbol);
                    if (list.length >= 6) break;
                }
            } catch { /* ignore */ }
        }
        return list;
    }, [messages]);

    if (rollup.length === 0) return null;

    const marquee = rollup.length > 3;

    return (
        <div className={styles.banner}>
            <div className={styles.label}>
                <div className={styles.labelIcon}>
                    <Pin size={10} className={anim.float} />
                </div>
                <div className={styles.labelText}>
                    <span className={styles.labelTitle}>TRACK FOR TOMORROW</span>
                    <span className={styles.labelSub}>
                        {rollup.length} signal{rollup.length === 1 ? '' : 's'} in last hour
                    </span>
                </div>
            </div>
            <div className={styles.divider} />
            <div className={styles.tickers}>
                <div className={`${styles.tickersInner} ${marquee ? anim.marquee : ''}`} draggable="false">
                    {(marquee ? [...rollup, ...rollup] : rollup).map((sym, i) => (
                        <div key={`${sym}-${i}`} className={styles.tickerChip} draggable="false">
                            <TrendingUp size={9} className={styles.tickerIcon} />
                            <span className={styles.tickerSym}>{sym}</span>
                            <PoolTelegramPushButton
                                ticker={sym}
                                channelName="feed-rollup"
                                compact
                            />
                            <ArrowUpRight size={9} className={styles.tickerArrow} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FeedRollupBanner;
