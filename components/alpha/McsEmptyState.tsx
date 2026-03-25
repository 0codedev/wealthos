// components/alpha/McsEmptyState.tsx
// Thin wrapper around the established <EmptyState type="mce"> from CC57/CC96.

import React from 'react';
import { EmptyState } from '../shared/EmptyState';

export const McsEmptyState: React.FC = () => (
  <EmptyState type="mce" variant="card" />
);