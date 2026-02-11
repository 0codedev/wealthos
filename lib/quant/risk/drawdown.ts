/**
 * Drawdown Analysis Engine
 */

export interface DrawdownMetrics {
    peak: number;
    trough: number;
    currentDrawdown: number;
    maxDrawdown: number;
    underwaterCurve: number[];
}

/**
 * Calculates Maximum Drawdown and the underwater equity curve.
 * 
 * @param equityCurve Array of portfolio values over time
 */
export const calculateDrawdowns = (equityCurve: number[]): DrawdownMetrics => {
    let peak = 0;
    let maxDrawdown = 0;
    let trough = 0;
    const underwaterCurve: number[] = [];
    
    // Find initial conditions if array has items
    if (equityCurve.length > 0) {
        peak = equityCurve[0];
        trough = equityCurve[0];
    }
    
    for (const value of equityCurve) {
        // Update peak
        if (value > peak) {
            peak = value;
        }
        
        // Calculate current drawdown percentage map below peak
        const currentDrawdown = peak === 0 ? 0 : (peak - value) / peak;
        underwaterCurve.push(currentDrawdown * 100); // Push percentage
        
        // Track the worst drawdown
        if (currentDrawdown > maxDrawdown) {
            maxDrawdown = currentDrawdown;
            trough = value;
        }
    }
    
    // Current live drawdown is the last element
    const currentDrawdownLive = underwaterCurve.length > 0 
        ? underwaterCurve[underwaterCurve.length - 1] 
        : 0;
        
    return {
        peak,
        trough,
        currentDrawdown: currentDrawdownLive,
        maxDrawdown: maxDrawdown * 100,
        underwaterCurve
    };
};
