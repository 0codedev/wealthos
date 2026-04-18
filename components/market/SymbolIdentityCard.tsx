import React, { useState, useEffect } from 'react';
import { DhanScripResolver } from '../../services/DhanScripResolver';
import { Copy, Check, Fingerprint, RefreshCw } from 'lucide-react';

interface SymbolIdentityCardProps {
  symbol: string;
  isin: string;
  instrumentKey: string;
}

export default function SymbolIdentityCard({ symbol, isin, instrumentKey }: SymbolIdentityCardProps) {
  const [dhanScripId, setDhanScripId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    let active = true;
    const resolveDhanId = async () => {
      setIsResolving(true);
      try {
        await DhanScripResolver.initialize();
        if (!active) return;
        const resolvedId = DhanScripResolver.resolveSecurityId(symbol);
        setDhanScripId(resolvedId);
      } catch (err) {
        console.error('Failed to resolve Dhan scrip ID', err);
      } finally {
        if (active) setIsResolving(false);
      }
    };
    resolveDhanId();
    return () => {
      active = false;
    };
  }, [symbol]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => {
      setCopiedField(null);
    }, 1500);
  };

  return (
    <div className="bg-slate-800/10 border border-slate-200 dark:border-slate-800/60 rounded-xl p-3 select-none">
      <div className="flex items-center gap-2 mb-2">
        <Fingerprint size={14} className="text-indigo-400" />
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">
          Cross-Platform Identifiers (Aliases)
        </span>
      </div>

      <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
        {/* ISIN */}
        <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/60 rounded-lg px-2.5 py-1.5 justify-between gap-3 flex-1 min-w-[120px]">
          <div className="flex flex-col">
            <span className="text-[7.5px] text-slate-400 font-bold uppercase tracking-wider">ISIN</span>
            <span className="font-mono text-slate-700 dark:text-slate-200 font-bold">{isin || 'N/A'}</span>
          </div>
          {isin && (
            <button
              onClick={() => copyToClipboard(isin, 'isin')}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition-colors"
              title="Copy ISIN"
            >
              {copiedField === 'isin' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </button>
          )}
        </div>

        {/* Upstox Key */}
        <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/60 rounded-lg px-2.5 py-1.5 justify-between gap-3 flex-1 min-w-[120px]">
          <div className="flex flex-col">
            <span className="text-[7.5px] text-slate-400 font-bold uppercase tracking-wider">Upstox Key</span>
            <span className="font-mono text-slate-700 dark:text-slate-200 font-bold">{instrumentKey || 'N/A'}</span>
          </div>
          {instrumentKey && (
            <button
              onClick={() => copyToClipboard(instrumentKey, 'upstoxKey')}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition-colors"
              title="Copy Upstox Instrument Key"
            >
              {copiedField === 'upstoxKey' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </button>
          )}
        </div>

        {/* Dhan Scrip ID */}
        <div className="flex items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/60 rounded-lg px-2.5 py-1.5 justify-between gap-3 flex-1 min-w-[120px]">
          <div className="flex flex-col">
            <span className="text-[7.5px] text-slate-400 font-bold uppercase tracking-wider">Dhan Scrip ID</span>
            {isResolving ? (
              <span className="flex items-center gap-1 text-slate-400 text-[9px] font-medium">
                <RefreshCw size={10} className="animate-spin text-indigo-400" /> Resolving...
              </span>
            ) : (
              <span className="font-mono text-slate-700 dark:text-slate-200 font-bold">{dhanScripId || 'Not Found'}</span>
            )}
          </div>
          {dhanScripId && (
            <button
              onClick={() => copyToClipboard(dhanScripId, 'dhanId')}
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition-colors"
              title="Copy Dhan Scrip ID"
            >
              {copiedField === 'dhanId' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
