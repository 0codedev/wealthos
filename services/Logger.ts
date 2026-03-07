/**
 * Structured Logging Service
 * Centralizes logging logic to allow for filtering, formatting, and potential external shipping.
 */

// Define Log Levels
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

const CURRENT_LEVEL = import.meta.env.DEV ? LogLevel.DEBUG : LogLevel.INFO;

interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    data?: any;
    context?: string;
}

class LoggerService {
    private formatMessage(level: string, message: string, data?: any, context?: string): LogEntry {
        return {
            timestamp: new Date().toISOString(),
            level,
            message,
            data,
            context
        };
    }

    private sanitize(data: any): any {
        if (!data) return data;
        
        // SECURITY FIX: In production, we strictly limit what gets logged to the console.
        if (!import.meta.env.DEV) {
            if (typeof data === 'object') {
                return '[Redacted Data Object]';
            }
            if (typeof data === 'string') {
                // Redact things that look like session strings or keys
                if (data.length > 50 || /session|key|token|auth|password/i.test(data)) {
                    return '[Redacted Sensitive String]';
                }
            }
        }
        
        // Deep clone and sanitize nested objects if needed in dev
        try {
            const str = JSON.stringify(data);
            if (str.length > 5000) return '[Data too large for log]';
            
            // Redact common sensitive keys even in dev
            const sensitiveKeys = ['apiKey', 'api_key', 'accessToken', 'access_token', 'password', 'pin', 'session', 'secret'];
            let sanitizedStr = str;
            sensitiveKeys.forEach(key => {
                const regex = new RegExp(`("${key}":\\s*")[^"]+(")`, 'gi');
                sanitizedStr = sanitizedStr.replace(regex, '$1***REDACTED***$2');
            });
            
            return JSON.parse(sanitizedStr);
        } catch {
            return data;
        }
    }

    private print(level: LogLevel, entry: LogEntry) {
        if (level < CURRENT_LEVEL) return;

        const prefix = `[${entry.timestamp}] [${entry.level}]${entry.context ? ` [${entry.context}]` : ''}:`;
        const sanitizedData = this.sanitize(entry.data);

        switch (level) {
            case LogLevel.DEBUG:
                console.debug(prefix, entry.message, sanitizedData || '');
                break;
            case LogLevel.INFO:
                console.info(prefix, entry.message, sanitizedData || '');
                break;
            case LogLevel.WARN:
                console.warn(prefix, entry.message, sanitizedData || '');
                break;
            case LogLevel.ERROR:
                console.error(prefix, entry.message, sanitizedData || '');
                break;
        }
    }

    public debug(message: string, data?: any, context?: string) {
        this.print(LogLevel.DEBUG, this.formatMessage('DEBUG', message, data, context));
    }

    public info(message: string, data?: any, context?: string) {
        this.print(LogLevel.INFO, this.formatMessage('INFO', message, data, context));
    }

    public warn(message: string, data?: any, context?: string) {
        this.print(LogLevel.WARN, this.formatMessage('WARN', message, data, context));
    }

    public error(message: string, error?: any, context?: string) {
        this.print(LogLevel.ERROR, this.formatMessage('ERROR', message, error, context));
    }
}

export const logger = new LoggerService();
