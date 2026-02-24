import { auditTrail } from './SecurityService';

interface AdvisorAuditOptions {
    model: string;
    persona: string;
    hasImage?: boolean;
    includeAbsoluteValues?: boolean;
    promptLength?: number;
    responseLength?: number;
}

export const aiAuditService = {
    logAdvisorQuery(options: AdvisorAuditOptions) {
        auditTrail.log('advisor_query', 'Advisor query executed', {
            model: options.model,
            persona: options.persona,
            hasImage: !!options.hasImage,
            includeAbsoluteValues: !!options.includeAbsoluteValues,
            promptLength: options.promptLength || 0,
            responseLength: options.responseLength || 0,
        });
    },

    logAdvisorReport(options: AdvisorAuditOptions) {
        auditTrail.log('advisor_report_generated', 'Advisor audit report generated', {
            model: options.model,
            persona: options.persona,
            includeAbsoluteValues: !!options.includeAbsoluteValues,
            responseLength: options.responseLength || 0,
        });
    },

    logVoiceSession(options: Pick<AdvisorAuditOptions, 'model' | 'persona' | 'includeAbsoluteValues'>) {
        auditTrail.log('advisor_voice_session', 'Advisor voice session started', {
            model: options.model,
            persona: options.persona,
            includeAbsoluteValues: !!options.includeAbsoluteValues,
        });
    }
};
