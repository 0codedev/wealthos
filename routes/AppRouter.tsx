import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Investment, MarketStatus, ASSET_CLASS_COLORS, PortfolioStats } from '../types';
import { Trade } from '../database';
import { DashboardSkeleton, AdvisorSkeleton, BacktesterSkeleton, StockResearchSkeleton, IPOWarRoomSkeleton } from '../components/shared/Skeleton';
import { CustomTooltip } from '../components/shared/CustomTooltip';
import { PrivacyValue } from '../components/shared/PrivacyComponents';
import { DataFreshnessProvider } from '../components/shared/DataFreshnessProvider';
import { formatCurrency, formatCurrencyPrecise, calculatePercentage } from '../utils/helpers';
import { ErrorBoundary } from '../components/ErrorBoundary';

// Lazy Loaded Tabs
const DashboardTab = lazy(() => import('../components/tabs/DashboardTab'));
const PortfolioTab = lazy(() => import('../components/tabs/PortfolioTab').then(m => ({ default: m.PortfolioTab })));
const PsychDashboard = lazy(() => import('../components/PsychDashboard'));
const MacroPulse = lazy(() => import('../components/tabs/MacroPulse'));
const AdvisorTab = lazy(() => import('../components/tabs/AdvisorTab'));
const StrategyLab = lazy(() => import('../components/tabs/StrategyLab'));
const GoalGPS = lazy(() => import('../components/tabs/GoalGPS'));
const IPOWarRoom = lazy(() => import('../components/tabs/IPOWarRoom'));
const ComplianceShield = lazy(() => import('../components/tabs/ComplianceShield'));
const Academy = lazy(() => import('../components/tabs/Academy'));
const AlphaPredator = lazy(() => import('../components/growth/AlphaPredator'));
const PaperTrading = lazy(() => import('../components/tabs/market/PaperTrading').then(m => ({ default: m.PaperTrading })));
const StockResearch = lazy(() => import('../components/tabs/market/StockResearch'));
const OptionExpiryCalendar = lazy(() => import('../components/tabs/market/OptionExpiryCalendar').then(m => ({ default: m.OptionExpiryCalendar })));
const AgenticLab = lazy(() => import('../components/tabs/market/AgenticLab').then(m => ({ default: m.AgenticLab })));
const OptionChainIntel = lazy(() => import('../components/market/OptionChainIntel'));
const RetirementPlanner = lazy(() => import('../components/tabs/RetirementPlanner'));
const LegacyVault = lazy(() => import('../components/tabs/LegacyVault'));
const Boardroom = lazy(() => import('../components/innovation/Boardroom').then(m => ({ default: m.Boardroom })));
const BlackSwan = lazy(() => import('../components/innovation/BlackSwan').then(m => ({ default: m.BlackSwan })));
const OpportunityCost = lazy(() => import('../components/innovation/OpportunityCost').then(m => ({ default: m.OpportunityCost })));
const DynastyMode = lazy(() => import('../components/innovation/DynastyMode').then(m => ({ default: m.DynastyMode })));
const ImpulseCheck = lazy(() => import('../components/innovation/ImpulseCheck').then(m => ({ default: m.ImpulseCheck })));
const QuantDashboard = lazy(() => import('../components/analytics/QuantDashboard').then(m => ({ default: m.QuantDashboard })));
const FortressDashboard = lazy(() => import('../components/fortress/FortressDashboard').then(m => ({ default: m.FortressDashboard })));
const MathLabHub = lazy(() => import('../components/calculators/MathLabHub').then(m => ({ default: m.MathLabHub })));
const LiabilityVault = lazy(() => import('../components/innovation/LiabilityVault').then(m => ({ default: m.LiabilityVault })));
const SettingsDesktopView = lazy(() => import('../components/settings/SettingsDesktopView'));
const JournalReviewMode = lazy(() => import('../components/journal/JournalReviewMode'));
const AlphaEngineTab = lazy(() => import('../components/tabs/AlphaEngineTab').then(m => ({ default: m.AlphaEngineTab })));
const LaunchpadTab = lazy(() => import('../components/tabs/LaunchpadTab'));
const OptionsGreeksDashboard = lazy(() => import('../components/alpha/OptionsGreeksDashboard').then(m => ({ default: m.OptionsGreeksDashboard })));
const ApexBacktesterTab = lazy(() => import('../components/tabs/ApexBacktesterTab'));
const FinancialOracle = lazy(() => import('../components/oracle/FinancialOracle'));
const SignalIntelligenceHub = lazy(() => import('../components/signals/SignalIntelligenceHub').then(m => ({ default: m.SignalIntelligenceHub })));
const MasteryHub = lazy(() => import('../components/mastery/MasteryHub'));
const TelegramIntelHub = lazy(() => import('../components/tabs/TelegramIntelHub'));
const VibeTradingPanel = lazy(() => import('../components/VibeTradingPanel').then(m => ({ default: m.VibeTradingPanel })));
const PoolCategoryPage = lazy(() => import('../components/pool/PoolCategoryPage'));

const SectorRotationTab = lazy(() => import('../components/tools/SectorRotationTab'));
const SectoralFlowTab = lazy(() => import('../components/tools/SectoralFlowTab'));
const GlobalMarketsTab = lazy(() => import('../components/tools/GlobalMarketsTab'));
const PositionSizerTab = lazy(() => import('../components/tools/PositionSizerTab'));
const ReturnsCalculatorTab = lazy(() => import('../components/tools/ReturnsCalculatorTab'));
const CryptoMarkets = lazy(() => import('../components/CryptoMarkets').then(m => ({ default: m.CryptoMarkets })));
const StrategyLabV2 = lazy(() => import('../components/StrategyLab').then(m => ({ default: m.StrategyLab })));
const AlgoBots = lazy(() => import('../components/AlgoBots').then(m => ({ default: m.AlgoBots })));
const AIResearch = lazy(() => import('../components/AIResearch').then(m => ({ default: m.AIResearch })));
const TradeFinderModule = lazy(() => import('../src/modules/trade-finder/TradeFinderModule').then(m => ({ default: m.TradeFinderModule })));
const ProChartsTab = lazy(() => import('../components/tabs/ProChartsTab').then(m => ({ default: m.ProChartsTab })));




// New Journal Sub-Tabs (Refreshed)
const MistakesTab = lazy(() => import('../components/tabs/journal/MistakesTab'));

const ReportsTab = lazy(() => import('../components/tabs/journal/ReportsTab'));

import { resolveCommandActionRoute } from '../services/CommandActionRoutingService';
import { useNavigationIntentStore } from '../store/navigationIntentStore';
import { TabAIStrip } from '../components/ai/TabAIStrip';

import { usePortfolioStore } from '../store/portfolioStore';
import { useSettingsStore } from '../store/settingsStore';
import { shallow } from 'zustand/shallow';


interface AppRouterProps {
    activeSubTab: string;
    isPrivacyMode: boolean;
    isDarkMode: boolean;
    vix: number;
    marketStatus: MarketStatus | string;
    dashboardView: 'MAIN' | 'SPENDING' | 'MARKETS' | 'COMMUNITY';
    setDashboardView: (view: 'MAIN' | 'SPENDING' | 'MARKETS' | 'COMMUNITY') => void;
    setEditingInvestment: (inv: Investment | null) => void;
    setActiveCategory: (category: string) => void;
    setActiveSubTab: (subTab: string) => void;
    setIsAddModalOpen: (open: boolean) => void;
}

export const AppRouter: React.FC<AppRouterProps> = ({
    activeSubTab,
    isPrivacyMode,
    isDarkMode,
    vix,
    marketStatus,
    dashboardView,
    setDashboardView,
    setEditingInvestment,
    setActiveCategory,
    setActiveSubTab,
    setIsAddModalOpen
}) => {
    const setNavigationIntent = useNavigationIntentStore((state) => state.setIntent);
    const designPreset = useSettingsStore(s => s.designPreset);

    // On-demand mount tracker: core tabs mount on first activation and remain alive in DOM
    const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set([activeSubTab]));

    useEffect(() => {
        setVisitedTabs(prev => {
            if (prev.has(activeSubTab)) return prev;
            const next = new Set(prev);
            next.add(activeSubTab);
            return next;
        });
    }, [activeSubTab]);
    
    const investments = usePortfolioStore(s => s.investments);
    const stats = usePortfolioStore(s => s.stats);
    const allocationData = usePortfolioStore(s => s.allocationData);
    const assetClassData = usePortfolioStore(s => s.assetClassData);
    const platformData = usePortfolioStore(s => s.platformData);
    const history = usePortfolioStore(s => s.history);
    const lifeEvents = usePortfolioStore(s => s.lifeEvents);
    const addLifeEvent = usePortfolioStore(s => s.addLifeEvent);
    const deleteLifeEvent = usePortfolioStore(s => s.deleteLifeEvent);
    const deleteInvestment = usePortfolioStore(s => s.deleteInvestment);
    const updateInvestment = usePortfolioStore(s => s.updateInvestment);
    const refreshPortfolio = usePortfolioStore(s => s.refreshPortfolio);



    const dashboardProps = React.useMemo(() => ({
        isPrivacyMode,
        isDarkMode,
        onAddFirstAsset: () => setIsAddModalOpen(true),
        formatCurrency,
        formatCurrencyPrecise,
        calculatePercentage,
        ASSET_CLASS_COLORS,
        CustomTooltip,
        marketVix: vix,
        marketStatus: marketStatus as MarketStatus,
        view: dashboardView,
        onViewChange: setDashboardView,
        onQuickAction: (action: string) => {
            if (action === 'add') {
                setIsAddModalOpen(true);
                return;
            }

            const route = resolveCommandActionRoute(action);
            setNavigationIntent({
                target: route.category as any,
                action,
                createdAt: Date.now(),
            });
            setActiveCategory(route.category);
            if (route.subTab) {
                setActiveSubTab(route.subTab);
            }
        }
    }), [
        isPrivacyMode, isDarkMode, vix, marketStatus, dashboardView,
        setIsAddModalOpen, setDashboardView, setNavigationIntent, setActiveCategory, setActiveSubTab
    ]);

    // Internal switcher states for grouped innovation tabs
    const [innovationMode, setInnovationMode] = React.useState<'BOARD' | 'IMPULSE'>('BOARD');
    const [riskMode, setRiskMode] = React.useState<'STRESS' | 'REGRET' | 'LIABILITY'>('STRESS');

    const renderContent = () => {
        switch (activeSubTab) {
            case 'dashboard': return null; // Handled by parallel core tab wrapper
            case 'portfolio': return null; // Handled by parallel core tab wrapper
            case 'planning':
            case 'gps': return <GoalGPS />;
            case 'compliance': return (
                <ErrorBoundary message="Compliance Shield encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <ComplianceShield />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'vibe-trading':
            case 'vibe': return (
                <ErrorBoundary message="Vibe-Trading AI Workspace encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <VibeTradingPanel />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'algo-bots':
            case 'freqtrade': return (
                <ErrorBoundary message="Algo Bots Control Center encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <AlgoBots />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'ai-research':
            case 'finrl': return (
                <ErrorBoundary message="AI & Quantitative Research Lab encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <AIResearch />
                    </Suspense>
                </ErrorBoundary>
            );


            case 'vectorbt-lab':
            case 'backtrader-lab':
            case 'lumibot-lab':
            case 'strategy': 
            case 'simulators': return (
                <ErrorBoundary message="Strategy Lab encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <StrategyLab initialSubTab={activeSubTab} />
                    </Suspense>
                </ErrorBoundary>
            );

            case 'crypto-markets': return (
                <ErrorBoundary message="Crypto & Prediction Markets encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <CryptoMarkets />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'backtester': return (

                <ErrorBoundary message="Apex Backtester encountered an error." layout="card">
                    <Suspense fallback={<BacktesterSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="backtester" />
                            <ApexBacktesterTab />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'macro': return null; // Handled by parallel core tab wrapper
            case 'research': return (
                <ErrorBoundary message="Stock Research encountered an error." layout="card">
                    <Suspense fallback={<StockResearchSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="market" />
                            <StockResearch />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'expiry': return <div className="page-shell h-full"><OptionExpiryCalendar /></div>;
            case 'intel': return (
                <div className="page-shell flex flex-col gap-4">
                    <TabAIStrip tab="analytics" />
                    <OptionChainIntel />
                </div>
            );
            case 'paper': return (
                <div className="page-shell flex flex-col gap-4">
                    <TabAIStrip tab="trading" />
                    <PaperTrading />
                </div>
            );
            case 'agentic': return <div className="page-shell h-full"><AgenticLab /></div>;
            case 'ipo': return (
                <ErrorBoundary message="IPO War Room encountered an error." layout="card">
                    <Suspense fallback={<IPOWarRoomSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="ipo" />
                            <IPOWarRoom />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'advisor': return (
                <ErrorBoundary message="AI Advisor encountered an error." layout="card">
                    <Suspense fallback={<AdvisorSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="growth" />
                            <AdvisorTab onNavigate={setActiveCategory} />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'growth':
            case 'predator': return (
                <div className="page-shell flex flex-col gap-4">
                    <TabAIStrip tab="alpha" />
                    <AlphaPredator />
                </div>
            );
            case 'journal': return null; // Handled by parallel core tab wrapper


            case 'mistakes': return (
                <ErrorBoundary message="Mirror of Truth encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="journal" />
                            <MistakesTab />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'reports': return (
                <ErrorBoundary message="Reports Tab encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="journal" />
                            <ReportsTab />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'review': return (
                <ErrorBoundary message="Journal Review encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="journal" />
                            <JournalReviewMode />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'academy': return (
                <ErrorBoundary message="Academy encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="academy" />
                            <Academy />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'retirement': return (
                <ErrorBoundary message="Retirement Planner encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <RetirementPlanner />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'legacy': return (
                <ErrorBoundary message="Legacy Vault encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <LegacyVault />
                    </Suspense>
                </ErrorBoundary>
            );
            
            // --- Grouped Innovation (Moonshot Lab) ---
            case 'innovation':
            case 'boardroom': return (
                <ErrorBoundary message="Moonshot Lab (Boardroom) encountered an error.">
                    <div className="page-shell flex flex-col h-full">
                        <div className="flex gap-2 mb-4 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-xl w-fit">
                            <button 
                                onClick={() => setInnovationMode('BOARD')}
                                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${innovationMode === 'BOARD' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                AI Boardroom
                            </button>
                            <button 
                                onClick={() => setInnovationMode('IMPULSE')}
                                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${innovationMode === 'IMPULSE' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Anti-Impulse
                            </button>
                        </div>
                        {innovationMode === 'BOARD' ? <Boardroom /> : <ImpulseCheck />}
                    </div>
                </ErrorBoundary>
            );
            case 'risk': return (
                <ErrorBoundary message="Moonshot Lab (Risk) encountered an error.">
                    <div className="page-shell flex flex-col h-full">
                        <div className="flex gap-2 mb-4 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-xl w-fit">
                            <button 
                                onClick={() => setRiskMode('STRESS')}
                                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${riskMode === 'STRESS' ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Stress Lab
                            </button>
                            <button 
                                onClick={() => setRiskMode('REGRET')}
                                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${riskMode === 'REGRET' ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Regret Engine
                            </button>
                            <button 
                                onClick={() => setRiskMode('LIABILITY')}
                                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${riskMode === 'LIABILITY' ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Liability Hub
                            </button>
                        </div>
                        {riskMode === 'STRESS' ? <BlackSwan /> : riskMode === 'REGRET' ? <OpportunityCost /> : <LiabilityVault />}
                    </div>
                </ErrorBoundary>
            );
            case 'liability': return (
                <ErrorBoundary message="Moonshot Lab (Liability Vault) encountered an error.">
                    <LiabilityVault />
                </ErrorBoundary>
            );
            case 'dynasty': return (
                <ErrorBoundary message="Future Dynasty encountered an error.">
                    <DynastyMode />
                </ErrorBoundary>
            );

            case 'mathlab': return (
                <ErrorBoundary message="Math Lab encountered an error.">
                    <MathLabHub />
                </ErrorBoundary>
            );
            case 'quant': return (
                <ErrorBoundary message="Deep Quant encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <QuantDashboard />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'fortress':
            case 'fortress-center': return (
                <ErrorBoundary message="The Fortress encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <FortressDashboard />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'intraday': return (
                <ErrorBoundary message="Alpha Engine (Intraday) encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="momentum" />
                            <AlphaEngineTab activeSubTab="intraday" onTabChange={setActiveSubTab} />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'greeks': return (
                <ErrorBoundary message="Options Greeks Dashboard encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <OptionsGreeksDashboard />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'screener': return (
                <ErrorBoundary message="Alpha Engine (Screener) encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="momentum" />
                            <AlphaEngineTab activeSubTab="screener" onTabChange={setActiveSubTab} />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'heatmap': return (
                <ErrorBoundary message="Alpha Engine (Heatmap) encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="alpha" />
                            <AlphaEngineTab activeSubTab="heatmap" onTabChange={setActiveSubTab} />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'market-command': return (
                <ErrorBoundary message="Alpha Engine (Market Command Center) encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <div className="page-shell flex flex-col gap-4">
                            <TabAIStrip tab="alpha" />
                            <AlphaEngineTab activeSubTab="market-command" onTabChange={setActiveSubTab} />
                        </div>
                    </Suspense>
                </ErrorBoundary>
            );
            case 'launchpad': return <LaunchpadTab />;
            case 'oracle': return (
                <ErrorBoundary message="Predictive Oracle encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <FinancialOracle />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'signals': return (
                <ErrorBoundary message="Signal Intelligence Hub encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <SignalIntelligenceHub />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'mastery': return (
                <ErrorBoundary message="Mastery Hub encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <MasteryHub />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'telegram': return (
                <ErrorBoundary message="Telegram Intel Hub encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <TelegramIntelHub />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'pool':
            case 'watchlist':
            case 'verdicts':
            case 'sources':
                return (
                    <ErrorBoundary message="Momentum Pool encountered an error." layout="card">
                        <Suspense fallback={<DashboardSkeleton />}>
                            <PoolCategoryPage activeSubTab={activeSubTab === 'pool' ? 'watchlist' : activeSubTab} onTabChange={setActiveSubTab} />
                        </Suspense>
                    </ErrorBoundary>
                );
            case 'tools':
            case 'sector-analytics': return (
                <ErrorBoundary message="Sector Rotation Intelligence encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <SectorRotationTab />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'sectors-flow': return (
                <ErrorBoundary message="Sectoral Flow Terminal encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <SectoralFlowTab />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'globalmarket': return (
                <ErrorBoundary message="Global Markets Monitor encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <GlobalMarketsTab />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'calculator': return (
                <ErrorBoundary message="Precision Position Sizer encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <PositionSizerTab />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'returns-calc': return (
                <ErrorBoundary message="Returns Calculator encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <ReturnsCalculatorTab />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'charts': return (
                <ErrorBoundary message="Pro Charts Terminal encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <ProChartsTab />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'tradefinder': return (
                <ErrorBoundary message="TradeFinder Terminal encountered an error." layout="card">
                    <Suspense fallback={<DashboardSkeleton />}>
                        <TradeFinderModule />
                    </Suspense>
                </ErrorBoundary>
            );
            case 'settings': return null; // Handled by parallel core tab wrapper
            default: return null;
        }
    };

    const isCoreTab = ['dashboard', 'portfolio', 'settings', 'journal', 'analytics', 'playbook', 'mirror', 'calendar', 'mistakes', 'reports', 'macro'].includes(activeSubTab);
    const isJournalGroup = ['analytics', 'journal', 'playbook', 'mirror', 'calendar', 'mistakes', 'reports'].includes(activeSubTab);
    const hasVisitedJournal = isJournalGroup || Array.from(visitedTabs).some(t => ['analytics', 'journal', 'playbook', 'mirror', 'calendar', 'mistakes', 'reports'].includes(t));

    return (
        <div className="h-full w-full relative">
            {/* Core Tabs are mounted on-demand and kept alive in the DOM tree continuously to preserve scroll positions and state */}
            {visitedTabs.has('dashboard') && (
                <div style={{ display: activeSubTab === 'dashboard' ? 'block' : 'none' }} className="h-full w-full tab-fade-in">
                    <TabAIStrip tab="dashboard" />
                    <ErrorBoundary message="Dashboard encountered an error.">
                        <Suspense fallback={<DashboardSkeleton />}>
                            <DashboardTab {...dashboardProps as any} />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            )}
            {visitedTabs.has('portfolio') && (
                <div style={{ display: activeSubTab === 'portfolio' ? 'block' : 'none' }} className="h-full w-full tab-fade-in">
                    <TabAIStrip tab="portfolio" />
                    <ErrorBoundary message="Portfolio Hub encountered an error.">
                        <Suspense fallback={<DashboardSkeleton />}>
                            <PortfolioTab
                                onAddAsset={() => { setEditingInvestment(null); setIsAddModalOpen(true); }}
                                onEditAsset={(inv) => { setEditingInvestment(inv); setIsAddModalOpen(true); }}
                                isPrivacyMode={isPrivacyMode}
                                onNavigate={setActiveCategory}
                            />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            )}
            {visitedTabs.has('settings') && (
                <div style={{ display: activeSubTab === 'settings' ? 'block' : 'none' }} className="h-full w-full tab-fade-in">
                    <ErrorBoundary message="Settings encountered an error.">
                        <Suspense fallback={<DashboardSkeleton />}>
                            <SettingsDesktopView />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            )}
            {hasVisitedJournal && (
                <div style={{ display: isJournalGroup ? 'block' : 'none' }} className="h-full w-full tab-fade-in">
                    <TabAIStrip tab="journal" />
                    <ErrorBoundary message="Trading Journal encountered an error.">
                        <Suspense fallback={<DashboardSkeleton />}>
                            <PsychDashboard activeSubTab={activeSubTab} />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            )}
            {visitedTabs.has('macro') && (
                <div style={{ display: activeSubTab === 'macro' ? 'block' : 'none' }} className="h-full w-full tab-fade-in">
                    <TabAIStrip tab="market" />
                    <ErrorBoundary message="Macro Pulse encountered an error.">
                        <Suspense fallback={<DashboardSkeleton />}>
                            <MacroPulse />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            )}

            {/* Non-core tabs are rendered dynamically inside Suspense */}
            {!isCoreTab && (
                <Suspense fallback={<DashboardSkeleton />}>
                    {renderContent()}
                </Suspense>
            )}
        </div>
    );
};
