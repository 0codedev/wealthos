import React, { useRef, useState, useEffect } from 'react';
import { Bot, Paperclip, Send, Loader2, X, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { ChatBubble, type AdvisorData } from '../../ai';
import { BubbleSkeleton, CardSkeleton } from '../../shared/LoadingSkeleton';
import MorningBriefing from '../../MorningBriefing'; // Correct path
import { ReportCard, ActionList } from './ReportView';
import { Investment } from '../../../types';
import { SectionHeader, StateSurface } from '../../shared/SurfacePrimitives';

interface ChatInterfaceProps {
    chatMessages: { role: 'user' | 'model', text?: string, image?: string | null }[];
    advisorData: AdvisorData | null;
    isGeneratingReport: boolean;
    isSending: boolean;
    investments: Investment[];
    totalNetWorth: string;
    contextPrompts: string[];
    onNavigate: (tab: string) => void;
    onSendMessage: (text: string, image: string | null) => void;
    onClearReport: () => void;
    renderHeader: () => React.ReactNode;
    isSidebarOpen: boolean;
    SidebarComponent: React.ReactNode;
    setChatImage: (img: string | null) => void;
    chatImage: string | null;
    compressImage: (file: File) => Promise<Blob>;
    blobToBase64: (blob: Blob) => Promise<string>;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
    chatMessages,
    advisorData,
    isGeneratingReport,
    isSending,
    investments,
    totalNetWorth,
    contextPrompts,
    onNavigate,
    onSendMessage,
    onClearReport,
    renderHeader,
    isSidebarOpen,
    SidebarComponent,
    setChatImage,
    chatImage,
    compressImage,
    blobToBase64
}) => {
    const chatEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [chatInput, setChatInput] = useState('');
    const [isInputVisible, setIsInputVisible] = useState(true);

    useEffect(() => {
        if (isInputVisible && chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [chatMessages, isInputVisible]);

    const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const blob = await compressImage(file);
                const base64 = await blobToBase64(blob);
                setChatImage(base64);
            } catch (err) { console.error(err); }
        }
    };

    const handleSend = () => {
        if ((!chatInput.trim() && !chatImage) || isSending) return;
        onSendMessage(chatInput, chatImage);
        setChatInput('');
    }

    return (
        <div className="flex flex-col h-full overflow-hidden relative">
            {/* Header - Fixed at Top (Outside Scroll) */}
            {renderHeader()}

            {/* Main Content with Sidebar */}
            <div className="flex flex-1 overflow-hidden">
                {/* Conversations Sidebar */}
                {isSidebarOpen && SidebarComponent}

                {/* Vertical Column for Chat & Input */}
                <div className="flex-1 flex flex-col relative w-full overflow-hidden">
                    {/* Chat Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth">
                        {chatMessages.length === 0 && !advisorData ? (
                            <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
                                <MorningBriefing investments={investments} totalNetWorth={totalNetWorth} />

                                <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 rounded-2xl flex items-center justify-center mb-6 shadow-sm mt-8">
                                    <Bot size={40} />
                                </div>
                                <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Wealth Advisor AI</h3>
                                <p className="text-sm text-slate-500 max-w-sm">
                                    Ask about your portfolio, upload charts, or generate a full audit.
                                </p>
                                <div className="mt-4 w-full max-w-lg">
                                    <StateSurface
                                        title="Advisor Ready"
                                        description="Start with one prompt below or attach a chart screenshot for context-aware analysis."
                                        icon={MessageSquare}
                                        tone="info"
                                        badge="context-aware"
                                        compact
                                    />
                                </div>

                                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-lg">
                                    {contextPrompts.map((q, i) => (
                                        <button
                                            key={i}
                                            onClick={() => q.includes('Upload') ? fileInputRef.current?.click() : setChatInput(q)}
                                            className="px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:border-indigo-500 hover:text-indigo-500 transition-all text-left"
                                        >
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="w-full max-w-5xl mx-auto">
                                {chatMessages.map((msg, idx) => (
                                    <ChatBubble key={idx} role={msg.role} text={msg.text} image={msg.image} />
                                ))}

                                {isGeneratingReport && (
                                    <div className="mt-4 mb-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                                        <CardSkeleton />
                                    </div>
                                )}

                                {advisorData && (
                                    <div className="mt-4 mb-8 pt-6 border-t border-slate-100 dark:border-slate-800 animate-in slide-in-from-bottom-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                                        <SectionHeader
                                            eyebrow="Advisor Output"
                                            title="Portfolio Audit Report"
                                            description="Risk, opportunity, and action stack generated from your current context."
                                            icon={Paperclip}
                                            tone="info"
                                            badge="generated"
                                            actions={
                                                <button onClick={onClearReport} className="text-slate-400 transition-colors hover:text-rose-500" title="Clear report">
                                                    <X size={20} />
                                                </button>
                                            }
                                            className="mb-4"
                                        />
                                        <ReportCard data={advisorData} />
                                        <div className="grid md:grid-cols-2 gap-4">
                                            <ActionList items={advisorData.risks} type="RISK" onNavigate={onNavigate} />
                                            <ActionList items={advisorData.opportunities} type="OPP" onNavigate={onNavigate} />
                                        </div>
                                    </div>
                                )}

                                {isSending && <BubbleSkeleton />}
                                <div ref={chatEndRef} className="h-4"></div>
                            </div>
                        )}
                    </div>

                    {/* Input Area (Docked at Bottom) */}
                    <div className={`transition-all duration-300 ease-in-out relative z-40 ${isInputVisible ? 'translate-y-0' : 'hidden'}`}>
                        {/* Minimize Handle */}
                        <div className="flex justify-center -mb-3 relative z-50 pointer-events-none">
                            <button
                                onClick={() => setIsInputVisible(false)}
                                className="pointer-events-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full p-1.5 text-slate-400 hover:text-indigo-600 shadow-sm hover:shadow-md transition-all active:scale-95"
                                title="Minimize Input"
                            >
                                <ChevronDown size={16} />
                            </button>
                        </div>

                        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 p-4 pb-6">
                            <div className="w-full max-w-5xl mx-auto space-y-3">
                            {chatImage && (
                                <div className="inline-flex items-center gap-3 bg-slate-50 dark:bg-slate-800 p-2 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 animate-in slide-in-from-bottom-2">
                                    <div className="h-10 w-10 rounded-lg overflow-hidden relative">
                                        <img src={chatImage} className="object-cover w-full h-full" alt="preview" />
                                    </div>
                                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Image attached</span>
                                    <button onClick={() => setChatImage(null)} aria-label="Remove attached image" className="ml-2 p-1 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded-full text-slate-400 hover:text-rose-500"><X size={14} /></button>
                                </div>
                            )}
                            {!chatImage && (
                                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                    Sensitive values are sanitized unless explicitly requested.
                                </p>
                            )}

                            <div className="flex gap-2 items-end">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleImageSelect}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="p-3.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-indigo-500 rounded-2xl transition-colors border border-slate-200 dark:border-slate-800"
                                    title="Upload Image"
                                >
                                    <Paperclip size={20} />
                                </button>

                                <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all flex flex-col">
                                    <textarea
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                        placeholder="Type a message..."
                                        className="w-full bg-transparent border-none p-3.5 text-sm focus:ring-0 outline-none resize-none max-h-32 min-h-[50px] placeholder:text-slate-400 dark:text-white"
                                        rows={1}
                                    />
                                </div>

                                <button
                                    onClick={handleSend}
                                    disabled={isSending || (!chatInput.trim() && !chatImage)}
                                    className="p-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white rounded-2xl shadow-lg shadow-indigo-500/30 transition-all active:scale-95"
                                >
                                    {isSending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

                {/* Floating Restore Button */}
                {!isInputVisible && (
                    <div className="absolute bottom-6 right-6 z-50 animate-in zoom-in duration-200">
                        <button
                            onClick={() => setIsInputVisible(true)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-lg shadow-indigo-600/30 transition-all hover:scale-110 active:scale-95"
                            title="Show Chat Input"
                        >
                            <MessageSquare size={24} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
