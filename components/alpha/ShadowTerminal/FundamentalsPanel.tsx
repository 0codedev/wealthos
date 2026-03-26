import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { Tabs } from '../../ui/AnimatedTabs';
import { upstoxMarketDataService } from '../../../services/UpstoxMarketDataService';
import { 
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip as ChartTooltip,
  PieChart, Pie, Cell
} from 'recharts';
import { 
  Building2, Percent, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, 
  DollarSign, Briefcase, Activity, AlertCircle, Coins, Award, Users, Scale
} from 'lucide-react';
import { CapabilityWarningDot } from '../../shared/CapabilityWarningDot';
import { useMarketContext } from '../../../hooks/useMarketContext';
import { DataFreshnessTag } from '../../shared/DataFreshnessTag';
import { formatNumberIndian } from '../../../utils/helpers';

interface FundamentalsPanelProps {
  symbol: string;
  gFactor: number;
}

type SubTab = 'profile' | 'financials' | 'shareholding' | 'peers';

const FundamentalsPanel: React.FC<FundamentalsPanelProps> = ({ symbol, gFactor }) => {
  const { context } = useMarketContext('NSE:' + symbol);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('profile');
  const [isLoading, setIsLoading] = useState(true);
  const [isin, setIsin] = useState<string | null>(null);
  
  // States for aspects
  const [profile, setProfile] = useState<any>(null);
  const [ratios, setRatios] = useState<any>(null);
  const [shareholding, setShareholding] = useState<any>(null);
  const [competitors, setCompetitors] = useState<any>(null);
  const [actions, setActions] = useState<any>(null);

  // Resolve ISIN and fetch data on mount/change
  useEffect(() => {
    let active = true;
    setIsLoading(true);
    
    const loadData = async () => {
      try {
        const resolved = await upstoxMarketDataService.resolveSymbol(symbol);
        if (!active) return;
        
        const resolvedIsin = resolved?.isin || 'MOCK_' + symbol;
        setIsin(resolvedIsin);

        // Fetch all aspects in parallel
        const [profData, ratioData, shareData, compData, actData] = await Promise.all([
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'profile', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'key-ratios', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'shareholding', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'competitors', symbol),
          upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'corporate-actions', symbol)
        ]);

        if (!active) return;
        setProfile(profData);
        setRatios(ratioData);
        setShareholding(shareData);
        setCompetitors(compData);
        setActions(actData);
      } catch (err) {
        console.error("Error loading fundamentals data:", err);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadData();
    
    return () => {
      active = false;
    };
  }, [symbol]);

  // F.5.1: Calculate Fundamental Score (0 - 100)
  const fundamentalScore = useMemo(() => {
    if (!ratios || !shareholding) return 0;
    
    let score = 0;
    
    // 1. ROE > 15% -> +20 pts
    if (ratios.roe > 15) score += 20;
    // 2. ROCE > 15% -> +15 pts
    if (ratios.roce > 15) score += 15;
    // 3. Debt/Equity < 0.5 -> +15 pts
    if (ratios.debt_to_equity < 0.5) score += 15;
    // 4. Revenue Growth YoY > 10% -> +20 pts
    if (ratios.revenue_growth_yoy > 10) score += 20;
    // 5. Margin improvement -> +15 pts
    if (ratios.profit_margin_improvement) score += 15;
    // 6. FII accumulation -> +15 pts
    const q = shareholding.quarters;
    if (q && q.length >= 2) {
      const latestFii = q[q.length - 1].fii;
      const prevFii = q[q.length - 2].fii;
      if (latestFii > prevFii) score += 15;
    }
    
    return score;
  }, [ratios, shareholding]);

  // F.5.3: Composite Alpha Score
  const compositeAlphaScore = useMemo(() => {
    const normGFactor = gFactor * 10; // normalize 0-10 to 0-100
    return Math.round((normGFactor * 0.6) + (fundamentalScore * 0.4));
  }, [gFactor, fundamentalScore]);

  // F.2.2: Shareholding Smart Money Flow Score
  const smartMoneyMetrics = useMemo(() => {
    if (!shareholding || !shareholding.quarters || shareholding.quarters.length < 2) {
      return { score: 0, signal: 'Neutral', fiiChange: 0, diiChange: 0 };
    }
    
    const q = shareholding.quarters;
    const latest = q[q.length - 1];
    const prev = q[q.length - 2];
    
    const fiiChange = latest.fii - prev.fii;
    const diiChange = latest.dii - prev.dii;
    const pledgeChange = (latest.pledged || 0) - (prev.pledged || 0);
    
    const score = Number(((fiiChange * 2) + (diiChange * 1.5) - (pledgeChange * 3)).toFixed(2));
    
    let signal = 'Neutral';
    if (score > 1.5) signal = 'Strong Institutional Accumulation';
    else if (score > 0) signal = 'Mild Accumulation';
    else if (score < -1.5) signal = 'Institutional Distribution / Exit';
    else if (score < 0) signal = 'Mild Distribution';
    
    return { score, signal, fiiChange, diiChange };
  }, [shareholding]);

  // F.4.4: Relative Valuation Signal (PE premium/discount to sector average)
  const relativeValuation = useMemo(() => {
    if (!competitors || !ratios) return { discount: 0, label: 'N/A', avgPE: 0 };
    
    const currentPE = ratios.pe_ratio;
    // Find average PE of competitors (excluding current stock to get peer average)
    const peers = competitors.filter((c: any) => c.symbol !== symbol);
    if (peers.length === 0) return { discount: 0, label: 'N/A', avgPE: 0 };
    
    const totalPeersPE = peers.reduce((sum: number, c: any) => sum + (c.pe || 0), 0);
    const avgPE = totalPeersPE / peers.length;
    
    if (avgPE === 0) return { discount: 0, label: 'N/A', avgPE: 0 };
    
    const diff = ((currentPE - avgPE) / avgPE) * 100;
    const discount = -diff; // negative difference is a discount
    
    let label = '';
    if (discount > 10) label = `Trading at a ${discount.toFixed(1)}% discount to peers`;
    else if (discount < -10) label = `Trading at a ${Math.abs(discount).toFixed(1)}% premium to peers`;
    else label = 'Trading in-line with peer valuation';
    
    return { discount, label, avgPE };
  }, [competitors, ratios, symbol]);

  if (isLoading) {
    return (
      <div className="flex-grow flex flex-col items-center justify-center h-[340px] text-slate-500">
        <Activity className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
        <p className="text-[10px] font-black uppercase tracking-widest">Compiling Fundamentals...</p>
      </div>
    );
  }

  // Render Sub-tabs
  const renderTabContent = () => {
    switch (activeSubTab) {
      case 'profile':
        return (
          <div className="space-y-3.5">
            {/* Description */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30">
              <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest block mb-1.5 flex items-center gap-1">
                <Building2 className="w-3 h-3" /> Company Profile
              </span>
              <p className="text-slate-300 text-[10px] leading-relaxed">
                {profile?.description}
              </p>
            </div>
            
            {/* Sector / Industry info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-800/30 rounded-xl p-2.5 border border-slate-700/30 text-center">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Sector</span>
                <span className="text-xs font-black text-slate-200">{profile?.sector}</span>
              </div>
              <div className="bg-slate-800/30 rounded-xl p-2.5 border border-slate-700/30 text-center">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Industry</span>
                <span className="text-xs font-black text-slate-200">{profile?.industry}</span>
              </div>
            </div>

            {/* Market Cap card */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30 flex justify-between items-center">
              <div>
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Market Cap (INR)</span>
                <span className="text-sm font-black text-emerald-400">
                  ₹{profile?.market_cap ? (profile.market_cap / 1000).toFixed(2) + 'k Cr' : 'N/A'}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Market Cap (USD)</span>
                <span className="text-xs font-black text-slate-300">
                  ${profile?.market_cap_usd ? (profile.market_cap_usd / 1000).toFixed(2) + 'B' : 'N/A'}
                </span>
              </div>
            </div>

            {/* Valuation status */}
            <div className="bg-slate-850/50 rounded-xl p-3 border border-indigo-500/20 text-center">
              <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest block mb-1">Valuation Status</span>
              <span className="text-xs font-black text-white">{relativeValuation.label}</span>
              <div className="text-[9px] text-slate-500 mt-1 font-bold">
                Symbol P/E: <span className="text-indigo-400">{ratios?.pe_ratio}</span> vs Sector Avg P/E: <span className="text-indigo-400">{relativeValuation.avgPE?.toFixed(1)}</span>
              </div>
            </div>
          </div>
        );
        
      case 'financials':
        return (
          <div className="space-y-3.5">
            {/* TTM Metrics Grid */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-800/20 rounded-lg p-1.5 border border-slate-800">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">ROE</span>
                <span className="text-xs font-black text-white">{ratios?.roe}%</span>
              </div>
              <div className="bg-slate-800/20 rounded-lg p-1.5 border border-slate-800">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">ROCE</span>
                <span className="text-xs font-black text-white">{ratios?.roce}%</span>
              </div>
              <div className="bg-slate-800/20 rounded-lg p-1.5 border border-slate-800">
                <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest block">D/E</span>
                <span className="text-xs font-black text-white">{ratios?.debt_to_equity}</span>
              </div>
            </div>

            {/* Income snapshot */}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="bg-slate-800/30 rounded-xl p-2 border border-slate-700/30 flex justify-between items-center">
                <span className="text-slate-500 font-bold uppercase tracking-wider">Revenue</span>
                <span className="font-black text-slate-300">₹{formatNumberIndian(ratios?.revenue_ttm)}Cr</span>
              </div>
              <div className="bg-slate-800/30 rounded-xl p-2 border border-slate-700/30 flex justify-between items-center">
                <span className="text-slate-500 font-bold uppercase tracking-wider">Net Profit</span>
                <span className="font-black text-emerald-400">₹{formatNumberIndian(ratios?.net_profit_ttm)}Cr</span>
              </div>
              <div className="bg-slate-800/30 rounded-xl p-2 border border-slate-700/30 flex justify-between items-center">
                <span className="text-slate-500 font-bold uppercase tracking-wider">Cash</span>
                <span className="font-black text-slate-300">₹{formatNumberIndian(ratios?.cash)}Cr</span>
              </div>
              <div className="bg-slate-800/30 rounded-xl p-2 border border-slate-700/30 flex justify-between items-center">
                <span className="text-slate-500 font-bold uppercase tracking-wider">Debt</span>
                <span className="font-black text-rose-400">₹{formatNumberIndian(ratios?.debt)}Cr</span>
              </div>
            </div>

            {/* Financial Trend chart */}
            <div className="bg-slate-800/20 rounded-xl p-3 border border-slate-800/50">
              <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest block mb-2 flex items-center justify-between">
                <span>Revenue & Profit (8-Qtr Trend)</span>
                <span className="text-[8px] text-slate-500 font-bold tracking-tight lowercase">bars=rev, line=profit</span>
              </span>
              <div className="h-[120px] w-full">
                <SafeChartContainer>
                  <ComposedChart data={ratios?.quarters || []} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                    <XAxis dataKey="period" stroke="#475569" fontSize={8} tickLine={false} />
                    <YAxis yAxisId="left" stroke="#3b82f6" fontSize={8} tickLine={false} />
                    <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={8} tickLine={false} />
                    <ChartTooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                      labelStyle={{ fontSize: '9px', fontWeight: 'bold', color: '#fff' }}
                      itemStyle={{ fontSize: '9px' }}
                    />
                    <Bar yAxisId="left" dataKey="revenue" fill="#3b82f6" opacity={0.65} radius={[2, 2, 0, 0]} name="Revenue" />
                    <Line yAxisId="right" type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} name="Profit" />
                  </ComposedChart>
                </SafeChartContainer>
              </div>
            </div>
          </div>
        );
        
      case 'shareholding':
        const SH_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899'];
        const shareholdingData = [
          { name: 'Promoters', value: shareholding?.promoter || 0 },
          { name: 'FIIs', value: shareholding?.fii || 0 },
          { name: 'DIIs', value: shareholding?.dii || 0 },
          { name: 'Public', value: shareholding?.public || 0 }
        ].filter(d => d.value > 0);

        return (
          <div className="space-y-3">
            {/* Donut Chart & Legend Row */}
            <div className="flex items-center justify-between gap-4">
              <div className="h-[100px] w-[100px] shrink-0">
                <SafeChartContainer>
                  <PieChart>
                    <Pie
                      data={shareholdingData}
                      cx="50%"
                      cy="50%"
                      innerRadius={28}
                      outerRadius={42}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {shareholdingData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={SH_COLORS[index % SH_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </SafeChartContainer>
              </div>

              {/* Legend Grid */}
              <div className="flex-grow grid grid-cols-2 gap-x-2 gap-y-1.5 text-[10px]">
                {shareholdingData.map((d, index) => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SH_COLORS[index % SH_COLORS.length] }} />
                    <span className="text-slate-500 font-bold">{d.name}</span>
                    <span className="font-black text-slate-200 ml-auto font-mono">{d.value.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Smart Money Flow Score Card */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1">
                  <Users className="w-3 h-3" /> Smart Money Compass
                </span>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                  smartMoneyMetrics.score > 0 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                }`}>
                  Score: {smartMoneyMetrics.score > 0 ? '+' : ''}{smartMoneyMetrics.score}
                </span>
              </div>
              <p className="text-[10px] font-bold text-slate-300">{smartMoneyMetrics.signal}</p>
              
              {/* Institutional Delta stats */}
              <div className="grid grid-cols-2 gap-4 border-t border-slate-800/50 pt-2 text-[9px] font-bold">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 uppercase">FII change:</span>
                  <span className={`font-mono ${(smartMoneyMetrics.fiiChange ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {smartMoneyMetrics.fiiChange != null ? `${smartMoneyMetrics.fiiChange >= 0 ? '↑ +' : '↓ '}${smartMoneyMetrics.fiiChange.toFixed(2)}%` : '--'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 uppercase">DII change:</span>
                  <span className={`font-mono ${(smartMoneyMetrics.diiChange ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {smartMoneyMetrics.diiChange != null ? `${smartMoneyMetrics.diiChange >= 0 ? '↑ +' : '↓ '}${smartMoneyMetrics.diiChange.toFixed(2)}%` : '--'}
                  </span>
                </div>
              </div>
            </div>

            {/* Promoter Pledge Stat */}
            <div className="bg-slate-800/20 rounded-xl p-2.5 border border-slate-800 flex justify-between items-center text-[10px]">
              <span className="text-slate-500 font-bold uppercase tracking-wider">Promoter Pledge Status</span>
              <span className={`font-black ${shareholding?.promoter_pledged > 0 ? 'text-amber-500 animate-pulse' : 'text-emerald-400'}`}>
                {shareholding?.promoter_pledged > 0 ? `${shareholding.promoter_pledged}% PLEDGED` : '0% PLEDGES (SAFE)'}
              </span>
            </div>
          </div>
        );
        
      case 'peers':
        return (
          <div className="space-y-3 overflow-x-auto no-scrollbar">
            <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest block flex items-center gap-1 mb-1">
              <Scale className="w-3 h-3" /> Peer Comparison Table
            </span>
            <table className="w-full text-left text-[9px] whitespace-nowrap">
              <thead>
                <tr className="bg-slate-950/40 text-slate-500 font-black uppercase tracking-wider border-b border-slate-800">
                  <th className="py-2 pl-2">Company</th>
                  <th className="py-2 text-right">P/E</th>
                  <th className="py-2 text-right">P/B</th>
                  <th className="py-2 text-right">ROE%</th>
                  <th className="py-2 text-right">Growth%</th>
                  <th className="py-2 text-right pr-2">Margin%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850">
                {competitors?.map((c: any) => {
                  const isCurrent = c.symbol === symbol;
                  const betterPE = ratios && (c.pe < ratios.pe_ratio);
                  const betterROE = ratios && (c.roe > ratios.roe);
                  
                  return (
                    <tr key={c.symbol} className={`hover:bg-slate-800/10 ${isCurrent ? 'bg-indigo-500/10 border-l-2 border-indigo-500' : ''}`}>
                      <td className="py-2 pl-2 font-black text-slate-300">
                        {c.symbol}
                      </td>
                      <td className={`py-2 text-right font-mono font-bold ${isCurrent ? 'text-indigo-400 font-black' : (betterPE ? 'text-emerald-400' : 'text-slate-400')}`}>
                        {c.pe?.toFixed(1)}
                      </td>
                      <td className="py-2 text-right font-mono text-slate-400">{c.pb?.toFixed(1)}</td>
                      <td className={`py-2 text-right font-mono font-bold ${isCurrent ? 'text-indigo-400 font-black' : (betterROE ? 'text-emerald-400' : 'text-slate-400')}`}>
                        {c.roe?.toFixed(1)}%
                      </td>
                      <td className="py-2 text-right font-mono text-slate-400">{c.revenue_growth?.toFixed(1)}%</td>
                      <td className="py-2 text-right font-mono text-slate-400 pr-2">{c.profit_margin?.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
    }
  };

  return (
    <div className="flex-grow flex flex-col overflow-hidden h-full">
      {/* Discrepancy Warnings */}
      {context?.discrepancies && context.discrepancies.length > 0 && context.discrepancies[0] && (
        <div className="mb-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2 text-[10px] text-amber-400">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-bold uppercase tracking-wider block">Price Discrepancy Flagged</span>
            <p className="font-medium text-slate-300 mt-0.5">
              Divergence between Upstox (₹{context.discrepancies[0].upstoxValue}) and Dhan (₹{context.discrepancies[0].dhanValue}) is {((context.discrepancies[0].delta || 0) * 100).toFixed(2)}%.
            </p>
          </div>
        </div>
      )}

      {/* Freshness/Trust Banner */}
      {context && (
        <div className="mb-3 flex items-center justify-between bg-slate-900/40 p-2 rounded-xl border border-slate-800/80">
          <span className="text-[9px] font-bold text-slate-400 uppercase">Context Telemetry</span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono font-bold text-slate-500">Trust Score: {context.trustScore}%</span>
            <DataFreshnessTag fetchedAt={context.asOf} source={context.trustScore >= 70 ? 'live' : 'cache'} />
          </div>
        </div>
      )}

      {/* Overview Score Card Row */}
      <div className="grid grid-cols-2 gap-3 mb-4 shrink-0">
        <div className="bg-slate-800/30 rounded-xl p-2.5 border border-slate-700/30 text-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-1 opacity-5">
            <Coins className="w-8 h-8" />
          </div>
          <span className="text-[7.5px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">
            Fundamental Score
            <CapabilityWarningDot capability="fundamentals" />
          </span>
          <span className={`text-xl font-black font-mono ${
            fundamentalScore >= 70 ? 'text-emerald-400' : fundamentalScore >= 40 ? 'text-amber-400' : 'text-rose-400'
          }`}>
            {fundamentalScore}<span className="text-[10px] text-slate-500 font-normal">/100</span>
          </span>
        </div>
        
        <div className="bg-slate-800/30 rounded-xl p-2.5 border border-slate-700/30 text-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-1 opacity-5">
            <Award className="w-8 h-8" />
          </div>
          <span className="text-[7.5px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Composite Alpha Score</span>
          <span className={`text-xl font-black font-mono ${
            compositeAlphaScore >= 70 ? 'text-emerald-400' : compositeAlphaScore >= 50 ? 'text-amber-400' : 'text-rose-400'
          }`}>
            {compositeAlphaScore}<span className="text-[10px] text-slate-500 font-normal">/100</span>
          </span>
        </div>
      </div>

      {/* Aspects Toggle Bar */}
      <Tabs.Root
        value={activeSubTab}
        onChange={(val) => setActiveSubTab(val as SubTab)}
        variant="solid-indigo"
        layoutId="fundamentals-aspects-tabs"
        motionPreset="spring"
        className="mb-3 shrink-0 select-none"
      >
        <Tabs.List className="flex bg-slate-950/50 p-1 rounded-xl border border-slate-800/80">
          {(['profile', 'financials', 'shareholding', 'peers'] as SubTab[]).map(tab => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className="flex-1 py-1.5 text-[8.5px] font-black uppercase tracking-wider text-center"
            >
              {tab}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      {/* Tab contents area with scroll container */}
      <div className="flex-grow overflow-y-auto pr-1 select-none scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
        {renderTabContent()}
      </div>

      {/* Corporate actions notification footer */}
      {actions && actions.length > 0 && (
        <div className="mt-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-2 shrink-0 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <div className="text-[9px] leading-tight text-slate-400">
            <span className="font-black text-slate-300 uppercase tracking-wider mr-1">Ex-Date ({actions[0].ex_date}):</span>
            {actions[0].details}
          </div>
        </div>
      )}
    </div>
  );
};

export default FundamentalsPanel;
