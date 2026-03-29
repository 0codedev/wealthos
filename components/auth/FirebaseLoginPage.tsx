import React, { useState } from 'react';
import { Loader2, ShieldCheck, Mail, Lock, ArrowRight, Fingerprint, Activity, Globe } from 'lucide-react';
import { getFirebaseAuthServices } from '../../lib/firebase';
import { useFirebaseAuth } from '../../contexts/FirebaseAuthContext';
import { motion, AnimatePresence } from 'framer-motion';

const FirebaseLoginPage: React.FC = () => {
    const { loading: authLoading } = useFirebaseAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [mode, setMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [showPasswordSetupOption, setShowPasswordSetupOption] = useState(false);

    const isTelegramWebApp = typeof window !== 'undefined' && (!!(window as any).Telegram?.WebApp?.initData || window.location.search.includes('tgWebAppData'));

    const handleSendPasswordSetup = async () => {
        setIsLoading(true);
        setError('');
        setSuccessMessage('');
        try {
            const { auth, authModule } = await getFirebaseAuthServices();
            await authModule.sendPasswordResetEmail(auth, email);
            setSuccessMessage(`Password setup link sent to ${email}. Please check your inbox.`);
            setShowPasswordSetupOption(false);
        } catch (err: unknown) {
            handleAuthError(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');
        setSuccessMessage('');

        try {
            const { auth, authModule } = await getFirebaseAuthServices();
            if (mode === 'SIGNUP') {
                await authModule.createUserWithEmailAndPassword(auth, email, password);
                setSuccessMessage('Account provisioned successfully. Initializing workspace...');
            } else {
                await authModule.signInWithEmailAndPassword(auth, email, password);
            }
        } catch (err: unknown) {
            handleAuthError(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleAuth = async () => {
        setIsGoogleLoading(true);
        setError('');
        setSuccessMessage('');
        try {
            const { auth, googleProvider, authModule } = await getFirebaseAuthServices();
            await authModule.signInWithPopup(auth, googleProvider);
        } catch (err: unknown) {
            handleAuthError(err);
        } finally {
            setIsGoogleLoading(false);
        }
    };

    const handleAuthError = (err: unknown) => {
        const code = (err as any)?.code || '';
        if (code === 'auth/user-not-found') {
            setError('Credentials not recognized in the system.');
        } else if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
            setError('Invalid authentication credentials provided.');
        } else if (code === 'auth/email-already-in-use') {
            setError('Account already exists. If you signed in with Google, you can set a password to link them.');
            setShowPasswordSetupOption(true);
        } else if (code === 'auth/weak-password') {
            setError('Security standard not met: Password requires minimum 6 characters.');
        } else if (code === 'auth/invalid-email') {
            setError('Invalid email address format.');
        } else if (code === 'auth/popup-closed-by-user') {
            setError('Authentication window was terminated before completion.');
        } else {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('Authentication process failed.');
            }
        }
    };

    if (authLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-[#0B0F19] overflow-hidden relative">
                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop')] bg-cover bg-center opacity-10 mix-blend-luminosity"></div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F19] via-[#0B0F19]/80 to-transparent"></div>

                <div className="flex flex-col items-center relative z-10">
                    <div className="relative">
                        <div className="w-16 h-16 border-2 border-slate-800 rounded-full"></div>
                        <div className="absolute top-0 left-0 w-16 h-16 border-2 border-t-orange-500 border-r-orange-500 border-b-transparent border-l-transparent rounded-full animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <ShieldCheck className="w-6 h-6 text-orange-400" />
                        </div>
                    </div>
                    <p className="mt-6 text-sm font-medium text-slate-400 tracking-widest uppercase flex items-center gap-2">
                        <Activity className="w-4 h-4 text-orange-500 animate-pulse" />
                        Establishing Secure Link
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0B0F19] text-slate-300 font-sans selection:bg-orange-500/30 overflow-hidden relative flex flex-col md:flex-row">

            {/* Background Texture & Glows */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
                <div className="absolute top-0 right-0 -mr-[20%] -mt-[10%] w-[50%] h-[50%] rounded-full bg-orange-600/10 blur-[120px] mix-blend-screen"></div>
                <div className="absolute bottom-0 left-0 -ml-[20%] -mb-[10%] w-[60%] h-[60%] rounded-full bg-blue-600/10 blur-[150px] mix-blend-screen"></div>
            </div>

            {/* Left Column: Branding / Marketing (Hidden on small mobile, visible on md+) */}
            <div className="hidden md:flex flex-1 flex-col justify-between p-12 lg:p-20 relative z-10 border-r border-white/5 bg-black/20 backdrop-blur-3xl">
                <div>
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8 }}
                        className="inline-flex items-center gap-3"
                    >
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg shadow-orange-500/20">
                            <Globe className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-xl font-bold tracking-tight text-white">Wealth<span className="text-orange-400">OS</span> Enterprise</span>
                    </motion.div>
                </div>

                <div className="max-w-xl">
                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        className="text-4xl lg:text-5xl font-light text-white leading-tight mb-6"
                    >
                        Institutional-grade <br />
                        <span className="font-bold bg-clip-text text-transparent bg-gradient-to-r from-orange-400 to-amber-200">
                            Portfolio Intelligence.
                        </span>
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, delay: 0.3 }}
                        className="text-lg text-slate-400 leading-relaxed mb-12"
                    >
                        Access your unified financial command center. Secured by zero-trust architecture, advanced encryption, and enterprise-level authentication protocols.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1, delay: 0.6 }}
                        className="flex gap-6 items-center"
                    >
                        <div className="flex flex-col gap-1">
                            <span className="text-2xl font-semibold text-white">SOC 2</span>
                            <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold text-orange-500/80">Compliant</span>
                        </div>
                        <div className="w-px h-10 bg-slate-800"></div>
                        <div className="flex flex-col gap-1">
                            <span className="text-2xl font-semibold text-white">AES-256</span>
                            <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold text-orange-500/80">Encryption</span>
                        </div>
                    </motion.div>
                </div>

                <div className="text-xs text-slate-600 font-medium tracking-wide uppercase">
                    © {new Date().getFullYear()} WealthOS Infrastructure
                </div>
            </div>

            {/* Right Column: Authentication */}
            <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12 relative z-10 w-full min-h-screen md:min-h-0">
                {/* Mobile version of the logo */}
                <div className="md:hidden flex items-center gap-3 mb-10 w-full max-w-[400px]">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg shadow-orange-500/20">
                        <Globe className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-lg font-bold tracking-tight text-white">Wealth<span className="text-orange-400">OS</span></span>
                </div>

                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5 }}
                    className="w-full max-w-[420px]"
                >
                    {/* Header */}
                    <div className="mb-8">
                        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                            {mode === 'LOGIN' ? 'Secure Login' : 'Provision Account'}
                        </h2>
                        <p className="text-sm text-slate-400">
                            {mode === 'LOGIN' ? 'Authenticate to access your workspace.' : 'Initialize your secure enterprise environment.'}
                        </p>
                    </div>

                    {/* Google Auth Button */}
                    {isTelegramWebApp ? (
                        <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-400 text-xs text-center mb-6 leading-relaxed">
                            ⚠️ Google Sign-In is blocked inside Telegram's sandbox. Please use your <b>Email & Password</b> below.
                        </div>
                    ) : (
                        <button
                            onClick={handleGoogleAuth}
                            disabled={isGoogleLoading || isLoading}
                            className="w-full relative group overflow-hidden rounded-xl p-[1px] transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-6"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-slate-700 via-slate-600 to-slate-700 rounded-xl opacity-50 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative flex items-center justify-center gap-3 px-6 py-3.5 bg-[#121826] rounded-xl hover:bg-[#161d2d] transition-colors">
                                {isGoogleLoading ? (
                                    <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
                                ) : (
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                )}
                                <span className="font-semibold text-white">Continue with Google</span>
                            </div>
                        </button>
                    )}

                    <div className="flex items-center gap-4 mb-6">
                        <div className="flex-1 h-px bg-slate-800"></div>
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">or SSO</span>
                        <div className="flex-1 h-px bg-slate-800"></div>
                    </div>

                    {/* Form Container */}
                    <div className="bg-[#121826]/80 backdrop-blur-xl rounded-2xl border border-white/5 relative shadow-2xl">

                        {/* Tabs */}
                        <div className="flex border-b border-white/5 relative">
                            <button
                                onClick={() => { setMode('LOGIN'); setError(''); setSuccessMessage(''); }}
                                className={`flex-1 py-4 text-sm font-semibold transition-all relative z-10 ${mode === 'LOGIN' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                Secure Login
                            </button>
                            <button
                                onClick={() => { setMode('SIGNUP'); setError(''); setSuccessMessage(''); }}
                                className={`flex-1 py-4 text-sm font-semibold transition-all relative z-10 ${mode === 'SIGNUP' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                Provision Account
                            </button>

                            {/* Animated active indicator */}
                            <div
                                className={`absolute bottom-0 h-0.5 bg-orange-500 transition-all duration-300 ease-out`}
                                style={{
                                    width: '50%',
                                    left: mode === 'LOGIN' ? '0%' : '50%',
                                }}
                            />
                        </div>

                        {/* Form */}
                        <form onSubmit={handleEmailAuth} className="p-6 sm:p-8 space-y-5">
                            <AnimatePresence mode="popLayout">
                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0, y: -10 }}
                                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-start gap-3 overflow-hidden"
                                    >
                                        <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
                                        <p>{error}</p>
                                    </motion.div>
                                )}
                                {successMessage && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0, y: -10 }}
                                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-start gap-3 overflow-hidden"
                                    >
                                        <Fingerprint className="w-5 h-5 shrink-0 mt-0.5" />
                                        <p>{successMessage}</p>
                                    </motion.div>
                                )}
                                {showPasswordSetupOption && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0, y: -10 }}
                                        animate={{ opacity: 1, height: 'auto', y: 0 }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl flex flex-col gap-3 text-xs overflow-hidden"
                                    >
                                        <p className="text-orange-400 font-medium leading-relaxed">
                                            This email address is already registered using Google Sign-In. You can send a password setup link to verify and link a password to your Google account.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleSendPasswordSetup}
                                            disabled={isLoading}
                                            className="px-4 py-2 bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold rounded-lg transition-all text-center self-start"
                                        >
                                            Send Password Setup Link
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest ml-1">Identity Email</label>
                                <div className="relative group">
                                    <Mail className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-orange-500 transition-colors" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="user@enterprise.com"
                                        required
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-slate-600 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 focus:bg-orange-500/[0.02] outline-none transition-all"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-slate-400 uppercase tracking-widest ml-1">Access Key</label>
                                <div className="relative group">
                                    <Lock className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-orange-500 transition-colors" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••••••"
                                        required
                                        minLength={6}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl py-3.5 pl-11 pr-4 text-sm text-white placeholder:text-slate-600 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 focus:bg-orange-500/[0.02] outline-none transition-all"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading || isGoogleLoading}
                                className="w-full py-3.5 bg-orange-500 hover:bg-orange-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold rounded-xl shadow-[0_0_20px_rgba(249,115,22,0.3)] hover:shadow-[0_0_30px_rgba(249,115,22,0.5)] transition-all flex items-center justify-center gap-2 mt-4"
                            >
                                {isLoading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        {mode === 'LOGIN' ? 'Authenticate' : 'Initialize Workspace'}
                                        <ArrowRight className="w-5 h-5" />
                                    </>
                                )}
                            </button>
                        </form>
                    </div>

                    <div className="mt-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                        <Lock className="w-3.5 h-3.5 border border-slate-700/50 rounded-full p-[2px]" />
                        End-to-End Encrypted Session
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

export default FirebaseLoginPage;
