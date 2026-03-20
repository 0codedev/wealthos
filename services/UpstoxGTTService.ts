import { logger } from './Logger';

export interface GTTOrder {
  gtt_order_id: string;
  instrument_key: string;
  type: string;
  side: string;
  trigger_price: number;
  limit_price?: number;
  qty: number;
  status: string;
  created_at: string;
}

class UpstoxGTTService {
  async fetchGTTOrders(gttOrderId?: string): Promise<any> {
    try {
      const url = gttOrderId 
        ? `/api/python-nse/api/upstox/gtt?gtt_order_id=${encodeURIComponent(gttOrderId)}`
        : '/api/python-nse/api/upstox/gtt';
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to fetch GTT orders: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in fetchGTTOrders:', err);
      return null;
    }
  }

  async placeGTT(payload: any): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/gtt/place', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to place GTT order: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in placeGTT:', err);
      return null;
    }
  }

  async modifyGTT(payload: any): Promise<any> {
    try {
      const response = await fetch('/api/python-nse/api/upstox/gtt/modify', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to modify GTT order: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in modifyGTT:', err);
      return null;
    }
  }

  async cancelGTT(gttOrderId: string): Promise<any> {
    try {
      const response = await fetch(`/api/python-nse/api/upstox/gtt/cancel?gtt_order_id=${encodeURIComponent(gttOrderId)}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        return await response.json();
      }
      throw new Error(`Failed to cancel GTT order: ${response.statusText}`);
    } catch (err) {
      logger.error('Error in cancelGTT:', err);
      return null;
    }
  }
}

export const upstoxGTTService = new UpstoxGTTService();
