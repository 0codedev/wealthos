import React, { useState } from 'react';
import { Cloud, CloudOff, Download, Upload, Loader2, CheckCircle, AlertCircle, LogOut, Shield, Smartphone } from 'lucide-react';
import { useFirebaseAuth } from '../../contexts/FirebaseAuthContext';
import { getFirebaseAuthServices } from '../../lib/firebase';
import { syncProviderFacade } from '../../services/SyncProviderFacade';
import type { SyncPreviewSummary } from '../../services/SyncGovernanceService';
import { StateSurface } from '../shared/SurfacePrimitives';
import { uploadBackupToCloud, downloadBackupFromCloud } from '../../services/BackupService';
import { triggerHapticImpact, triggerHapticNotification } from '../../utils/haptics';
import { syncEngine } from '../../services/SyncEngine';
import { useToast } from '../shared/ToastProvider';
import { DeviceManagementModal } from './DeviceManagementModal';

interface CloudSyncPanelProps {
    onRestoreComplete?: () => void;
}

const CloudSyncPanel: React.FC<CloudSyncPanelProps> = ({ onRestoreComplete }) => {
    const { user, signOut } = useFirebaseAuth();
    const [activeProvider, setActiveProvider] = useState<'firebase' | 'supabase'>(syncProviderFacade.getActiveProviderName());
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [pullPreview, setPullPreview] = useState<SyncPreviewSummary | null>(null);
    const [showPullConfirm, setShowPullConfirm] = useState(false);
    const [showDeviceModal, setShowDeviceModal] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // VPS Sync states
    const [isVpsLoading, setIsVpsLoading] = useState(false);
    const [vpsStatus, setVpsStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [vpsMessage, setVpsMessage] = useState('');

    // GCS backup/restore states
    const [isGcsLoading, setIsGcsLoading] = useState(false);
    const [gcsStatus, setGcsStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [gcsMessage, setGcsMessage] = useState('');

    const { toast } = useToast();
    const [isAutoPull, setIsAutoPull] = useState(syncEngine.isAutoPullEnabled());

    const toggleAutoPull = () => {
        const next = !isAutoPull;
        setIsAutoPull(next);
        syncEngine.setAutoPullEnabled(next);
        triggerHapticImpact('light');
        if (next) {
            toast.info('Automatic background pull enabled.');
        } else {
            toast.success('Automatic background pull disabled! Local device is in Safe Mode.');
        }
    };

    const handleVpsPush = async () => {
        if (!user) return;
        triggerHapticImpact('medium');
        setIsVpsLoading(true);
        setVpsStatus('idle');
        setVpsMessage('Pushing 100% of holdings, trades, tokens & settings to Oracle Cloud...');
        const res = await syncEngine.performPush(user.uid);
        setIsVpsLoading(false);
        setVpsStatus(res.success ? 'success' : 'error');
        setVpsMessage(res.message);
        triggerHapticNotification(res.success ? 'success' : 'error');
    };

    const handleVpsPull = async () => {
        if (!user) return;
        triggerHapticImpact('medium');
        setIsVpsLoading(true);
        setVpsStatus('idle');
        setVpsMessage('Downloading and rehydrating portfolio & tokens from Oracle Cloud...');
        const res = await syncEngine.performPull(user.uid);
        setIsVpsLoading(false);
        setVpsStatus(res.success ? 'success' : 'error');
        setVpsMessage(res.message);
        triggerHapticNotification(res.success ? 'success' : 'error');
        if (res.success && onRestoreComplete) {
            onRestoreComplete();
        }
    };

    const handleProviderChange = (provider: 'firebase' | 'supabase') => {
        syncProviderFacade.setActiveProviderName(provider);
        setActiveProvider(provider);
        setStatus('idle');
        setMessage(`Switched active provider to ${provider === 'supabase' ? 'Supabase' : 'Firebase'}.`);
    };

    const handleAuth = async (type: 'LOGIN' | 'SIGNUP') => {
        setIsLoading(true);
        setStatus('idle');
        setMessage('');

        try {
            const { auth, authModule } = await getFirebaseAuthServices();
            if (type === 'SIGNUP') {
                await authModule.createUserWithEmailAndPassword(auth, email, password);
                setStatus('success');
                setMessage('Account created! You are now signed in to Cloud Sync.');
            } else {
                await authModule.signInWithEmailAndPassword(auth, email, password);
                setStatus('success');
                setMessage('Logged in to Cloud Sync successfully.');
            }
        } catch (err: unknown) {
            setStatus('error');
            const message = err instanceof Error ? err.message : String(err);
            const code = (err as any).code || '';
            if (code === 'auth/user-not-found') setMessage('No account found with this email.');
            else if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') setMessage('Incorrect password.');
            else if (code === 'auth/email-already-in-use') setMessage('Email already registered. Try logging in.');
            else if (code === 'auth/weak-password') setMessage('Password must be at least 6 characters.');
            else setMessage(message || 'Authentication failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogleAuth = async () => {
        setIsLoading(true);
        setStatus('idle');
        setMessage('');

        try {
            const { auth, googleProvider, authModule } = await getFirebaseAuthServices();
            await authModule.signInWithPopup(auth, googleProvider);
            setStatus('success');
            setMessage('Logged in to Cloud Sync successfully via Google.');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const code = (err as any).code || '';
            setStatus('error');
            if (code === 'auth/popup-closed-by-user') setMessage('Google sign-in cancelled.');
            else setMessage(message || 'Authentication failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSyncToCloud = async () => {
        if (!user) return;
        triggerHapticImpact('medium');
        setIsLoading(true);
        setStatus('syncing');
        setMessage('Pushing data to cloud...');
        const result = await syncProviderFacade.syncToCloud(user.uid);
        triggerHapticNotification(result.success ? 'success' : 'error');
        setStatus(result.success ? 'success' : 'error');
        setMessage(result.message);
        setIsLoading(false);
    };

    const handlePullPreview = async () => {
        if (!user) return;
        triggerHapticImpact('medium');
        setIsLoading(true);
        setStatus('syncing');
        setMessage('Previewing cloud restore...');

        try {
            const preview = await syncProviderFacade.previewPullFromCloud(user.uid);
            triggerHapticNotification('success');
            setPullPreview(preview);
            setShowPullConfirm(true);
            setStatus('idle');
            setMessage('Cloud restore preview ready.');
        } catch (err: unknown) {
            triggerHapticNotification('error');
            setStatus('error');
            const message = err instanceof Error ? err.message : String(err);
            setMessage(message || 'Failed to preview cloud restore.');
        } finally {
            setIsLoading(false);
        }
    };

    const confirmPullFromCloud = async () => {
        if (!user) return;
        triggerHapticImpact('medium');
        setShowPullConfirm(false);
        setIsLoading(true);
        setStatus('syncing');
        setMessage('Pulling data from cloud...');
        const result = await syncProviderFacade.pullFromCloud(user.uid);
        triggerHapticNotification(result.success ? 'success' : 'error');
        setStatus(result.success ? 'success' : 'error');
        setMessage(result.message);
        setIsLoading(false);

        if (result.success && onRestoreComplete) {
            onRestoreComplete();
        }
    };

    const handleGcsBackup = async () => {
        if (!user) return;
        triggerHapticImpact('medium');
        setIsGcsLoading(true);
        setGcsStatus('idle');
        setGcsMessage('Uploading JSON backup to Cloud Storage...');
        try {
            const result = await uploadBackupToCloud(user.uid);
            triggerHapticNotification(result.success ? 'success' : 'error');
            setGcsStatus(result.success ? 'success' : 'error');
            setGcsMessage(result.message);
        } catch (err: unknown) {
            triggerHapticNotification('error');
            setGcsStatus('error');
            setGcsMessage(err instanceof Error ? err.message : String(err));
        } finally {
            setIsGcsLoading(false);
        }
    };

    const handleGcsRestore = async () => {
        if (!user) return;
        if (!window.confirm("WARNING: This will overwrite ALL local database tables (except historical backtest data) and local settings with the cloud backup JSON. Are you sure?")) {
            return;
        }
        triggerHapticImpact('medium');
        setIsGcsLoading(true);
        setGcsStatus('idle');
        setGcsMessage('Downloading JSON backup and restoring...');
        try {
            const result = await downloadBackupFromCloud(user.uid);
            triggerHapticNotification(result.success ? 'success' : 'error');
            setGcsStatus(result.success ? 'success' : 'error');
            setGcsMessage(result.message);
            if (result.success) {
                if (onRestoreComplete) {
                    onRestoreComplete();
                }
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
        } catch (err: unknown) {
            triggerHapticNotification('error');
            setGcsStatus('error');
            setGcsMessage(err instanceof Error ? err.message : String(err));
        } finally {
            setIsGcsLoading(false);
        }
    };

    return (
        <>
            <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                <div className="border-b border-slate-200/70 bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-6 py-5 dark:border-slate-800 dark:from-sky-950/20 dark:via-slate-900 dark:to-emerald-950/20">
                    <div className="mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`rounded-2xl p-3 ${user ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-500/20' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700'}`}>
                                {user ? <Cloud size={20} /> : <CloudOff size={20} />}
                            </div>
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-sky-500 dark:text-sky-300">Cloud Vault</p>
                                <h3 className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
                                    {activeProvider === 'supabase' ? 'Supabase Cloud Sync' : 'Firebase Cloud Sync'}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {user ? `Connected via ${activeProvider === 'supabase' ? 'Supabase' : 'Firebase'} (${user.email})` : 'Not connected'}
                                </p>
                            </div>
                        </div>
                        {user && (
                            <button
                                onClick={signOut}
                                className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800 dark:hover:text-rose-400"
                                title="Sign Out of Cloud Sync"
                            >
                                <LogOut size={16} />
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-700">Push local truth</span>
                        <span className="rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-700">Preview before pull</span>
                        <span className="rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-700">Account-scoped recovery</span>
                    </div>
                </div>

                <div className="p-6">
                    <div className="mb-5 flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800/60">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Select Sync Provider</span>
                        <div className="flex gap-1.5 rounded-2xl bg-slate-100 p-1 dark:bg-slate-950">
                            <button
                                onClick={() => handleProviderChange('firebase')}
                                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                                    activeProvider === 'firebase'
                                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                                }`}
                            >
                                Firebase
                            </button>
                            <button
                                onClick={() => handleProviderChange('supabase')}
                                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                                    activeProvider === 'supabase'
                                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                                }`}
                            >
                                Supabase
                            </button>
                        </div>
                    </div>

                    {!user && (
                        <StateSurface
                            className="mb-5"
                            compact
                            tone="info"
                            title="What this unlocks"
                            description="Secure cross-device recovery, cloud push/pull history, and restore previews before local data is replaced."
                            icon={Cloud}
                        />
                    )}

                    {message && (
                        <div className={`mb-4 flex items-center gap-2 rounded-2xl border p-3 text-xs ${status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400' :
                            status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400' :
                                'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300'
                            }`}>
                            {status === 'success' && <CheckCircle size={14} />}
                            {status === 'error' && <AlertCircle size={14} />}
                            {status === 'syncing' && <Loader2 size={14} className="animate-spin" />}
                            {message}
                        </div>
                    )}

                    {!user ? (
                        <div className="space-y-3">
                            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Create an account or login to sync your data securely across all devices.</p>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Email Address"
                                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-600"
                            />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-600"
                            />
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => handleAuth('LOGIN')}
                                    disabled={isLoading}
                                    className="rounded-2xl border border-slate-200 bg-slate-100 py-2.5 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700 dark:disabled:bg-slate-900 dark:disabled:text-slate-600"
                                >
                                    Log In
                                </button>
                                <button
                                    onClick={() => handleAuth('SIGNUP')}
                                    disabled={isLoading}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-sky-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sky-500 disabled:bg-slate-300 dark:disabled:bg-slate-700"
                                >
                                    {isLoading && <Loader2 size={16} className="animate-spin" />}
                                    Sign Up
                                </button>
                            </div>
                            <button
                                onClick={handleGoogleAuth}
                                disabled={isLoading}
                                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-50 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:hover:bg-slate-900 dark:disabled:bg-slate-800"
                            >
                                <svg className="h-4 w-4" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                Continue with Google
                            </button>
                        </div>
                    ) : (
                        <div className="mt-2 space-y-4">
                            {/* Oracle Cloud VPS Real-Time Live Sync Card */}
                            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 ring-1 ring-emerald-500/20">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Oracle Cloud Multi-Device Sync</span>
                                    </div>
                                    <span className="text-[10px] font-mono text-slate-400">24/7 Persistent Hub</span>
                                </div>
                                <p className="text-xs text-slate-300 mb-3">
                                    Synchronizes 100% of your holdings, trades, Dhan PIN, Upstox daily session token, and journal records across all your devices in under 1 second.
                                </p>

                                {vpsMessage && (
                                    <div className={`mb-3 flex items-center gap-2 rounded-xl border p-2.5 text-xs ${
                                        vpsStatus === 'success' ? 'border-emerald-500/40 bg-emerald-900/30 text-emerald-300' :
                                        vpsStatus === 'error' ? 'border-rose-500/40 bg-rose-900/30 text-rose-300' :
                                        'border-slate-700 bg-slate-800 text-slate-300'
                                    }`}>
                                        {vpsStatus === 'success' && <CheckCircle size={14} />}
                                        {vpsStatus === 'error' && <AlertCircle size={14} />}
                                        {isVpsLoading && <Loader2 size={14} className="animate-spin" />}
                                        <span>{vpsMessage}</span>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={handleVpsPush}
                                        disabled={isVpsLoading}
                                        className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-900/30 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
                                    >
                                        {isVpsLoading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                        Push This Device to Cloud
                                    </button>
                                    <button
                                        onClick={handleVpsPull}
                                        disabled={isVpsLoading}
                                        className="flex items-center justify-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 py-2.5 text-xs font-bold text-sky-400 border border-sky-500/30 active:scale-95 transition-all disabled:opacity-50"
                                    >
                                        {isVpsLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                        Pull &amp; Restore to Device
                                    </button>
                                </div>

                                {/* Connected Hardware Sessions / Device Consciousness */}
                                <button
                                    onClick={() => setShowDeviceModal(true)}
                                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 py-2.5 text-xs font-bold text-slate-200 border border-slate-700/60 active:scale-95 transition-all"
                                >
                                    <Smartphone size={14} className="text-emerald-400" />
                                    Connected Devices &amp; Remote Logout
                                </button>

                                {/* Automatic Background Pull Control Switch */}
                                <div className="mt-4 pt-3.5 border-t border-slate-700/60 flex items-center justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-slate-200">Automatic Background Pull</span>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                isAutoPull ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                            }`}>
                                                {isAutoPull ? 'Enabled' : 'Disabled (Safe Mode)'}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                                            {isAutoPull
                                                ? 'Cloud changes are downloaded automatically when switching tabs or focusing the window.'
                                                : 'Automatic downloading is blocked. Your active workstation will never be modified in the background. Downloads only happen when you click "Pull & Restore to Device".'}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={toggleAutoPull}
                                        aria-label="Toggle Automatic Background Pull"
                                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                            isAutoPull ? 'bg-emerald-600' : 'bg-slate-700'
                                        }`}
                                    >
                                        <span
                                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                                isAutoPull ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                        />
                                    </button>
                                </div>
                            </div>

                            <div className="border-t border-slate-100 dark:border-slate-800 my-2" />

                            <StateSurface
                                compact
                                tone="neutral"
                                title="Auxiliary Backups"
                                description="Push sends your current local truth to cloud. Pull previews differences first so you can restore with context instead of guessing."
                                icon={Cloud}
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={handleSyncToCloud}
                                    disabled={isLoading || isGcsLoading}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700"
                                >
                                    {isLoading && status === 'syncing' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                    Sync to Cloud
                                </button>
                                <button
                                    onClick={handlePullPreview}
                                    disabled={isLoading || isGcsLoading}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-sky-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sky-500 disabled:bg-slate-300 dark:disabled:bg-slate-700"
                                >
                                    {isLoading && status === 'syncing' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                    Preview Pull
                                </button>
                            </div>
                            <p className="mt-2 px-4 text-center text-[10px] text-slate-500 dark:text-slate-400">
                                Pushing replaces cloud data with your current local data. Pull shows a restore preview before replacing local data.
                            </p>

                            {/* GCS Backup Pipeline Section */}
                            <div className="border-t border-slate-100 dark:border-slate-800 my-4" />

                            <div className="space-y-3">
                                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                                    <Cloud className="text-violet-500" size={16} />
                                    <span className="text-xs font-bold uppercase tracking-wider">Cloud Storage JSON Sync</span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Full replication backup including credentials, settings, and all tables (excludes backtesting data) for 1-click device replication.
                                </p>

                                {gcsMessage && (
                                    <div className={`flex items-center gap-2 rounded-2xl border p-3 text-xs ${
                                        gcsStatus === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400' :
                                        gcsStatus === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400' :
                                        'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300'
                                    }`}>
                                        {gcsStatus === 'success' && <CheckCircle size={14} />}
                                        {gcsStatus === 'error' && <AlertCircle size={14} />}
                                        {isGcsLoading && <Loader2 size={14} className="animate-spin" />}
                                        {gcsMessage}
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={handleGcsBackup}
                                        disabled={isLoading || isGcsLoading}
                                        className="flex items-center justify-center gap-2 rounded-2xl bg-violet-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-500 disabled:bg-slate-300 dark:disabled:bg-slate-700"
                                    >
                                        {isGcsLoading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                        Cloud Backup
                                    </button>
                                    <button
                                        onClick={handleGcsRestore}
                                        disabled={isLoading || isGcsLoading}
                                        className="flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-500 disabled:bg-slate-300 dark:disabled:bg-slate-700"
                                    >
                                        {isGcsLoading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                        Cloud Restore
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {showPullConfirm && pullPreview && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg rounded-[28px] border border-slate-800 bg-slate-900 p-6 shadow-2xl">
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-sky-300">Restore Preview</p>
                        <h4 className="mt-2 text-lg font-bold text-white">Cloud Restore Preview</h4>
                        <p className="mt-2 text-sm text-slate-400">
                            {pullPreview.totals.changedTables} changed, {pullPreview.totals.newTables} new, {pullPreview.totals.wipeTables} empty-cloud tables, {pullPreview.totals.conflictTables} conflict candidates.
                        </p>
                        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                            {pullPreview.tables.map((table) => (
                                <div key={table.tableName} className="flex items-center justify-between gap-3 text-xs">
                                    <div>
                                        <p className="font-semibold text-white">{table.tableName}</p>
                                        <p className="text-slate-500">{table.localCount} local &rarr; {table.incomingCount} cloud rows</p>
                                    </div>
                                    <span className={`rounded-full px-2 py-1 font-bold uppercase ${table.conflict ? 'bg-amber-950/40 text-amber-300' : table.status === 'unchanged' ? 'bg-emerald-950/40 text-emerald-300' : 'bg-indigo-950/40 text-indigo-300'}`}>
                                        {table.conflict ? 'conflict' : table.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-6 flex gap-3">
                            <button
                                onClick={() => setShowPullConfirm(false)}
                                className="flex-1 rounded-2xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmPullFromCloud}
                                className="flex-1 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-sky-500"
                            >
                                Replace Local Data
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <DeviceManagementModal
                isOpen={showDeviceModal}
                onClose={() => setShowDeviceModal(false)}
            />
        </>
    );
};

export default CloudSyncPanel;
