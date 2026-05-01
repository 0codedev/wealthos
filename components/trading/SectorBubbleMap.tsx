import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Compass, Layers, Zap } from 'lucide-react';
import { useQuickLookStore } from '../../hooks/useQuickLook';

interface SectorBubble {
    name: string;
    symbol: string;
    pctChange: number;
    rFactor: number;
    turnoverCr: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
}

const SECTOR_DATA: Omit<SectorBubble, 'x' | 'y' | 'vx' | 'vy' | 'radius'>[] = [
    { name: 'Banking', symbol: 'NIFTY BANK', pctChange: 1.15, rFactor: 3.10, turnoverCr: 45000 },
    { name: 'IT Tech', symbol: 'NIFTY IT', pctChange: -0.45, rFactor: 1.10, turnoverCr: 32000 },
    { name: 'Metals', symbol: 'NIFTY METAL', pctChange: 2.10, rFactor: 3.85, turnoverCr: 28000 },
    { name: 'Auto', symbol: 'NIFTY AUTO', pctChange: 0.85, rFactor: 2.60, turnoverCr: 22000 },
    { name: 'Pharma', symbol: 'NIFTY PHARMA', pctChange: 0.40, rFactor: 1.95, turnoverCr: 18000 },
    { name: 'FMCG', symbol: 'NIFTY FMCG', pctChange: -0.20, rFactor: 1.30, turnoverCr: 16000 },
    { name: 'Energy', symbol: 'NIFTY ENERGY', pctChange: 1.45, rFactor: 3.20, turnoverCr: 38000 },
    { name: 'Realty', symbol: 'NIFTY REALTY', pctChange: 3.20, rFactor: 4.10, turnoverCr: 12000 },
    { name: 'Media', symbol: 'NIFTY MEDIA', pctChange: -1.10, rFactor: 0.85, turnoverCr: 5000 },
    { name: 'PSU Bank', symbol: 'NIFTY PSU BANK', pctChange: 2.40, rFactor: 3.90, turnoverCr: 21000 }
];

export const SectorBubbleMap: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [hoveredBubble, setHoveredBubble] = useState<SectorBubble | null>(null);
    const { openQuickLook } = useQuickLookStore();
    const bubblesRef = useRef<SectorBubble[]>([]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = (canvas.width = canvas.parentElement?.clientWidth || 700);
        const height = (canvas.height = 360);

        // Initialize physics particles
        bubblesRef.current = SECTOR_DATA.map((s, idx) => {
            const radius = Math.max(26, Math.min(54, Math.sqrt(s.turnoverCr) * 0.22));
            return {
                ...s,
                x: width * 0.2 + (idx % 4) * (width * 0.2) + (Math.random() * 20 - 10),
                y: height * 0.3 + Math.floor(idx / 4) * 90 + (Math.random() * 20 - 10),
                vx: (Math.random() - 0.5) * (s.rFactor * 0.4),
                vy: (Math.random() - 0.5) * (s.rFactor * 0.4),
                radius
            };
        });

        let animId: number;

        const render = () => {
            ctx.clearRect(0, 0, width, height);

            // Draw subtle background grid
            ctx.strokeStyle = 'rgba(51, 65, 85, 0.25)';
            ctx.lineWidth = 1;
            for (let x = 0; x < width; x += 40) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
            for (let y = 0; y < height; y += 40) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            const bubbles = bubblesRef.current;

            // Physics Update & Collision
            bubbles.forEach((b, i) => {
                b.x += b.vx;
                b.y += b.vy;

                // Wall bounds
                if (b.x - b.radius < 0) { b.x = b.radius; b.vx *= -1; }
                if (b.x + b.radius > width) { b.x = width - b.radius; b.vx *= -1; }
                if (b.y - b.radius < 0) { b.y = b.radius; b.vy *= -1; }
                if (b.y + b.radius > height) { b.y = height - b.radius; b.vy *= -1; }

                // Bubble vs Bubble collision repulsion
                for (let j = i + 1; j < bubbles.length; j++) {
                    const b2 = bubbles[j];
                    const dx = b2.x - b.x;
                    const dy = b2.y - b.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const minDist = b.radius + b2.radius + 4;

                    if (dist < minDist) {
                        const overlap = (minDist - dist) * 0.5;
                        const nx = dx / (dist || 1);
                        const ny = dy / (dist || 1);
                        b.x -= nx * overlap;
                        b.y -= ny * overlap;
                        b2.x += nx * overlap;
                        b2.y += ny * overlap;

                        // Slight velocity exchange
                        const tempVx = b.vx;
                        const tempVy = b.vy;
                        b.vx = b2.vx * 0.8;
                        b.vy = b2.vy * 0.8;
                        b2.vx = tempVx * 0.8;
                        b2.vy = tempVy * 0.8;
                    }
                }

                // Render Bubble
                const isPositive = b.pctChange >= 0;
                const isHovered = hoveredBubble?.symbol === b.symbol;

                ctx.save();
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);

                // Gradient Fill
                const grad = ctx.createRadialGradient(b.x - b.radius * 0.3, b.y - b.radius * 0.3, 2, b.x, b.y, b.radius);
                if (isPositive) {
                    grad.addColorStop(0, isHovered ? 'rgba(52, 211, 153, 0.4)' : 'rgba(16, 185, 129, 0.25)');
                    grad.addColorStop(1, 'rgba(5, 150, 105, 0.15)');
                    ctx.fillStyle = grad;
                    ctx.strokeStyle = isHovered ? '#34d399' : 'rgba(16, 185, 129, 0.6)';
                } else {
                    grad.addColorStop(0, isHovered ? 'rgba(251, 113, 133, 0.4)' : 'rgba(244, 63, 94, 0.25)');
                    grad.addColorStop(1, 'rgba(225, 29, 72, 0.15)');
                    ctx.fillStyle = grad;
                    ctx.strokeStyle = isHovered ? '#fb7185' : 'rgba(244, 63, 94, 0.6)';
                }

                ctx.lineWidth = isHovered ? 2.5 : 1.5;
                ctx.fill();
                ctx.stroke();

                // Text
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${Math.max(10, Math.floor(b.radius * 0.32))}px Inter, sans-serif`;
                ctx.fillText(b.name, b.x, b.y - b.radius * 0.2);

                ctx.font = `bold ${Math.max(9, Math.floor(b.radius * 0.26))}px monospace`;
                ctx.fillStyle = isPositive ? '#34d399' : '#fb7185';
                ctx.fillText(`${isPositive ? '+' : ''}${b.pctChange.toFixed(1)}%`, b.x, b.y + b.radius * 0.28);

                ctx.restore();
            });

            animId = requestAnimationFrame(render);
        };

        render();

        const handleMouseMove = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const found = bubblesRef.current.find(b => {
                const dx = mouseX - b.x;
                const dy = mouseY - b.y;
                return Math.sqrt(dx * dx + dy * dy) <= b.radius;
            });

            setHoveredBubble(found || null);
        };

        const handleClick = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const found = bubblesRef.current.find(b => {
                const dx = mouseX - b.x;
                const dy = mouseY - b.y;
                return Math.sqrt(dx * dx + dy * dy) <= b.radius;
            });

            if (found) {
                openQuickLook({
                    type: 'STOCK',
                    data: {
                        symbol: found.symbol,
                        ltp: 24500,
                        pctChange: found.pctChange,
                        rFactor: found.rFactor,
                        sector: found.name
                    }
                });
            }
        };

        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('click', handleClick);

        return () => {
            cancelAnimationFrame(animId);
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('click', handleClick);
        };
    }, [openQuickLook, hoveredBubble]);

    return (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 space-y-4 relative overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <span className="p-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                        <Compass size={18} />
                    </span>
                    <div>
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                            Smart Money Rotation • 2D Flow Matrix
                        </span>
                        <h3 className="text-base font-bold text-white font-display">
                            Real-Time Sector Capital Flow Bubble Map
                        </h3>
                    </div>
                </div>

                <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
                    <span className="flex items-center gap-1"><Zap size={12} className="text-amber-400" /> Size = Turnover</span>
                    <span className="hidden sm:inline">• Click Bubble for QuickLook</span>
                </div>
            </div>

            {/* Interactive Physics Canvas */}
            <div className="w-full h-90 relative rounded-2xl bg-slate-950/60 border border-slate-800/80 overflow-hidden flex items-center justify-center cursor-pointer">
                <canvas ref={canvasRef} className="w-full h-full" />

                {/* Hover Tooltip Overlay */}
                {hoveredBubble && (
                    <div className="absolute top-3 right-3 bg-slate-900/90 backdrop-blur-md border border-slate-700 p-3 rounded-2xl text-xs space-y-1 shadow-xl pointer-events-none animate-in fade-in">
                        <div className="font-bold text-white flex items-center justify-between gap-4">
                            <span>{hoveredBubble.symbol}</span>
                            <span className={hoveredBubble.pctChange >= 0 ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                                {hoveredBubble.pctChange >= 0 ? '+' : ''}{hoveredBubble.pctChange.toFixed(2)}%
                            </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                            Turnover: ₹{hoveredBubble.turnoverCr.toLocaleString('en-IN')} Cr
                        </div>
                        <div className="text-[11px] text-amber-400 font-mono">
                            R-Factor: {hoveredBubble.rFactor.toFixed(2)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
