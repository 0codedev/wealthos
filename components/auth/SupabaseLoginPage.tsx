import React, { useState } from 'react';
import { Loader2, Cloud, ShieldCheck, Mail, Lock, ArrowRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useSupabaseAuth } from '../../contexts/SupabaseAuthContext';

const SupabaseLoginPage: React.FC = () => {
    const { loading: authLoading } = useSupabaseAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [mode, setMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');
        setSuccessMessage('');

        try {
            if (mode === 'SIGNUP') {
                const { error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                setSuccessMessage('Registration successful! Please check your email to verify your account.');
            } else {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                // session updates automatically triggering re-render of RootAuthGate
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Authentication failed');
        } finally {
            setIsLoading(false);
        }
    };

    if (authLoading) {
        return (
            <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center relative overflow-hidden">
                <Loader2 size={32} className="text-indigo-500 animate-spin mb-4 relative z-10" />
                <p className="text-slate-400 font-mono text-sm relative z-10 animate-pulse">Initializing Cloud Secure Link...</p>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[100px]" />
            </div>

            <div className="w-full max-w-md bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 relative z-10 shadow-2xl">

                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center mb-4">
                        <Cloud className="w-8 h-8 text-indigo-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Cloud Secure Access</h1>
                    <p className="text-sm text-slate-400 text-center px-4">
                        Authenticate with Supabase to sync your Wealth Aggregator portfolio across devices.
                    </p>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                    {/* Error / Success Messages */}
                    {error && (
                        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium text-center">
                            {error}
                        </div>
                    )}
                    {successMessage && (
                        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium text-center">
                            {successMessage}
                        </div>
                    )}

                    <div className="space-y-4 mb-6">
                        <div className="relative group">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                                <Mail size={18} />
                            </div>
                            <input
                                type="email"
                                required
                                placeholder="Cloud Identity (Email)"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-slate-950/50 border border-slate-800 focus:border-indigo-500 text-white rounded-xl py-3 pl-12 pr-4 outline-none transition-all placeholder:text-slate-600 font-mono text-sm"
                            />
                        </div>

                        <div className="relative group">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors">
                                <Lock size={18} />
                            </div>
                            <input
                                type="password"
                                required
                                placeholder="Master Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-slate-950/50 border border-slate-800 focus:border-indigo-500 text-white rounded-xl py-3 pl-12 pr-4 outline-none transition-all placeholder:text-slate-600 font-mono text-sm"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl disabled:opacity-50 transition-all flex items-center justify-center gap-2 group shadow-[0_0_20px_rgba(79,70,229,0.2)] hover:shadow-[0_0_30px_rgba(79,70,229,0.4)]"
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : mode === 'LOGIN' ? 'Initiate Link' : 'Register Identity'}
                        {!isLoading && <ArrowRight className="w-4 h-4 ml-1 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />}
                    </button>

                    <div className="mt-6 flex justify-center text-xs">
                        {mode === 'LOGIN' ? (
                            <span className="text-slate-400">
                                No cloud identity yet? <button type="button" onClick={() => { setMode('SIGNUP'); setError(''); setSuccessMessage(''); }} className="text-indigo-400 hover:text-indigo-300 ml-1 font-bold underline decoration-indigo-500/30 underline-offset-4">Register here</button>
                            </span>
                        ) : (
                            <span className="text-slate-400">
                                Already registered? <button type="button" onClick={() => { setMode('LOGIN'); setError(''); setSuccessMessage(''); }} className="text-indigo-400 hover:text-indigo-300 ml-1 font-bold underline decoration-indigo-500/30 underline-offset-4">Login here</button>
                            </span>
                        )}
                    </div>
                </form>

                {/* Footer security badge */}
                <div className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-600 font-mono">
                    <ShieldCheck size={14} className="text-emerald-500/50" />
                    Encrypted Cloud Sync via Supabase
                </div>
            </div>
        </div>
    );
};

export default SupabaseLoginPage;
