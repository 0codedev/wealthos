import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, TrendingDown, Plus, Trash2, Save, Play, Calculator, 
  Target, Shield, AlertTriangle, CheckCircle2, Activity, BarChart3, 
  Wind, Droplets, Flame, TrendingUp as ChevronUp, ChevronDown
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import { formatCurrencyCompact as formatCurrency } from '../../utils/helpers';

interface Leg {
  id: string;
  type: 'CE' | 'PE';
  action: 'Buy' | 'Sell';
  strikePrice: number;
  premium: number;
  lotSize: number;
  quantity: number;
  isActive: boolean;
}

interface IndexConfig {
  lotSize: number;
  defaultSpot: number;
  color: string;
}

const INDEX_CONFIG: Record<string, IndexConfig> = {
  NIFTY: { lotSize: 25, defaultSpot: 23500, color: '#10b981' },
  BANKNIFTY: { lotSize: 15, defaultSpot: 51500, color: '#3b82f6' },
  FINNIFTY: { lotSize: 40, defaultSpot: 24000, color: '#8b5cf6' },
  MIDCPNIFTY: { lotSize: 75, defaultSpot: 12000, color: '#f59e0b' },
};

const PRESET_STRATEGIES = [
  {
    name: 'Bull Call Spread',
    description: 'Buy ATM Call + Sell OTM Call',
    legs: (spot: number, index: string) => {
      const config = INDEX_CONFIG[index];
      const atm = Math.round(spot / 50) * 50;
      const otm = atm + 100;
      return [
        { type: 'CE', action: 'Buy', strikePrice: atm, premium: 0, lotSize: config.lotSize, quantity: 1 },
        { type: 'CE', action: 'Sell', strikePrice: otm, premium: 0, lotSize: config.lotSize, quantity: 1 },
      ];
    }
  },
  {
    name: 'Bear Put Spread',
    description: 'Buy ATM Put + Sell OTM Put',
    legs: (spot: number, index: string) => {
      const config = INDEX_CONFIG[index];
      const atm = Math.round(spot / 50) * 50;
      const otm = atm - 100;
      return [
        { type: 'PE', action: 'Buy', strikePrice: atm, premium: 0, lotSize: config.lotSize, quantity: 1 },
        { type: 'PE', action: 'Sell', strikePrice: otm, premium: 0, lotSize: config.lotSize, quantity: 1 },
      ];
    }
  },
  {
    name: 'Long Straddle',
    description: 'Buy ATM Call + Buy ATM Put',
    legs: (spot: number, index: string) => {
      const config = INDEX_CONFIG[index];
      const atm = Math.round(spot / 50) * 50;
      return [
        { type: 'CE', action: 'Buy', strikePrice: atm, premium: 0, lotSize: config.lotSize, quantity: 1 },
        { type: 'PE', action: 'Buy', strikePrice: atm, premium: 0, lotSize: config.lotSize, quantity: 1 },
      ];
    }
  },
  {
    name: 'Short Strangle',
    description: 'Sell OTM Call + Sell OTM Put',
    legs: (spot: number, index: string) => {
      const config = INDEX_CONFIG[index];
      const otmCall = Math.round(spot / 50) * 50 + 100;
      const otmPut = Math.round(spot / 50) * 50 - 100;
      return [
        { type: 'CE', action: 'Sell', strikePrice: otmCall, premium: 0, lotSize: config.lotSize, quantity: 1 },
        { type: 'PE', action: 'Sell', strikePrice: otmPut, premium: 0, lotSize: config.lotSize, quantity: 1 },
      ];
    }
  },
  {
    name: 'Iron Condor',
    description: 'Buy OTM Put + Sell L-OTM Put + Sell H-OTM Call + Buy OTM Call',
    legs: (spot: number, index: string) => {
      const config = INDEX_CONFIG[index];
      const atm = Math.round(spot / 50) * 50;
      return [
        { type: 'PE', action: 'Buy', strikePrice: atm - 200, premium: 0, lotSize: config.lotSize, quantity: 1 },
        { type: 'PE', action: 'Sell', strikePrice: atm - 100, premium: 0, lotSize: config.lotSize, quantity: 1 },
        { type: 'CE', action: 'Sell', strikePrice: atm + 100, premium: 0, lotSize: config.lotSize, quantity: 1 },
        { type: 'CE', action: 'Buy', strikePrice: atm + 200, premium: 0, lotSize: config.lotSize, quantity: 1 },
      ];
    }
  }
];

const OptionsPlayground: React.FC = () => {
  const [selectedIndex, setSelectedIndex] = useState<'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | 'MIDCPNIFTY'>('NIFTY');
  const [spotPrice, setSpotPrice] = useState(INDEX_CONFIG[selectedIndex].defaultSpot);
  const [legs, setLegs] = useState<Leg[]>(() => {
    const config = INDEX_CONFIG[selectedIndex];
    return [
      { id: '1', type: 'CE', action: 'Buy', strikePrice: Math.round(spotPrice / 50) * 50, premium: 50, lotSize: config.lotSize, quantity: 1, isActive: true },
      { id: '2', type: 'PE', action: 'Buy', strikePrice: Math.round(spotPrice / 50) * 50, premium: 50, lotSize: config.lotSize, quantity: 1, isActive: true },
    ];
  });
  
  const [activeLegs, setActiveLegs] = useState<Leg[]>(legs);
  const [isCalculating, setIsCalculating] = useState(false);
  
  const config = INDEX_CONFIG[selectedIndex];
  
  useEffect(() => {
    const active = legs.filter(leg => leg.isActive);
    setActiveLegs(active);
  }, [legs]);

  const handleIndexChange = (index: 'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | 'MIDCPNIFTY') => {
    setSelectedIndex(index);
    setSpotPrice(INDEX_CONFIG[index].defaultSpot);
    const newLegs: Leg[] = [
      { 
        id: '1', 
        type: 'CE', 
        action: 'Buy', 
        strikePrice: Math.round(INDEX_CONFIG[index].defaultSpot / 50) * 50, 
        premium: 50, 
        lotSize: INDEX_CONFIG[index].lotSize, 
        quantity: 1, 
        isActive: true 
      },
      { 
        id: '2', 
        type: 'PE', 
        action: 'Buy', 
        strikePrice: Math.round(INDEX_CONFIG[index].defaultSpot / 50) * 50, 
        premium: 50, 
        lotSize: INDEX_CONFIG[index].lotSize, 
        quantity: 1, 
        isActive: true 
      },
    ];
    setLegs(newLegs);
  };

  const applyPreset = (presetName: string) => {
    const preset = PRESET_STRATEGIES.find(p => p.name === presetName);
    if (preset) {
      const newLegs: Leg[] = preset.legs(spotPrice, selectedIndex).map((leg, index) => ({
        id: (index + 1).toString(),
        type: leg.type as 'CE' | 'PE',
        action: leg.action as 'Buy' | 'Sell',
        strikePrice: leg.strikePrice,
        premium: Math.random() * 100 + 50,
        lotSize: leg.lotSize,
        quantity: leg.quantity,
        isActive: true,
      }));
      setLegs(newLegs);
    }
  };

  const addLeg = () => {
    if (legs.length >= 4) return;
    const newId = (legs.length + 1).toString();
    const newLeg: Leg = {
      id: newId,
      type: 'CE',
      action: 'Buy',
      strikePrice: Math.round(spotPrice / 50) * 50 + 100,
      premium: 50,
      lotSize: config.lotSize,
      quantity: 1,
      isActive: true,
    };
    setLegs([...legs, newLeg]);
  };

  const removeLeg = (id: string) => {
    setLegs(legs.filter(leg => leg.id !== id));
  };

  const updateLeg = (id: string, field: keyof Leg, value: any) => {
    setLegs(legs.map(leg => 
      leg.id === id ? { ...leg, [field]: value } : leg
    ));
  };

  const toggleLegActive = (id: string) => {
    setLegs(legs.map(leg => 
      leg.id === id ? { ...leg, isActive: !leg.isActive } : leg
    ));
  };

  const calculateMetrics = () => {
    setIsCalculating(true);
    setTimeout(() => setIsCalculating(false), 500);
  };

  const payoffData = useMemo(() => {
    const data = [];
    const startPrice = spotPrice * 0.92;
    const endPrice = spotPrice * 1.08;
    
    for (let i = 0; i < 50; i++) {
      const price = startPrice + (endPrice - startPrice) * (i / 49);
      let totalPnl = 0;
      
      activeLegs.forEach(leg => {
        if (!leg.isActive) return;
        
        const intrinsicValue = leg.type === 'CE' 
          ? Math.max(0, price - leg.strikePrice)
          : Math.max(0, leg.strikePrice - price);
        
        const legPnl = (leg.action === 'Buy' ? 1 : -1) * (intrinsicValue - leg.premium) * leg.lotSize * leg.quantity;
        totalPnl += legPnl;
      });
      
      data.push({
        price: price,
        pnl: totalPnl,
      });
    }
    
    return data;
  }, [spotPrice, activeLegs]);

  const maxProfit = useMemo(() => {
    const pnlAtMin = payoffData[0]?.pnl || 0;
    const pnlAtMax = payoffData[payoffData.length - 1]?.pnl || 0;
    return Math.max(pnlAtMin, pnlAtMax);
  }, [payoffData]);

  const maxLoss = useMemo(() => {
    const pnlValues = payoffData.map(d => d.pnl);
    return pnlValues.length > 0 ? Math.min(...pnlValues) : 0;
  }, [payoffData]);

  const breakevenPoints = useMemo(() => {
    const points: number[] = [];
    for (let i = 0; i < payoffData.length - 1; i++) {
      const current = payoffData[i];
      const next = payoffData[i + 1];
      if (current.pnl === 0) points.push(current.price);
      else if (current.pnl * next.pnl < 0) {
        const denom = Math.abs(current.pnl) + Math.abs(next.pnl);
        const t = denom > 0 ? Math.abs(current.pnl) / denom : 0;
        points.push(current.price + (next.price - current.price) * t);
      }
    }
    return points;
  }, [payoffData]);

  const netPremium = useMemo(() => {
    let net = 0;
    activeLegs.forEach(leg => {
      if (leg.isActive) {
        net += (leg.action === 'Buy' ? -1 : 1) * leg.premium * leg.lotSize * leg.quantity;
      }
    });
    return net;
  }, [activeLegs]);

  const riskRewardRatio = useMemo(() => {
    if (maxLoss === 0 || isNaN(maxLoss) || isNaN(maxProfit)) return 'N/A';
    return (maxProfit / Math.abs(maxLoss)).toFixed(2);
  }, [maxProfit, maxLoss]);

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">Options Strategy Builder</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">Create and visualize multi-leg option strategies</p>
            </div>
          </div>
          <button
            onClick={calculateMetrics}
            disabled={isCalculating}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold rounded-lg shadow-lg hover:shadow-emerald-500/25 transition-all disabled:opacity-50"
          >
            {isCalculating ? <Calculator className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Calculate P&L
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-1 space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Index Selection</label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(INDEX_CONFIG).map(([index, cfg]) => (
                  <button
                    key={index}
                    onClick={() => handleIndexChange(index as any)}
                    className={`p-3 rounded-lg border transition-all ${selectedIndex === index
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-400 dark:text-emerald-400'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="text-sm font-bold">{index}</div>
                    <div className="text-xs opacity-70">Lot: {cfg.lotSize}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Spot Price</label>
              <input
                type="number"
                value={spotPrice}
                onChange={(e) => setSpotPrice(Number(e.target.value))}
                className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white font-mono font-bold"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Preset Strategies</label>
              <div className="space-y-2">
                {PRESET_STRATEGIES.map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => applyPreset(preset.name)}
                    className="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors text-left"
                  >
                    <div className="text-sm font-bold">{preset.name}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">{preset.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-bold text-slate-900 dark:text-white">Strategy Builder</h4>
              <button
                onClick={addLeg}
                disabled={legs.length >= 4}
                className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded-lg border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4" /> Add Leg
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {legs.map((leg, idx) => (
                <motion.div
                  key={leg.id}
                  layout
                  className={`p-4 rounded-lg border transition-all ${leg.isActive
                    ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                    : 'bg-slate-50/50 dark:bg-slate-900/30 border-slate-200/50 dark:border-slate-800/50 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleLegActive(leg.id)}
                        className={`w-8 h-8 rounded-lg border-2 transition-colors ${leg.isActive
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'bg-slate-200 border-slate-400 dark:bg-slate-700 dark:border-slate-600'
                        }`}
                      >
                        {leg.isActive && <CheckCircle2 className="w-5 h-5" />}
                      </button>
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Leg {idx + 1}</span>
                    </div>
                    <button
                      onClick={() => removeLeg(leg.id)}
                      className="p-1 text-slate-500 hover:text-rose-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Type</label>
                      <select
                        value={leg.type}
                        onChange={(e) => updateLeg(leg.id, 'type', e.target.value as 'CE' | 'PE')}
                        className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                      >
                        <option value="CE">CE</option>
                        <option value="PE">PE</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Action</label>
                      <select
                        value={leg.action}
                        onChange={(e) => updateLeg(leg.id, 'action', e.target.value as 'Buy' | 'Sell')}
                        className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                      >
                        <option value="Buy">Buy</option>
                        <option value="Sell">Sell</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Strike</label>
                      <input
                        type="number"
                        value={leg.strikePrice}
                        onChange={(e) => updateLeg(leg.id, 'strikePrice', Number(e.target.value))}
                        className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Premium</label>
                      <input
                        type="number"
                        value={leg.premium}
                        onChange={(e) => updateLeg(leg.id, 'premium', Number(e.target.value))}
                        className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Lot Size</label>
                      <input
                        type="number"
                        value={leg.lotSize}
                        onChange={(e) => updateLeg(leg.id, 'lotSize', Number(e.target.value))}
                        className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Qty</label>
                      <input
                        type="number"
                        value={leg.quantity}
                        onChange={(e) => updateLeg(leg.id, 'quantity', Number(e.target.value))}
                        className="w-full p-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm font-mono"
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Max Profit</span>
            </div>
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
              {isCalculating ? 'Calculating...' : formatCurrency(maxProfit)}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-950/30 dark:to-red-950/30 border border-rose-200 dark:border-rose-800">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <span className="text-xs font-bold text-rose-800 dark:text-rose-300">Max Loss</span>
            </div>
            <p className="text-lg font-bold text-rose-700 dark:text-rose-400">
              {isCalculating ? 'Calculating...' : formatCurrency(maxLoss)}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-xs font-bold text-blue-800 dark:text-blue-300">Risk/Reward</span>
            </div>
            <p className="text-lg font-bold text-blue-700 dark:text-blue-400">
              {isCalculating ? 'Calculating...' : riskRewardRatio}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 border border-purple-200 dark:border-purple-800">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span className="text-xs font-bold text-purple-800 dark:text-purple-300">Net Premium</span>
            </div>
            <p className="text-lg font-bold text-purple-700 dark:text-purple-400">
              {isCalculating ? 'Calculating...' : formatCurrency(netPremium)}
            </p>
          </div>

          {breakevenPoints.length > 0 && (
            <div className="md:col-span-2 lg:col-span-4 p-4 rounded-lg bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-bold text-amber-800 dark:text-amber-300">Break-even Points</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {breakevenPoints.map((point, idx) => (
                  <span key={idx} className="px-3 py-1 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 text-sm font-mono">
                    {formatCurrency(point)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OptionsPlayground; 