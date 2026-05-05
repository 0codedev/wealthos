import React from 'react';
import { motion, HTMLMotionProps, MotionProps } from 'framer-motion';
import { fadeRise, staggerParent, snappyLayout } from './variants';
import { useReducedMotion } from './useReducedMotion';

type IntrinsicTag = 'div' | 'span' | 'ul' | 'ol' | 'li' | 'section' | 'article' | 'header' | 'footer' | 'nav' | 'main' | 'aside';

// ──────────────────────────────────────────────────────────
// <Press> — tactile press feedback (scale on tap, lift on hover).
// Wraps any child element with a motion.div that handles the
// hover/tap micro-interaction. GPU-only (transform).
// ──────────────────────────────────────────────────────────

interface PressProps extends HTMLMotionProps<'div'> {
    children: React.ReactNode;
    /** Disable hover lift (e.g. for cards with their own hover styles). */
    noLift?: boolean;
    /** Scale amount on tap. Default 0.98. */
    pressScale?: number;
}

export const Press: React.FC<PressProps> = ({
    children, noLift, pressScale = 0.98, ...rest
}) => {
    const reduced = useReducedMotion();
    return (
        <motion.div
            whileHover={reduced || noLift ? undefined : { y: -1 }}
            whileTap={reduced ? undefined : { scale: pressScale }}
            transition={snappyLayout}
            {...rest}
        >
            {children}
        </motion.div>
    );
};

// ──────────────────────────────────────────────────────────
// <MotionButton> — drop-in <button> with subtle press feedback.
// All non-motion props forwarded.
// ──────────────────────────────────────────────────────────

type ButtonProps = Omit<HTMLMotionProps<'button'>, 'ref'> & {
    children?: React.ReactNode;
};

export const MotionButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ children, ...rest }, ref) => {
        const reduced = useReducedMotion();
        return (
            <motion.button
                ref={ref}
                whileTap={reduced ? undefined : { scale: 0.97 }}
                transition={snappyLayout}
                {...rest}
            >
                {children}
            </motion.button>
        );
    }
);
MotionButton.displayName = 'MotionButton';

// ──────────────────────────────────────────────────────────
// <StaggerList> / <StaggerItem> — pair for cascading children.
// Wrap your list in <StaggerList> and each child in <StaggerItem>.
// ──────────────────────────────────────────────────────────

interface StaggerListProps extends MotionProps {
    children: React.ReactNode;
    delay?: number;
    initialDelay?: number;
    className?: string;
    as?: IntrinsicTag;
}

export const StaggerList: React.FC<StaggerListProps> = ({
    children, delay = 0.04, initialDelay = 0, className, as = 'div', ...rest
}) => {
    const reduced = useReducedMotion();
    const Tag = motion[as as 'div'] as any;
    if (reduced) {
        const PlainTag = as as any;
        return <PlainTag className={className}>{children}</PlainTag>;
    }
    return (
        <Tag
            className={className}
            variants={staggerParent(delay, initialDelay)}
            initial="initial"
            animate="animate"
            exit="initial"
            {...rest}
        >
            {children}
        </Tag>
    );
};

interface StaggerItemProps extends MotionProps {
    children: React.ReactNode;
    className?: string;
    as?: IntrinsicTag;
}

export const StaggerItem: React.FC<StaggerItemProps> = ({
    children, className, as = 'div', ...rest
}) => {
    const reduced = useReducedMotion();
    const Tag = motion[as as 'div'] as any;
    if (reduced) {
        const PlainTag = as as any;
        return <PlainTag className={className}>{children}</PlainTag>;
    }
    return (
        <Tag className={className} variants={fadeRise} {...rest}>
            {children}
        </Tag>
    );
};
