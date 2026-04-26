import React, { useState, useRef, useEffect } from 'react';
import { useToast } from '../shared/ToastProvider';
import {
    Mic, Loader2, FileText, MessageSquare, History, Trash2, Bot, ShieldCheck, Database, Zap, Search
} from 'lucide-react';
import { Investment } from '../../types';
import * as AIService from '../../services/aiService';
import { chatWithGroq, streamChatWithGroq } from '../../services/groqService';
import { SEBI_COMPLIANCE_CORE } from '../../services/aiService';
import { blobToBase64, compressImage, formatCurrency } from '../../utils/helpers';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useShallow } from 'zustand/react/shallow';
import { useConversations } from '../../hooks/useConversations';
import { ConversationsSidebar } from '../ai/ConversationsSidebar';
import { type AdvisorData } from '../ai';
import { apiRateLimiter } from '../../utils/security';
import { buildPortfolioAIContext, safeParseJsonBlock } from '../../services/AIContextService';
import { aiAuditService } from '../../services/AIAuditService';
import TabHero from '../shared/TabHero';
import { db } from '../../database';

// --- Sub Components ---
import { ModelSelector, PersonaSelector, PERSONAS, MODELS } from './advisor/HeaderControls';
import { ChatInterface } from './advisor/ChatInterface';
import { VoiceInterface } from './advisor/VoiceInterface';
import { BehavioralAudit } from './advisor/BehavioralAudit';

interface AdvisorTabProps {
    onNavigate: (tab: string) => void;
}

// --- Helper: Context Aware Prompts ---
const getContextAwarePrompts = (investments: Investment[], netWorth: string) => {
    const prompts = ["Analyze my risk exposure", "Upload Chart Screenshot"];

    // 1. Check for high cash (Opportunity)
    const cash = investments.find(i => i.type === 'Cash/Bank')?.currentValue || 0;
    const total = parseFloat(netWorth.replace(/[^0-9.-]+/g, ""));
    if (total > 0 && (cash / total) > 0.2) {
        prompts.push("Where should I deploy my idle cash?");
    }

    // 2. Check for crypto exposure (Risk)
    const crypto = investments.filter(i => i.type === 'Crypto').reduce((acc, i) => acc + i.currentValue, 0);
    if (total > 0 && (crypto / total) > 0.15) {
        prompts.push("Is my crypto allocation too high?");
    }

    // 3. Tax Season (Time based - simplified)
    const month = new Date().getMonth();
    if (month >= 0 && month <= 2) { // Jan-Mar
        prompts.push("How to save tax before March 31?");
    }

    // 4. Default fallback
    if (prompts.length < 4) {
        prompts.push("Review portfolio diversity");
    }

    return prompts.slice(0, 4);
};

// --- Helper: Rich AI Context ---
const getExtendedAppContext = async (investments: Investment[], totalNetWorth: string, includeAbsoluteValues: boolean = false, contextDepth: 'recent' | 'full' = 'recent') => {
    const portfolioContext = buildPortfolioAIContext(investments, totalNetWorth, {
        includeAbsoluteValues,
        includeSensitiveBrokerFields: false,
    });
    
    try {
        const tradeLimit = contextDepth === 'full' ? 100 : 15;
        const mistakeLimit = contextDepth === 'full' ? 50 : 5;

        const recentTrades = await db.trades.orderBy('date').reverse().limit(tradeLimit).toArray();
        const recentMistakes = await db.mistakes.orderBy('date').reverse().limit(mistakeLimit).toArray();

        let tradeContext = "";
        if (recentTrades.length > 0) {
            tradeContext = "\n\nRECENT TRADING ACTIVITY:\n" + recentTrades.map(t => {
                const pnlText = includeAbsoluteValues ? `${t.pnl || 0}` : 'Hidden';
                return `- ${t.date.split('T')[0]}: ${t.direction} ${t.ticker} @ ${includeAbsoluteValues ? t.entryPrice : 'Hidden'}. Exit: ${includeAbsoluteValues ? t.exitPrice : 'Hidden'}. PnL: ${pnlText}. Mistakes: ${t.mistakes?.join(', ') || 'None'}. Grade: ${t.grade || 'N/A'}`;
            }).join('\n');
        }

        let mistakeContext = "";
        if (recentMistakes.length > 0) {
            mistakeContext = "\n\nTRADING MISTAKES & JOURNAL LESSONS:\n" + recentMistakes.map(m => 
                `- ${m.date ? m.date.split('T')[0] : 'N/A'}: [${m.category}] ${m.title}. Cost: ${includeAbsoluteValues ? m.cost : 'Hidden'}. Lesson: ${m.lesson}`
            ).join('\n');
        }
        
        return `${portfolioContext.contextText}${tradeContext}${mistakeContext}`;
    } catch(e) {
        console.warn("Failed to fetch extended context from DB:", e);
        return portfolioContext.contextText;
    }
};

// --- Main Advisor Component ---

const AdvisorTab: React.FC<AdvisorTabProps> = ({ onNavigate }) => {
    const investments = usePortfolioStore(useShallow(s => s.investments));
    const stats = usePortfolioStore(useShallow(s => s.stats));
    const totalNetWorth = React.useMemo(() => formatCurrency(stats?.totalCurrent || 0), [stats]);
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<'CHAT' | 'VOICE' | 'AUDIT'>('CHAT');
    const contextPrompts = useRef(getContextAwarePrompts(investments, totalNetWorth)).current;

    // Voice State
    const [isLiveSessionActive, setIsLiveSessionActive] = useState(false);
    const [advisorData, setAdvisorData] = useState<AdvisorData | null>(null);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);
    const liveSessionRef = useRef<AIService.LiveVoiceSession | null>(null);

    // Chat State
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', text?: string, image?: string | null }[]>([]);
    const [selectedModelId, setSelectedModelId] = useState('gemini-3.1-flash-lite-preview');
    const [selectedPersonaId, setSelectedPersonaId] = useState('standard');
    const [contextDepth, setContextDepth] = useState<'recent' | 'full'>('recent');
    const [isSafeMode, setIsSafeMode] = useState(true); // PII / Absolute Value masking
    const [isSearchGroundingEnabled, setIsSearchGroundingEnabled] = useState(false);
    const [isThinkingEnabled, setIsThinkingEnabled] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [chatImage, setChatImage] = useState<string | null>(null);

    // Conversation Memory
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const {
        conversations,
        activeConversation,
        createConversation,
        loadConversation,
        deleteConversation,
        renameConversation,
        messages,
        addMessage,
        clearMessages,
    } = useConversations(selectedPersonaId);

    useEffect(() => {
        liveSessionRef.current = new AIService.LiveVoiceSession();
        return () => {
            liveSessionRef.current?.stop();
        };
    }, []);

    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

    useEffect(() => {
        if (!isSending) {
            setChatMessages(
                messages.map(message => ({
                    role: message.role === 'assistant' ? 'model' : 'user',
                    text: message.content,
                    image: message.imageUrl || null
                }))
            );
        }
    }, [messages, isSending]);

    const handleClearChat = async () => {
        setChatMessages([]);
        setAdvisorData(null);
        await clearMessages();
        toast.success("Chat history & reports cleared");
    };

    // --- Voice Handlers ---
    const handleToggleLiveSession = async () => {
        if (isLiveSessionActive) {
            liveSessionRef.current?.stop();
            setIsLiveSessionActive(false);
        } else {
            try {
                const persona = PERSONAS.find(p => p.id === selectedPersonaId) || PERSONAS[0];
                const extendedContext = await getExtendedAppContext(investments, totalNetWorth, !isSafeMode, contextDepth);
                const aiAnalystContext = await AIService.getAIAnalystContext();
                const systemInstructions = `${persona.prompt}\n${extendedContext}\n${aiAnalystContext}\nAnswer questions concisely.`;
                aiAuditService.logVoiceSession({
                    model: 'gemini-live',
                    persona: selectedPersonaId,
                    includeAbsoluteValues: false,
                });
                await liveSessionRef.current?.start(systemInstructions);
                setIsLiveSessionActive(true);
            } catch (e) {
                console.error("Live Session Start Error:", e);
                toast.error('Failed to connect to Gemini Live. Please check your API key.');
                setIsLiveSessionActive(false);
            }
        }
    };

    const handleGenerateReport = async () => {
        setIsGeneratingReport(true);
        setAdvisorData(null);
        try {
            const extendedContext = await getExtendedAppContext(investments, totalNetWorth, true, contextDepth);
            const aiAnalystContext = await AIService.getAIAnalystContext();
            const prompt = `
            Role: Senior Wealth Manager.
            Context:
            ${extendedContext}
            ${aiAnalystContext}
            Task: Audit portfolio and trading history. Output JSON schema: { "grades": { "diversification": "Grade", "riskProfile": "Grade", "assetQuality": "Grade" }, "summary": "text", "risks": ["text"], "opportunities": ["text"], "actions": ["text"] }
          `;
            const rawResponse = await AIService.askGemini(prompt, true);
            const parsedData = safeParseJsonBlock<AdvisorData>(rawResponse);
            if (!parsedData) {
                throw new Error('Model returned an invalid report payload.');
            }
            setAdvisorData(parsedData);
            aiAuditService.logAdvisorReport({
                model: selectedModelId,
                persona: selectedPersonaId,
                includeAbsoluteValues: true,
                responseLength: rawResponse.length,
            });

            setChatMessages(prev => [...prev, { role: 'model', text: "I've generated a comprehensive portfolio audit report for you.", image: null }]);
            await addMessage({ role: 'assistant', content: "I've generated a comprehensive portfolio audit report for you.", model: selectedModelId });
        } catch (e) {
            console.error("Report Failed", e);
            setChatMessages(prev => [...prev, { role: 'model', text: "Error generating report. Please try again later.", image: null }]);
        } finally {
            setIsGeneratingReport(false);
        }
    };

    const handleSendMessage = async (userText: string, userImage: string | null) => {
        setChatImage(null);
        if (!apiRateLimiter.canProceed('advisor-chat')) {
            toast.error(`Rate limit reached. Try again in a minute. Remaining attempts: ${apiRateLimiter.getRemainingAttempts('advisor-chat')}`);
            return;
        }
        setIsSending(true);

        const newHistory = [...chatMessages, { role: 'user' as const, text: userText, image: userImage }];
        setChatMessages(newHistory);
        await addMessage({ role: 'user', content: userText, imageUrl: userImage || undefined, model: selectedModelId });

        // Add placeholder for streaming response
        const streamingIndex = newHistory.length;
        setChatMessages(prev => [...prev, { role: 'model', text: '', image: null }]);

        try {
            const apiHistory = chatMessages.map(msg => ({
                role: msg.role,
                parts: msg.image
                    ? [{ inlineData: { mimeType: 'image/png', data: msg.image.split(',')[1] } }, { text: msg.text || '' }]
                    : [{ text: msg.text || '' }]
            }));

            const apiMessage = userImage
                ? [{ inlineData: { mimeType: 'image/png', data: userImage.split(',')[1] } }, { text: userText || 'Analyze this image' }]
                : userText;

            const persona = PERSONAS.find(p => p.id === selectedPersonaId) || PERSONAS[0];
            const extendedContext = await getExtendedAppContext(investments, totalNetWorth, !isSafeMode, contextDepth);
            const aiAnalystContext = await AIService.getAIAnalystContext();
            const systemContext = `${persona.prompt}\n\n${SEBI_COMPLIANCE_CORE}\n\nUSER DATA & PORTFOLIO:\n${extendedContext}\n${aiAnalystContext}`;

            // Stream handler: Update message as tokens arrive
            const onToken = (_token: string, fullText: string) => {
                setChatMessages(prev => {
                    const updated = [...prev];
                    updated[streamingIndex] = { role: 'model', text: fullText, image: null };
                    return updated;
                });
            };

            const onComplete = (fullText: string) => {
                setChatMessages(prev => {
                    const updated = [...prev];
                    updated[streamingIndex] = { role: 'model', text: fullText, image: null };
                    return updated;
                });
                aiAuditService.logAdvisorQuery({
                    model: selectedModelId,
                    persona: selectedPersonaId,
                    hasImage: !!userImage,
                    includeAbsoluteValues: false,
                    promptLength: userText.length,
                    responseLength: fullText.length,
                });
                void addMessage({ role: 'assistant', content: fullText, model: selectedModelId });
                setIsSending(false);
            };

            const onError = (error: Error) => {
                setChatMessages(prev => {
                    const updated = [...prev];
                    updated[streamingIndex] = { role: 'model', text: `Error: ${error.message || "Unable to process request."}`, image: null };
                    return updated;
                });
                setIsSending(false);
            };

            // Route to appropriate streaming provider
            const selectedModel = MODELS.find(m => m.id === selectedModelId);
            const provider = selectedModel?.provider || 'gemini';

            if (provider === 'gemini') {
                await AIService.streamChatWithGemini(
                    selectedModelId, 
                    apiHistory, 
                    apiMessage, 
                    systemContext, 
                    onToken, onComplete, onError,
                    { 
                        googleSearchGrounding: isSearchGroundingEnabled,
                        thinkingMode: isThinkingEnabled 
                    }
                );
            } else {
                // OpenAI-compatible streaming (Groq, OpenRouter)
                const storeData = localStorage.getItem('wealth-aggregator-logic');
                const settings = storeData ? JSON.parse(storeData).state : {};
                
                let endpoint = "";
                let apiKey = "";

                if (provider === 'groq') {
                    endpoint = "https://api.groq.com/openai/v1/chat/completions";
                    apiKey = settings.groqApiKey;
                } else if (provider === 'openrouter') {
                    endpoint = "https://openrouter.ai/api/v1/chat/completions";
                    apiKey = settings.openRouterApiKey;
                }

                if (!apiKey) {
                    throw new Error(`${provider.toUpperCase()}_API_KEY_MISSING`);
                }

                const openAiHistory = chatMessages.map(msg => ({
                    role: msg.role === 'model' ? 'assistant' as const : 'user' as const,
                    content: msg.text || ''
                }));

                await AIService.streamChatWithOpenAICompatible(
                    endpoint,
                    apiKey,
                    selectedModelId,
                    openAiHistory,
                    userText,
                    systemContext,
                    onToken,
                    onComplete,
                    onError
                );
            }
        } catch (error: unknown) {
            console.error("Chat Error", error);
            setIsSending(false);
            
            // Remove the empty placeholder message on error
            setChatMessages(prev => prev.filter((msg, i) => i !== streamingIndex));
            
            // Provide user feedback
            const errMessage = error instanceof Error ? error.message : String(error);
            let errorMsg = "Unable to reach AI. ";
            if (errMessage.includes('API_KEY_MISSING')) {
                errorMsg = `Missing ${selectedModelId.includes('gemini') ? 'Gemini' : 'Provider'} API Key. Check Settings.`;
            } else if (errMessage.includes('429') || errMessage.includes('RATE_LIMIT')) {
                errorMsg = "Too many requests. Please wait a moment.";
            } else {
                errorMsg += errMessage || "Please check your internet and API keys.";
            }
            toast.error(errorMsg);
        }
    };

    const renderHeader = () => (
        <div className="relative z-40 flex flex-wrap items-center justify-between shrink-0 border-b border-slate-200/50 bg-white/60 px-4 py-2.5 backdrop-blur-md dark:border-slate-800/50 dark:bg-slate-900/60 gap-2">
            {/* Left side actions */}
            <div className="flex bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/50 shrink-0">
                <button
                    onClick={() => setActiveTab('CHAT')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === 'CHAT' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                    <MessageSquare size={14} /> Chat
                </button>
                <button
                    onClick={() => setActiveTab('VOICE')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === 'VOICE' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                    <Mic size={14} /> Voice
                </button>
                <button
                    onClick={() => setActiveTab('AUDIT')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${activeTab === 'AUDIT' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                    <Bot size={14} /> AI SWOT Audit
                </button>
            </div>

            {/* Right side selectors/actions */}
            <div className="flex items-center gap-2 overflow-visible">
                <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className={`rounded-lg p-2 transition-colors border ${isSidebarOpen
                        ? 'bg-indigo-100 border-indigo-200 text-indigo-600 dark:bg-indigo-500/20 dark:border-indigo-500/30 dark:text-indigo-400'
                        : 'border-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300'
                        }`}
                    title="Conversation History"
                >
                    <History size={16} />
                </button>
                
                <button
                    onClick={() => setContextDepth(prev => prev === 'recent' ? 'full' : 'recent')}
                    className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors shadow-sm ${
                        contextDepth === 'full' 
                        ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/20 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/30'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/30'
                    }`}
                    title={contextDepth === 'full' ? "Deep Context: Sending 100+ items (High token cost)" : "Fast Context: Sending 15-20 recent items (Token efficient)"}
                >
                    {contextDepth === 'full' ? <Database size={14} /> : <Zap size={14} />} 
                    <span className="hidden sm:inline">{contextDepth === 'full' ? 'Deep Context' : 'Fast Context'}</span>
                </button>

                <div className="flex bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/50 shrink-0">
                    <button
                        onClick={() => setIsSafeMode(!isSafeMode)}
                        className={`p-1.5 rounded-md transition-all ${isSafeMode ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                        title={isSafeMode ? "Safe Mode: PII/Values Masked" : "Exposed Mode: Absolute Values Sent"}
                    >
                        <ShieldCheck size={14} />
                    </button>
                    <button
                        onClick={() => setIsSearchGroundingEnabled(!isSearchGroundingEnabled)}
                        className={`p-1.5 rounded-md transition-all ${isSearchGroundingEnabled ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                        title="Web Search Grounding (Gemini Only)"
                    >
                        <Search size={14} />
                    </button>
                    <button
                        onClick={() => setIsThinkingEnabled(!isThinkingEnabled)}
                        className={`p-1.5 rounded-md transition-all ${isThinkingEnabled ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                        title="Deep Reasoning Mode"
                    >
                        <Bot size={14} />
                    </button>
                </div>
                
                <PersonaSelector selected={selectedPersonaId} onSelect={setSelectedPersonaId} />
                <ModelSelector selected={selectedModelId} onSelect={setSelectedModelId} />
                
                <button
                    onClick={handleGenerateReport}
                    disabled={isGeneratingReport}
                    className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/20 dark:text-indigo-300 dark:hover:bg-indigo-500/30"
                >
                    {isGeneratingReport ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} 
                    <span className="hidden sm:inline">Audit Report</span>
                </button>
            </div>
        </div>
    );

    return (
        <div className="w-full h-full flex flex-col relative bg-slate-50 dark:bg-wa-surface">
            {activeTab === 'CHAT' ? (
                <ChatInterface
                    chatMessages={chatMessages}
                    advisorData={advisorData}
                    isGeneratingReport={isGeneratingReport}
                    isSending={isSending}
                    investments={investments}
                    totalNetWorth={totalNetWorth}
                    contextPrompts={contextPrompts}
                    onNavigate={onNavigate}
                    onSendMessage={handleSendMessage}
                    onClearReport={() => setAdvisorData(null)}
                    renderHeader={renderHeader}
                    isSidebarOpen={isSidebarOpen}
                    SidebarComponent={
                        <div className="w-72 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0 h-full">
                            <ConversationsSidebar
                                conversations={conversations}
                                activeConversationId={activeConversation?.id || null}
                                onSelect={(id) => {
                                    setChatMessages([]);
                                    setAdvisorData(null);
                                    loadConversation(id);
                                }}
                                onNew={() => {
                                    setChatMessages([]);
                                    setAdvisorData(null);
                                    createConversation(selectedPersonaId);
                                }}
                                onDelete={(id) => { setPendingDeleteId(id); setIsDeleteModalOpen(true); }}
                                onRename={renameConversation}
                                onClear={() => { setPendingDeleteId(null); setIsDeleteModalOpen(true); }}
                            />
                        </div>
                    }
                    setChatImage={setChatImage}
                    chatImage={chatImage}
                    compressImage={compressImage}
                    blobToBase64={blobToBase64}
                />
            ) : activeTab === 'VOICE' ? (
                <VoiceInterface
                    isLiveSessionActive={isLiveSessionActive}
                    onToggleSession={handleToggleLiveSession}
                    renderHeader={renderHeader}
                />
            ) : (
                <div className="flex flex-col h-full overflow-y-auto bg-slate-50 dark:bg-slate-950">
                    {renderHeader()}
                    <div className="flex-1 p-6 md:p-8">
                        <BehavioralAudit />
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {isDeleteModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 animate-in zoom-in-95 duration-200">
                        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-900/30 text-rose-600 rounded-2xl flex items-center justify-center mb-4">
                            <Trash2 size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Clear Conversation?</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                            This will permanently delete the current chat history and all generated reports. This action cannot be undone.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setIsDeleteModalOpen(false)}
                                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { 
                                    if (pendingDeleteId) {
                                        deleteConversation(pendingDeleteId);
                                        setPendingDeleteId(null);
                                    } else {
                                        handleClearChat();
                                    }
                                    setIsDeleteModalOpen(false); 
                                }}
                                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold shadow-lg shadow-rose-600/20 transition-all active:scale-95"
                            >
                                Confirm Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(AdvisorTab);
