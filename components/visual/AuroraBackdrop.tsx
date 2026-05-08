import React from 'react';

interface AuroraBackdropProps {
  intensity?: 'low' | 'med' | 'high';
  className?: string;
}

export const AuroraBackdrop = React.memo<AuroraBackdropProps>(({
  intensity = 'med',
  className = '',
}) => (
  <div
    aria-hidden
    className={`aurora-static aurora-static--${intensity} ${className}`}
  />
));
AuroraBackdrop.displayName = 'AuroraBackdrop';

export default AuroraBackdrop;
