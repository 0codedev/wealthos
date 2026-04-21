import React, { useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Shield, Activity, Radio, Server, Eye, Camera, Cpu,
    CheckCircle2, AlertTriangle, XCircle, ChevronRight, Send, X,
    Wifi, WifiOff, AlertOctagon, Sparkles, Box
} from 'lucide-react';
import { useQuantumStore } from '../../store/quantumStore';
import { useShallow } from 'zustand/react/shallow';
import { resilienceTelemetry } from '../../services/ResilienceTelemetry';
import type { ConfluenceSignal, SourceHealth, TelemetrySource } from '../../types/quantum';

/**
 * ResilienceCoreConsole — CC38
 * =====================================================================
 * The "cyber-security desk" view. Three primary surfaces:
 *
 *  1. Telemetry ribbon — source health meters, latency charts
 *  2. Node-link diagram — visual connection map of all feeds
 *  3. Confluence signal ledger — incoming OCR/text signals with
 *     verification badges, editable bounding boxes, and a
 *     slide-to-confirm authorization rail.
 */
export const ResilienceCoreConsole: React.FC = () => {
    const telemetry = useQuantumStore(useShallow(s => s.telemetry));
    const setTelemetry = useQuantumStore(useShallow(s => s.setTelemetry));
    const signals = useQuantumStore(useShallow(s => s.signals));
    const setSignals = useQuantumStore(useShallow(s => s.setSignals));
    const upsertSignal = useQuantumStore(useShallow(s => s.upsertSignal));
    const focusedSignalId = useQuantumStore(useShallow(s => s.focusedSignalId));
    const setFocusedSignalId = useQuantumStore(useShallow(s => s.setFocusedSignalId));

    // Seed some demo signals + subscribe to the live telemetry poller
    useEffect(() => {
        resilienceTelemetry.start();
        const unsub = resilienceTelemetry.onChange((sources) => setTelemetry(sources));
        return () => { unsub(); resilienceTelemetry.stop(); };
    }, [setTelemetry]);

    // Seed a few demo OCR signals on first mount so the UI is never empty
    useEffect(() => {
        if (signals.length === 0) {
            const demo: ConfluenceSignal[] = [
                seedSignal('BUY NIFTY 25000 CE @ 145', 'NIFTY', 'BUY', 25000, 'CE', 145, 25, 0.91, true),
                seedSignal('SELL BANKNIFTY 52000 PE @ 220 SL 250', 'BANKNIFTY', 'SELL', 52000, 'PE', 220, 15, 0.78, true),
                seedSignal('BUY RELIANCE 1280 CE @ 28', 'RELIANCE', 'BUY', 1280, 'CE', 28, 250, 0.62, false),
            ];
            setSignals(demo);
        }
    }, [signals.length, setSignals]);

    const verifySignal = (s: ConfluenceSignal) => {
        // Naive verifier — chainVerified = true if ticker is a known index,
        // rangeVerified = true if limit is in plausible range,
        // lotVerified = true if qty % lotSize === 0.
        const isIndex = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'].includes(s.ticker);
        const chainVerified = isIndex || !!s.strike;
        const lot = isIndex ? (s.ticker === 'BANKNIFTY' ? 15 : s.ticker === 'FINNIFTY' ? 40 : s.ticker === 'MIDCPNIFTY' ? 75 : 25) : 1;
        const lotVerified = s.quantity > 0 && s.quantity % lot === 0;
        const rangeVerified = (s.limit ?? 0) > 0 && (s.limit ?? 0) < 100000;
        const status: ConfluenceSignal['status'] =
            chainVerified && lotVerified && rangeVerified ? 'VERIFIED' : 'REJECTED';
        const rejection = !chainVerified ? 'Underlying not on the active chain' :
                          !lotVerified ? `Quantity ${s.quantity} does not match lot ${lot}` :
                          !rangeVerified ? 'Limit price outside plausible range' : undefined;
        upsertSignal({ ...s, chainVerified, lotVerified, rangeVerified, status, rejection });
    };

    return (
        <div className="space-y-4">
            <TelemetryRibbon sources={telemetry} />
            <NodeLinkDiagram sources={telemetry} />
            <SignalLedger
                signals={signals}
                onVerify={verifySignal}
                focusedId={focusedSignalId}
                onFocus={setFocusedSignalId}
            />
        </div>
    );
};

function seedSignal(raw: string, ticker: string, side: 'BUY' | 'SELL', strike: number, optType: 'CE' | 'PE', limit: number, qty: number, conf: number, chain: boolean): ConfluenceSignal {
    return {
        id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        receivedAt: Date.now() - Math.random() * 5 * 60_000,
        source: Math.random() > 0.5 ? 'OCR' : 'TELEGRAM',
        raw, ticker, side, strike, optionType: optType, limit, quantity: qty,
        confidence: conf,
        chainVerified: chain,
        rangeVerified: false,
        lotVerified: false,
        status: 'PENDING',
        ocrBoxes: [
            { text: 'BUY', bbox: { x: 8, y: 12, w: 50, h: 26 }, confidence: 0.97 },
            { text: 'NIFTY 25000 CE', bbox: { x: 70, y: 12, w: 200, h: 26 }, confidence: 0.94 },
            { text: '@ 145', bbox: { x: 280, y: 12, w: 80, h: 26 }, confidence: 0.89 },
        ],
    };
}

// =====================================================================
// 1) Telemetry ribbon
// =====================================================================

const TelemetryRibbon: React.FC<{ sources: TelemetrySource[] }> = ({ sources }) => (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {sources.map(s => <SourceMeter key={s.id} source={s} />)}
    </div>
);

const HEALTH_COLORS: Record<SourceHealth, { ring: string; text: string; bg: string; icon: React.ReactNode; label: string }> = {
    GREEN:    { ring: 'border-emerald-500/40',  text: 'text-emerald-300',  bg: 'bg-emerald-500/10',  icon: <CheckCircle2 size={12} />, label: 'ONLINE' },
    YELLOW:   { ring: 'border-amber-500/40',    text: 'text-amber-300',    bg: 'bg-amber-500/10',    icon: <AlertTriangle size={12} />, label: 'SLOW' },
    RED:      { ring: 'border-rose-500/40',     text: 'text-rose-300',     bg: 'bg-rose-500/10',     icon: <XCircle size={12} />, label: 'STALLED' },
    OFFLINE:  { ring: 'border-slate-500/40',   text: 'text-slate-300',    bg: 'bg-slate-500/10',    icon: <WifiOff size={12} />, label: 'OFFLINE' },
};

const KIND_ICONS: Record<TelemetrySource['kind'], React.ReactNode> = {
    WS: <Radio size={14} />, HTTP: <Server size={14} />, OCR: <Camera size={14} />, BRIDGE: <Box size={14} />, SCRAPER: <Wifi size={14} />,
};

const SourceMeter: React.FC<{ source: TelemetrySource }> = ({ source }) => {
    const cfg = HEALTH_COLORS[source.health];
    return (
        <div className={`rounded-2xl border ${cfg.ring} ${cfg.bg} p-3`}>
            <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                    {KIND_ICONS[source.kind]}
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">{source.name}</span>
                </div>
                <span className={`flex items-center gap-1 text-[9px] font-bold ${cfg.text}`}>{cfg.icon}{cfg.label}</span>
            </div>
            <div className="text-lg font-mono font-bold text-slate-100">{source.latencyMs !== null ? `${source.latencyMs.toFixed(0)}ms` : '—'}</div>
            {source.quotaUsed !== null && (
                <div className="mt-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-cyan-500" style={{ width: `${Math.min(100, source.quotaUsed * 100)}%` }} />
                </div>
            )}
            <div className="text-[9px] text-slate-500 mt-1">{source.note ?? source.kind}</div>
        </div>
    );
};

// =====================================================================
// 2) Node-link diagram
// =====================================================================

const NodeLinkDiagram: React.FC<{ sources: TelemetrySource[] }> = ({ sources }) => {
    if (sources.length === 0) return null;
    return (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
            <div className="flex items-center gap-2 mb-3">
                <Shield size={16} className="text-cyan-400" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">Connection Mesh</h3>
            </div>
            <svg viewBox="0 0 600 220" className="w-full h-56">
                {/* lines from app (left) to bridge (center) to sources (right) */}
                <line x1={50} y1={110} x2={300} y2={110} stroke="rgba(34,211,238,0.4)" strokeWidth={2} />
                {sources.map((s, i) => {
                    const y = 30 + (i * 30);
                    return <line key={s.id} x1={300} y1={110} x2={520} y2={y} stroke="rgba(34,211,238,0.25)" strokeWidth={1.5} />;
                })}
                {/* App node */}
                <circle cx={50} cy={110} r={20} fill="rgba(34,211,238,0.2)" stroke="#22d3ee" strokeWidth={2} />
                <text x={50} y={114} textAnchor="middle" fontSize={10} fontWeight={900} fill="#22d3ee">APP</text>
                {/* Bridge node */}
                <rect x={260} y={88} width={80} height={44} rx={10} fill="rgba(167,139,250,0.2)" stroke="#a78bfa" strokeWidth={2} />
                <text x={300} y={114} textAnchor="middle" fontSize={10} fontWeight={900} fill="#a78bfa">BRIDGE</text>
                {/* Source nodes */}
                {sources.map((s, i) => {
                    const y = 30 + (i * 30);
                    const cfg = HEALTH_COLORS[s.health];
                    const fill = s.health === 'GREEN' ? 'rgba(16,185,129,0.2)' : s.health === 'YELLOW' ? 'rgba(245,158,11,0.2)' : s.health === 'RED' ? 'rgba(244,63,94,0.2)' : 'rgba(100,116,139,0.2)';
                    const stroke = s.health === 'GREEN' ? '#10b981' : s.health === 'YELLOW' ? '#f59e0b' : s.health === 'RED' ? '#f43f5e' : '#64748b';
                    return (
                        <g key={s.id}>
                            <circle cx={520} cy={y} r={14} fill={fill} stroke={stroke} strokeWidth={2} />
                            <text x={520} y={y + 3} textAnchor="middle" fontSize={7} fontWeight={700} fill="#cbd5e1">{s.kind}</text>
                            <text x={520} y={y + 28} textAnchor="middle" fontSize={8} fontWeight={700} fill="#cbd5e1">{s.name}</text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

// =====================================================================
// 3) Signal ledger with slide-to-confirm
// =====================================================================

const SignalLedger: React.FC<{
    signals: ConfluenceSignal[];
    onVerify: (s: ConfluenceSignal) => void;
    focusedId: string | null;
    onFocus: (id: string | null) => void;
}> = ({ signals, onVerify, focusedId, onFocus }) => {
    return (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Send size={16} className="text-cyan-400" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-300">Confluence Signal Ledger</h3>
                </div>
                <span className="text-[10px] text-slate-500">{signals.length} signals</span>
            </div>
            <div className="space-y-2">
                {signals.map(s => (
                    <SignalRow
                        key={s.id}
                        s={s}
                        onVerify={() => onVerify(s)}
                        onFocus={() => onFocus(s.id)}
                        isFocused={focusedId === s.id}
                    />
                ))}
            </div>
        </div>
    );
};

const SignalRow: React.FC<{ s: ConfluenceSignal; onVerify: () => void; onFocus: () => void; isFocused: boolean }> = ({ s, onVerify, onFocus, isFocused }) => {
    const statusColor: Record<ConfluenceSignal['status'], string> = {
        PENDING:  'border-slate-700/40 bg-slate-900/40 text-slate-300',
        VERIFIED: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200',
        REJECTED: 'border-rose-500/30 bg-rose-500/5 text-rose-200',
        SENT:     'border-cyan-500/30 bg-cyan-500/5 text-cyan-200',
        FAILED:   'border-rose-500/30 bg-rose-500/5 text-rose-200',
    };
    return (
        <div className={`rounded-xl border ${statusColor[s.status]} p-3`}>
            <div className="flex items-center gap-2 mb-1.5">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-slate-800 text-slate-300">{s.source}</span>
                <span className="text-[10px] text-slate-500">{(Date.now() - s.receivedAt < 60_000 ? `${Math.round((Date.now() - s.receivedAt) / 1000)}s` : `${Math.round((Date.now() - s.receivedAt) / 60_000)}m`)} ago</span>
                <span className="ml-auto text-[10px] font-mono text-slate-400">conf {(s.confidence * 100).toFixed(0)}%</span>
            </div>
            <div className="text-sm font-mono text-slate-100">{s.raw}</div>
            <div className="flex flex-wrap items-center gap-2 mt-2">
                <VerifyBadge ok={s.chainVerified} label="chain" />
                <VerifyBadge ok={s.rangeVerified} label="range" />
                <VerifyBadge ok={s.lotVerified} label="lot" />
                <span className="ml-auto text-[10px] font-black uppercase tracking-widest">{s.status}</span>
            </div>
            {s.rejection && <div className="text-[10px] text-rose-300 mt-1">⚠ {s.rejection}</div>}
            {isFocused && <OcrVerifyOverlay signal={s} />}
            <div className="mt-2 flex items-center gap-2">
                {s.status === 'PENDING' && (
                    <button
                        onClick={onVerify}
                        className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold uppercase tracking-widest"
                    >
                        Run Sanity Checks
                    </button>
                )}
                <button
                    onClick={onFocus}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-bold uppercase tracking-widest"
                >
                    {isFocused ? 'Hide OCR' : 'Inspect OCR'}
                </button>
                {s.status === 'VERIFIED' && <SlideToConfirm signal={s} />}
            </div>
        </div>
    );
};

const VerifyBadge: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
    <span className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest ${ok ? 'text-emerald-300' : 'text-slate-500'}`}>
        {ok ? <CheckCircle2 size={9} /> : <AlertOctagon size={9} />} {label}
    </span>
);

// Mini OCR verify overlay — shows the parsed text with bbox "boxes"
const OcrVerifyOverlay: React.FC<{ signal: ConfluenceSignal }> = ({ signal }) => (
    <div className="mt-2 rounded-lg bg-slate-950/80 border border-slate-800 p-2">
        <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">OCR bounding boxes</div>
        <div className="relative h-16 rounded bg-slate-900/60 overflow-hidden">
            {signal.ocrBoxes?.map((b, i) => (
                <div
                    key={i}
                    className="absolute border border-cyan-400/40 bg-cyan-500/10 rounded-sm flex items-center justify-center text-[9px] font-mono text-cyan-200"
                    style={{
                        left: `${(b.bbox.x / 400) * 100}%`,
                        top: `${(b.bbox.y / 60) * 100}%`,
                        width: `${(b.bbox.w / 400) * 100}%`,
                        height: `${(b.bbox.h / 60) * 100}%`,
                    }}
                >
                    {b.text}
                </div>
            ))}
        </div>
    </div>
);

// =====================================================================
// 4) Slide-to-confirm (Stripe/iOS-style rail)
// =====================================================================

const SlideToConfirm: React.FC<{ signal: ConfluenceSignal }> = ({ signal }) => {
    const railRef = useRef<HTMLDivElement | null>(null);
    const [dragX, setDragX] = useState(0);
    const [confirmed, setConfirmed] = useState(false);
    const railWidth = 240;
    const handleW = 36;
    const max = railWidth - handleW - 4;

    const onMove = (e: React.PointerEvent) => {
        if (confirmed) return;
        const rail = railRef.current?.getBoundingClientRect();
        if (!rail) return;
        const x = Math.max(0, Math.min(max, e.clientX - rail.left - handleW / 2));
        setDragX(x);
        if (x >= max - 1) {
            setConfirmed(true);
            setDragX(max);
            window.dispatchEvent(new CustomEvent('quantum:slide-authorized', { detail: { signal } }));
        }
    };
    const reset = () => { if (!confirmed) setDragX(0); };

    return (
        <div
            ref={railRef}
            onPointerMove={onMove}
            onPointerUp={reset}
            onPointerLeave={reset}
            className="relative flex-1 h-9 rounded-full bg-slate-800 border border-slate-700 overflow-hidden cursor-grab select-none"
            style={{ width: railWidth, maxWidth: '100%' }}
        >
            <div
                className="absolute inset-0 flex items-center justify-center text-[10px] font-black uppercase tracking-widest"
                style={{ color: confirmed ? '#34d399' : '#94a3b8' }}
            >
                {confirmed ? '✓ AUTHORIZED' : 'Slide to authorize'}
            </div>
            <motion.div
                className="absolute top-0.5 h-8 w-9 rounded-full bg-gradient-to-br from-cyan-500 to-fuchsia-500 flex items-center justify-center shadow-lg"
                animate={{ x: dragX }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
                <ChevronRight size={16} className="text-white" />
            </motion.div>
        </div>
    );
};

export default ResilienceCoreConsole;
