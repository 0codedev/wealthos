import { logger } from './Logger';

class UpstoxAccountService {
  async fetchUserProfile(): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/user/profile');
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch user profile: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchUserProfile:', err);
      return null;
    }
  }

  async fetchFunds(segment?: string): Promise<any> {
    try {
      const url = segment 
        ? `/api/python-nse/api/upstox/user/funds?segment=${encodeURIComponent(segment)}`
        : '/api/python-nse/api/upstox/user/funds';
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch funds: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchFunds:', err);
      return null;
    }
  }

  async fetchFundsV3(segment?: string): Promise<any> {
    try {
      const url = segment 
        ? `/api/python-nse/api/upstox/user/funds-v3?segment=${encodeURIComponent(segment)}`
        : '/api/python-nse/api/upstox/user/funds-v3';
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch funds V3: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchFundsV3:', err);
      return null;
    }
  }

  async fetchHoldings(): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/user/holdings');
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch holdings: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchHoldings:', err);
      return null;
    }
  }

  async fetchPositions(): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/user/positions');
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch positions: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchPositions:', err);
      return null;
    }
  }

  async fetchMtfPositions(): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/user/mtf-positions');
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch MTF positions: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchMtfPositions:', err);
      return null;
    }
  }

  async fetchKillSwitchStatus(): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/user/kill-switch');
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch kill switch status: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchKillSwitchStatus:', err);
      return null;
    }
  }

  async toggleKillSwitch(status: 'activate' | 'deactivate'): Promise<any> {
    try {
      const response = await fetch(`/api/python-nse/api/upstox/user/kill-switch?kill_switch_status=${status}`, {
        method: 'POST'
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to toggle kill switch to ${status}: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in toggleKillSwitch:', err);
      return null;
    }
  }

  async fetchIpWhitelist(): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/user/ip');
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch IP whitelist: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchIpWhitelist:', err);
      return null;
    }
  }

  async updateIpWhitelist(ips: string[]): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/user/ip', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ip: ips })
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to update IP whitelist: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in updateIpWhitelist:', err);
      return null;
    }
  }

  // --- Phase 4: Trade P&L Mining ---
  async fetchPnLMetadata(): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/trade/pnl/metadata');
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch P&L metadata: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchPnLMetadata:', err);
      return null;
    }
  }

  async fetchPnLData(segment: string, financialYear: string, pageNumber: number = 1, pageSize: number = 50): Promise<any> {
    try {
      const response = await fetch(`/api/python-nse/api/upstox/trade/pnl/data?segment=${encodeURIComponent(segment)}&financial_year=${encodeURIComponent(financialYear)}&page_number=${pageNumber}&page_size=${pageSize}`);
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch P&L data: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchPnLData:', err);
      return null;
    }
  }

  async fetchPnLCharges(segment: string, financialYear: string, pageNumber: number = 1, pageSize: number = 50): Promise<any> {
    try {
      const response = await fetch(`/api/python-nse/api/upstox/trade/pnl/charges?segment=${encodeURIComponent(segment)}&financial_year=${encodeURIComponent(financialYear)}&page_number=${pageNumber}&page_size=${pageSize}`);
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch P&L charges: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchPnLCharges:', err);
      return null;
    }
  }
}

export const upstoxAccountService = new UpstoxAccountService();
