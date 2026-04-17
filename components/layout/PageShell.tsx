import React from 'react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '../ui/motion/useReducedMotion';

interface PageShellProps {
  routeId: string;
  children: React.ReactNode;
}

/**
 * Persistent tab shell. The routeId key triggers a fade-only animation
 * on route change; no transform, no y-axis, no scale — so the new content
 * appears in place instead of sliding in from a fixed direction.
 */
export const PageShell = React.memo<PageShellProps>(({ routeId, children }) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      key={routeId}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: reduced ? 0 : 0.15, ease: 'easeOut' } }}
      className="w-full"
    >
      {children}
    </motion.div>
  );
});
PageShell.displayName = 'PageShell';

export default PageShell;
