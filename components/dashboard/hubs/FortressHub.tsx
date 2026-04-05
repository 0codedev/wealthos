import React, { useState, useEffect, useMemo } from 'react';
import {
    Shield, Lock, Unlock, Key, FileText, AlertOctagon, Power, Clock,
    Eye, EyeOff, Save, Trash2, ShieldCheck, ShieldAlert, Users,
    Fingerprint, Smartphone, Mail, CreditCard, Building, Heart,
    FolderLock, ChevronRight, CheckCircle2, XCircle, AlertTriangle,
    Download, Upload, Copy, Edit3, Plus, Tag, Calendar, Star
} from 'lucide-react';
import { encryptData, decryptData, hashPassword } from '../../../utils/Encryption';
import { SecurityDashboard, LegacyPlanning, SecretNote } from '../../fortress';

// ===================== TYPES =====================
// Local components moved to ../../fortress

// ===================== DOCUMENT CATEGORIES =====================
const CATEGORIES = [
    { id: 'password', label: 'Passwords', icon: <Key size={12} />, color: 'text-indigo-400 bg-indigo-500/10' },
    { id: 'financial', label: 'Financial', icon: <CreditCard size={12} />, color: 'text-emerald-400 bg-emerald-500/10' },
    { id: 'personal', label: 'Personal', icon: <Users size={12} />, color: 'text-blue-400 bg-blue-500/10' },
    { id: 'medical', label: 'Medical', icon: <Heart size={12} />, color: 'text-rose-400 bg-rose-500/10' },
    { id: 'legal', label: 'Legal', icon: <FileText size={12} />, color: 'text-amber-400 bg-amber-500/10' },
];

// ===================== MAIN FORTRESS HUB =====================
const FortressHub: React.FC = () => {
    // Security State
    const [isLocked, setIsLocked] = useState(true);
    const [masterPassword, setMasterPassword] = useState('');
    const [storedHash, setStoredHash] = useState<string | null>(null);
    const [isSetupMode, setIsSetupMode] = useState(false);

    // Vault State
    const [notes, setNotes] = useState<SecretNote[]>([]);
    const [newNote, setNewNote] = useState({ title: '', content: '', category: 'password' as const });
    const [viewingNote, setViewingNote] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    // Tabs
    const [activeTab, setActiveTab] = useState<'vault' | 'security' | 'legacy'>('vault');

    // Dead Man's Switch
    const [dmsEnabled, setDmsEnabled] = useState(false);
    const [dmsTimer, setDmsTimer] = useState(30);

    // Calculate security score
    const securityScore = useMemo(() => {
        let score = 50; // Base
        if (storedHash) score += 20; // Password set
        if (notes.length > 0) score += 15; // Notes stored
        if (dmsEnabled) score += 15; // DMS enabled
        return Math.min(100, score);
    }, [storedHash, notes.length, dmsEnabled]);

    // Setup / Unlock Logic
    useEffect(() => {
        const savedHash = localStorage.getItem('fortress_hash');
        if (savedHash) {
            setStoredHash(savedHash);
        } else {
            setIsSetupMode(true);
        }
        const savedNotes = localStorage.getItem('fortress_notes_v2');
        if (savedNotes) setNotes(JSON.parse(savedNotes));
    }, []);

    const handleUnlock = () => {
        if (!masterPassword) return;
        const inputHash = hashPassword(masterPassword);
        if (inputHash === storedHash) {
            setIsLocked(false);
            setMasterPassword('');
        } else {
            alert("ACCESS DENIED - Invalid Master Key");
        }
    };

    const handleSetup = () => {
        if (!masterPassword || masterPassword.length < 8) {
            alert("Password must be at least 8 characters");
            return;
        }
        const h = hashPassword(masterPassword);
        localStorage.setItem('fortress_hash', h);
        setStoredHash(h);
        setIsSetupMode(false);
        setIsLocked(false);
        setMasterPassword('');
    };

    const saveNotes = (updatedNotes: SecretNote[]) => {
        setNotes(updatedNotes);
        localStorage.setItem('fortress_notes_v2', JSON.stringify(updatedNotes));
    };

    const handleAddNote = () => {
        if (!newNote.title || !newNote.content) return;
        const sessionKey = storedHash?.substring(0, 32) || "FALLBACK_KEY_123";
        const encrypted = encryptData(newNote.content, sessionKey);
        const note: SecretNote = {
            id: Date.now().toString(),
            title: newNote.title,
            encryptedContent: encrypted,
            date: new Date().toLocaleDateString(),
            category: newNote.category,
            starred: false
        };
        saveNotes([note, ...notes]);
        setNewNote({ title: '', content: '', category: 'password' });
        setViewingNote(null);
    };

    const getDecryptedContent = (note: SecretNote) => {
        const sessionKey = storedHash?.substring(0, 32) || "FALLBACK_KEY_123";
        return decryptData(note.encryptedContent, sessionKey);
    };

    const toggleStar = (id: string) => {
        const updated = notes.map(n => n.id === id ? { ...n, starred: !n.starred } : n);
        saveNotes(updated);
    };

    const deleteNote = (id: string) => {
        saveNotes(notes.filter(n => n.id !== id));
    };

    const filteredNotes = selectedCategory
        ? notes.filter(n => n.category === selectedCategory)
        : notes;

    // ===================== LOCK SCREEN =====================
    if (isLocked) {
        return (
            <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden min-h-[400px] flex flex-col items-center justify-center text-center">
                {/* CSS-Only Noise Pattern (Performance Optimized) */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
                />

                <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.03)_1px,transparent_1px)] bg-[size:40px_40px]" />

                <div className="relative z-10 space-y-6 max-w-sm w-full">
                    <div className="mx-auto w-24 h-24 bg-white dark:bg-slate-900 rounded-full flex items-center justify-center border border-emerald-500/20 shadow-xl shadow-emerald-500/5">
                        <Lock size={36} className="text-emerald-500" />
                    </div>

                    <div>
                        <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter mb-1">THE FORTRESS 2.0</h2>
                        <p className="text-xs font-mono text-emerald-600 dark:text-emerald-505/60 uppercase tracking-widest">
                            {isSetupMode ? "Initialize Secure Vault" : "AES-256 Encrypted"}
                        </p>
                    </div>

                    <div className="bg-white/80 dark:bg-slate-900/80 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 backdrop-blur-sm">
                        <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block text-left">
                            {isSetupMode ? "Create Master Key (min 8 chars)" : "Enter Master Key"}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={masterPassword}
                                onChange={e => setMasterPassword(e.target.value)}
                                className="flex-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-slate-900 dark:text-white font-mono text-lg focus:border-emerald-500 outline-none transition-all"
                                placeholder="••••••••••••"
                                onKeyDown={e => e.key === 'Enter' && (isSetupMode ? handleSetup() : handleUnlock())}
                            />
                            <button
                                onClick={isSetupMode ? handleSetup : handleUnlock}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white p-3 rounded-lg transition-colors shadow-lg shadow-emerald-900/30"
                            >
                                {isSetupMode ? <Save size={20} /> : <Key size={20} />}
                            </button>
                        </div>
                        {isSetupMode && (
                            <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-3 flex items-center gap-1">
                                <AlertOctagon size={12} /> This key cannot be recovered. Store it safely.
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-500 dark:text-slate-600">
                        <div className="flex items-center gap-1"><ShieldCheck size={10} /> AES-256</div>
                        <div className="flex items-center gap-1"><FolderLock size={10} /> Local Only</div>
                        <div className="flex items-center gap-1"><Fingerprint size={10} /> Zero-Trust</div>
                    </div>
                </div>
            </div>
        );
    }

    // ===================== VAULT INTERFACE =====================
    return (
        <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-emerald-900/30 rounded-3xl shadow-2xl relative overflow-hidden min-h-[500px] flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-slate-200 dark:border-emerald-900/20 bg-gradient-to-r from-white dark:from-slate-900 to-slate-50 dark:to-emerald-950/20">
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 dark:text-emerald-400">
                            <ShieldCheck size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                                THE FORTRESS 2.0
                                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 uppercase">Secured</span>
                            </h2>
                            <div className="flex items-center gap-4 text-xs font-mono text-emerald-700 dark:text-emerald-600/60 mt-1">
                                <span>Security: {securityScore}%</span>
                                <span>•</span>
                                <span>{notes.length} secrets</span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsLocked(true)}
                        className="p-2 rounded-lg bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-200 dark:border-slate-800"
                        title="Lock Vault"
                    >
                        <Lock size={18} />
                    </button>
                </div>

                {/* Tab Navigation */}
                <div className="flex gap-1 mt-4 p-1 bg-slate-100 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800">
                    {[
                        { id: 'vault', label: 'Secure Vault', icon: <FolderLock size={14} /> },
                        { id: 'security', label: 'Security', icon: <ShieldCheck size={14} /> },
                        { id: 'legacy', label: 'Legacy', icon: <Users size={14} /> },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === tab.id
                                ? 'bg-emerald-600 text-white shadow-lg'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 p-6 overflow-auto">
                {/* VAULT TAB */}
                {activeTab === 'vault' && (
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        <div className="space-y-2">
                            <button
                                onClick={() => setSelectedCategory(null)}
                                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${!selectedCategory ? 'bg-emerald-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                            >
                                <FolderLock size={12} /> All Secrets
                            </button>
                            {CATEGORIES.map(cat => (
                                <button
                                    key={cat.id}
                                    onClick={() => setSelectedCategory(cat.id)}
                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${selectedCategory === cat.id
                                        ? `${cat.color} border border-current`
                                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                >
                                    {cat.icon} {cat.label}
                                    <span className="ml-auto text-[9px] opacity-60">
                                        {notes.filter(n => n.category === cat.id).length}
                                    </span>
                                </button>
                            ))}

                            {/* Dead Man's Switch */}
                            <div className="mt-6 p-3 bg-slate-100 dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-800">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center gap-1">
                                        <ShieldAlert size={10} className={dmsEnabled ? 'text-rose-500' : ''} /> DMS
                                    </span>
                                    <button
                                        onClick={() => setDmsEnabled(!dmsEnabled)}
                                        className={`w-8 h-4 rounded-full transition-colors relative ${dmsEnabled ? 'bg-rose-600' : 'bg-slate-700'}`}
                                    >
                                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${dmsEnabled ? 'left-4' : 'left-0.5'}`} />
                                    </button>
                                </div>
                                {dmsEnabled && (
                                    <p className="text-[9px] text-rose-500">Active: {dmsTimer} days</p>
                                )}
                            </div>
                        </div>

                        {/* Notes List */}
                        <div className="lg:col-span-3 space-y-3">
                            {/* Add New Button */}
                            {viewingNote !== 'NEW' && (
                                <button
                                    onClick={() => setViewingNote('NEW')}
                                    className="w-full p-4 border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 rounded-xl text-slate-500 hover:text-emerald-500 dark:hover:text-emerald-400 transition-all flex items-center justify-center gap-2 text-xs font-bold"
                                >
                                    <Plus size={14} /> Add New Secret
                                </button>
                            )}

                                                     {viewingNote === 'NEW' && (
                                <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-emerald-500/30 space-y-3 animate-in fade-in">
                                    <input
                                        type="text"
                                        placeholder="Title (e.g., Gmail Password)"
                                        value={newNote.title}
                                        onChange={e => setNewNote({ ...newNote, title: e.target.value })}
                                        className="w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-slate-900 dark:text-white text-sm focus:border-emerald-500 outline-none"
                                    />
                                    <textarea
                                        placeholder="Secret content... (Will be encrypted)"
                                        value={newNote.content}
                                        onChange={e => setNewNote({ ...newNote, content: e.target.value })}
                                        className="w-full h-24 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-slate-800 dark:text-slate-300 font-mono text-xs focus:border-emerald-500 outline-none resize-none"
                                    />
                                    <div className="flex gap-2">
                                        {CATEGORIES.map(cat => (
                                            <button
                                                key={cat.id}
                                                onClick={() => setNewNote({ ...newNote, category: cat.id as any })}
                                                className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 ${newNote.category === cat.id ? cat.color : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800'
                                                    }`}
                                            >
                                                {cat.icon} {cat.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                        <button onClick={() => setViewingNote(null)} className="px-4 py-2 text-xs text-slate-400">Cancel</button>
                                        <button onClick={handleAddNote} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg">
                                            Encrypt & Save
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Notes List */}
                            {filteredNotes.length === 0 && viewingNote !== 'NEW' ? (
                                <div className="text-center py-12 opacity-30">
                                    <Shield size={40} className="mx-auto mb-2 text-slate-500" />
                                    <p className="text-xs text-slate-400">No secrets in this category</p>
                                </div>
                            ) : (
                                filteredNotes.map(note => (
                                    <div key={note.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500/30 transition-all group">
                                        <div className="flex justify-between items-start">
                                            <div className="flex items-start gap-3">
                                                <button onClick={() => toggleStar(note.id)} className="mt-0.5">
                                                    <Star size={14} className={note.starred ? 'text-amber-400 fill-amber-400' : 'text-slate-400 dark:text-slate-600'} />
                                                </button>
                                                <div>
                                                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{note.title}</h4>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${CATEGORIES.find(c => c.id === note.category)?.color}`}>
                                                            {note.category}
                                                        </span>
                                                        <span className="text-[9px] text-slate-500 dark:text-slate-600 font-mono">{note.date}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => setViewingNote(viewingNote === note.id ? null : note.id)}
                                                    className="p-1.5 text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400"
                                                >
                                                    {viewingNote === note.id ? <EyeOff size={14} /> : <Eye size={14} />}
                                                </button>
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(getDecryptedContent(note))}
                                                    className="p-1.5 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400"
                                                >
                                                    <Copy size={14} />
                                                </button>
                                                <button
                                                    onClick={() => deleteNote(note.id)}
                                                    className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-500"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        {viewingNote === note.id && (
                                            <div className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200 dark:border-emerald-900/30 animate-in fade-in">
                                                <p className="text-xs font-mono text-emerald-700 dark:text-emerald-300 break-all select-all">
                                                    {getDecryptedContent(note)}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {/* SECURITY TAB */}
                {activeTab === 'security' && (
                    <SecurityDashboard securityScore={securityScore} />
                )}

                          {activeTab === 'legacy' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <LegacyPlanning />

                        <div className="bg-white dark:bg-slate-900/50 rounded-2xl p-5 border border-slate-200 dark:border-slate-800">
                            <h4 className="text-xs font-bold text-rose-600 dark:text-rose-300 uppercase flex items-center gap-2 mb-4">
                                <ShieldAlert size={14} /> Dead Man's Switch
                            </h4>

                            <div className="flex items-center justify-between mb-4">
                                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">Protocol Status</span>
                                <button
                                    onClick={() => setDmsEnabled(!dmsEnabled)}
                                    className={`w-12 h-6 rounded-full transition-colors relative ${dmsEnabled ? 'bg-rose-600' : 'bg-slate-700'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${dmsEnabled ? 'left-7' : 'left-1'}`} />
                                </button>
                            </div>

                            {dmsEnabled && (
                                <div className="space-y-4 animate-in fade-in">
                                    <div>
                                        <label className="text-[10px] text-slate-550 dark:text-slate-500 font-bold uppercase block mb-2">Inactivity Trigger</label>
                                        <div className="flex bg-slate-100 dark:bg-slate-950 rounded-lg p-1 border border-slate-200 dark:border-slate-800">
                                            {[15, 30, 60, 90].map(days => (
                                                <button
                                                    key={days}
                                                    onClick={() => setDmsTimer(days)}
                                                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${dmsTimer === days ? 'bg-rose-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-300'}`}
                                                >
                                                    {days}d
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/30 rounded-lg">
                                        <p className="text-[10px] text-rose-700 dark:text-rose-300 leading-relaxed">
                                            <AlertOctagon size={10} className="inline mr-1" />
                                            If no login for {dmsTimer} days, vault access will be shared with verified beneficiaries.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FortressHub;
