import React, { Suspense, lazy } from 'react';
import { Investment, AggregatedData, PortfolioStats } from '../../../types';
import { HoldingsView } from './HoldingsView';
import { AnalyticsView } from './AnalyticsView';
import { RiskEngineView } from './RiskEngineView';
import { PassiveIncomeView } from './PassiveIncomeView';
import { PortfolioActionProposal } from '../../../services/PortfolioActionService';
import { Activity, Shuffle, Layers } from 'lucide-react';

const XRayView = lazy(() => import('./XRayModal').then(module => ({ default: module.XRayView })));
const RebalancingTool = lazy(() => import('../../tools/RebalancingTool').then(module => ({ default: module.RebalancingTool })));
const PortfolioExportPanel = lazy(() => import('../../portfolio/PortfolioExportPanel').then(module => ({ default: module.PortfolioExportPanel })));

export type PortfolioTabKey =
    | 'HOLDINGS'
    | 'ANALYTICS'
    | 'PERFORMANCE'
    | 'RISK'
    | 'XRAY'
    | 'PASSIVE'
    | 'REBALANCE'
    | 'KILL_SWITCH';

export interface PortfolioTabViewProps {
    activeTab: PortfolioTabKey;
    filteredInvestments: Investment[];
    archivedInvestments: Investment[];
    totalAssets: number;
    allocationData: AggregatedData[];
    formatCurrency: (val: number) => string;
    isPrivacyMode: boolean;
    focusActionCategory: 'rebalance' | 'deploy-cash' | 'trim' | 'tax-harvest' | null;
    onAddAsset: () => void;
    onEditAsset: (inv: Investment, e: React.MouseEvent) => void;
    onDeleteAsset: (inv: Investment, e: React.MouseEvent) => void;
    onQuickUpdate: ((id: string, updates: Partial<Investment>) => void) | undefined;
    onBookProfit: (inv: Investment) => void;
    onPortfolioActionFollowUp: (proposal: PortfolioActionProposal) => void;
    onNavigate?: (tab: string) => void;
    setSimulatorAsset: (inv: Investment | null) => void;
    setActiveTab: (key: PortfolioTabKey) => void;
    searchTerm: string;
    filterType: 'ALL' | 'PROFIT' | 'LOSS';
    groupBy: 'NONE' | 'TYPE' | 'PLATFORM';
    viewMode: 'CARD' | 'TERMINAL';
    isSpotlightEnabled: boolean;
    highlightDiagnostics: boolean;
    realizedPlMap: Record<string, { pl: number, cost: number }>;
    calculatePercentage: (part: number, total: number) => string;
    PrivacyValue: React.FC<{ value: string | number, isPrivacyMode: boolean, className?: string }>;
    latestNavs?: Record<string, number>;
    onSyncToJournal?: (inv: Investment) => void;
    onSyncAllIposToJournal?: () => void;
}

export const PortfolioTabView: React.FC<PortfolioTabViewProps> = ({
    activeTab,
    filteredInvestments,
    archivedInvestments,
    totalAssets,
    allocationData,
    formatCurrency,
    isPrivacyMode,
    focusActionCategory,
    onAddAsset,
    onEditAsset,
    onDeleteAsset,
    onQuickUpdate,
    onBookProfit,
    onPortfolioActionFollowUp,
    onNavigate,
    setSimulatorAsset,
    setActiveTab,
    searchTerm,
    filterType,
    groupBy,
    viewMode,
    isSpotlightEnabled,
    highlightDiagnostics,
    realizedPlMap,
    calculatePercentage,
    PrivacyValue,
    latestNavs,
    onSyncToJournal,
    onSyncAllIposToJournal,
}) => {
    if (activeTab === 'HOLDINGS') {
        return (
            <HoldingsView
                investments={filteredInvestments}
                archivedInvestments={archivedInvestments}
                totalAssets={totalAssets}
                onAddAsset={onAddAsset}
                onEditAsset={onEditAsset}
                onDeleteAsset={onDeleteAsset}
                onQuickUpdate={onQuickUpdate}
                onBookProfit={onBookProfit}
                formatCurrency={formatCurrency}
                calculatePercentage={calculatePercentage}
                isPrivacyMode={isPrivacyMode}
                PrivacyValue={PrivacyValue}
                setSimulatorAsset={setSimulatorAsset}
                latestNavs={latestNavs}
                searchTerm={searchTerm}
                filterType={filterType}
                groupBy={groupBy}
                viewMode={viewMode}
                isSpotlightEnabled={isSpotlightEnabled}
                realizedPlMap={realizedPlMap}
                onNavigate={onNavigate}
                highlightDiagnostics={highlightDiagnostics}
                onSyncToJournal={onSyncToJournal}
                onSyncAllIposToJournal={onSyncAllIposToJournal}
            />
        );
    }

    if (activeTab === 'ANALYTICS') {
        return (
            <AnalyticsView
                investments={filteredInvestments}
                formatCurrency={formatCurrency}
                isPrivacyMode={isPrivacyMode}
                focusCategory={focusActionCategory}
                onFollowUp={onPortfolioActionFollowUp}
            />
        );
    }

    if (activeTab === 'PERFORMANCE') {
        return (
            <div className="space-y-6">
                <AnalyticsView
                    investments={filteredInvestments}
                    formatCurrency={formatCurrency}
                    isPrivacyMode={isPrivacyMode}
                    focusCategory={focusActionCategory}
                    onFollowUp={onPortfolioActionFollowUp}
                />
                <Suspense fallback={<div className="h-40 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">Loading export tools...</div>}>
                    <PortfolioExportPanel investments={filteredInvestments} />
                </Suspense>
            </div>
        );
    }

    if (activeTab === 'RISK' || activeTab === 'KILL_SWITCH') {
        return (
            <RiskEngineView
                investments={filteredInvestments}
                totalAssets={totalAssets}
                formatCurrency={formatCurrency}
                setSimulatorAsset={setSimulatorAsset}
            />
        );
    }

    if (activeTab === 'XRAY') {
        return (
            <Suspense fallback={<div className="h-64 flex items-center justify-center"><Activity className="animate-pulse text-indigo-500" /></div>}>
                <XRayView
                    investments={filteredInvestments}
                    totalAssets={totalAssets}
                    onClose={() => setActiveTab('HOLDINGS')}
                    formatCurrency={formatCurrency}
                    isPrivacyMode={isPrivacyMode}
                    setSimulatorAsset={setSimulatorAsset}
                />
            </Suspense>
        );
    }

    if (activeTab === 'PASSIVE') {
        return (
            <PassiveIncomeView
                investments={filteredInvestments}
                totalAssets={totalAssets}
                formatCurrency={formatCurrency}
            />
        );
    }

    if (activeTab === 'REBALANCE') {
        return (
            <Suspense fallback={<div className="h-64 flex items-center justify-center"><Shuffle className="animate-spin-slow text-indigo-500" /></div>}>
                <RebalancingTool
                    allocationData={allocationData}
                    totalValue={totalAssets}
                    formatCurrency={formatCurrency}
                    onClose={() => setActiveTab('HOLDINGS')}
                />
            </Suspense>
        );
    }

    return null;
};
