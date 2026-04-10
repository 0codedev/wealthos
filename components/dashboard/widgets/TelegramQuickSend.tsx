import React, { useState } from 'react';
import { Send, Settings, Check, X } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { telegramAlertService } from '../../../services/TelegramAlertService';
import { useToast } from '../../shared/ToastProvider';

/**
 * TelegramQuickSend — SPRINT 3.7
 *
 * Rebuild of the original dashboard Telegram widget the user loved: a compact,
 * professional quick-send surface. Gear icon toggles an inline config panel
 * (bot token + chat id, persisted via settingsStore), textarea for the message,
 * one Send button. No tabs, no clutter.
 */
export const TelegramQuickSend: React.FC = () => {
    const { toast } = useToast();
    const botToken = useSettingsStore(s => s.telegramBotToken);
    const chatId = useSettingsStore(s => s.telegramChatId);
    const updateSetting = useSettingsStore(s => s.updateSetting);

    const [showConfig, setShowConfig] = useState(false);
    const [draftToken, setDraftToken] = useState(botToken);
    const [draftChatId, setDraftChatId] = useState(chatId);
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);

    const configOk = Boolean(botToken && chatId);

    const handleSend = async () => {
        if (!message.trim()) return;
        setSending(true);
        try {
            // Custom creds (if user typed local ones) override registry/env path.
            const ok = await telegramAlertService.send(
                message.trim().replace(/\n/g, '<br/>'),
                draftToken || undefined,
                draftChatId || undefined
            );
            if (ok) {
                toast.success('Sent to Telegram');
                setMessage('');
            } else {
                toast.error('Send failed - check token / chat id in gear config');
            }
        } catch (e) {
            toast.error('Send failed - is the Python bridge running?');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="p-4 sm:p-5 space-y-3 h-full flex flex-col">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                    <Send size={15} className="text-sky-400" /> Telegram Quick Send
                </h3>
                <button
                    onClick={() => { setDraftToken(botToken); setDraftChatId(chatId); setShowConfig(v => !v); }}
                    className={`p-1.5 rounded-lg transition-colors ${showConfig ? 'bg-sky-500/20 text-sky-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/60'}`}
                    title="Configure bot"
                    aria-label="Configure Telegram bot"
                >
                    <Settings size={15} />
                </button>
            </div>

            {showConfig && (
                <div className="space-y-2 p-3 rounded-xl bg-slate-900/60 border border-slate-700/50">
                    <input
                        value={draftToken}
                        onChange={(e) => setDraftToken(e.target.value)}
                        placeholder="Bot token (123456:ABC-...)"
                        className="w-full text-xs bg-slate-950/70 border border-slate-700/60 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500 font-mono"
                        autoComplete="off"
                    />
                    <input
                        value={draftChatId}
                        onChange={(e) => setDraftChatId(e.target.value)}
                        placeholder="Chat ID (-100... or user id; #topic supported)"
                        className="w-full text-xs bg-slate-950/70 border border-slate-700/60 rounded-lg px-3 py-2 text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500 font-mono"
                        autoComplete="off"
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={() => { updateSetting('telegramBotToken', draftToken.trim()); updateSetting('telegramChatId', draftChatId.trim()); toast.success('Telegram config saved'); setShowConfig(false); }}
                            className="flex items-center gap-1 text-[10px] font-bold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
                        >
                            <Check size={11} /> Save
                        </button>
                        <button
                            onClick={() => setShowConfig(false)}
                            className="flex items-center gap-1 text-[10px] font-bold px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors"
                        >
                            <X size={11} /> Cancel
                        </button>
                        <span className={`ml-auto self-center text-[9px] font-bold uppercase tracking-wider ${configOk ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {configOk ? 'configured' : 'not configured'}
                        </span>
                    </div>
                </div>
            )}

            <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={configOk ? 'Type your message…' : 'Configure bot token + chat id first'}
                disabled={!configOk}
                rows={4}
                className="w-full flex-1 min-h-[90px] resize-none text-sm bg-slate-950/50 border border-slate-700/50 rounded-xl px-3 py-2.5 text-slate-100 placeholder:text-slate-600 outline-none focus:border-sky-500/70 transition-colors disabled:opacity-50"
            />

            <button
                onClick={handleSend}
                disabled={!configOk || sending || !message.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 text-white text-sm font-bold shadow-lg shadow-sky-900/30 hover:from-sky-500 hover:to-indigo-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]"
            >
                {sending ? (
                    <>Sending…</>
                ) : (
                    <><Send size={14} /> Send</>
                )}
            </button>
        </div>
    );
};
