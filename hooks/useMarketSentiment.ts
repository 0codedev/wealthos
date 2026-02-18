import { useState, useEffect, useMemo } from 'react';
import { marketDataService } from '../services/MarketDataService';
import { bootCoordinator, BootLane } from '../lib/bootCoordinator';

export type MarketStatus = 'NORMAL' | 'AMBER' | 'RED' | 'PRE_MARKET' | 'POST_MARKET' | 'CLOSED';

interface MarketSentiment {
  vix: number;
  status: MarketStatus;
  isMarketOpen: boolean;
  marketMessage: string;
  nextEvent: string;
  fiiDiiNet: number;
}

// India Market Hours (IST)
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 15;
const MARKET_CLOSE_HOUR = 15;
const MARKET_CLOSE_MINUTE = 30;
const PRE_MARKET_START_HOUR = 9;
const PRE_MARKET_START_MINUTE = 0;

// Check if today is a trading day (Mon-Fri, excluding holidays)
const isTradingDay = (date: Date): boolean => {
  const day = date.getDay();
  // Weekend check
  if (day === 0 || day === 6) return false;

  // Major Indian market holidays 2024-2025 (simplified)
  const holidays = [
    '2024-12-25', // Christmas
    '2025-01-26', // Republic Day
    '2025-03-14', // Holi
    '2025-04-14', // Ambedkar Jayanti
    '2025-08-15', // Independence Day
    '2025-10-02', // Gandhi Jayanti
    '2025-11-04', // Diwali (approx)
  ];

  const dateStr = date.toISOString().split('T')[0];
  return !holidays.includes(dateStr);
};

// Get market status based on current time
const getMarketStatus = (date: Date): { isOpen: boolean; phase: string } => {
  const hour = date.getHours();
  const minute = date.getMinutes();
  const currentTime = hour * 60 + minute;

  const preMarketStart = PRE_MARKET_START_HOUR * 60 + PRE_MARKET_START_MINUTE;
  const marketOpen = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const marketClose = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;

  if (!isTradingDay(date)) {
    return { isOpen: false, phase: 'Weekend/Holiday' };
  }

  if (currentTime < preMarketStart) {
    return { isOpen: false, phase: 'Pre-market' };
  } else if (currentTime < marketOpen) {
    return { isOpen: false, phase: 'Pre-market session' };
  } else if (currentTime < marketClose) {
    return { isOpen: true, phase: 'Market Open' };
  } else {
    return { isOpen: false, phase: 'After hours' };
  }
};

// Calculate next market event
const getNextMarketEvent = (date: Date): string => {
  const { isOpen, phase } = getMarketStatus(date);
  const hour = date.getHours();
  const minute = date.getMinutes();

  if (!isTradingDay(date)) {
    // Find next trading day
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    while (!isTradingDay(nextDay)) {
      nextDay.setDate(nextDay.getDate() + 1);
    }
    return `Market opens ${nextDay.toLocaleDateString('en-IN', { weekday: 'short' })} 9:15 AM`;
  }

  if (isOpen) {
    const closeHour = MARKET_CLOSE_HOUR;
    const closeMinute = MARKET_CLOSE_MINUTE;
    const hoursLeft = closeHour - hour - (minute > closeMinute ? 1 : 0);
    const minsLeft = (closeMinute - minute + 60) % 60;
    return `Closes in ${hoursLeft}h ${minsLeft}m`;
  } else if (phase === 'Pre-market' || phase === 'Pre-market session') {
    return `Opens at 9:15 AM`;
  } else {
    return `Closed for today`;
  }
};

export const useMarketSentiment = (): MarketSentiment => {
  const [vix, setVix] = useState<number>(15.5);
  const [fiiDiiNet, setFiiDiiNet] = useState<number>(0);
  const [status, setStatus] = useState<MarketStatus>('NORMAL');

  useEffect(() => {
    let isMounted = true;

    const updateSentiment = async () => {
      const now = new Date();
      const { isOpen, phase } = getMarketStatus(now);

      let currentVix = 15.5;
      try {
        const { macro } = await marketDataService.fetchMacroAndGlobal();
        const vixIndicator = macro.find(m => m.id === 'indiavix');
        if (vixIndicator) currentVix = vixIndicator.value;
      } catch (err) {
        console.warn('Failed to fetch real VIX for sentiment analysis', err);
      }

      if (!isMounted) return;

      setVix(parseFloat(currentVix.toFixed(2)));

      try {
        const fiiData = await marketDataService.fetchFiiDiiData();
        if (fiiData && fiiData.length > 0) {
            // Get net of latest record
            const latest = fiiData[0];
            setFiiDiiNet((latest.fii || 0) + (latest.dii || 0));
        }
      } catch (err) {
          console.warn('Failed to fetch FII/DII data', err);
      }

      // Determine status based on VIX and market state
      if (!isOpen) {
        if (phase === 'Weekend/Holiday') {
          setStatus('CLOSED');
        } else if (phase.includes('Pre-market')) {
          setStatus('PRE_MARKET');
        } else {
          setStatus('POST_MARKET');
        }
      } else {
        // Market is open - use VIX to determine sentiment
        if (currentVix > 28) {
          setStatus('RED');
        } else if (currentVix > 20) {
          setStatus('AMBER');
        } else {
          setStatus('NORMAL');
        }
      }
    };

    // Initial update scheduled in WARM lane (P2) to avoid blocking shell boot
    bootCoordinator.schedule(BootLane.P2_WARM, () => {
      if (isMounted) {
        updateSentiment();
      }
    });

    // Update every 5 minutes (reduced frequency to save API quota)
    const interval = setInterval(updateSentiment, 5 * 60000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const sentiment = useMemo((): MarketSentiment => {
    const now = new Date();
    const { isOpen } = getMarketStatus(now);

    let message = '';
    switch (status) {
      case 'RED':
        message = 'High Volatility - Exercise caution';
        break;
      case 'AMBER':
        message = 'Elevated Volatility';
        break;
      case 'NORMAL':
        message = 'Markets stable';
        break;
      case 'CLOSED':
        message = 'Markets closed';
        break;
      case 'PRE_MARKET':
        message = 'Pre-market session';
        break;
      case 'POST_MARKET':
        message = 'After hours';
        break;
    }

    return {
      vix,
      status,
      isMarketOpen: isOpen,
      marketMessage: message,
      nextEvent: getNextMarketEvent(now),
      fiiDiiNet
    };
  }, [vix, status, fiiDiiNet]);

  return sentiment;
};
