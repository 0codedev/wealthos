import React from 'react';
import { User, Bot } from 'lucide-react';
import { renderMarkdown } from './MarkdownRenderer';

export interface ChatBubbleProps {
    role: 'user' | 'model';
    text?: string;
    image?: string | null;
}

export const ChatBubble: React.FC<ChatBubbleProps> = React.memo(({ role, text, image }) => {
    const isUser = role === 'user';
    return (
        <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
            {/* Width logic: User ~80%, AI ~98% (almost full width for reports) */}
            <div className={`flex ${isUser ? 'max-w-[80%]' : 'max-w-[98%] w-full'} gap-4 items-start ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${isUser ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-indigo-600 border border-slate-200 dark:border-slate-700'}`}>
                    {isUser ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={`flex flex-col gap-2 ${!isUser ? 'flex-1 min-w-0' : ''}`}>
                    <div className={`p-5 rounded-2xl shadow-sm border ${isUser ? 'bg-indigo-600 text-white border-indigo-600 rounded-tr-sm' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 rounded-tl-sm w-full'}`}>
                        {image && (
                            <img src={image} alt="Upload" className="rounded-lg max-h-64 object-cover border border-white/20 mb-3" />
                        )}
                        {text && <div className="text-sm">{renderMarkdown(text)}</div>}
                    </div>
                </div>
            </div>
        </div>
    );
});

ChatBubble.displayName = 'ChatBubble';
