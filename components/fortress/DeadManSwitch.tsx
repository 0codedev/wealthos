import React, { useState, useEffect } from 'react';
import { HeartPulse, Clock, AlertTriangle, ShieldCheck, UserCheck } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';

export const DeadManSwitch: React.FC = () => {
    const { toast } = useToast();
    const [lastActive, setLastActive] = useState<Date>(new Date());
    const [timeoutDays, setTimeoutDays] = useState(30);
    const [isLegacyMode, setIsLegacyMode] = useState(false);
    const [isActive, setIsActive] = useState(true); // Is the switch enabled?

    // Load state from local storage on mount
    useEffect(() => {
        const storedLastActive = localStorage.getItem('fortress_last_active');
        if (storedLastActive) {
            const parsed = new Date(storedLastActive);
            if (!isNaN(parsed.getTime())) {
                setLastActive(parsed);
            }
        }

        const storedTimeout = localStorage.getItem('fortress_timeout_days');
        if (storedTimeout) {
            const parsedTimeout = parseInt(storedTimeout, 10);
            if (!isNaN(parsedTimeout) && parsedTimeout > 0) {
                setTimeoutDays(parsedTimeout);
            }
        }

        const storedStatus = localStorage.getItem('fortress_dms_enabled');
        if (storedStatus) setIsActive(storedStatus === 'true');

        // Check for Legacy Mode
        checkStatus();
    }, []);

    const checkStatus = () => {
        const storedLastActive = localStorage.getItem('fortress_last_active');
        if (!storedLastActive) return;

        const last = new Date(storedLastActive);
        if (isNaN(last.getTime())) return;

        const now = new Date();
        const diffTime = Math.max(0, now.getTime() - last.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (isActive && diffDays > timeoutDays) {
            setIsLegacyMode(true);
        } else {
            setIsLegacyMode(false);
        }
    };

    const handlePing = () => {
        const now = new Date();
        setLastActive(now);
        setIsLegacyMode(false);
        localStorage.setItem('fortress_last_active', now.toISOString());
        toast.success("Heartbeat received. Timer reset.");
    };

    const handleToggle = () => {
        const newState = !isActive;
        setIsActive(newState);
        localStorage.setItem('fortress_dms_enabled', String(newState));
        if (newState) {
            handlePing(); // Reset timer on enable
            toast.success("Dead Man's Switch Enabled");
        } else {
            toast.info("Dead Man's Switch Disabled");
        }
    };

    const handleTimeoutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const days = parseInt(e.target.value);
        setTimeoutDays(days);
        localStorage.setItem('fortress_timeout_days', String(days));
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
            {isLegacyMode && (
                <div className="absolute inset-0 bg-rose-500/10 z-10 flex items-center justify-center backdrop-blur-sm">
                    <div className="bg-rose-600 text-white p-6 rounded-2xl shadow-2xl text-center max-w-sm animate-in zoom-in">
                        <AlertTriangle size={48} className="mx-auto mb-4" />
                        <h2 className="text-2xl font-bold mb-2">PROTOCOL ACTIVATED</h2>
                        <p className="mb-6">Inactivity detected. Legacy mode is now active. Beneficiaries have been granted access.</p>
                        <button
                            onClick={handlePing}
                            className="bg-white text-rose-600 px-6 py-3 rounded-xl font-bold hover:bg-rose-50 transition-colors"
                        >
                            I AM ALIVE (DEACTIVATE)
                        </button>
                    </div>
                </div>
            )}

            <div className="flex items-center gap-3 mb-6">
                <div className={`p-3 rounded-xl ${isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                    <HeartPulse size={24} className={isActive ? "animate-pulse" : ""} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Dead Man's Switch</h3>
                    <p className="text-sm text-slate-500">Automated legacy protocol trigger.</p>
                </div>
                <div className="ml-auto">
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={isActive} onChange={handleToggle} className="sr-only peer" />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 dark:peer-focus:ring-emerald-800 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-emerald-500"></div>
                    </label>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2 mb-2 text-slate-500">
                        <Clock size={16} />
                        <span className="text-xs font-bold uppercase tracking-wider">Timeout Period</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <input
                            type="range"
                            min="1"
                            max="365"
                            value={timeoutDays}
                            onChange={handleTimeoutChange}
                            disabled={!isActive}
                            className="w-full accent-emerald-500"
                        />
                        <span className="font-mono font-bold text-lg w-16 text-right">{timeoutDays}d</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                        System will wait <strong>{timeoutDays} days</strong> of inactivity before unlocking the vault.
                    </p>
                </div>

                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
                    <div className="flex items-center gap-2 mb-1 text-slate-500">
                        <UserCheck size={16} />
                        <span className="text-xs font-bold uppercase tracking-wider">Last Heartbeat</span>
                    </div>
                    <div>
                        <p className="text-lg font-bold text-slate-800 dark:text-white">
                            {lastActive.toLocaleDateString()}
                        </p>
                        <p className="text-xs text-slate-400">
                            {lastActive.toLocaleTimeString()}
                        </p>
                    </div>
                    <button
                        onClick={handlePing}
                        disabled={!isActive}
                        className="mt-3 w-full py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-emerald-500 hover:text-emerald-500 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                    >
                        Ping I'm Alive
                    </button>
                </div>
            </div>

            <div className="mt-6 flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-100 dark:border-amber-900/30">
                <ShieldCheck size={18} className="text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800 dark:text-amber-400 leading-relaxed">
                    <strong>Security Note:</strong> This is a browser-based simulation. In a real-world scenario, this would be connected to your email provider or bank activity to ensure failsafe detection.
                </p>
            </div>
        </div>
    );
};
