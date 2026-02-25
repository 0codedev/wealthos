import { logger } from '../Logger';

export interface WeatherDiagnostics {
  weather: 'sunny' | 'partly_cloudy' | 'rainy';
  icon: string; // "🌤" | "🌧" | "⛅"
  label: string;
  description: string;
  fiiNet: number;
  diiNet: number;
  combinedNet: number;
}

export class InstitutionalWeatherService {
  /**
   * Computes the daily institutional weather bias based on cash market net flows.
   */
  static computeWeather(fiiNet: number, diiNet: number, fiiFuturesNet: number = 0): WeatherDiagnostics {
    try {
      const combinedNet = fiiNet + diiNet;
      
      let weather: 'sunny' | 'partly_cloudy' | 'rainy' = 'partly_cloudy';
      let icon = '⛅';
      let label = 'Partly Cloudy';
      let description = 'Mixed institutional activity. Market in rotational and consolidation mode.';

      // Sunny criteria: strong net buying or positive FII cash + futures buying
      if (combinedNet > 1200 || (fiiNet > 500 && combinedNet > 0) || (fiiNet > 0 && fiiFuturesNet > 500)) {
        weather = 'sunny';
        icon = '🌤';
        label = 'Sunny (Institutional Support)';
        description = 'Strong institutional accumulation. High liquidity support from smart money.';
      }
      // Rainy criteria: strong net distribution or heavy FII cash selling
      else if (combinedNet < -1200 || (fiiNet < -500 && combinedNet < 0) || (fiiNet < -1000)) {
        weather = 'rainy';
        icon = '🌧';
        label = 'Rainy (Distribution Alert)';
        description = 'Heavy institutional liquidation. Risk of distribution and downward pressure.';
      }

      return {
        weather,
        icon,
        label,
        description,
        fiiNet,
        diiNet,
        combinedNet
      };
    } catch (err) {
      logger.error('Error computing institutional weather:', err);
      return {
        weather: 'partly_cloudy',
        icon: '⛅',
        label: 'Partly Cloudy',
        description: 'Failed to compute weather. Defaulting to neutral conditions.',
        fiiNet: 0,
        diiNet: 0,
        combinedNet: 0
      };
    }
  }
}
export default InstitutionalWeatherService;
