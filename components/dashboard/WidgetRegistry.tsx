import React, { Suspense, lazy } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import WidgetSkeleton from '../shared/WidgetSkeleton';

// Standard Widgets
import {
    TotalPLWidget, TopPerformerWidget, TotalHoldingsWidget, LoanWidgetWrapper,
    SpendingWidget, MarketWidget, CommunityWidget
} from './StandardWidgets';
import TaxHarvestingWidget from './widgets/TaxHarvestingWidget';
import CashflowLedgerWidget from './widgets/CashflowLedgerWidget';
import { RunwayGauge } from './RunwayGauge';
import { LiabilityWatchdogWidget } from './widgets/LiabilityWatchdogWidget';
import { LiveTradingVaultWidget } from './widgets/LiveTradingVaultWidget';
import { GoalThermometer } from './widgets/GoalThermometer';
import { GhostPortfolio } from './widgets/GhostPortfolio';

// Lazy Loaded Hubs & Enhancements
const FinancialCalendar = lazy(() => import('./widgets/FinancialCalendar'));
const HeatmapWidget = lazy(() => import('./widgets/HeatmapWidget'));
const AlertsManager = lazy(() => import('./widgets/AlertsManager'));
const TelegramQuickSend = lazy(() => import('./widgets/TelegramQuickSend').then(m => ({ default: m.TelegramQuickSend })));
const FortressHub = lazy(() => import('./hubs/FortressHub'));
const Project5LWidgetEnhanced = lazy(() => import('./widgets/Project5LWidget'));
const AICopilotWidget = lazy(() => import('./widgets/AICopilotWidget'));
const FIREDashboardWidget = lazy(() => import('./widgets/FIREDashboardWidget'));
const CorrelationMatrixWidget = lazy(() => import('./widgets/CorrelationMatrixWidget'));
const RebalancingWizard = lazy(() => import('./widgets/RebalancingWizard'));
const SmartActionsWidget = lazy(() => import('./widgets/SmartActionsWidget'));
const ExposureChartWidget = lazy(() => import('./ChartWidgets').then(module => ({ default: module.ExposureChartWidget })));
const PlatformChartWidget = lazy(() => import('./ChartWidgets').then(module => ({ default: module.PlatformChartWidget })));
const WealthSimulator = lazy(() => import('./WealthSimulator'));
const MilestoneTimelineWidget = lazy(() => import('./widgets/MilestoneTimelineWidget'));
const OptionChainWidget = lazy(() => import('./widgets/OptionChainWidget'));
const PsychologicalPnLWidget = lazy(() => import('./widgets/PsychologicalPnLWidget'));
const BacktesterWidget = lazy(() => import('./widgets/BacktesterWidget'));
const ShadowPortfolioWidget = lazy(() => import('./widgets/ShadowPortfolioWidget'));
const MissionControlWidget = lazy(() => import('./widgets/MissionControlWidget'));
const PortfolioGreeksWidget = lazy(() => import('./widgets/PortfolioGreeksWidget'));
const WebhookManagerWidget = lazy(() => import('./widgets/WebhookManagerWidget'));
const StockezeeBoosterWidget = lazy(() => import('./widgets/StockezeeBoosterWidget'));
const AlphaEngineHub = lazy(() => import('./hubs/AlphaEngineHub'));

// Agent O Ã¢â‚¬â€ Quant Analytics
const RiskScoreCardWidget = lazy(() => import('./widgets/RiskScoreCardWidget'));

// A2 — Macro Clock (RBI repo rate + India VIX)
const MacroClockWidget = lazy(() => import('./widgets/MacroClockWidget'));

// A4 — Daily 9 AM Telegram digest
const DailyDigestWidget = lazy(() => import('./widgets/DailyDigestWidget'));



// Power User Widgets
const XIRRTimeMachine = lazy(() => import('./widgets/XIRRTimeMachine'));
const SmartWatchlist = lazy(() => import('./widgets/SmartWatchlist'));
const DividendCalendar = lazy(() => import('./widgets/DividendCalendar'));

// Moonshot Widgets
const PortfolioConstellation = lazy(() => import('./widgets/PortfolioConstellation'));
const BlackSwanWarRoom = lazy(() => import('./widgets/BlackSwanWarRoom'));
const WealthTimeCapsule = lazy(() => import('./widgets/WealthTimeCapsule'));
const WealthDestinyGauge = lazy(() => import('../oracle/WealthDestinyGauge'));
const ScenarioComparison = lazy(() => import('../oracle/ScenarioComparison'));
const MasteryOverviewWidget = lazy(() => import('../mastery/MasteryOverviewWidget'));
const FinancialCalendarWidget = lazy(() => import('./widgets/FinancialCalendarWidget'));
// Agent M: Real-Time Market Intelligence (Phase 4)
const LivePortfolioPnL = lazy(() => import('../market/LivePortfolioPnL'));
const MarketSentimentRadar = lazy(() => import('../market/MarketSentimentRadar'));

export interface WidgetRegistryProps {
    id: string;
    isEditMode: boolean;
    formatCurrency: (val: number) => string;
    isPrivacyMode: boolean;
    stats: any;
    formatCurrencyPrecise: (val: number) => string;
    investments: any[];
    calculatePercentage: (part: number, total: number) => string;
    showNetWorth: boolean;
    targetNetWorth: number;
    assetClassData: any[];
    CustomTooltip: any;
    platformData: any[];
    isDarkMode: boolean;
    onViewChange: (view: 'MAIN' | 'SPENDING' | 'MARKETS' | 'COMMUNITY') => void;
    dynamicProjectionData: any[];
    onQuickAction: (action: string) => void;
    history: any[];
    lifeEvents: any[];
    addLifeEvent: any;
    deleteLifeEvent: any;
}

export const WidgetRegistry = React.memo(({
    id, isEditMode, formatCurrency, isPrivacyMode, stats, formatCurrencyPrecise,
    investments, calculatePercentage, showNetWorth, targetNetWorth,
    assetClassData, CustomTooltip, platformData, isDarkMode, onViewChange,
    dynamicProjectionData, onQuickAction, history, lifeEvents, addLifeEvent, deleteLifeEvent
}: WidgetRegistryProps) => {
    const commonProps = { dragHandle: isEditMode };

    switch (id) {
        case 'live-trading-vault':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full min-h-[300px]">
                        <LiveTradingVaultWidget formatCurrency={formatCurrency} isPrivacyMode={isPrivacyMode} />
                    </div>
                </ErrorBoundary>
            );
        case 'cashflow-ledger':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full min-h-[300px]">
                        <CashflowLedgerWidget />
                    </div>
                </ErrorBoundary>
            );
        case 'total-pl':
            return (
                <ErrorBoundary key={id}>
                    <TotalPLWidget id={id} {...commonProps} stats={stats} isPrivacyMode={isPrivacyMode} formatCurrency={formatCurrency} formatCurrencyPrecise={formatCurrencyPrecise} />
                </ErrorBoundary>
            );
        case 'top-performer':
            return (
                <ErrorBoundary key={id}>
                    <TopPerformerWidget id={id} {...commonProps} stats={stats} investments={investments} calculatePercentage={calculatePercentage} />
                </ErrorBoundary>
            );
        case 'total-holdings':
            return (
                <ErrorBoundary key={id}>
                    <TotalHoldingsWidget id={id} {...commonProps} investments={investments} stats={stats} isPrivacyMode={isPrivacyMode} />
                </ErrorBoundary>
            );
        case 'loan-widget':
            return (
                <ErrorBoundary key={id}>
                    <LoanWidgetWrapper id={id} {...commonProps} />
                </ErrorBoundary>
            );
        case 'project-5l':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Project 5L" />}>
                            <Project5LWidgetEnhanced
                                currentWealth={showNetWorth ? (stats?.totalValue || 0) : (stats?.totalAssets || 0)}
                                targetWealth={targetNetWorth}
                                monthlyContribution={25000}
                                expectedReturn={12}
                                isNetWorth={showNetWorth}
                            />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'exposure-chart':
            return (
                <ErrorBoundary key={id}>
                    <Suspense fallback={<WidgetSkeleton title="Asset Allocation" />}>
                        <ExposureChartWidget id={id} {...commonProps} allocationData={assetClassData} investments={investments} CustomTooltip={CustomTooltip} isPrivacyMode={isPrivacyMode} formatCurrency={formatCurrency} calculatePercentage={calculatePercentage} />
                    </Suspense>
                </ErrorBoundary>
            );
        case 'platform-chart':
            return (
                <ErrorBoundary key={id}>
                    <Suspense fallback={<WidgetSkeleton title="Platform Diversification" />}>
                        <PlatformChartWidget id={id} {...commonProps} platformData={platformData} isDarkMode={isDarkMode} isPrivacyMode={isPrivacyMode} CustomTooltip={CustomTooltip} />
                    </Suspense>
                </ErrorBoundary>
            );
        case 'tax-harvesting':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full min-h-[300px]">
                        <TaxHarvestingWidget investments={investments} />
                    </div>
                </ErrorBoundary>
            );
        case 'fortress-hub':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Fortress Hub" />}>
                            <FortressHub />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'spending-widget':
            return (
                <ErrorBoundary key={id}>
                    <SpendingWidget id={id} {...commonProps} onClick={() => onViewChange('SPENDING')} />
                </ErrorBoundary>
            );
        case 'market-widget':
            return (
                <ErrorBoundary key={id}>
                    <MarketWidget id={id} {...commonProps} onClick={() => onViewChange('MARKETS')} />
                </ErrorBoundary>
            );
        case 'macro-clock':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Macro Clock" />}>
                            <MacroClockWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'daily-digest':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Daily Digest" />}>
                            <DailyDigestWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'community-widget':
            return (
                <ErrorBoundary key={id}>
                    <CommunityWidget id={id} {...commonProps} onClick={() => onViewChange('COMMUNITY')} />
                </ErrorBoundary>
            );
        case 'calendar':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full min-h-[400px]">
                        <Suspense fallback={<WidgetSkeleton title="Financial Calendar" />}>
                            <FinancialCalendar investments={investments} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'wealth-simulator':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Wealth Simulator" />}>
                            <WealthSimulator projectionData={dynamicProjectionData} isDarkMode={isDarkMode} formatCurrency={formatCurrency} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'smart-actions-widget':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Smart Actions" />}>
                            <SmartActionsWidget onQuickAction={onQuickAction} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'heatmap':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full min-h-[400px]">
                        <Suspense fallback={<WidgetSkeleton title="Market Heatmap" />}>
                            <HeatmapWidget history={history} isDarkMode={isDarkMode} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'alerts-widget':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Alerts" />}>
                            <AlertsManager investments={investments} formatCurrency={formatCurrency} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'telegram-quick-send':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Telegram Quick Send" />}>
                            <TelegramQuickSend />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'ai-copilot':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="AI Copilot" />}>
                            <AICopilotWidget formatCurrency={formatCurrency} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'fire-dashboard':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="FIRE Dashboard" />}>
                            <FIREDashboardWidget stats={stats} formatCurrency={formatCurrency} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'correlation-matrix':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Correlation Matrix" />}>
                            <CorrelationMatrixWidget investments={investments} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'rebalancing-wizard':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Rebalancing Wizard" />}>
                            <RebalancingWizard investments={investments} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'runway-gauge':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <RunwayGauge />
                    </div>
                </ErrorBoundary>
            );
        case 'liability-watchdog':
            return (
                <ErrorBoundary key={id}>
                    <div className={`h-full transition-opacity duration-300 ${!showNetWorth ? 'opacity-50 grayscale' : 'opacity-100'}`}>
                        <LiabilityWatchdogWidget />
                    </div>
                </ErrorBoundary>
            );
        case 'goal-thermometer':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <GoalThermometer currentNetWorth={stats?.totalCurrent} />
                    </div>
                </ErrorBoundary>
            );
        case 'milestone-timeline':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Milestone Timeline" />}>
                            <MilestoneTimelineWidget
                                lifeEvents={lifeEvents}
                                addLifeEvent={addLifeEvent}
                                deleteLifeEvent={deleteLifeEvent}
                            />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'xirr-time-machine':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="XIRR Time-Machine" />}>
                            <XIRRTimeMachine
                                investments={investments}
                                totalCurrentValue={stats?.totalCurrent || 0}
                                totalInvested={stats?.totalInvested || 0}
                                isPrivacyMode={isPrivacyMode}
                            />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'smart-watchlist':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Smart Watchlist" />}>
                            <SmartWatchlist isPrivacyMode={isPrivacyMode} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'dividend-calendar':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Dividend Hub" />}>
                            <DividendCalendar isPrivacyMode={isPrivacyMode} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'portfolio-constellation':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Constellation" />}>
                            <PortfolioConstellation
                                investments={investments}
                                isPrivacyMode={isPrivacyMode}
                            />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'black-swan-war-room':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Black Swan War Room" />}>
                            <BlackSwanWarRoom
                                investments={investments}
                                totalCurrentValue={stats?.totalCurrent || 0}
                                totalInvested={stats?.totalInvested || 0}
                                isPrivacyMode={isPrivacyMode}
                            />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'wealth-time-capsule':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Time Capsule" />}>
                            <WealthTimeCapsule
                                totalCurrentValue={stats?.totalCurrent || 0}
                                totalInvested={stats?.totalInvested || 0}
                                investments={investments}
                                isPrivacyMode={isPrivacyMode}
                            />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'option-chain':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full min-h-[400px]">
                        <Suspense fallback={<WidgetSkeleton title="Option Chain" />}>
                            <OptionChainWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'psychological-pnl':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Psychological P&L" />}>
                            <PsychologicalPnLWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'strategy-lab':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Strategy Lab" />}>
                            <BacktesterWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'shadow-portfolio':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Shadow Portfolio" />}>
                            <ShadowPortfolioWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'mission-control':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Mission Control" />}>
                            <MissionControlWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'portfolio-greeks':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Portfolio Greeks" />}>
                            <PortfolioGreeksWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'webhook-manager':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Webhook Manager" />}>
                            <WebhookManagerWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'alpha-booster':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Alpha Booster Lab" />}>
                            <StockezeeBoosterWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );





        case 'alpha-engine-hub':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Alpha Engine" />}>
                            <AlphaEngineHub />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'ghost-portfolio':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <GhostPortfolio 
                            currentNetWorth={stats?.totalCurrent || 0}
                            investments={investments}
                        />
                    </div>
                </ErrorBoundary>
            );
        case 'WEALTH_DESTINY':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Wealth Destiny" />}>
                            <WealthDestinyGauge />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'SCENARIO_COMPARE':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Scenario Comparison" />}>
                            <ScenarioComparison />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'MASTERY_OVERVIEW':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Mastery Overview" />}>
                            <MasteryOverviewWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'FINANCIAL_CALENDAR':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Market Calendar" />}>
                            <FinancialCalendarWidget />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'risk-score-card':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Risk Score" />}>
                            <RiskScoreCardWidget isPrivacyMode={isPrivacyMode} />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'live-portfolio-pnl':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Live Portfolio P\&L" />}>
                            <LivePortfolioPnL className="h-full" />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        case 'market-sentiment-radar':
            return (
                <ErrorBoundary key={id}>
                    <div className="h-full">
                        <Suspense fallback={<WidgetSkeleton title="Market Sentiment" />}>
                            <MarketSentimentRadar className="h-full" />
                        </Suspense>
                    </div>
                </ErrorBoundary>
            );
        default:
            return null;
    }
});
