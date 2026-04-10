
import React, { useRef, useState } from 'react';
import { HardDrive, Download, Upload, Loader2, CheckCircle, AlertTriangle, RefreshCw, X, ShieldAlert } from 'lucide-react';
import * as BackupService from '../services/BackupService';
import CloudSyncPanel from './settings/CloudSyncPanel';
import { logger } from '../services/Logger';
import { FocusTrap } from './shared/AccessibleComponents';
import type { SyncPreviewSummary } from '../services/SyncGovernanceService';
import { triggerHapticImpact, triggerHapticNotification } from '../utils/haptics';

interface DataBackupSettingsProps {
  onDataRestored?: () => void;
  onImport?: (data: any) => Promise<void>;
  collapsed?: boolean;
}

const DataBackupSettings: React.FC<DataBackupSettingsProps> = ({ onDataRestored, onImport, collapsed = false }) => {
  const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [message, setMessage] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [restorePreview, setRestorePreview] = useState<(SyncPreviewSummary & { protectedStorageKeys?: string[]; backupTimestamp?: string | null; }) | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async (mode: 'optimized' | 'full' = 'optimized') => {
    triggerHapticImpact('medium');
    setStatus('PROCESSING');
    setMessage('Packaging...');
    try {
      const summary = await BackupService.handleDownloadBackup(mode);
      triggerHapticNotification('success');
      setStatus('SUCCESS');
      if (summary) {
        const kb = summary.finalBytes / 1024;
        setMessage(summary.compressed ? `Done · ${kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`} compressed` : 'Done');
      } else {
        setMessage('Cancelled');
      }
      setTimeout(() => {
        setStatus('IDLE');
        setMessage(null);
      }, 3000);
    } catch (e) {
      triggerHapticNotification('error');
      setStatus('ERROR');
      setMessage('Failed');
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    triggerHapticImpact('light');
    setStatus('PROCESSING');
    setMessage('Previewing...');

    try {
      // Reads gzip-compressed v3 saves AND legacy plain .json files
      const { payload: json } = await BackupService.readBackupFile(file);
      const preview = await BackupService.previewRestoreFromJSON(json);
      triggerHapticNotification('success');
      setRestorePreview(preview);
      setRestoreFile(file);
      setShowConfirmModal(true);
      setStatus('IDLE');
      setMessage(null);
    } catch (err) {
      logger.error('Failed to preview restore file', err, 'Backup');
      triggerHapticNotification('error');
      setStatus('ERROR');
      setMessage('Invalid Backup');
      setTimeout(() => {
        setStatus('IDLE');
        setMessage(null);
      }, 4000);
    } finally {
      // Reset input so the same file can be selected again if needed
      e.target.value = '';
    }
  };

  const executeRestore = async () => {
    if (!restoreFile) return;

    triggerHapticImpact('heavy');
    setShowConfirmModal(false);
    setStatus('PROCESSING');
    setMessage('Restoring...');
    logger.info('Starting restore process', { fileName: restoreFile.name }, 'Backup');

    try {
      // Raw bytes: handles gzip v3 saves and legacy plain JSON alike
      const { payload: json } = await BackupService.readBackupFile(restoreFile);
      logger.debug('Backup payload parsed successfully', { mode: json?.meta?.mode }, 'Backup');

      if (onImport) {
        logger.debug('Using onImport strategy', undefined, 'Backup');
        await onImport(json);
      } else {
        logger.debug('Using BackupService strategy', undefined, 'Backup');
        await BackupService.restoreFromJSON(json);
      }

      logger.info('Restore complete', undefined, 'Backup');
      triggerHapticNotification('success');
      setStatus('SUCCESS');
      setMessage('Reloading...');

      if (onDataRestored) await onDataRestored();

      // Give extra time for IndexedDB to commit before reload
      setTimeout(() => {
        window.location.reload();
      }, 2000);

    } catch (err: unknown) {
      logger.error('Restore failed', err, 'Backup');
      triggerHapticNotification('error');
      setStatus('ERROR');
      setMessage('Failed');

      setTimeout(() => {
        setStatus('IDLE');
        setMessage(null);
      }, 5000);
    } finally {
      setRestoreFile(null);
      setRestorePreview(null);
    }
  };

  if (collapsed) {
    return (
      <div className="flex justify-center p-2">
        <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400" title="Data Management">
          <HardDrive size={20} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`rounded-lg p-3 border transition-all duration-300 ${status === 'PROCESSING' ? 'bg-indigo-900/20 border-indigo-500 ring-1 ring-indigo-500/50' : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'}`}>
        {/* Row 1: Heading */}
        <div className="flex items-center gap-2 mb-2 text-slate-500 dark:text-slate-400">
          <HardDrive size={12} className="text-indigo-500" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Data Management</span>
        </div>

        {/* Row 2: Actions */}
        {status === 'IDLE' ? (
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => handleExport('optimized')}
              className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white py-1.5 px-1 rounded-md text-[9px] font-bold flex flex-col items-center justify-center gap-1 transition-all border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600"
              title="Lite Backup - all user state, excludes caches &amp; retrainable ML data. Gzip-compressed save file."
            >
              <Download size={11} className="text-indigo-500" />
              Backup (Lite)
            </button>

            <button
              onClick={() => handleExport('full')}
              className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white py-1.5 px-1 rounded-md text-[9px] font-bold flex flex-col items-center justify-center gap-1 transition-all border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600"
              title="Full Backup - everything including caches, snapshots &amp; ML artifacts for exact device parity."
            >
              <Download size={11} className="text-violet-500" />
              Backup (Full)
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white py-1.5 px-1 rounded-md text-[9px] font-bold flex flex-col items-center justify-center gap-1 transition-all border border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600"
              title="Restore from JSON Backup File"
            >
              <Upload size={11} className="text-emerald-500" />
              Restore JSON
            </button>
          </div>
        ) : (
          <div className={`py-1.5 px-3 rounded-md border flex items-center justify-center gap-2 animate-in fade-in duration-200
              ${status === 'SUCCESS' ? 'bg-emerald-500/10 dark:bg-emerald-950/30 border-emerald-500/50 text-emerald-600 dark:text-emerald-400' :
              status === 'ERROR' ? 'bg-rose-500/10 dark:bg-rose-950/30 border-rose-500/50 text-rose-600 dark:text-rose-400' :
                'bg-indigo-500/10 dark:bg-indigo-950/30 border-indigo-500/50 text-indigo-600 dark:text-indigo-300'}`}>

            {status === 'PROCESSING' && <RefreshCw size={12} className="animate-spin" />}
            {status === 'SUCCESS' && <CheckCircle size={12} />}
            {status === 'ERROR' && <AlertTriangle size={12} />}

            <span className="text-[10px] font-bold uppercase">{message}</span>
          </div>
        )}

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".json,.gz,.json.gz,application/json,application/gzip"
          onChange={handleFileSelect}
          disabled={status === 'PROCESSING'}
        />
      </div>

      {/* Cloud Sync Section */}
      <div className="mt-3">
        <CloudSyncPanel onRestoreComplete={onDataRestored} />
      </div>

      {/* Restore Confirmation Modal */}
      {showConfirmModal && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-modal-title"
        >
          <FocusTrap isActive={showConfirmModal}>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-rose-500/10 dark:bg-rose-900/30 text-rose-600 dark:text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <ShieldAlert size={24} aria-hidden="true" />
                </div>

                <h3 id="restore-modal-title" className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                  Nuclear Restore?
                </h3>

              <p className="text-slate-600 dark:text-slate-400 text-sm mb-6">
                You are about to restore <span className="text-slate-900 dark:text-white font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">{restoreFile?.name}</span>.
                <br /><br />
                <span className="text-rose-600 dark:text-rose-400 font-bold">WARNING:</span> This will <span className="underline decoration-rose-500 decoration-2 underline-offset-2">permanently wipe</span> all current data and replace it with this backup.
              </p>

              {restorePreview && (
                <div className="mb-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 p-4 text-left">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Restore Preview</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {restorePreview.totals.changedTables} changed, {restorePreview.totals.newTables} new, {restorePreview.totals.wipeTables} empty-backup tables, {restorePreview.totals.conflictTables} conflict candidates.
                  </p>
                  {restorePreview.backupTimestamp && (
                    <p className="mt-1 text-[11px] text-slate-500">Backup created: {new Date(restorePreview.backupTimestamp).toLocaleString()}</p>
                  )}
                  {restorePreview.protectedStorageKeys && restorePreview.protectedStorageKeys.length > 0 && (
                    <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">Protected storage keys: {restorePreview.protectedStorageKeys.length}</p>
                  )}
                  <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                    {restorePreview.tables.map((table) => (
                      <div key={table.tableName} className="flex items-center justify-between gap-3 text-[11px]">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{table.tableName}</p>
                          <p className="text-slate-500">{table.localCount} local &rarr; {table.incomingCount} backup rows</p>
                        </div>
                        <span className={`rounded-full px-2 py-1 font-bold uppercase ${table.conflict ? 'bg-amber-500/10 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300' : table.status === 'unchanged' ? 'bg-emerald-500/10 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300' : 'bg-indigo-500/10 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300'}`}>
                          {table.conflict ? 'conflict' : table.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setShowConfirmModal(false); setRestoreFile(null); setRestorePreview(null); }}
                  className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-sm font-medium rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeRestore}
                  className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-rose-900/20 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw size={16} /> Restore Data
                </button>
              </div>
            </div>
          </div>
          </FocusTrap>
        </div>
      )}
    </>
  );
};

export default DataBackupSettings;
