import React from 'react';

export interface SecretNote {
    id: string;
    title: string;
    encryptedContent: string;
    date: string;
    category: 'password' | 'financial' | 'personal' | 'medical' | 'legal';
    starred: boolean;
}

export interface LegacyBeneficiary {
    id: string;
    name: string;
    email: string;
    relationship: string;
    share: number; // Percentage
}

export interface SecurityItem {
    id: string;
    name: string;
    platform: string;
    has2FA: boolean;
    lastChecked: string;
    icon: React.ReactNode;
}
