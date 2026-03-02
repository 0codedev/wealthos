import { dhanBrokerService } from './DhanBrokerService';

class DhanAuthService {
    isConfigured() {
        return dhanBrokerService.isConfigured();
    }

    testConnection() {
        return dhanBrokerService.testConnection();
    }
}

export const dhanAuthService = new DhanAuthService();
