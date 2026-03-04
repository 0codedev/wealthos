/**
 * Google Drive Sync Service
 * 
 * Provides OAuth authentication and file operations for syncing
 * wealth aggregator data to Google Drive.
 * 
 * Uses Google Identity Services (GIS) for authentication.
 */

// Google API configuration - will be set from settings
let CLIENT_ID = '';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FILENAME = 'WealthAggregator_Backup.json';
const BACKUP_FOLDER = 'WealthAggregator';

// State
let accessToken: string | null = null;
let tokenClient: any = null;
let isInitialized = false;

/**
 * Initialize the Google Drive service with client ID
 */
export const initGoogleDrive = (clientId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (!clientId) {
            reject(new Error('Google Drive Client ID is required'));
            return;
        }

        CLIENT_ID = clientId;

        // Check if Google Identity Services script is loaded
        if (typeof google === 'undefined' || !google.accounts) {
            // Load the script dynamically
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => {
                initTokenClient();
                isInitialized = true;
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
            document.head.appendChild(script);
        } else {
            initTokenClient();
            isInitialized = true;
            resolve();
        }
    });
};

/**
 * Initialize the OAuth token client
 */
const initTokenClient = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response: any) => {
            if (response.error) {
                console.error('OAuth Error:', response.error);
                accessToken = null;
            } else {
                accessToken = response.access_token;
            }
        },
    });
};

/**
 * Sign in to Google and get access token
 */
export const signInToGoogle = (): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (!isInitialized || !tokenClient) {
            reject(new Error('Google Drive not initialized. Call initGoogleDrive first.'));
            return;
        }

        // Set up callback to resolve promise
        tokenClient.callback = (response: any) => {
            if (response.error) {
                reject(new Error(response.error));
            } else {
                accessToken = response.access_token;
                if (accessToken) {
                    resolve(accessToken);
                } else {
                    reject(new Error('No access token received'));
                }
            }
        };

        // Request access token - this opens the Google sign-in popup
        tokenClient.requestAccessToken({ prompt: 'consent' });
    });
};

/**
 * Sign out and revoke access
 */
export const signOutFromGoogle = (): void => {
    if (accessToken) {
        google.accounts.oauth2.revoke(accessToken, () => {
            accessToken = null;
            if (import.meta.env.DEV) console.log('Signed out from Google Drive');
        });
    }
};

/**
 * Check if user is signed in
 */
export const isSignedIn = (): boolean => {
    return accessToken !== null;
};

/**
 * Get or create the backup folder in Google Drive
 */
const getOrCreateBackupFolder = async (): Promise<string> => {
    // Search for existing folder
    const searchResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${BACKUP_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        }
    );

    const searchResult = await searchResponse.json();

    if (searchResult.files && searchResult.files.length > 0) {
        return searchResult.files[0].id;
    }

    // Create new folder
    const createResponse = await fetch(
        'https://www.googleapis.com/drive/v3/files',
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: BACKUP_FOLDER,
                mimeType: 'application/vnd.google-apps.folder',
            }),
        }
    );

    const folder = await createResponse.json();
    return folder.id;
};

/**
 * Upload backup data to Google Drive
 */
export const uploadBackupToDrive = async (data: object): Promise<{ success: boolean; message: string }> => {
    if (!accessToken) {
        return { success: false, message: 'Not signed in to Google Drive' };
    }

    try {
        const folderId = await getOrCreateBackupFolder();

        // Check if backup file already exists
        const searchResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name='${BACKUP_FILENAME}' and '${folderId}' in parents and trashed=false`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            }
        );

        const searchResult = await searchResponse.json();
        const existingFileId = searchResult.files?.[0]?.id;

        // Prepare the file content
        const fileContent = JSON.stringify(data, null, 2);
        const blob = new Blob([fileContent], { type: 'application/json' });

        // Create multipart request
        const metadata = {
            name: BACKUP_FILENAME,
            mimeType: 'application/json',
            parents: existingFileId ? undefined : [folderId],
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', blob);

        let uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        let method = 'POST';

        if (existingFileId) {
            // Update existing file
            uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`;
            method = 'PATCH';
        }

        const response = await fetch(uploadUrl, {
            method,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
            body: form,
        });

        if (response.ok) {
            return {
                success: true,
                message: `Backup synced to Google Drive at ${new Date().toLocaleTimeString()}`
            };
        } else {
            const error = await response.json();
            return { success: false, message: error.error?.message || 'Upload failed' };
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message };
    }
};

/**
 * Download backup data from Google Drive
 */
export const downloadBackupFromDrive = async (): Promise<{ success: boolean; data?: object; message: string }> => {
    if (!accessToken) {
        return { success: false, message: 'Not signed in to Google Drive' };
    }

    try {
        const folderId = await getOrCreateBackupFolder();

        // Search for backup file
        const searchResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name='${BACKUP_FILENAME}' and '${folderId}' in parents and trashed=false`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            }
        );

        const searchResult = await searchResponse.json();

        if (!searchResult.files || searchResult.files.length === 0) {
            return { success: false, message: 'No backup found in Google Drive' };
        }

        const fileId = searchResult.files[0].id;

        // Download file content
        const downloadResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            }
        );

        if (downloadResponse.ok) {
            const data = await downloadResponse.json();
            return {
                success: true,
                data,
                message: 'Backup downloaded from Google Drive'
            };
        } else {
            return { success: false, message: 'Failed to download backup' };
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, message };
    }
};

/**
 * Get info about the last backup in Drive
 */
export const getLastBackupInfo = async (): Promise<{ exists: boolean; modifiedTime?: string }> => {
    if (!accessToken) {
        return { exists: false };
    }

    try {
        const folderId = await getOrCreateBackupFolder();

        const searchResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=name='${BACKUP_FILENAME}' and '${folderId}' in parents and trashed=false&fields=files(id,modifiedTime)`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            }
        );

        const searchResult = await searchResponse.json();

        if (searchResult.files && searchResult.files.length > 0) {
            return {
                exists: true,
                modifiedTime: searchResult.files[0].modifiedTime
            };
        }

        return { exists: false };
    } catch {
        return { exists: false };
    }
};

// Type declarations for Google Identity Services
declare const google: {
    accounts: {
        oauth2: {
            initTokenClient: (config: any) => any;
            revoke: (token: string, callback: () => void) => void;
        };
    };
};
