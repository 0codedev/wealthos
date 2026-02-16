import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { liveQuery } from 'dexie';
import { db, Conversation, ChatMessage } from '../database';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    imageUrl?: string;
    model?: string;
}

export interface UseConversationsReturn {
    // Conversations List
    conversations: Conversation[];
    activeConversation: Conversation | null;

    // Actions
    createConversation: (persona: string) => Promise<number>;
    loadConversation: (id: number) => void;
    deleteConversation: (id: number) => Promise<void>;
    renameConversation: (id: number, title: string) => Promise<void>;

    // Messages
    messages: Message[];
    addMessage: (message: Message) => Promise<void>;
    clearMessages: () => Promise<void>;

    // State
    isLoading: boolean;
}

export function useConversations(initialPersona: string = 'advisor'): UseConversationsReturn {
    const storageKey = `active_conv_${initialPersona}`;
    const [activeConversationId, setActiveConversationIdState] = useState<number | null>(() => {
        if (typeof window === 'undefined') return null;
        const saved = localStorage.getItem(storageKey);
        return saved ? parseInt(saved) : null;
    });
    
    const activeIdRef = useRef<number | null>(activeConversationId);
    const [isLoading, setIsLoading] = useState(false);

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

    // Sync ref and localStorage
    const setActiveConversationId = useCallback((id: number | null) => {
        setActiveConversationIdState(id);
        activeIdRef.current = id;
        if (id) {
            localStorage.setItem(storageKey, id.toString());
        } else {
            localStorage.removeItem(storageKey);
        }
    }, [storageKey]);

    // Fetch all conversations for this persona
    useEffect(() => {
        const subscription = liveQuery(() => db.conversations
            .where('persona')
            .equals(initialPersona)
            .reverse()
            .sortBy('updatedAt')
        ).subscribe(setConversations);
        return () => subscription.unsubscribe();
    }, [initialPersona]);

    // Handle Persona change - switch to correct active conversation from localStorage
    useEffect(() => {
        const saved = localStorage.getItem(storageKey);
        const newId = saved ? parseInt(saved) : null;
        setActiveConversationIdState(newId);
        activeIdRef.current = newId;
    }, [initialPersona, storageKey]);

    // Fetch active conversation and messages
    useEffect(() => {
        if (!activeConversationId) {
            setActiveConversation(null);
            setChatMessages([]);
            return;
        }

        const subAc = liveQuery(() => db.conversations.get(activeConversationId))
            .subscribe(c => {
                if (c) {
                    setActiveConversation(c);
                } else {
                    // Clean up if deleted
                    setActiveConversationId(null);
                }
            });

        const subMsg = liveQuery(() => db.chat_messages
            .where('conversationId')
            .equals(activeConversationId)
            .sortBy('timestamp')
        ).subscribe(setChatMessages);

        return () => {
            subAc.unsubscribe();
            subMsg.unsubscribe();
        };
    }, [activeConversationId, setActiveConversationId]);

    // Convert ChatMessage to Message format
    const messages = useMemo<Message[]>(() =>
        chatMessages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
            imageUrl: m.imageUrl,
            model: m.model
        })),
        [chatMessages]
    );

    // Create new conversation
    const createConversation = useCallback(async (persona: string): Promise<number> => {
        const now = new Date().toISOString();
        const id = await db.conversations.add({
            title: `New Chat ${new Date().toLocaleDateString()}`,
            persona,
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
            preview: ''
        });
        setActiveConversationId(id as number);
        return id as number;
    }, [setActiveConversationId]);

    // Load existing conversation
    const loadConversation = useCallback((id: number) => {
        setActiveConversationId(id);
    }, [setActiveConversationId]);

    // Delete conversation and its messages
    const deleteConversation = useCallback(async (id: number) => {
        await (db as any).transaction('rw', db.conversations, db.chat_messages, async () => {
            await db.chat_messages.where('conversationId').equals(id).delete();
            await db.conversations.delete(id);
        });
        if (activeIdRef.current === id) {
            setActiveConversationId(null);
        }
    }, [setActiveConversationId]);

    // Rename conversation
    const renameConversation = useCallback(async (id: number, title: string) => {
        await db.conversations.update(id, { title });
    }, []);

    // Add message to active conversation
    const addMessage = useCallback(async (message: Message) => {
        let convId = activeIdRef.current;
        if (!convId) {
            convId = await createConversation(initialPersona);
        }
        const now = new Date().toISOString();

        await db.chat_messages.add({
            conversationId: convId,
            role: message.role,
            content: message.content,
            timestamp: now,
            model: message.model,
            imageUrl: message.imageUrl
        });

        // Update conversation metadata
        const conv = await db.conversations.get(convId);
        if (conv) {
            await db.conversations.update(convId, {
                updatedAt: now,
                messageCount: (conv.messageCount || 0) + 1,
                preview: message.content.slice(0, 100)
            });

            // Auto-rename on first message
            if (conv.messageCount === 0 && message.role === 'user') {
                const autoTitle = message.content.slice(0, 40) + (message.content.length > 40 ? '...' : '');
                await db.conversations.update(convId, { title: autoTitle });
            }
        }
    }, [createConversation, initialPersona]);

    // Clear all messages in active conversation
    const clearMessages = useCallback(async () => {
        const convId = activeIdRef.current;
        if (convId) {
            await db.chat_messages.where('conversationId').equals(convId).delete();
            await db.conversations.update(convId, {
                messageCount: 0,
                preview: '',
                updatedAt: new Date().toISOString()
            });
        }
    }, []);

    return {
        conversations,
        activeConversation,
        createConversation,
        loadConversation,
        deleteConversation,
        renameConversation,
        messages,
        addMessage,
        clearMessages,
        isLoading
    };
}

export default useConversations;
