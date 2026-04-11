import React from 'react';
import { ShieldCheck, Fingerprint, Mail, Building, CreditCard, CheckCircle2, XCircle } from 'lucide-react';
import { SecurityItem } from './types';

// ===================== SECURITY DASHBOARD =====================
export const SecurityDashboard: React.FC<{ securityScore: number }> = React.memo(({ securityScore }) => {
    const securityItems: SecurityItem[] = [
        { id: '1', name: 'Google Account', platform: 'google.com', has2FA: true, lastChecked: '2024-12-15', icon: <Mail size={14} /> },
        { id: '2', name: 'Bank Account', platform: 'hdfc.com', has2FA: true, lastChecked: '2024-12-10', icon: <Building size={14} /> },
        { id: '3', name: 'Zerodha', platform: 'zerodha.com', has2FA: true, lastChecked: '2024-12-18', icon: <CreditCard size={14} /> },
        { id: '4', name: 'Groww', platform: 'groww.in', has2FA: false, lastChecked: '2024-11-20', icon: <CreditCard size={14} /> },
    ];

    const enabled2FA = securityItems.filter(i => i.has2FA).length;
    const total = securityItems.length;

    return (
        <div className="space-y-4">
            {/* Security Score */}
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950/30 rounded-2xl p-4 border border-indigo-500/20">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-indigo-300 uppercase flex items-center gap-2">
                        <ShieldCheck size={14} /> Security Score
                    </h4>
                    <span className={`text-2xl font-black font-mono ${(securityScore || 0) > 80 ? 'text-emerald-400' :
                        (securityScore || 0) > 60 ? 'text-amber-400' : 'text-rose-400'
                        }`}>
                        {Math.min(100, Math.max(0, securityScore || 0))}%
                    </span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-1000 ${(securityScore || 0) > 80 ? 'bg-emerald-500' :
                            (securityScore || 0) > 60 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                        style={{ width: `${Math.min(100, Math.max(0, securityScore || 0))}%` }}
                    />
                </div>
            </div>

            {/* 2FA Overview */}
            <div className="bg-slate-900/50 rounded-2xl p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2">
                        <Fingerprint size={14} /> 2FA Status
                    </h4>
                    <span className="text-[10px] text-emerald-400 font-bold">{enabled2FA}/{total} Enabled</span>
                </div>
                <div className="space-y-2">
                    {securityItems.map(item => (
                        <div key={item.id} className="flex items-center justify-between p-2 bg-slate-950/50 rounded-lg border border-slate-800/50">
                            <div className="flex items-center gap-2">
                                <span className="text-slate-500">{item.icon}</span>
                                <div>
                                    <p className="text-xs font-bold text-slate-300">{item.name}</p>
                                    <p className="text-[9px] text-slate-600 font-mono">{item.platform}</p>
                                </div>
                            </div>
                            {item.has2FA ? (
                                <CheckCircle2 size={16} className="text-emerald-500" />
                            ) : (
                                <XCircle size={16} className="text-rose-500" />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

SecurityDashboard.displayName = 'SecurityDashboard';
