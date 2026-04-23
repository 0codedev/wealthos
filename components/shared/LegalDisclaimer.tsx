import React from 'react';
import { ShieldAlert, Info, Scale, AlertTriangle } from 'lucide-react';

export type DisclaimerVariant = 'sebi' | 'simulation' | 'reference' | 'risk' | 'advisory';

interface LegalDisclaimerProps {
    /** Which disclaimer style to render. */
    variant?: DisclaimerVariant;
    /** Override the default body text. */
    text?: string;
    /** Render compact (1 line) or full (multi-line) layout. */
    compact?: boolean;
    /** Optional className for layout positioning. */
    className?: string;
}

const PRESETS: Record<DisclaimerVariant, { icon: React.ReactNode; text: string; label: string }> = {
    sebi: {
        icon: <ShieldAlert size={12} className="legal-icon" />,
        label: 'SEBI',
        text: 'SEBI Compliance: Suggestions are based on quantitative models. This is not financial advice. Past performance does not guarantee future results.',
    },
    simulation: {
        icon: <Info size={12} className="legal-icon" />,
        label: 'Simulation',
        text: 'Projections use Monte Carlo and historical data. Actual market behaviour may differ. Use outputs as one of many decision inputs.',
    },
    reference: {
        icon: <Scale size={12} className="legal-icon" />,
        label: 'Reference Only',
        text: 'This is an auto-generated report for reference only. Verify all figures against your broker statement before acting.',
    },
    risk: {
        icon: <AlertTriangle size={12} className="legal-icon" />,
        label: 'Risk',
        text: 'Investments in equities, derivatives and IPOs carry market and liquidity risk. Read the offer document carefully before subscribing.',
    },
    advisory: {
        icon: <ShieldAlert size={12} className="legal-icon" />,
        label: 'Advisory',
        text: 'No content on this dashboard constitutes personalised investment advice. Please consult a SEBI-registered investment advisor for tailored recommendations.',
    },
};

export const LegalDisclaimer: React.FC<LegalDisclaimerProps> = ({
    variant = 'sebi',
    text,
    compact = false,
    className = '',
}) => {
    const preset = PRESETS[variant];
    const body = text || preset.text;

    return (
        <div
            role="note"
            aria-label={`${preset.label} disclaimer`}
            className={`legal-disclaimer ${compact ? 'mt-2' : 'mt-3'} ${className}`}
        >
            {preset.icon}
            <span className="flex-1">
                <span className="font-bold uppercase tracking-wider mr-1 text-[10px] opacity-90">
                    {preset.label}:
                </span>
                {body}
            </span>
        </div>
    );
};

export default LegalDisclaimer;
