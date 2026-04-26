import React from 'react';
import { Sparkles } from 'lucide-react';

const formatInline = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-bold text-indigo-600 dark:text-indigo-300">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
            return <em key={i} className="italic text-slate-500 dark:text-slate-400">{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
            return <code key={i} className="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded text-xs font-mono text-emerald-600 dark:text-emerald-400">{part.slice(1, -1)}</code>;
        }
        return part;
    });
};

export const renderMarkdown = (text: string) => {
    if (!text) return null;

    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];

    let listBuffer: React.ReactNode[] = [];
    let isOrderedList = false;

    const flushList = () => {
        if (listBuffer.length > 0) {
            const ListTag = isOrderedList ? 'ol' : 'ul';
            elements.push(
                <ListTag key={`list-${elements.length}`} className={`mb-4 pl-5 ${isOrderedList ? 'list-decimal' : 'list-disc'} space-y-1 text-slate-700 dark:text-slate-300`}>
                    {listBuffer}
                </ListTag>
            );
            listBuffer = [];
        }
    };

    lines.forEach((line, index) => {
        const trimmed = line.trim();

        // Headings
        if (line.startsWith('### ')) {
            flushList();
            elements.push(<h3 key={index} className="text-md font-bold text-indigo-600 dark:text-indigo-400 mt-6 mb-2 flex items-center gap-2"><Sparkles size={14} /> {formatInline(line.replace('### ', ''))}</h3>);
        } else if (line.startsWith('## ')) {
            flushList();
            elements.push(<h2 key={index} className="text-lg font-bold text-slate-900 dark:text-white border-b border-indigo-100 dark:border-indigo-500/30 pb-2 mt-8 mb-4">{formatInline(line.replace('## ', ''))}</h2>);
        } else if (line.startsWith('# ')) {
            flushList();
            elements.push(<h1 key={index} className="text-2xl font-black text-slate-900 dark:text-white mt-6 mb-6">{formatInline(line.replace('# ', ''))}</h1>);
        }
        // Lists
        else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            isOrderedList = false;
            listBuffer.push(<li key={index} className="pl-1">{formatInline(trimmed.replace(/^[-*]\s+/, ''))}</li>);
        } else if (/^\d+\.\s/.test(trimmed)) {
            isOrderedList = true;
            listBuffer.push(<li key={index} className="pl-1">{formatInline(trimmed.replace(/^\d+\.\s+/, ''))}</li>);
        }
        // Empty lines
        else if (trimmed === '') {
            flushList();
            elements.push(<div key={index} className="h-3"></div>);
        }
        // Regular Text
        else {
            flushList();
            elements.push(<p key={index} className="text-slate-700 dark:text-slate-300 mb-1 leading-relaxed">{formatInline(line)}</p>);
        }
    });

    flushList();
    return elements;
};
