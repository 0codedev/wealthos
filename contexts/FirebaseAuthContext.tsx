import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { getFirebaseAuthServices } from '../lib/firebase';

interface FirebaseAuthContextType {
    user: User | null;
    loading: boolean;
    signOut: () => Promise<void>;
}

const FirebaseAuthContext = createContext<FirebaseAuthContextType>({
    user: null,
    loading: true,
    signOut: async () => { },
});

export const useFirebaseAuth = () => useContext(FirebaseAuthContext);

export const FirebaseAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        let isActive = true;

        if (import.meta.env.DEV && (localStorage.getItem('wealthos_mock_auth') !== 'false' || window.location.search.includes('mock_auth=true'))) {
            setUser({
                uid: 'mock_user_123',
                email: 'propdesk@wealthos.dev',
                displayName: 'Prop Desk Lead'
            } as unknown as User);
            setLoading(false);
            return;
        }

        // Failsafe timeout: gives Firebase IndexedDB session cache ample time to hydrate
        // while preventing indefinite hang if offline
        const timer = setTimeout(() => {
            if (isActive) {
                setLoading(false);
            }
        }, 2200);

        try {
            void (async () => {
                const { auth, authModule } = await getFirebaseAuthServices();
                if (!isActive) {
                    return;
                }

                unsubscribe = authModule.onAuthStateChanged(auth, (firebaseUser) => {
                    clearTimeout(timer);
                    setUser(firebaseUser);
                    setLoading(false);
                    if (firebaseUser?.uid) {
                        try {
                            localStorage.setItem('wealthos_has_logged_in', 'true');
                        } catch (e) { /* ignore */ }
                        import('../services/SyncEngine').then(({ syncEngine }) => {
                            syncEngine.onUserLogin(firebaseUser.uid);
                        }).catch(err => {
                            console.warn('[SyncEngine] Failed to initialize on auth change:', err);
                        });
                    } else {
                        try {
                            localStorage.removeItem('wealthos_has_logged_in');
                        } catch (e) { /* ignore */ }
                    }
                }, (error) => {
                    clearTimeout(timer);
                    console.warn("Firebase auth error:", error);
                    setLoading(false);
                });
            })();
        } catch (err) {
            clearTimeout(timer);
            console.warn("Firebase auth initialization skipped:", err);
            setLoading(false);
        }

        return () => {
            isActive = false;
            clearTimeout(timer);
            unsubscribe?.();
        };
    }, []);

    const signOut = async () => {
        try {
            const { syncEngine } = await import('../services/SyncEngine');
            await syncEngine.clearLocalDataForUserSwitch('');
        } catch (e) {
            console.warn('[Auth] Failed to clean up user data on sign out:', e);
        }
        try {
            const { auth, authModule } = await getFirebaseAuthServices();
            await authModule.signOut(auth);
        } catch (e) {
            console.warn('[Auth] Firebase sign out error:', e);
        }
        if (typeof window !== 'undefined') {
            window.location.href = '/';
        }
    };

    return (
        <FirebaseAuthContext.Provider value={{ user, loading, signOut }}>
            {children}
        </FirebaseAuthContext.Provider>
    );
};
