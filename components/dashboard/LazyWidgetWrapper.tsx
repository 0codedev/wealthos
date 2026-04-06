import React, { useRef, useState, useEffect, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springTransition } from '../ui/animations';

interface LazyWidgetWrapperProps {
    children: ReactNode;
    minHeight?: string;
    placeholder?: ReactNode;
}

export const LazyWidgetWrapper: React.FC<LazyWidgetWrapperProps> = ({ children, minHeight = '320px', placeholder }) => {
    const [isVisible, setIsVisible] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    if (containerRef.current) observer.unobserve(containerRef.current);
                }
            },
            {
                // Trigger load when within 400px of viewport
                rootMargin: '400px',
                threshold: 0.01,
            }
        );

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        return () => {
            if (containerRef.current) observer.unobserve(containerRef.current);
        };
    }, []);

    return (
        <div ref={containerRef} style={!isVisible ? { minHeight } : undefined} className="h-full w-full">
            <AnimatePresence>
                {isVisible ? (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="h-full w-full"
                    >
                        {children}
                    </motion.div>
                ) : (
                    <motion.div
                        initial={{ opacity: 0.6 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="h-full w-full"
                    >
                        {placeholder}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
