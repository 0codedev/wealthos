import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Fingerprint, Lock, ShieldCheck, KeyRound, Delete } from 'lucide-react';
import { useBiometricLockStore } from '../../hooks/useBiometricLock';

export const BiometricAppLocker: React.FC = () => {
    const { 
        isEnabled, 
        isLocked, 
        unlockWithBiometric, 
        unlockWithPin, 
        isBiometricSupported,
        autoLockMinutes,
        lastActivity,
        lockApp,
        recordActivity
    } = useBiometricLockStore();

    const [pin, setPin] = useState<string>('');

    // Inactivity Auto-Lock
    useEffect(() => {
        if (!isEnabled || isLocked) return;

        const handleUserAction = () => recordActivity();
        window.addEventListener('mousemove', handleUserAction);
        window.addEventListener('keydown', handleUserAction);
        window.addEventListener('click', handleUserAction);

        const checkInterval = setInterval(() => {
            const idleMs = Date.now() - lastActivity;
            if (idleMs > autoLockMinutes * 60 * 1000) {
                lockApp();
            }
        }, 30000);

        return () => {
            window.removeEventListener('mousemove', handleUserAction);
            window.removeEventListener('keydown', handleUserAction);
            window.removeEventListener('click', handleUserAction);
            clearInterval(checkInterval);
        };
    }, [isEnabled, isLocked, lastActivity, autoLockMinutes, lockApp, recordActivity]);

    // Attempt biometric scan when lock screen appears
    useEffect(() => {
        if (isEnabled && isLocked && isBiometricSupported) {
            // Small delay to let browser mount
            const timer = setTimeout(() => {
                unlockWithBiometric();
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isEnabled, isLocked, isBiometricSupported]);

    if (!isEnabled || !isLocked || typeof document === 'undefined') return null;

    const handleNumberClick = (digit: string) => {
        if (pin.length < 6) {
            const newPin = pin + digit;
            setPin(newPin);
            if (newPin.length === 6) {
                setTimeout(() => {
                    const success = unlockWithPin(newPin);
                    if (!success) setPin('');
                }, 150);
            }
        }
    };

    const handleBackspace = () => {
        setPin(prev => prev.slice(0, -1));
    };

    return createPortal(
        <div className="fixed inset-0 z-[9999999] bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-900/90 border border-slate-800 rounded-3xl w-full max-w-sm shadow-2xl p-8 text-center space-y-6"
            >
                {/* Header Lock Icon */}
                <div className="flex flex-col items-center justify-center">
                    <div className="p-4 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mb-3 shadow-lg shadow-indigo-500/10">
                        <Lock size={32} />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 font-mono">
                        Hardware Security Vault
                    </span>
                    <h2 className="text-xl font-bold text-white font-display mt-1">
                        WealthOS Locked
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                        Authenticate with Biometrics or enter 6-digit PIN
                    </p>
                </div>

                {/* PIN Dots Indicator */}
                <div className="flex justify-center gap-3 my-2">
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                        <div 
                            key={idx}
                            className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                                idx < pin.length 
                                    ? 'bg-indigo-500 shadow-md shadow-indigo-500/40 scale-110' 
                                    : 'bg-slate-800 border border-slate-700'
                            }`}
                        />
                    ))}
                </div>

                {/* Biometric Trigger Button */}
                {isBiometricSupported && (
                    <button
                        type="button"
                        onClick={() => unlockWithBiometric()}
                        className="w-full py-3 rounded-2xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 font-semibold text-xs flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
                    >
                        <Fingerprint size={16} />
                        <span>Scan Touch ID / Face ID</span>
                    </button>
                )}

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-2.5 pt-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                        <button
                            key={digit}
                            type="button"
                            onClick={() => handleNumberClick(digit)}
                            className="h-12 rounded-2xl bg-slate-800/60 hover:bg-slate-700/60 active:scale-95 text-white font-mono font-bold text-lg transition-all border border-slate-800"
                        >
                            {digit}
                        </button>
                    ))}
                    <div className="flex items-center justify-center">
                        <KeyRound size={16} className="text-slate-600" />
                    </div>
                    <button
                        type="button"
                        onClick={() => handleNumberClick('0')}
                        className="h-12 rounded-2xl bg-slate-800/60 hover:bg-slate-700/60 active:scale-95 text-white font-mono font-bold text-lg transition-all border border-slate-800"
                    >
                        0
                    </button>
                    <button
                        type="button"
                        onClick={handleBackspace}
                        className="h-12 rounded-2xl bg-slate-800/40 hover:bg-slate-700/40 active:scale-95 text-slate-400 hover:text-white flex items-center justify-center transition-all border border-slate-800"
                        aria-label="Backspace"
                    >
                        <Delete size={18} />
                    </button>
                </div>
            </motion.div>
        </div>,
        document.body
    );
};
