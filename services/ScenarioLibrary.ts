export interface StressTestScenario {
  name: string;
  description: string;
  shocks: Record<string, number>; // Maps InvestmentType or sector tags to shock percentage (e.g. -0.15 means -15%)
}

export const SCENARIOS: Record<string, StressTestScenario> = {
  'India-Pakistan Escalation': {
    name: 'India-Pakistan Escalation',
    description: 'Geopolitical border tensions spike. Capital flights to safe havens, gold rallies, equities face panic selling.',
    shocks: {
      'Stocks': -0.15,
      'Mutual Fund': -0.12,
      'Smallcase': -0.15,
      'ETF': -0.12,
      'Digital Gold': 0.08,
      'Digital Silver': 0.05,
      'Fixed Deposit': 0.05,
      'Cash/Bank': 0.0,
      'Crypto': -0.10,
    },
  },
  'US Rate Hike Surprise': {
    name: 'US Rate Hike Surprise',
    description: 'Federal Reserve raises rates unexpectedly by 50bps. FII outflows trigger INR depreciation and IT sector selloff.',
    shocks: {
      'Stocks': -0.08,
      'Mutual Fund': -0.06,
      'Smallcase': -0.09,
      'ETF': -0.07,
      'Digital Gold': -0.04,
      'Fixed Deposit': -0.02,
      'Cash/Bank': 0.0,
      'Crypto': -0.15,
    },
  },
  'RBI Emergency Rate Cut': {
    name: 'RBI Emergency Rate Cut',
    description: 'RBI unexpectedly cuts repo rate by 50bps to stimulate growth. Massive rally in banking, real estate, and rate-sensitive stocks.',
    shocks: {
      'Stocks': 0.08,
      'Mutual Fund': 0.06,
      'Smallcase': 0.09,
      'ETF': 0.07,
      'Real Estate': 0.12,
      'Fixed Deposit': 0.03,
      'Cash/Bank': 0.0,
    },
  },
  'Global Market Crash (2008)': {
    name: 'Global Market Crash (2008)',
    description: 'Systemic liquidity crisis in global banking. Hyper-correlation sells off equities and cryptos; gold is the sole survivor.',
    shocks: {
      'Stocks': -0.45,
      'Mutual Fund': -0.38,
      'Smallcase': -0.42,
      'ETF': -0.38,
      'Digital Gold': 0.20,
      'Digital Silver': 0.15,
      'Crypto': -0.70,
      'Fixed Deposit': 0.05,
      'Real Estate': -0.25,
      'Cash/Bank': 0.0,
    },
  },
  'Monsoon Failure': {
    name: 'Monsoon Failure',
    description: 'Severe dry spell affects rural demand, driving inflation up. FMCG and agri stocks suffer from margin compression.',
    shocks: {
      'Stocks': -0.05,
      'Mutual Fund': -0.04,
      'Smallcase': -0.06,
      'ETF': -0.04,
      'Fixed Deposit': 0.01,
      'Cash/Bank': 0.0,
    },
  },
};

export default SCENARIOS;
