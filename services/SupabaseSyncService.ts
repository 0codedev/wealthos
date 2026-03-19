import { db } from '../database';
import { supabase } from '../lib/supabase';
import { logger } from './Logger';
import { buildSyncPreview } from './SyncGovernanceService';

const toSnakeCase = (str: string) => str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const toCamelCase = (str: string) => str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const convertKeys = (obj: any, converter: (s: string) => string): any => {
    if (Array.isArray(obj)) {
        return obj.map(v => convertKeys(v, converter));
    } else if (obj !== null && obj.constructor === Object) {
        return Object.keys(obj).reduce((result, key) => {
            result[converter(key)] = convertKeys(obj[key], converter);
            return result;
        }, {} as any);
    }
    return obj;
};

/**
 * Pushes all Dexie local data to Supabase.
 * This is a heavy operation meant for manual sync initially.
 * It deletes existing user cloud data and replaces it with the local snapshot to ensure symmetry,
 * just like the JSON backup.
 */
export const syncToCloud = async (userId: string): Promise<{ success: boolean; message: string }> => {
    try {
        logger.info('Starting full sync to Supabase Cloud...');

        // 1. Gather all local data
        const trades = await db.trades.toArray();
        const investments = await db.investments.toArray();
        const transactions = await db.transactions.toArray();
        const dividends = await db.dividends.toArray();
        const goals = await db.goals.toArray();
        const strategies = await db.strategies.toArray();
        const tax_records = await db.tax_records.toArray();
        const realized_transactions = await db.realized_transactions.toArray();
        const paper_trades = await db.paper_trades.toArray();
        const mistakes = await db.mistakes.toArray();
        const daily_reviews = await db.daily_reviews.toArray();
        const life_events = await db.life_events.toArray();
        const beneficiaries = await db.beneficiaries.toArray();
        const friends = await db.friends.toArray();

        // Helper to format arrays for Supabase (adds user_id and converts camelCase to snake_case)
        const formatForCloud = (arr: any[]) => arr.map(item => ({ ...convertKeys(item, toSnakeCase), user_id: userId }));

        // We do sequential upserts. Because RLS protects other users' data, 
        // a simple upsert (conflict on ID) works well. Let's use upsert.

        // We need to define upsert chunks so we don't overload Supabase payload size
        const upsertTable = async (tableName: string, data: any[]) => {
            if (data.length === 0) return;
            const { error } = await supabase.from(tableName).upsert(formatForCloud(data));
            if (error) throw new Error(`Failed to sync ${tableName}: ${error.message}`);
        };

        await upsertTable('trades', trades);
        await upsertTable('investments', investments);
        await upsertTable('transactions', transactions);
        await upsertTable('dividends', dividends);
        await upsertTable('goals', goals);
        await upsertTable('strategies', strategies);
        await upsertTable('tax_records', tax_records);
        await upsertTable('realized_transactions', realized_transactions);
        await upsertTable('paper_trades', paper_trades);
        await upsertTable('mistakes', mistakes);
        await upsertTable('daily_reviews', daily_reviews);
        await upsertTable('life_events', life_events);
        await upsertTable('beneficiaries', beneficiaries);
        await upsertTable('friends', friends);

        logger.info('Cloud sync complete!');
        return { success: true, message: 'Successfully synced to Supabase Cloud!' };

    } catch (err: unknown) {
        logger.error('Failed to sync to cloud:', err);
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message };
    }
};

/**
 * Generates a preview of what will change if pulling from Supabase Cloud.
 */
export const previewPullFromCloud = async (userId: string): Promise<any> => {
    try {
        logger.info('Generating preview for Supabase Cloud pull...');

        const fetchTable = async (tableName: string) => {
            const { data, error } = await supabase.from(tableName).select('*').eq('user_id', userId);
            if (error) throw new Error(`Failed to fetch ${tableName}: ${error.message}`);
            return (data || []).map((row: any) => {
                const { user_id, created_at, ...rest } = row;
                return convertKeys(rest, toCamelCase);
            });
        };

        const cloudData: any = {
            trades: await fetchTable('trades'),
            investments: await fetchTable('investments'),
            transactions: await fetchTable('transactions'),
            dividends: await fetchTable('dividends'),
            goals: await fetchTable('goals'),
            strategies: await fetchTable('strategies'),
            tax_records: await fetchTable('tax_records'),
            realized_transactions: await fetchTable('realized_transactions'),
            paper_trades: await fetchTable('paper_trades'),
            mistakes: await fetchTable('mistakes'),
            daily_reviews: await fetchTable('daily_reviews'),
            life_events: await fetchTable('life_events'),
            beneficiaries: await fetchTable('beneficiaries'),
            friends: await fetchTable('friends'),
        };

        return await buildSyncPreview(cloudData, 'Supabase');
    } catch (err: unknown) {
        logger.error('Failed to generate Supabase preview:', err);
        throw err;
    }
};

/**
 * Pulls all data from Supabase and overwrites local Dexie DB.
 * Similar to Nuclear Restore.
 */
export const pullFromCloud = async (userId: string): Promise<{ success: boolean; message: string }> => {
    try {
        logger.info('Starting full pull from Supabase Cloud...');

        // Helper to fetch table data
        const fetchTable = async (tableName: string) => {
            const { data, error } = await supabase.from(tableName).select('*').eq('user_id', userId);
            if (error) throw new Error(`Failed to fetch ${tableName}: ${error.message}`);
            // Remove user_id and created_at before saving locally to keep Dexie clean, and convert back to camelCase
            return (data || []).map((row: any) => {
                const { user_id, created_at, ...rest } = row;
                return convertKeys(rest, toCamelCase);
            });
        };

        const cloudData: any = {
            trades: await fetchTable('trades'),
            investments: await fetchTable('investments'),
            transactions: await fetchTable('transactions'),
            dividends: await fetchTable('dividends'),
            goals: await fetchTable('goals'),
            strategies: await fetchTable('strategies'),
            tax_records: await fetchTable('tax_records'),
            realized_transactions: await fetchTable('realized_transactions'),
            paper_trades: await fetchTable('paper_trades'),
            mistakes: await fetchTable('mistakes'),
            daily_reviews: await fetchTable('daily_reviews'),
            life_events: await fetchTable('life_events'),
            beneficiaries: await fetchTable('beneficiaries'),
            friends: await fetchTable('friends'),
        };

        // Nuclear replace local Dexie with Cloud Data
        await db.transaction('rw', db.tables, async () => {
            await Promise.all(db.tables.map(table => table.clear()));

            const tables = Object.keys(cloudData);
            for (const tableName of tables) {
                const rows = cloudData[tableName];
                const table = db.table(tableName);

                if (!table || !Array.isArray(rows) || rows.length === 0) continue;
                await table.bulkPut(rows);
            }
        });

        logger.info('Local database updated from cloud!');
        return { success: true, message: 'Data restored successfully from Supabase!' };

    } catch (err: unknown) {
        logger.error('Failed to pull from cloud:', err);
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message };
    }
};
