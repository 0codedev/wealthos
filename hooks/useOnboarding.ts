import { useState, useEffect, useCallback } from 'react';

interface OnboardingStep {
    id: string;
    title: string;
    description: string;
    action?: string;
}

interface OnboardingResult {
    isOnboarding: boolean;
    currentStep: number;
    steps: OnboardingStep[];
    nextStep: () => void;
    previousStep: () => void;
    skipOnboarding: () => void;
    completeOnboarding: () => void;
    restartOnboarding: () => void;
    progress: number;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        id: 'welcome',
        title: 'Welcome to Wealth Aggregator! 🎉',
        description: 'Your AI-powered wealth management companion. Track investments, journal trades, and plan your financial future.',
    },
    {
        id: 'portfolio',
        title: 'Track Your Portfolio 📊',
        description: 'Add all your investments in one place - stocks, mutual funds, crypto, gold, real estate, and more.',
        action: 'Add Your First Asset',
    },
    {
        id: 'ai-advisor',
        title: 'Meet Your AI Advisor 🤖',
        description: 'Get personalized financial advice, portfolio analysis, and market insights powered by Gemini AI.',
        action: 'Try AI Advisor',
    },
    {
        id: 'journal',
        title: 'Master Trading Psychology 🧠',
        description: 'Log trades, track emotions, and learn from your patterns with the trading journal.',
        action: 'Start Journaling',
    },
    {
        id: 'goals',
        title: 'Plan Your Future 🎯',
        description: 'Set financial goals with Monte Carlo simulations, retirement planning, and estate management.',
        action: 'Set a Goal',
    },
    {
        id: 'complete',
        title: "You're All Set! 🚀",
        description: "Start building wealth with confidence. We're here to help every step of the way.",
        action: 'Get Started',
    },
];

const STORAGE_KEY = 'wealth_aggregator_onboarding';

/**
 * Hook for managing new user onboarding flow
 * Tracks progress in localStorage, only shows once
 */
export function useOnboarding(): OnboardingResult {
    const [currentStep, setCurrentStep] = useState(0);
    const [isOnboarding, setIsOnboarding] = useState(false);

    // Check if user needs onboarding
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            // New user - show onboarding
            setIsOnboarding(true);
        } else {
            try {
                const data = JSON.parse(stored);
                if (!data.completed) {
                    setIsOnboarding(true);
                    setCurrentStep(data.step || 0);
                }
            } catch {
                // Invalid data, start fresh
                setIsOnboarding(true);
            }
        }
    }, []);

    // Save progress
    useEffect(() => {
        if (isOnboarding) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                step: currentStep,
                completed: false,
            }));
        }
    }, [currentStep, isOnboarding]);

    const nextStep = useCallback(() => {
        if (currentStep < ONBOARDING_STEPS.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            completeOnboarding();
        }
    }, [currentStep]);

    const previousStep = useCallback(() => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1);
        }
    }, [currentStep]);

    const skipOnboarding = useCallback(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            step: 0,
            completed: true,
            skipped: true,
        }));
        setIsOnboarding(false);
    }, []);

    const completeOnboarding = useCallback(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            step: ONBOARDING_STEPS.length,
            completed: true,
            completedAt: new Date().toISOString(),
        }));
        setIsOnboarding(false);
    }, []);

    const restartOnboarding = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        setCurrentStep(0);
        setIsOnboarding(true);
    }, []);

    const progress = ((currentStep + 1) / ONBOARDING_STEPS.length) * 100;

    return {
        isOnboarding,
        currentStep,
        steps: ONBOARDING_STEPS,
        nextStep,
        previousStep,
        skipOnboarding,
        completeOnboarding,
        restartOnboarding,
        progress,
    };
}

export default useOnboarding;
