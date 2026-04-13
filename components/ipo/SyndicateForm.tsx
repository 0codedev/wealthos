import React, { useMemo } from 'react';
import { Plus, User, Wallet, Sparkles, Check, AlertCircle } from 'lucide-react';
import { AutocompleteInput } from './AutocompleteInput';
import { IPOApplication, Friend } from '../../database';
import { formatCurrency } from '../../utils/helpers';
import { normalizeSyndicateName, findMatchingVaultFriend } from '../../services/SyndicateNameResolver';

interface SyndicateFormProps {
    formData: Partial<IPOApplication>;
    setFormData: (data: Partial<IPOApplication>) => void;
    handleAdd: (e: React.FormEvent) => void;
    formError: string | null;
    applicantInputRef: React.RefObject<HTMLInputElement | null>;
    pastApplicants: string[];
    pastUPIs: string[];
    pastIPONames?: string[];
    appliedApplicants?: Set<string> | string[];
    applicantUpiMap?: Record<string, string>;
    setFormError: (error: string | null) => void;
    friends?: Friend[];
}

const SyndicateFormComp: React.FC<SyndicateFormProps> = ({
    formData,
    setFormData,
    handleAdd,
    formError,
    applicantInputRef,
    pastApplicants,
    pastUPIs,
    pastIPONames = [],
    appliedApplicants,
    applicantUpiMap = {},
    setFormError,
    friends = []
}) => {
    // Combined list of vault members + past applicants
    const memberOptions = useMemo(() => {
        const vaultNames = friends.map(f => f.name);
        const combined = Array.from(new Set([...vaultNames, ...pastApplicants]));
        return combined.filter(Boolean);
    }, [friends, pastApplicants]);

    // Check currently selected applicant's vault balance
    const selectedFriend = useMemo(() => {
        if (!formData.applicantName) return null;
        return findMatchingVaultFriend(formData.applicantName, friends);
    }, [formData.applicantName, friends]);

    const isLowBalance = selectedFriend && (formData.amount || 0) > 0 && selectedFriend.balance < (formData.amount || 0);

    const handleApplicantSelect = (rawName: string) => {
        const canonicalName = normalizeSyndicateName(rawName);
        const matchedFriend = findMatchingVaultFriend(rawName, friends);
        const mappedUpi = matchedFriend?.notes?.match(/UPI:\s*([^\s)]+)/i)?.[1] 
            || applicantUpiMap[canonicalName.toLowerCase()] 
            || applicantUpiMap[rawName.trim().toLowerCase()];

        setFormData({
            ...formData,
            applicantName: matchedFriend ? matchedFriend.name : canonicalName,
            upiHandle: mappedUpi || formData.upiHandle || ''
        });
    };

    return (
        <form onSubmit={handleAdd} className="bg-slate-50/90 dark:bg-slate-900/90 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-sm">
            <div className="grid grid-cols-2 md:grid-cols-7 gap-2.5 sm:gap-3 items-end">
                {/* IPO Name */}
                <div className="col-span-2 md:col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                        IPO Name
                    </label>
                    <AutocompleteInput
                        placeholder="e.g. NTPC Green"
                        value={formData.ipoName || ''}
                        onChange={val => setFormData({ ...formData, ipoName: val })}
                        options={pastIPONames}
                        className="w-full p-2 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-indigo-500 h-9 font-medium"
                    />
                </div>

                {/* Applicant with Vault Sync */}
                <div className="col-span-1">
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            Applicant
                        </label>
                        {selectedFriend && (
                            <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded ${isLowBalance ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/40' : 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'}`}>
                                ₹{formatCurrency(selectedFriend.balance)}
                            </span>
                        )}
                    </div>
                    <AutocompleteInput
                        ref={applicantInputRef}
                        placeholder="Select member / Self"
                        value={formData.applicantName || ''}
                        onChange={val => {
                            const canonical = normalizeSyndicateName(val);
                            const matchedFriend = findMatchingVaultFriend(val, friends);
                            const mappedUpi = matchedFriend?.notes?.match(/UPI:\s*([^\s)]+)/i)?.[1]
                                || applicantUpiMap[canonical.toLowerCase()] 
                                || applicantUpiMap[val.trim().toLowerCase()];

                            setFormData({
                                ...formData,
                                applicantName: val,
                                upiHandle: mappedUpi || formData.upiHandle || ''
                            });
                        }}
                        onSelect={handleApplicantSelect}
                        options={memberOptions}
                        appliedOptions={appliedApplicants}
                        subtitleMap={applicantUpiMap}
                        className={`w-full p-2 rounded-xl border bg-white dark:bg-slate-900 text-xs outline-none focus:border-indigo-500 h-9 font-medium ${
                            isLowBalance ? 'border-amber-400 dark:border-amber-500' : 'border-slate-200 dark:border-slate-700'
                        }`}
                    />
                </div>

                {/* UPI ID */}
                <div className="col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                        UPI ID
                    </label>
                    <AutocompleteInput
                        placeholder="e.g. mobile@oksbi"
                        value={formData.upiHandle || ''}
                        onChange={val => setFormData({ ...formData, upiHandle: val })}
                        options={pastUPIs}
                        className="w-full p-2 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-indigo-500 h-9 font-mono"
                    />
                </div>

                {/* IPO Type */}
                <div className="col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                        IPO Type
                    </label>
                    <select
                        value={formData.ipoType || 'MAINBOARD'}
                        onChange={e => setFormData({ ...formData, ipoType: e.target.value as any })}
                        className="w-full p-2 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-indigo-500 text-slate-800 dark:text-white h-9 font-medium"
                    >
                        <option value="MAINBOARD">Mainboard</option>
                        <option value="SME">SME</option>
                    </select>
                </div>

                {/* Quota */}
                <div className="col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                        Quota
                    </label>
                    <select
                        value={formData.quota || 'RETAIL'}
                        onChange={e => setFormData({ ...formData, quota: e.target.value as any })}
                        className="w-full p-2 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-indigo-500 text-slate-800 dark:text-white h-9 font-medium"
                    >
                        <option value="RETAIL">Retail</option>
                        <option value="SHAREHOLDER">Shareholder</option>
                        <option value="SMALL_HNI">Small HNI</option>
                        <option value="BIG_HNI">Big HNI</option>
                    </select>
                </div>

                {/* Amount */}
                <div className="col-span-1">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                        Amount (₹)
                    </label>
                    <input
                        type="number"
                        placeholder="15000"
                        value={formData.amount || ''}
                        onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                        className="w-full p-2 rounded-xl border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-indigo-500 h-9 font-mono font-bold"
                    />
                </div>

                {/* Submit Button */}
                <div className="col-span-1">
                    <button 
                        type="submit" 
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-2 text-xs font-bold flex items-center justify-center gap-1.5 h-9 shadow-md shadow-indigo-500/20 transition-all active:scale-95"
                    >
                        <Plus size={15} /> <span>Add</span>
                    </button>
                </div>
            </div>

            {/* Error or Low Balance Alert */}
            {formError && (
                <p className="text-xs text-rose-500 font-bold flex items-center gap-1">
                    <AlertCircle size={13} /> {formError}
                </p>
            )}
            {isLowBalance && !formError && (
                <p className="text-[11px] text-amber-500 dark:text-amber-400 font-medium flex items-center gap-1">
                    <AlertCircle size={12} />
                    <span>Notice: {selectedFriend?.name} has ₹{formatCurrency(selectedFriend?.balance || 0)} available in Vault (less than ₹{formatCurrency(formData.amount || 0)}). You can fund them from Self.</span>
                </p>
            )}
        </form>
    );
};

export const SyndicateForm = React.memo(SyndicateFormComp);
