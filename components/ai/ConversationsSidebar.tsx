import React, { useState } from 'react';
import { MessageSquare, Plus, Trash2, Edit2, Check, X, Clock } from 'lucide-react';
import { Conversation } from '../../database';
import { SectionHeader, StateSurface } from '../shared/SurfacePrimitives';

interface ConversationsSidebarProps {
    conversations: Conversation[];
    activeConversationId: number | null;
    onSelect: (id: number) => void;
    onNew: () => void;
    onDelete: (id: number) => void;
    onRename: (id: number, title: string) => void;
    onClear: () => void;
}

export const ConversationsSidebar: React.FC<ConversationsSidebarProps> = ({
    conversations,
    activeConversationId,
    onSelect,
    onNew,
    onDelete,
    onRename,
    onClear
}) => {
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editTitle, setEditTitle] = useState('');

    const handleStartEdit = (conv: Conversation) => {
        setEditingId(conv.id!);
        setEditTitle(conv.title);
    };

    const handleSaveEdit = () => {
        if (editingId && editTitle.trim()) {
            onRename(editingId, editTitle.trim());
        }
        setEditingId(null);
        setEditTitle('');
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setEditTitle('');
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-3">
                <SectionHeader
                    eyebrow="Memory"
                    title="Conversation History"
                    description="Your advisor sessions and summaries."
                    icon={MessageSquare}
                    tone="neutral"
                    badge={`${conversations.length} saved`}
                />
                <div className="flex gap-2">
                <button
                    onClick={onNew}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-500/30"
                >
                    <Plus size={16} />
                    New Chat
                </button>
                {activeConversationId && (
                    <button
                        onClick={onClear}
                        className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-slate-400 hover:text-rose-500 rounded-xl transition-all border border-slate-200 dark:border-slate-700"
                        title="Clear current chat"
                    >
                        <Trash2 size={16} />
                    </button>
                )}
                </div>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-1">
                {conversations.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                        <StateSurface
                            title="No Conversations Yet"
                            description="Start a new chat to begin building advisor memory."
                            icon={MessageSquare}
                            tone="neutral"
                            badge="empty"
                            compact
                        />
                    </div>
                ) : (
                    conversations.map(conv => (
                        <div
                            key={conv.id}
                            onClick={() => editingId !== conv.id && onSelect(conv.id!)}
                            className={`group relative p-3 rounded-xl cursor-pointer transition-all ${activeConversationId === conv.id
                                    ? 'bg-indigo-500/10 border border-indigo-500/30'
                                    : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 border border-transparent'
                                }`}
                        >
                            {editingId === conv.id ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                                        autoFocus
                                        className="flex-1 px-2 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white"
                                    />
                                    <button onClick={handleSaveEdit} aria-label="Save conversation title" className="p-1 text-emerald-500 hover:bg-emerald-500/20 rounded">
                                        <Check size={14} />
                                    </button>
                                    <button onClick={handleCancelEdit} aria-label="Cancel edit" className="p-1 text-rose-500 hover:bg-rose-500/20 rounded">
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-slate-800 dark:text-white truncate">
                                                {conv.title}
                                            </p>
                                            {conv.preview && (
                                                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                                    {conv.preview}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between mt-2">
                                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                            <Clock size={10} />
                                            {formatDate(conv.updatedAt)}
                                        </span>
                                        <span className="text-[10px] text-slate-400">
                                            {conv.messageCount || 0} msgs
                                        </span>
                                    </div>

                                    {/* Actions (visible on hover) */}
                                    <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleStartEdit(conv); }}
                                            className="p-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-indigo-500 rounded-lg transition-colors"
                                        >
                                            <Edit2 size={12} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onDelete(conv.id!); }}
                                            className="p-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-rose-500 rounded-lg transition-colors"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Footer Stats */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800">
                <p className="text-[10px] text-center text-slate-400">
                    {conversations.length} conversation{conversations.length !== 1 ? 's' : ''} saved
                </p>
            </div>
        </div>
    );
};

export default ConversationsSidebar;
