import React, { useState } from 'react';
import { Lock, FileText, Key, Eye, EyeOff, ShieldAlert, Plus, Unlock, Save } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import { hashPassword, verifyPassword, encryptData, decryptData } from '../../utils/Encryption';

interface SecureDocument {
    id: string;
    title: string;
    type: 'PASSWORD' | 'WILL' | 'DEED' | 'NOTE';
    encryptedContent: string; // In real app, this is actual hash
    dateAdded: string;
}

export const SecureVault: React.FC = () => {
    const { toast } = useToast();
    const [isLocked, setIsLocked] = useState(true);
    const [masterPassword, setMasterPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const [hasMasterPassword, setHasMasterPassword] = useState<boolean>(() => !!localStorage.getItem('vault_master_hash'));
    const [isSettingPassword, setIsSettingPassword] = useState(!hasMasterPassword);
    const [confirmPassword, setConfirmPassword] = useState('');

    // Secure Data Management
    const loadDocs = () => {
        const stored = localStorage.getItem('secure_vault_docs');
        if (stored) {
            try { return JSON.parse(stored); } catch (e) { return []; }
        }
        return [];
    };

    const [docs, setDocs] = useState<SecureDocument[]>(loadDocs);

    const handleSetPassword = () => {
        if (masterPassword.length < 6) {
            toast.error("Password must be at least 6 characters.");
            return;
        }
        if (masterPassword !== confirmPassword) {
            toast.error("Passwords do not match.");
            return;
        }
        
        // Hash and store the master password
        const hash = hashPassword(masterPassword);
        localStorage.setItem('vault_master_hash', hash);
        
        // Clear passwords from state and move to locked state
        setMasterPassword('');
        setConfirmPassword('');
        setHasMasterPassword(true);
        setIsSettingPassword(false);
        setIsLocked(true);
        toast.success("Master Password set successfully!");
    };

    const handleUnlock = () => {
        const storedHash = localStorage.getItem('vault_master_hash');
        
        if (!storedHash) {
            toast.error("Master password not set.");
            return;
        }

        if (verifyPassword(masterPassword, storedHash)) {
            setIsLocked(false);
            toast.success("Vault Unlocked");
        } else {
            toast.error("Invalid Master Password");
        }
    };

    const handleAccess = (doc: SecureDocument) => {
        const decryptedContent = decryptData(doc.encryptedContent, masterPassword);
        if (decryptedContent) {
            toast.success("Document decrypted successfully.");
            alert(`Decrypted Content:\n\n${decryptedContent}`);
        } else {
            toast.error("Failed to decrypt document. Wrong password?");
        }
    };

    const handleAddMockDoc = () => {
        if (isLocked) return;
        const secretText = prompt("Enter the secret content to encrypt:");
        if (!secretText) return;

        const newDoc: SecureDocument = {
            id: Date.now().toString(),
            title: 'New Secure Note',
            type: 'NOTE',
            encryptedContent: encryptData(secretText, masterPassword),
            dateAdded: new Date().toISOString().split('T')[0]
        };

        const updatedDocs = [...docs, newDoc];
        setDocs(updatedDocs);
        localStorage.setItem('secure_vault_docs', JSON.stringify(updatedDocs));
        toast.success("Encrypted document saved.");
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm h-full flex flex-col relative overflow-hidden">

            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className={`p-3 rounded-xl ${isLocked ? 'bg-slate-100 text-slate-500' : 'bg-indigo-100 text-indigo-600'}`}>
                    {isLocked ? <Lock size={24} /> : <Unlock size={24} />}
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Secure Vault</h3>
                    <p className="text-sm text-slate-500">AES-256 Encrypted Storage.</p>
                </div>
                {!isLocked && (
                    <button
                        onClick={() => setIsLocked(true)}
                        className="ml-auto text-xs font-bold text-slate-500 hover:text-rose-500"
                    >
                        LOCK VAULT
                    </button>
                )}
            </div>

            {/* Locked State */}
            {isSettingPassword ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-6">
                    <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mb-2 border border-indigo-100 dark:border-indigo-500/30">
                        <ShieldAlert size={32} className="text-indigo-500" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-slate-800 dark:text-white">Initialize Vault</h3>
                        <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">
                            Set a strong master password. If you lose this, your encrypted documents cannot be recovered.
                        </p>
                    </div>

                    <div className="w-full max-w-xs relative space-y-3">
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="Create Master Password"
                                value={masterPassword}
                                onChange={(e) => setMasterPassword(e.target.value)}
                                className="w-full px-4 py-3 pr-12 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-0 outline-none transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-500"
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        <input
                            type="password"
                            placeholder="Confirm Password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-0 outline-none transition-all"
                            onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()}
                        />
                    </div>

                    <button
                        onClick={handleSetPassword}
                        disabled={!masterPassword || !confirmPassword}
                        className="w-full max-w-xs py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                    >
                        <Save size={18} /> Initialize Vault
                    </button>
                </div>
            ) : isLocked ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-6">
                    <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mb-2">
                        <Key size={32} className="text-slate-400" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-slate-800 dark:text-white">Vault is Locked</h3>
                        <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">
                            Enter Master Password or trigger Dead Man's Switch to access.
                        </p>
                    </div>

                    <div className="w-full max-w-xs relative">
                        <input
                            type={showPassword ? "text" : "password"}
                            placeholder="Master Password"
                            value={masterPassword}
                            onChange={(e) => setMasterPassword(e.target.value)}
                            className="w-full px-4 py-3 pr-12 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-0 outline-none transition-all"
                            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-500"
                        >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>

                    <button
                        onClick={handleUnlock}
                        disabled={!masterPassword}
                        className="w-full max-w-xs py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-50 disabled:shadow-none"
                    >
                        Unlock Vault
                    </button>
                </div>
            ) : (
                /* Unlocked State */
                <div className="flex-1 flex flex-col animate-in zoom-in-95 duration-300">
                    <div className="flex justify-between items-center mb-4">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Stored Documents ({docs.length})</p>
                        <button onClick={handleAddMockDoc} className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-lg transition-colors">
                            <Plus size={14} /> Add New
                        </button>
                    </div>

                    <div className="space-y-3 overflow-y-auto pr-2 max-h-[300px]">
                        {docs.map((doc) => (
                            <div key={doc.id} className="group bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400 group-hover:text-indigo-500 transition-colors">
                                        <FileText size={18} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-800 dark:text-white text-sm">{doc.title}</h4>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-[10px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded">{doc.type}</span>
                                            <span className="text-[10px] text-slate-400">{doc.dateAdded}</span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleAccess(doc)}
                                    className="opacity-0 group-hover:opacity-100 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-600 hover:text-indigo-600 transition-all shadow-sm"
                                >
                                    View
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="mt-auto pt-6 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30">
                            <ShieldAlert size={18} className="text-red-500 mt-0.5 shrink-0" />
                            <p className="text-xs text-red-800 dark:text-red-400 leading-relaxed">
                                <strong>Warning:</strong> Documents are encrypted client-side. If you lose your Master Password AND the Dead Man's Switch fails, this data is lost forever.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
