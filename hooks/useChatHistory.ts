import { useState, useCallback, useEffect } from 'react';
import { db, Conversation, ChatMessage } from '../database';
import { liveQuery } from 'dexie';

interface ChatHistoryResult {
    // Conversations list
    conversations: Conversation[];
    activeConversation: Conversation | null;
    messages: ChatMessage[];

    // Actions
    createConversation: (persona: string) => Promise<number>;
    loadConversation: (id: number) => void;
    deleteConversation: (id: number) => Promise<void>;

    // Messages
    addMessage: (role: 'user' | 'assistant', content: string, model?: string) => Promise<void>;
    clearMessages: () => Promise<void>;

    // Search
    searchConversations: (query: string) => Conversation[];

    // State
    isLoading: boolean;
}

/**
 * Hook for managing AI Advisor conversation history with IndexedDB persistence.
 * Automatically saves all messages and allows loading previous conversations.
 * 
 * @example
 * const { conversations, createConversation, addMessage } = useChatHistory();
 * 
 * // Start new conversation
 * const id = await createConversation('oracle');
 * 
 * // Add messages
 * await addMessage('user', 'What should I invest in?');
 * await addMessage('assistant', 'Based on your portfolio...');
 */
export function useChatHistory(): ChatHistoryResult {
    const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);

    // Live query for all conversations
    useEffect(() => {
        const subscription = liveQuery(() => db.conversations.orderBy('updatedAt').reverse().toArray())
            .subscribe(setConversations);
        return () => subscription.unsubscribe();
    }, []);

    // Live query for active conversation and messages
    useEffect(() => {
        if (!activeConversationId) {
            setActiveConversation(null);
            setMessages([]);
            return;
        }

        const subAc = liveQuery(() => db.conversations.get(activeConversationId))
            .subscribe(c => setActiveConversation(c || null));

        const subMsg = liveQuery(() =>
            db.chat_messages.where('conversationId').equals(activeConversationId).sortBy('timestamp')
        ).subscribe(setMessages);

        return () => {
            subAc.unsubscribe();
            subMsg.unsubscribe();
        };
    }, [activeConversationId]);

    // Create a new conversation
    const createConversation = useCallback(async (persona: string): Promise<number> => {
        const now = new Date().toISOString();
        const id = await db.conversations.add({
            title: `New Chat - ${new Date().toLocaleDateString()}`,
            persona,
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
        });
        setActiveConversationId(id as number);
        return id as number;
    }, []);

    // Load existing conversation
    const loadConversation = useCallback((id: number) => {
        setActiveConversationId(id);
    }, []);

    // Delete conversation and its messages
    const deleteConversation = useCallback(async (id: number) => {
        await db.chat_messages.where('conversationId').equals(id).delete();
        await db.conversations.delete(id);

        if (activeConversationId === id) {
            setActiveConversationId(null);
        }
    }, [activeConversationId]);

    // Add message to active conversation
    const addMessage = useCallback(async (
        role: 'user' | 'assistant',
        content: string,
        model?: string
    ) => {
        if (!activeConversationId) return;

        const now = new Date().toISOString();

        // Add the message
        await db.chat_messages.add({
            conversationId: activeConversationId,
            role,
            content,
            timestamp: now,
            model,
        });

        // Update conversation metadata
        const conversation = await db.conversations.get(activeConversationId);
        if (conversation) {
            await db.conversations.update(activeConversationId, {
                updatedAt: now,
                messageCount: (conversation.messageCount || 0) + 1,
                preview: content.substring(0, 100),
                title: role === 'user' && conversation.messageCount === 0
                    ? content.substring(0, 50) + (content.length > 50 ? '...' : '')
                    : conversation.title
            });
        }
    }, [activeConversationId]);

    // Clear all messages in active conversation
    const clearMessages = useCallback(async () => {
        if (!activeConversationId) return;

        await db.chat_messages.where('conversationId').equals(activeConversationId).delete();
        await db.conversations.update(activeConversationId, {
            messageCount: 0,
            preview: undefined,
            updatedAt: new Date().toISOString()
        });
    }, [activeConversationId]);

    // Search through conversations
    const searchConversations = useCallback((query: string): Conversation[] => {
        const lowerQuery = query.toLowerCase();
        return conversations.filter(c =>
            c.title.toLowerCase().includes(lowerQuery) ||
            c.preview?.toLowerCase().includes(lowerQuery)
        );
    }, [conversations]);

    return {
        conversations,
        activeConversation,
        messages,
        createConversation,
        loadConversation,
        deleteConversation,
        addMessage,
        clearMessages,
        searchConversations,
        isLoading,
    };
}

export default useChatHistory;
