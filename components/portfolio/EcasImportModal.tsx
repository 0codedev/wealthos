/**
 * EcasImportModal — CC51
 *
 * Drop a CAMS / KFintech eCAS PDF + PAN, preview parsed folios,
 * mark existing holdings as EXISTS (default-skip), and commit
 * selected rows to db.investments via portfolioStore.addInvestment.
 *
 * Constraints from project rules:
 * - Uses MotionButton (CC44 Pillar 1A)
 * - Uses safeAsync (CC45 Pillar 3A)
 * - Uses useToast for user feedback
 * - Uses EmptyState (CC45 Pillar 3A) for the empty/preview states
 * - Respects prefers-reduced-motion (App.tsx wraps in MotionConfig)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, FileText, Loader2, Check, AlertCircle, RefreshCw, AlertTriangle, Sparkles } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import { EmptyState } from '../shared/EmptyState';
import { MotionButton } from '../ui/MotionButton';
import { safeAsync } from '../../utils/safeAsync';
import { modalOverlayVariants, modalContentVariants } from '../ui/animations';
import {
  parseEcas,
  importEcasFolios,
  findExistingEcasHoldings,
  getStoredPAN,
  setStoredPAN,
  getLastEcasImportForPan,
  compareForReimport,
  panLast4,
  EcasParseResult,
  EcasScheme,
  ReimportCheck,
} from '../../services/ecasImportService';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useFamily } from '../../contexts/FamilyContext';

interface EcasImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type RowStatus = 'NEW' | 'EXISTS';

interface PreviewRow {
  key: string;
  status: RowStatus;
  checked: boolean;
  folio: string;
  amc: string;
  scheme: EcasScheme;
}

export const EcasImportModal: React.FC<EcasImportModalProps> = ({ isOpen, onClose }) => {
  const { toast: toastApi } = useToast();
  const showToast = useCallback(
    (msg: string, type: 'error' | 'info' | 'success' = 'error') => {
      if (!toastApi) {
        console.warn('toast:', msg);
        return;
      }
      if (type === 'error') toastApi.error(msg);
      else if (type === 'success') toastApi.success(msg);
      else toastApi.info(msg);
    },
    [toastApi]
  );
  const { activeEntity } = useFamily();
  const addInvestment = usePortfolioStore((s) => s.addInvestment);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pan, setPan] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<EcasParseResult | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [committing, setCommitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [reimport, setReimport] = useState<ReimportCheck | null>(null);

  // Initialize PAN from sessionStorage on mount
  useEffect(() => {
    const stored = getStoredPAN();
    if (stored) setPan(stored);
  }, []);

  const reset = useCallback(() => {
    setParsed(null);
    setRows([]);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        showToast('Please upload a PDF file.', 'error');
        return;
      }
      setParsing(true);
      reset();
      const result = await safeAsync(
        () => parseEcas(file, pan),
        { silent: true }
      );
      if (!result.ok) {
        showToast(result.error.message, 'error');
        setParsing(false);
        return;
      }
      const existing = await safeAsync(
        () => findExistingEcasHoldings(result.data),
        { silent: true }
      );
      if (!existing.ok) {
        showToast(`Could not check for duplicates: ${existing.error.message}`, 'error');
      }
      const existingSet = existing.ok ? existing.data : new Set<string>();
      const previewRows: PreviewRow[] = [];
      for (const f of result.data.folios) {
        for (const s of f.schemes) {
          const key = s.amfiCode ? `${s.amfiCode}::${f.folio}` : `name::${s.name}::${f.folio}`;
          const isExisting = existingSet.has(key);
          previewRows.push({
            key,
            status: isExisting ? 'EXISTS' : 'NEW',
            checked: !isExisting,
            folio: f.folio,
            amc: f.amc,
            scheme: s,
          });
        }
      }
      setParsed(result.data);
      setRows(previewRows);
      setParsing(false);

      // CC57: compute re-import status for this PAN
      try {
        const last4 = panLast4(pan);
        const prior = last4 ? await getLastEcasImportForPan(last4) : null;
        setReimport(compareForReimport(prior, result.data.statementDate));
      } catch {
        // non-blocking: skip banner if lookup fails
      }

      // Persist PAN for this session only
      if (pan) setStoredPAN(pan);
    },
    [pan, reset, showToast]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const toggleRow = (key: string) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, checked: !r.checked } : r))
    );
  };

  const handleCommit = async () => {
    const selected = rows.filter((r) => r.checked);
    if (selected.length === 0) {
      showToast('No rows selected.', 'info');
      return;
    }
    setCommitting(true);
    const reParsed: EcasParseResult = {
      investorName: parsed?.investorName || '',
      statementDate: parsed?.statementDate || new Date().toISOString().split('T')[0],
      warnings: parsed?.warnings || [],
      folios: selected.map((r) => ({
        folio: r.folio,
        amc: r.amc,
        pan: null,
        schemes: [r.scheme],
      })),
    };
    const owner = activeEntity === 'ALL' ? 'SELF' : (activeEntity as string);
    const records = importEcasFolios(
      reParsed,
      new Date().toISOString(),
      owner,
      pan
    );
    let okCount = 0;
    let lastError: string | null = null;
    for (const rec of records) {
      const r = await safeAsync(
        () => addInvestment(rec as any),
        { silent: true }
      );
      if (!r.ok) {
        lastError = r.error.message;
      }
      if (r.ok) okCount++;
    }
    setCommitting(false);
    if (okCount === records.length) {
      showToast(`Imported ${okCount} holding${okCount === 1 ? '' : 's'}.`, 'success');
      onClose();
    } else if (okCount > 0) {
      showToast(`Imported ${okCount} of ${records.length}. ${lastError ?? ''}`, 'error');
    } else {
      showToast(`Import failed: ${lastError ?? 'unknown error'}`, 'error');
    }
  };

  if (!isOpen) return null;

  const selectedCount = rows.filter((r) => r.checked).length;
  const warnings = parsed?.warnings ?? [];

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        variants={modalOverlayVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={onClose}
      >
        <motion.div
          className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-3xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
          variants={modalContentVariants}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="text-emerald-500" /> Import eCAS
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
              aria-label="close"
            >
              <X size={20} className="text-slate-500" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto flex-1">
            {!parsed && !parsing && (
              <div className="space-y-4">
                <label
                  className="block text-sm font-medium text-slate-700 dark:text-slate-200"
                  htmlFor="ecas-pan"
                >
                  PAN (used as PDF password — CAMS/KFintech eCAS is PAN-encrypted)
                </label>
                <input
                  id="ecas-pan"
                  type="text"
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase().trim())}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono tracking-wider"
                  autoComplete="off"
                />
                <p className="text-xs text-slate-500">
                  Your PAN stays in this browser tab only (sessionStorage). It is never saved to the database.
                </p>
                <label
                  className={`block border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all ${
                    dragActive
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                      : 'border-slate-300 dark:border-slate-700 hover:border-emerald-500'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={onDrop}
                >
                  <div className="flex flex-col items-center gap-3 pointer-events-none">
                    <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                      <Upload className="text-emerald-600 dark:text-emerald-400" size={32} />
                    </div>
                    <p className="font-bold text-slate-900 dark:text-white">
                      Drop your eCAS PDF here, or click to browse
                    </p>
                    <p className="text-sm text-slate-500">
                      CAMS or KFintech — one file at a time
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    aria-label="upload eCAS PDF"
                    onChange={onInputChange}
                    className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                    style={{ position: 'absolute' }}
                  />
                </label>
              </div>
            )}

            {parsing && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="animate-spin text-emerald-500" size={48} />
                <p className="text-slate-600 dark:text-slate-300">Parsing eCAS...</p>
              </div>
            )}

            {parsed && rows.length === 0 && (
              <EmptyState
                type="no-trades"
                title="No holdings found"
                message="The eCAS was parsed but contains no mutual fund holdings."
              />
            )}

            {parsed && rows.length > 0 && (
              <div>
                <div className="mb-4 text-sm text-slate-600 dark:text-slate-300">
                  {parsed.investorName} • Statement: {parsed.statementDate} • {rows.length} holding
                  {rows.length === 1 ? '' : 's'} found
                </div>
                {warnings.length > 0 && (
                  <div className="mb-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs">
                    {warnings.length} warning{warnings.length === 1 ? '' : 's'} from casparser
                  </div>
                )}
                {/* CC57: re-import status banner */}
                {reimport && (
                  <div
                    data-reimport={reimport.status}
                    className={`mb-3 p-3 rounded-lg border text-xs flex items-start gap-2 ${
                      reimport.status === 'NEW'
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                        : reimport.status === 'UPDATE'
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
                          : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                    }`}
                  >
                    {reimport.status === 'NEW' ? (
                      <Sparkles size={14} className="mt-0.5 flex-shrink-0" />
                    ) : reimport.status === 'UPDATE' ? (
                      <RefreshCw size={14} className="mt-0.5 flex-shrink-0" />
                    ) : (
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    )}
                    <div>
                      {reimport.status === 'NEW' && (
                        <>
                          <span className="font-semibold">First import for this PAN</span>
                          {' — '}
                          {rows.length} holding{rows.length === 1 ? '' : 's'} will be added.
                        </>
                      )}
                      {reimport.status === 'UPDATE' && (
                        <>
                          <span className="font-semibold">UPDATE</span>
                          {' — Replaces import from '}
                          {reimport.prior?.statementDate} ({reimport.delta} day
                          {Math.abs(reimport.delta) === 1 ? '' : 's'} newer).
                        </>
                      )}
                      {reimport.status === 'STALE' && (
                        <>
                          <span className="font-semibold">Stale statement</span>
                          {' — This statement is older than your latest ('}
                          {reimport.prior?.statementDate}). Holdings will be replaced with older data.
                        </>
                      )}
                    </div>
                  </div>
                )}
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800 text-left">
                      <tr>
                        <th className="p-3 w-10"></th>
                        <th className="p-3">Scheme</th>
                        <th className="p-3">Folio / AMC</th>
                        <th className="p-3 text-right">Units</th>
                        <th className="p-3 text-right">Value (₹)</th>
                        <th className="p-3 w-20">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.key}
                          className={`border-t border-slate-200 dark:border-slate-700 ${
                            r.status === 'EXISTS' ? 'opacity-60' : ''
                          }`}
                        >
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={r.checked}
                              onChange={() => toggleRow(r.key)}
                              aria-label={`select ${r.scheme.name}`}
                            />
                          </td>
                          <td className="p-3 font-medium">{r.scheme.name}</td>
                          <td className="p-3 text-slate-500 text-xs">
                            {r.folio}<br />{r.amc}
                          </td>
                          <td className="p-3 text-right tabular-nums">{r.scheme.units.toFixed(3)}</td>
                          <td className="p-3 text-right tabular-nums">
                            ₹{r.scheme.currentValue.toLocaleString('en-IN')}
                          </td>
                          <td className="p-3">
                            {r.status === 'EXISTS' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs">
                                <AlertCircle size={12} /> EXISTS
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs">
                                <Check size={12} /> NEW
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
            >
              Cancel
            </button>
            {parsed && rows.length > 0 && (
              <MotionButton
                variant="primary"
                onClick={handleCommit}
                loading={committing}
                disabled={selectedCount === 0}
              >
                Import {selectedCount} holding{selectedCount === 1 ? '' : 's'}
              </MotionButton>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default EcasImportModal;
