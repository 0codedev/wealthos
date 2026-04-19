import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, X, Sparkles, Target, Bot, Brain, Rocket } from 'lucide-react';
import { useOnboarding } from '../../hooks/useOnboarding';

const STEP_ICONS = [Sparkles, Target, Bot, Brain, Target, Rocket];

/**
 * Onboarding flow component for new users
 * Shows a beautiful multi-step introduction to the app
 */
export const OnboardingFlow: React.FC = () => {
    const {
        isOnboarding,
        currentStep,
        steps,
        nextStep,
        previousStep,
        skipOnboarding,
        progress,
    } = useOnboarding();

    if (!isOnboarding) return null;

    const step = steps[currentStep];
    const Icon = STEP_ICONS[currentStep] || Sparkles;
    const isLastStep = currentStep === steps.length - 1;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop with gradient */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-gradient-to-br from-indigo-900/90 via-slate-900/95 to-purple-900/90 backdrop-blur-xl"
                />

                {/* Animated background orbs */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />
                    <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
                </div>

                {/* Content */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="relative w-full max-w-lg"
                >
                    {/* Skip button */}
                    <button
                        onClick={skipOnboarding}
                        className="absolute -top-12 right-0 text-white/60 hover:text-white 
                                   flex items-center gap-1 text-sm transition-colors"
                    >
                        Skip tour <X size={16} />
                    </button>

                    {/* Progress bar */}
                    <div className="mb-6">
                        <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                            <motion.div
                                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 0.5 }}
                            />
                        </div>
                        <div className="flex justify-between mt-2 text-xs text-white/40">
                            <span>Step {currentStep + 1} of {steps.length}</span>
                            <span>{Math.round(progress)}% complete</span>
                        </div>
                    </div>

                    {/* Card */}
                    <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.3 }}
                        className="bg-white/10 backdrop-blur-lg rounded-3xl border border-white/20 p-8 shadow-2xl"
                    >
                        {/* Icon */}
                        <div className="w-16 h-16 mb-6 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 
                                        flex items-center justify-center shadow-lg shadow-indigo-500/25">
                            <Icon size={32} className="text-white" />
                        </div>

                        {/* Title */}
                        <h2 className="text-2xl font-bold text-white mb-3">
                            {step.title}
                        </h2>

                        {/* Description */}
                        <p className="text-white/70 text-lg leading-relaxed mb-8">
                            {step.description}
                        </p>

                        {/* Actions */}
                        <div className="flex items-center justify-between">
                            {/* Previous */}
                            <button
                                onClick={previousStep}
                                disabled={currentStep === 0}
                                className="flex items-center gap-1 text-white/60 hover:text-white 
                                           disabled:opacity-0 disabled:pointer-events-none transition-all"
                            >
                                <ChevronLeft size={20} />
                                Back
                            </button>

                            {/* Next / Complete */}
                            <button
                                onClick={nextStep}
                                className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 
                                           text-white font-semibold rounded-xl hover:shadow-lg 
                                           hover:shadow-indigo-500/25 transition-all flex items-center gap-2"
                            >
                                {isLastStep ? (step.action || 'Get Started') : (step.action || 'Next')}
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </motion.div>

                    {/* Step indicators */}
                    <div className="flex justify-center gap-2 mt-6">
                        {steps.map((_, index) => (
                            <div
                                key={index}
                                className={`w-2 h-2 rounded-full transition-all ${index === currentStep
                                        ? 'bg-white w-6'
                                        : index < currentStep
                                            ? 'bg-white/60'
                                            : 'bg-white/20'
                                    }`}
                            />
                        ))}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default OnboardingFlow;
