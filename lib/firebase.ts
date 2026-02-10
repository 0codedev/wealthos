import type { FirebaseApp } from 'firebase/app';
import type { Auth, GoogleAuthProvider } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "wealthaggregator-b6ba5.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "wealthaggregator-b6ba5",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "wealthaggregator-b6ba5.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1040313194732",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1040313194732:web:f3948f8482f08736aa6dc9",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-QHB14JRKVW"
};

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firebaseFirestore: Firestore | null = null;
let firebaseGoogleProvider: GoogleAuthProvider | null = null;

const ensureFirebaseApp = async () => {
    if (firebaseApp) {
        return firebaseApp;
    }

    const { initializeApp } = await import('firebase/app');
    firebaseApp = initializeApp(firebaseConfig);
    return firebaseApp;
};

export const getFirebaseAuthServices = async () => {
    const app = await ensureFirebaseApp();
    const authModule = await import('firebase/auth');

    if (!firebaseAuth) {
        firebaseAuth = authModule.getAuth(app);
    }

    if (!firebaseGoogleProvider) {
        firebaseGoogleProvider = new authModule.GoogleAuthProvider();
    }

    return {
        auth: firebaseAuth,
        googleProvider: firebaseGoogleProvider,
        authModule,
    };
};

export const getFirebaseFirestoreService = async () => {
    const app = await ensureFirebaseApp();
    const firestoreModule = await import('firebase/firestore');

    if (!firebaseFirestore) {
        firebaseFirestore = firestoreModule.getFirestore(app);
    }

    return {
        firestore: firebaseFirestore,
        firestoreModule,
    };
};

export const getFirebaseApp = async () => ensureFirebaseApp();
