import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Sparkles, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Info } from 'lucide-react';
import { Investment } from '../../../types';
import { formatCurrency } from '../../../utils/helpers';

interface PortfolioConstellationProps {
    investments: Investment[];
    isPrivacyMode?: boolean;
}

interface Star {
    id: string;
    x: number;
    y: number;
    radius: number;
    color: string;
    glowColor: string;
    pulseSpeed: number;
    name: string;
    ticker: string;
    value: number;
    invested: number;
    plPercent: number;
    sector: string;
    type: string;
}

interface Nebula {
    x: number;
    y: number;
    radius: number;
    color: string;
    label: string;
}

// Sector color palette
const SECTOR_COLORS: Record<string, { base: string; glow: string; nebula: string }> = {
    'Technology': { base: '#60a5fa', glow: '#3b82f6', nebula: 'rgba(59, 130, 246, 0.06)' },
    'Finance': { base: '#34d399', glow: '#10b981', nebula: 'rgba(16, 185, 129, 0.06)' },
    'Healthcare': { base: '#f472b6', glow: '#ec4899', nebula: 'rgba(236, 72, 153, 0.06)' },
    'Energy': { base: '#fbbf24', glow: '#f59e0b', nebula: 'rgba(245, 158, 11, 0.06)' },
    'Consumer': { base: '#a78bfa', glow: '#8b5cf6', nebula: 'rgba(139, 92, 246, 0.06)' },
    'Industrial': { base: '#fb923c', glow: '#f97316', nebula: 'rgba(249, 115, 22, 0.06)' },
    'Real Estate': { base: '#2dd4bf', glow: '#14b8a6', nebula: 'rgba(20, 184, 166, 0.06)' },
    'Materials': { base: '#e879f9', glow: '#d946ef', nebula: 'rgba(217, 70, 239, 0.06)' },
    'default': { base: '#94a3b8', glow: '#64748b', nebula: 'rgba(100, 116, 139, 0.06)' },
};

// Type-based volatility influence
const TYPE_VOLATILITY: Record<string, number> = {
    'Stocks': 1.5,
    'Mutual Fund': 0.8,
    'ETF': 0.9,
    'Crypto': 2.5,
    'Digital Gold': 0.4,
    'Digital Silver': 0.5,
    'Fixed Deposit': 0.2,
    'Smallcase': 1.0,
    'Real Estate': 0.5,
    'Cash/Bank': 0.1,
    'IPO': 1.2,
    'Trading Alpha': 1.8,
};

const PortfolioConstellation: React.FC<PortfolioConstellationProps> = ({
    investments,
    isPrivacyMode = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animFrameRef = useRef<number>(0);

    const [hoveredStar, setHoveredStar] = useState<Star | null>(null);
    const [selectedStar, setSelectedStar] = useState<Star | null>(null);
    const [zoom, setZoom] = useState(1);
    const [showLabels, setShowLabels] = useState(true);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    // Build star data from investments
    const { stars, nebulae, constellationLines } = useMemo(() => {
        if (!investments.length) return { stars: [], nebulae: [], constellationLines: [] };

        const totalValue = investments.reduce((sum, inv) => sum + (inv.currentValue || 0), 0);
        const maxValue = Math.max(...investments.map(i => i.currentValue || 0));

        // Group by sector for constellation positioning
        const sectorGroups: Record<string, Investment[]> = {};
        investments.forEach(inv => {
            const sector = inv.sector || inv.type || 'default';
            if (!sectorGroups[sector]) sectorGroups[sector] = [];
            sectorGroups[sector].push(inv);
        });

        const sectors = Object.keys(sectorGroups);
        const angleStep = (2 * Math.PI) / Math.max(sectors.length, 1);
        const centerX = 400;
        const centerY = 300;
        const orbitRadius = 180;

        const resultStars: Star[] = [];
        const resultNebulae: Nebula[] = [];
        const resultLines: { from: Star; to: Star }[] = [];

        sectors.forEach((sector, sectorIdx) => {
            const sectorAngle = angleStep * sectorIdx - Math.PI / 2;
            const sectorCenterX = centerX + Math.cos(sectorAngle) * orbitRadius;
            const sectorCenterY = centerY + Math.sin(sectorAngle) * orbitRadius;

            const colors = SECTOR_COLORS[sector] || SECTOR_COLORS['default'];

            // Add nebula background for sector
            resultNebulae.push({
                x: sectorCenterX,
                y: sectorCenterY,
                radius: 60 + sectorGroups[sector].length * 15,
                color: colors.nebula,
                label: sector,
            });

            // Position stars within sector cluster
            const sectorStars: Star[] = [];
            sectorGroups[sector].forEach((inv, invIdx) => {
                const subAngle = (2 * Math.PI / Math.max(sectorGroups[sector].length, 1)) * invIdx;
                const spread = 30 + Math.random() * 40;

                const plPercent = inv.investedAmount > 0
                    ? ((inv.currentValue - inv.investedAmount) / inv.investedAmount) * 100
                    : 0;

                // Star color based on P&L
                let starColor = colors.base;
                let glowColor = colors.glow;
                if (plPercent > 10) {
                    starColor = '#34d399';
                    glowColor = '#10b981';
                } else if (plPercent < -10) {
                    starColor = '#f87171';
                    glowColor = '#ef4444';
                }

                const volatility = TYPE_VOLATILITY[inv.type] || 0.6;

                const star: Star = {
                    id: inv.id,
                    x: sectorCenterX + Math.cos(subAngle) * spread,
                    y: sectorCenterY + Math.sin(subAngle) * spread,
                    radius: Math.max(3, Math.min(14, (inv.currentValue / maxValue) * 14)),
                    color: starColor,
                    glowColor: glowColor,
                    pulseSpeed: 0.5 + volatility * 2,
                    name: inv.name,
                    ticker: inv.ticker || inv.name.substring(0, 4).toUpperCase(),
                    value: inv.currentValue,
                    invested: inv.investedAmount,
                    plPercent,
                    sector,
                    type: inv.type,
                };

                resultStars.push(star);
                sectorStars.push(star);
            });

            // Create constellation lines within sector
            for (let i = 0; i < sectorStars.length - 1; i++) {
                resultLines.push({ from: sectorStars[i], to: sectorStars[i + 1] });
            }
            // Close the constellation loop if 3+ stars
            if (sectorStars.length >= 3) {
                resultLines.push({ from: sectorStars[sectorStars.length - 1], to: sectorStars[0] });
            }
        });

        return { stars: resultStars, nebulae: resultNebulae, constellationLines: resultLines };
    }, [investments]);

    // Background stars (decorative)
    const bgStars = useMemo(() => {
        return Array.from({ length: 200 }, () => ({
            x: Math.random() * 800,
            y: Math.random() * 600,
            r: Math.random() * 1.5,
            twinkleSpeed: 0.5 + Math.random() * 3,
            twinkleOffset: Math.random() * Math.PI * 2,
        }));
    }, []);

    // Canvas drawing
    const draw = useCallback((timestamp: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Deep space gradient background
        const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
        bgGrad.addColorStop(0, '#0a0a1a');
        bgGrad.addColorStop(0.5, '#070714');
        bgGrad.addColorStop(1, '#020209');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        // Apply zoom
        ctx.translate(w / 2, h / 2);
        ctx.scale(zoom, zoom);
        ctx.translate(-w / 2, -h / 2);

        // Draw background twinkling stars
        bgStars.forEach(s => {
            const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(timestamp * 0.001 * s.twinkleSpeed + s.twinkleOffset));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${twinkle * 0.6})`;
            ctx.fill();
        });

        // Draw nebulae (sector clouds)
        nebulae.forEach(neb => {
            const grad = ctx.createRadialGradient(neb.x, neb.y, 0, neb.x, neb.y, neb.radius);
            grad.addColorStop(0, neb.color.replace('0.06', '0.12'));
            grad.addColorStop(0.5, neb.color);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(neb.x, neb.y, neb.radius, 0, Math.PI * 2);
            ctx.fill();

            // Sector label
            if (showLabels && !isPrivacyMode) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.font = '10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(neb.label, neb.x, neb.y - neb.radius + 10);
            }
        });

        // Draw constellation lines
        constellationLines.forEach(line => {
            ctx.beginPath();
            ctx.moveTo(line.from.x, line.from.y);
            ctx.lineTo(line.to.x, line.to.y);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        });

        // Draw portfolio stars
        stars.forEach(star => {
            const pulse = 1 + 0.15 * Math.sin(timestamp * 0.002 * star.pulseSpeed);
            const r = star.radius * pulse;
            const isHovered = hoveredStar?.id === star.id;
            const isSelected = selectedStar?.id === star.id;

            // Outer glow
            const glowRadius = r * (isHovered ? 4 : 2.5);
            const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, glowRadius);
            glow.addColorStop(0, star.glowColor + '40');
            glow.addColorStop(0.5, star.glowColor + '10');
            glow.addColorStop(1, 'transparent');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(star.x, star.y, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            // Star core
            const coreGrad = ctx.createRadialGradient(
                star.x - r * 0.2, star.y - r * 0.2, 0,
                star.x, star.y, r
            );
            coreGrad.addColorStop(0, '#ffffff');
            coreGrad.addColorStop(0.4, star.color);
            coreGrad.addColorStop(1, star.glowColor);
            ctx.fillStyle = coreGrad;
            ctx.beginPath();
            ctx.arc(star.x, star.y, r, 0, Math.PI * 2);
            ctx.fill();

            // Selection ring
            if (isSelected || isHovered) {
                ctx.strokeStyle = star.color;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(star.x, star.y, r + 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Star label
            if (showLabels && !isPrivacyMode && star.radius > 5) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.font = '9px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(star.ticker, star.x, star.y + r + 12);
            }
        });

        ctx.restore();

        animFrameRef.current = requestAnimationFrame(draw);
    }, [stars, nebulae, constellationLines, bgStars, zoom, hoveredStar, selectedStar, showLabels, isPrivacyMode]);

    // Start animation loop
    useEffect(() => {
        animFrameRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animFrameRef.current);
    }, [draw]);

    // Resize canvas
    useEffect(() => {
        const resize = () => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (!canvas || !container) return;
            const rect = container.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = Math.max(400, rect.height);
        };
        resize();
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);

    // Mouse interaction
    const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left);
        const my = (e.clientY - rect.top);
        setMousePos({ x: mx, y: my });

        // Adjust for zoom
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const worldX = (mx - cx) / zoom + cx;
        const worldY = (my - cy) / zoom + cy;

        // Hit test stars
        const hit = stars.find(s => {
            const dx = s.x - worldX;
            const dy = s.y - worldY;
            return Math.sqrt(dx * dx + dy * dy) < s.radius + 8;
        });
        setHoveredStar(hit || null);
    }, [stars, zoom]);

    const handleCanvasClick = useCallback(() => {
        if (hoveredStar) {
            setSelectedStar(prev => prev?.id === hoveredStar.id ? null : hoveredStar);
        } else {
            setSelectedStar(null);
        }
    }, [hoveredStar]);

    // Stats
    const totalStars = stars.length;
    const totalSectors = new Set(stars.map(s => s.sector)).size;
    const brightestStar = stars.length
        ? stars.reduce((best, s) => s.plPercent > best.plPercent ? s : best, stars[0])
        : null;

    return (
        <div className="glass-card rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20">
                        <Sparkles className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white">Portfolio Constellation</h3>
                        <p className="text-[10px] text-white/40">
                            {totalStars} stars · {totalSectors} sectors
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setShowLabels(!showLabels)}
                        className={`p-1.5 rounded-lg transition-all ${showLabels ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-white/30'}`}
                        title={showLabels ? 'Hide labels' : 'Show labels'}
                    >
                        {showLabels ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => setZoom(z => Math.min(2, z + 0.2))} className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70">
                        <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setZoom(z => Math.max(0.5, z - 0.2))} className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70">
                        <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { setZoom(1); setSelectedStar(null); }} className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70">
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div ref={containerRef} className="relative w-full" style={{ minHeight: 400 }}>
                <canvas
                    ref={canvasRef}
                    className="w-full cursor-crosshair"
                    style={{ display: 'block' }}
                    onMouseMove={handleCanvasMove}
                    onClick={handleCanvasClick}
                    onMouseLeave={() => setHoveredStar(null)}
                />

                {/* Hover tooltip */}
                {hoveredStar && !isPrivacyMode && (
                    <div
                        className="absolute pointer-events-none z-20 bg-black/90 backdrop-blur-xl border border-white/10 rounded-xl px-3 py-2 shadow-2xl"
                        style={{
                            left: Math.min(mousePos.x + 12, (containerRef.current?.offsetWidth || 600) - 180),
                            top: mousePos.y - 60,
                        }}
                    >
                        <div className="text-xs font-bold text-white">{hoveredStar.ticker}</div>
                        <div className="text-[10px] text-white/50">{hoveredStar.name}</div>
                        <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px] text-white/70">{formatCurrency(hoveredStar.value)}</span>
                            <span className={`text-[10px] font-bold ${hoveredStar.plPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {hoveredStar.plPercent >= 0 ? '+' : ''}{hoveredStar.plPercent.toFixed(1)}%
                            </span>
                        </div>
                    </div>
                )}

                {/* Selected star detail card */}
                {selectedStar && !isPrivacyMode && (
                    <div className="absolute bottom-3 left-3 right-3 z-20 bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-bold text-white text-sm">{selectedStar.name}</div>
                                <div className="text-[10px] text-white/40">{selectedStar.sector} · {selectedStar.type}</div>
                            </div>
                            <div className={`text-lg font-black ${selectedStar.plPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {selectedStar.plPercent >= 0 ? '+' : ''}{selectedStar.plPercent.toFixed(1)}%
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-3">
                            <div className="bg-white/5 rounded-lg p-2 text-center">
                                <div className="text-[9px] text-white/40">Value</div>
                                <div className="text-xs font-bold text-white">{formatCurrency(selectedStar.value)}</div>
                            </div>
                            <div className="bg-white/5 rounded-lg p-2 text-center">
                                <div className="text-[9px] text-white/40">Invested</div>
                                <div className="text-xs font-bold text-white">{formatCurrency(selectedStar.invested)}</div>
                            </div>
                            <div className="bg-white/5 rounded-lg p-2 text-center">
                                <div className="text-[9px] text-white/40">P&L</div>
                                <div className={`text-xs font-bold ${selectedStar.plPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {formatCurrency(selectedStar.value - selectedStar.invested)}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer quick stats */}
            <div className="p-3 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {brightestStar && !isPrivacyMode && (
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-white/40">Brightest:</span>
                            <span className="text-[10px] font-bold text-emerald-400">{brightestStar.ticker}</span>
                            <span className="text-[10px] text-emerald-400/70">+{brightestStar.plPercent.toFixed(0)}%</span>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Info className="w-3 h-3 text-white/20" />
                    <span className="text-[9px] text-white/20">Click a star for details</span>
                </div>
            </div>
        </div>
    );
};

export default React.memo(PortfolioConstellation);
