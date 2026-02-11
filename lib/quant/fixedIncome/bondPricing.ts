/**
 * Algorithmic Fixed Income Engineering
 * Employs heavy Newton-Raphson mathematics to solve invisible fixed income attributes.
 */

export interface BondInputs {
    faceValue: number;      // e.g. 100 or 1000
    couponRate: number;     // Annual coupon rate parameter (decimal) -> 0.05 for 5%
    periods: number;        // Total number of periods to maturity (Years * frequency)
    freq?: number;          // Payments per year (1=Annual, 2=Semi, 4=Quarterly). Default = 1
    yieldPerYear?: number;  // Yield To Maturity (Annualized decimal)
    currentPrice?: number;  // Required to extract YTM
}

/**
 * Calculates Present Value (Dirty Price) of a standard fixed-rate bond holding until maturity.
 */
export const calculateBondPrice = (inputs: BondInputs): number => {
    const { faceValue, couponRate, periods, freq = 1, yieldPerYear = 0.05 } = inputs;
    
    const yieldPerPeriod = yieldPerYear / freq;
    const couponPerPeriod = (faceValue * couponRate) / freq;
    
    if (yieldPerPeriod === 0) return faceValue + (couponPerPeriod * periods);
    
    // PV of the uniform annuity (the coupons)
    const pvCoupons = couponPerPeriod * ((1 - Math.pow(1 + yieldPerPeriod, -periods)) / yieldPerPeriod);
    
    // PV of the face value final payout
    const pvFaceValue = faceValue * Math.pow(1 + yieldPerPeriod, -periods);
    
    return pvCoupons + pvFaceValue;
};

/**
 * Newton-Raphson iterative solver to extract Yield To Maturity (YTM) from a given secondary market Price.
 * The solver converges aggressively on the IRR of the bond cashflows.
 */
export const calculateYTM = (inputs: BondInputs): number => {
    const { faceValue, couponRate, periods, freq = 1, currentPrice } = inputs;
    if (!currentPrice || currentPrice <= 0) return 0;

    const couponPerPeriod = (faceValue * couponRate) / freq;
    
    // Initial guess: Current Yield
    let y = (couponRate * faceValue) / currentPrice; 
    let yOld = 0;
    
    const MAX_ITER = 100;
    const TOLERANCE = 1e-7;
    
    for (let i = 0; i < MAX_ITER; i++) {
        if (Math.abs(y - yOld) < TOLERANCE) break;
        yOld = y;
        
        // P(y) = PV of flows at yield y
        let priceIter = 0;
        // P'(y) = derivative of price w.r.t yield
        let dPriceIter = 0; 
        
        for (let t = 1; t <= periods; t++) {
            const cf = (t === periods) ? couponPerPeriod + faceValue : couponPerPeriod;
            const discountFactor = Math.pow(1 + y, -t);
            priceIter += cf * discountFactor;
            // Derivative: -t * CF * (1+y)^-(t+1)
            dPriceIter += -t * cf * Math.pow(1 + y, -(t + 1)); 
        }
        
        // Newton-Raphson update step: y_{n+1} = y_n - f(y_n)/f'(y_n)
        // Here, f(y) = P(y) - currentPrice
        const f_y = priceIter - currentPrice;
        y = y - (f_y / dPriceIter);
    }
    
    // The derived yield 'y' is per period. Annualize it:
    return y * freq;
};

/**
 * Calculates Macaulay Duration 
 * (weighted average time to receive cash flows, evaluating price sensitivity).
 */
export const calculateMacaulayDuration = (inputs: BondInputs): number => {
    const { faceValue, couponRate, periods, freq = 1, yieldPerYear = 0.05 } = inputs;
    
    const yieldPerPeriod = yieldPerYear / freq;
    const couponPerPeriod = (faceValue * couponRate) / freq;
    
    let wSum = 0;
    let npv = 0;
    
    for (let t = 1; t <= periods; t++) {
        const cf = (t === periods) ? couponPerPeriod + faceValue : couponPerPeriod;
        const pvt = cf * Math.pow(1 + yieldPerPeriod, -t);
        npv += pvt;
        wSum += t * pvt; // Weight the time 't'
    }
    
    if (npv === 0) return 0;
    
    // Macaulay Duration in *periods*
    const macD_periods = wSum / npv;
    
    // Convert to *years* by dividing by frequency
    return macD_periods / freq;
};

export const calculateModifiedDuration = (macD: number, yieldPerYear: number, freq: number = 1): number => {
    return macD / (1 + (yieldPerYear / freq));
};
