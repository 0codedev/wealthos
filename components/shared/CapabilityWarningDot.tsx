import React, { useEffect } from 'react';
import { useCapabilityStore, CapabilityName } from '../../store/capabilityStore';

interface CapabilityWarningDotProps {
  capability: CapabilityName;
  className?: string;
}

export const CapabilityWarningDot: React.FC<CapabilityWarningDotProps> = ({
  capability,
  className = '',
}) => {
  const cap = useCapabilityStore(state => state.capabilities[capability]);
  const checkAndNotifyDegraded = useCapabilityStore(state => state.checkAndNotifyDegraded);

  useEffect(() => {
    if (cap && cap.state !== 'available') {
      checkAndNotifyDegraded(capability);
    }
  }, [capability, cap?.state, checkAndNotifyDegraded]);

  if (!cap || cap.state === 'available') {
    return null;
  }

  const dotColor = cap.state === 'unavailable' ? 'bg-rose-500' : 'bg-amber-500';
  const stateLabel = cap.state === 'degraded' ? 'degraded' : cap.state === 'unavailable' ? 'unavailable' : 'demo-only';

  return (
    <span
      className={`w-1.5 h-1.5 rounded-full inline-block mx-1 animate-pulse shrink-0 cursor-help ${dotColor} ${className}`}
      title={`API Capability '${capability}' is ${stateLabel}.${cap.reason ? ` Reason: ${cap.reason}` : ''}`}
    />
  );
};
