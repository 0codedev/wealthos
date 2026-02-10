import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface SupabaseAuthContextType {
    session: Session | null;
    user: User | null;
    loading: boolean;
    signOut: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextType>({
    session: null,
    user: null,
    loading: true,
    signOut: async () => { },
});

export const useSupabaseAuth = () => useContext(SupabaseAuthContext);

export const SupabaseAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Gracefully handle missing Supabase config
        try {
            supabase.auth.getSession().then(({ data: { session } }) => {
                setSession(session);
                setUser(session?.user ?? null);
                setLoading(false);
            }).catch(err => {
                console.warn("Supabase getSession error:", err);
                setLoading(false);
            });

            const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
                setSession(session);
                setUser(session?.user ?? null);
                setLoading(false);
            });

            return () => subscription.unsubscribe();
        } catch (err) {
            console.warn("Supabase auth initialization skipped:", err);
            setLoading(false);
            return () => { };
        }
    }, []);

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    return (
        <SupabaseAuthContext.Provider value={{ session, user, loading, signOut }}>
            {children}
        </SupabaseAuthContext.Provider>
    );
};
