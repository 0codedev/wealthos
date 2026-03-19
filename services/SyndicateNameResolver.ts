import { Friend } from '../database';

/**
 * Normalizes an applicant or friend name cleanly (trims extra spaces, preserves exact full name).
 */
export const normalizeSyndicateName = (name: string): string => {
    if (!name) return '';
    return name
        .trim()
        .replace(/\s+/g, ' ');
};

/**
 * Checks if two applicant names are identical (case-insensitive, whitespace-trimmed exact comparison).
 */
export const isSameSyndicateMember = (nameA: string, nameB: string): boolean => {
    if (!nameA || !nameB) return false;
    return nameA.trim().toLowerCase() === nameB.trim().toLowerCase();
};

/**
 * Finds the matching Friend from the Vault list given an applicant name string.
 * Uses exact case-insensitive trimmed matching so distinct persons are NEVER conflated.
 */
export const findMatchingVaultFriend = (applicantName: string, friends: Friend[]): Friend | undefined => {
    if (!applicantName || !friends || friends.length === 0) return undefined;
    const cleanTarget = applicantName.trim().toLowerCase();
    return friends.find(f => f.name.trim().toLowerCase() === cleanTarget);
};

