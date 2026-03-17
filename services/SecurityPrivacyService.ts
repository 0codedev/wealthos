import { db } from '../database';
import { auditTrail } from './SecurityService';

export interface SensitiveFieldSummary {
    label: string;
    value: string;
    configured: boolean;
}

export interface AdvisorRetentionSummary {
    conversations: number;
    messages: number;
    localArtifacts: number;
}

const ADVISOR_LOCAL_KEYS = ['advisor_chat_history', 'advisor_report_data'];

export const maskSecret = (value?: string): string => {
    if (!value) return 'Not set';
    if (value.length <= 4) return '••••';
    return `${value.slice(0, 2)}••••${value.slice(-2)}`;
};

export const buildSensitiveFieldSummary = (settings: {
    dhanClientId?: string;
    dhanAccessToken?: string;
    dhanPin?: string;
    dhanTotpSecret?: string;
    geminiApiKey?: string;
    groqApiKey?: string;
    apiKeys?: { rapidApi?: string; alphaVantage?: string; finnhub?: string; fmp?: string; };
}) => {
    const fields: SensitiveFieldSummary[] = [
        { label: 'Dhan Client ID', value: settings.dhanClientId || '', configured: !!settings.dhanClientId },
        { label: 'Dhan Access Token', value: settings.dhanAccessToken || '', configured: !!settings.dhanAccessToken },
        { label: 'Dhan PIN', value: settings.dhanPin || '', configured: !!settings.dhanPin },
        { label: 'Dhan TOTP Secret', value: settings.dhanTotpSecret || '', configured: !!settings.dhanTotpSecret },
        { label: 'Gemini API Key', value: settings.geminiApiKey || '', configured: !!settings.geminiApiKey },
        { label: 'Groq API Key', value: settings.groqApiKey || '', configured: !!settings.groqApiKey },
        { label: 'RapidAPI Key', value: settings.apiKeys?.rapidApi || '', configured: !!settings.apiKeys?.rapidApi },
        { label: 'Alpha Vantage Key', value: settings.apiKeys?.alphaVantage || '', configured: !!settings.apiKeys?.alphaVantage },
        { label: 'Finnhub Key', value: settings.apiKeys?.finnhub || '', configured: !!settings.apiKeys?.finnhub },
        { label: 'FMP Key', value: settings.apiKeys?.fmp || '', configured: !!settings.apiKeys?.fmp },
    ];

    return {
        fields,
        configuredCount: fields.filter((field) => field.configured).length,
    };
};

export const getAdvisorRetentionSummary = async (): Promise<AdvisorRetentionSummary> => ({
    conversations: await db.conversations.count(),
    messages: await db.chat_messages.count(),
    localArtifacts: ADVISOR_LOCAL_KEYS.filter((key) => !!localStorage.getItem(key)).length,
});

export const clearAdvisorRetention = async (): Promise<void> => {
    await (db as any).transaction('rw', db.conversations, db.chat_messages, async () => {
        await db.chat_messages.clear();
        await db.conversations.clear();
    });

    ADVISOR_LOCAL_KEYS.forEach((key) => localStorage.removeItem(key));
};

export const getAuditTrailSummary = () => {
    const entries = auditTrail.getAll();
    return {
        count: entries.length,
        lastEntry: entries[0] || null,
    };
};

export const clearAuditTrailData = (): void => {
    auditTrail.clear();
};
