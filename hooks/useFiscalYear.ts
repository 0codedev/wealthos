
import { useState, useMemo, useEffect } from 'react';
import { getISTDate } from '../utils/helpers';

export interface FiscalYearInfo {
  startDate: Date;
  endDate: Date;
  label: string; // "FY 24-25"
}

export const useFiscalYear = () => {
  // Try to load last selected offset from session storage to persist across tab switches
  const [offset, setOffset] = useState(() => {
    if (typeof sessionStorage !== 'undefined') {
      const saved = sessionStorage.getItem('fy_offset');
      return saved ? parseInt(saved, 10) : 0;
    }
    return 0;
  });

  useEffect(() => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('fy_offset', offset.toString());
    }
  }, [offset]);

  const fyInfo: FiscalYearInfo = useMemo(() => {
    const today = getISTDate(); // Use IST for accurate tax deadline calculation
    const currentMonth = today.getMonth(); // 0-11
    const currentYear = today.getFullYear();

    // If Jan(0), Feb(1), Mar(2), the FY started in previous year
    // Example: March 2024 is part of FY 23-24. April 2024 is start of FY 24-25.
    const baseStartYear = currentMonth < 3 ? currentYear - 1 : currentYear;

    const startYear = baseStartYear + offset;
    const endYear = startYear + 1;

    // FY Starts April 1st
    const startDate = new Date(startYear, 3, 1);
    // FY Ends March 31st of next year
    const endDate = new Date(endYear, 2, 31, 23, 59, 59);

    const label = `FY ${String(startYear).slice(2)}-${String(endYear).slice(2)}`;

    return { startDate, endDate, label };
  }, [offset]);

  const prevYear = () => setOffset(o => o - 1);
  const nextYear = () => setOffset(o => o + 1);

  return {
    ...fyInfo,
    offset,
    setOffset,
    prevYear,
    nextYear
  };
};
