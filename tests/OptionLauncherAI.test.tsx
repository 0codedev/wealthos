// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import OptionLauncherWidget from '../components/alpha/OptionLauncherWidget';
import { StockData } from '../services/AlphaEngineService';
import { streamChatWithGemini } from '../services/aiService';

// Mock scrollIntoView which is missing in JSDOM
beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    cleanup();
});

// Mock framer-motion to avoid animation delays in jsdom
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, className, style, ...props }: any) => (
            <div className={className} style={style} {...props}>{children}</div>
        ),
        button: ({ children, className, style, ...props }: any) => (
            <button className={className} style={style} {...props}>{children}</button>
        )
    },
    AnimatePresence: ({ children }: any) => <>{children}</>
}));

// Mock streamChatWithGemini
vi.mock('../services/aiService', () => ({
    streamChatWithGemini: vi.fn((model, history, message, systemPrompt, onToken, onComplete) => {
        onToken('Mock Token ', 'Mock Token ');
        onComplete('Mock Complete Response');
        return Promise.resolve();
    })
}));

// Mock useSettingsStore
vi.mock('../store/settingsStore', () => {
    const state = {
        modelAlphaEngineId: 'test-gemini-model',
        geminiApiKey: 'test-api-key',
        showOrderBookDepth: true,
        isUpstoxEnabled: true
    };
    const mockStoreFn = vi.fn((selector) => selector ? selector(state) : state);
    (mockStoreFn as any).getState = () => state;
    (mockStoreFn as any).subscribe = vi.fn(() => () => {});
    (mockStoreFn as any).setState = vi.fn();
    return {
        useSettingsStore: mockStoreFn
    };
});

// Mock alphaEngineService
vi.mock('../services/AlphaEngineService', async (importOriginal) => {
    const actual: any = await importOriginal();
    return {
        ...actual,
        alphaEngineService: {
            verifyORBWithCandles: vi.fn().mockResolvedValue({
                isLowPreserved: true,
                isHighPreserved: true,
                detail: '5m Opening Range verified via mock.'
            }),
            fetchPreciseStockATR: vi.fn().mockResolvedValue(30.0),
            getCachedSectors: vi.fn().mockReturnValue([
                {
                    sector: 'PHARMA',
                    lastPrice: 15000,
                    percentChange: 1.5,
                    previousClose: 14800,
                    strengthRatio: 1.5,
                    fatigueScore: 0,
                    fatigueState: 'neutral'
                }
            ]),
            getCachedMood: vi.fn().mockReturnValue({
                isBullish: true,
                ceVelocity: 150,
                peVelocity: 100,
                timestamp: '2026-05-20T10:00:00Z'
            })
        }
    };
});

describe('OptionLauncherWidget with AI Copilot', () => {
    const mockStock: StockData = {
        symbol: 'SUNPHARMA',
        sector: 'PHARMA',
        lastPrice: 1250.50,
        previousClose: 1230.00,
        openPrice: 1240.00,
        high: 1260.00,
        low: 1235.00,
        percentChange: 1.67,
        volume: 1200000,
        value: 150000000,
        gFactor: 2.5,
        signal: 'Up',
        openingGapPct: 0.81,
        dayExtremeScore: 0.62,
        isORBLowPreservedProxy: true,
        isORBHighPreservedProxy: false,
        openChangePct: 0.85
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render the Launcher view by default', () => {
        render(<OptionLauncherWidget stock={mockStock} />);
        
        expect(screen.getByText('Dhan Launcher')).toBeDefined();
        expect(screen.getByText('AI Copilot')).toBeDefined();
        expect(screen.getByText('SUNPHARMA')).toBeDefined();
    });

    it('should switch to AI Copilot tab and trigger auto-analysis setup', async () => {
        render(<OptionLauncherWidget stock={mockStock} />);
        
        const aiTabButton = screen.getByText('AI Copilot');
        fireEvent.click(aiTabButton);

        // Expect streaming function to have been triggered by the useEffect
        await waitFor(() => {
            expect(streamChatWithGemini).toHaveBeenCalled();
        });

        // Check if the system prompt contains the compiled market context
        const firstCallArgs = vi.mocked(streamChatWithGemini).mock.calls[0];
        const systemPromptUsed = firstCallArgs[3];
        
        expect(systemPromptUsed).toContain('Stock Symbol: SUNPHARMA');
        expect(systemPromptUsed).toContain('Sector Name: PHARMA');
        expect(systemPromptUsed).toContain('Nifty 50 Mood: BULLISH');
    });

    it('should trigger custom preset analysis when a preset is clicked', async () => {
        render(<OptionLauncherWidget stock={mockStock} />);
        
        const aiTabButton = screen.getByText('AI Copilot');
        fireEvent.click(aiTabButton);

        await waitFor(() => {
            expect(streamChatWithGemini).toHaveBeenCalledTimes(1);
        });

        // Click Trap Risk preset button
        const trapRiskButton = screen.getByText('⚠️ Trap Risk');
        fireEvent.click(trapRiskButton);

        await waitFor(() => {
            expect(streamChatWithGemini).toHaveBeenCalledTimes(2);
        });

        const secondCallArgs = vi.mocked(streamChatWithGemini).mock.calls[1];
        const promptSent = secondCallArgs[2];
        expect(promptSent).toContain('Is there any trap risk here?');
    });

    it('should render the Pre-Explosion Validator rules and check indicators', () => {
        render(<OptionLauncherWidget stock={mockStock} />);

        expect(screen.getByText('Pre-Explosion Validator')).toBeDefined();
        expect(screen.getByText('5m ORB Limit')).toBeDefined();
        expect(screen.getByText('Time Zone')).toBeDefined();
        expect(screen.getByText('Sector Trend')).toBeDefined();
        expect(screen.getByText('O2C Trend')).toBeDefined();
    });

    it('should disable execute button when ORB is breached and enable when bypassed', () => {
        const breachedStock: StockData = {
            ...mockStock,
            isORBLowPreservedProxy: false,
            isORBHighPreservedProxy: false
        };

        render(<OptionLauncherWidget stock={breachedStock} />);

        // The validator should show "Breached"
        expect(screen.getByText('Breached')).toBeDefined();
        
        // Execute button should have "Safety Gate Locked" text and be disabled
        const executeBtn = screen.getByRole('button', { name: /Safety Gate Locked/i });
        expect(executeBtn).toBeDefined();
        expect(executeBtn.hasAttribute('disabled')).toBe(true);

        // Click on the Bypass Safety Gate checkbox
        const bypassCheckbox = screen.getByLabelText(/Bypass Safety Gate/i);
        fireEvent.click(bypassCheckbox);

        // Execute button should now be enabled and show execute text
        const activeBtn = screen.getByRole('button', { name: /Execute Momentum Buy/i });
        expect(activeBtn).toBeDefined();
        expect(activeBtn.hasAttribute('disabled')).toBe(false);
    });

    it('should disable execute button when stock is exhausted or trap risk is true, and enable when bypassed', () => {
        const exhaustedStock: StockData = {
            ...mockStock,
            isExhausted: true,
            grr: 0.85
        };

        const { rerender } = render(<OptionLauncherWidget stock={exhaustedStock} />);
        
        // Execute button should be locked and disabled
        let executeBtn = screen.getByRole('button', { name: /Safety Gate Locked/i });
        expect(executeBtn).toBeDefined();
        expect(executeBtn.hasAttribute('disabled')).toBe(true);

        // Rerender with a trap risk stock
        const trapStock: StockData = {
            ...mockStock,
            isTrapRisk: true,
            ovr: 0.52
        };
        rerender(<OptionLauncherWidget stock={trapStock} />);

        executeBtn = screen.getByRole('button', { name: /Safety Gate Locked/i });
        expect(executeBtn).toBeDefined();
        expect(executeBtn.hasAttribute('disabled')).toBe(true);

        // Click on the Bypass Safety Gate checkbox
        const bypassCheckbox = screen.getByLabelText(/Bypass Safety Gate/i);
        fireEvent.click(bypassCheckbox);

        // Should now be enabled
        const activeBtn = screen.getByRole('button', { name: /Execute/i });
        expect(activeBtn).toBeDefined();
        expect(activeBtn.hasAttribute('disabled')).toBe(false);
    });

    it('should calculate Est. Capital Required dynamically based on lotSizesData', () => {
        const mockLotSizes = [
            {
                underlying: 'Sun Pharmaceutical Industries Ltd.',
                symbol: 'SUNPHARMA',
                created_at: '05/04/2026 00:00:00',
                month_data: '{"MAY-26": "700", "JUN-26": "700"}',
                last_trade_price: 1250.50,
                change: 20.50,
                change_percent: 1.67
            }
        ];

        render(<OptionLauncherWidget stock={mockStock} lotSizesData={mockLotSizes} />);

        // Spot: 1250.50, Premium: 1250.50 * 0.02 = 25.01. Capital: 700 * 25.01 = 17507
        expect(screen.getAllByText((_, el) => el?.textContent?.includes('17,507') ?? false).length).toBeGreaterThan(0);
        expect(screen.getByText('700')).toBeDefined();
    });

    it('should fallback to N/A for Est. Capital Required when stock is not in lotSizesData', () => {
        render(<OptionLauncherWidget stock={mockStock} lotSizesData={[]} />);

        expect(screen.getByText('N/A')).toBeDefined();
    });
});

