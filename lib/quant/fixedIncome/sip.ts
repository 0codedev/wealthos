/**
 * Calculates the future value of a Systematic Investment Plan (SIP).
 * 
 * @param monthlyInvestment - The amount invested each month in rupees.
 * @param expectedReturnsRate - The annualized expected rate of return in decimal (e.g., 0.12 for 12%).
 * @param years - Time period of investment in years.
 * @returns Total corpus, total invested, and estimated returns.
 */
export const calculateSIP = (monthlyInvestment: number, expectedReturnsRate: number, years: number) => {
    const months = years * 12;
    const monthlyRate = expectedReturnsRate / 12;

    // Formula: Future Value = P × ({[1 + i]^n - 1} / i) × (1 + i)
    // where P = regular investment, i = monthly interest rate, n = number of months
    
    let futureValue = 0;
    if (monthlyRate === 0) {
        futureValue = monthlyInvestment * months;
    } else {
        futureValue = monthlyInvestment * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
    }

    const totalInvested = monthlyInvestment * months;
    const estimatedReturns = futureValue - totalInvested;

    return {
        totalInvested,
        estimatedReturns,
        totalValue: futureValue
    };
};

/**
 * Calculates the future value of a Step-Up SIP (increasing investment automatically every year).
 * 
 * @param monthlyInvestment - Initial monthly investment in rupees.
 * @param stepUpPercentage - Annual increment in investment size (decimal, e.g., 0.10 for 10%).
 * @param expectedReturnsRate - The annualized expected rate of return in decimal (e.g., 0.12 for 12%).
 * @param years - Time period of investment in years.
 */
export const calculateStepUpSIP = (monthlyInvestment: number, stepUpPercentage: number, expectedReturnsRate: number, years: number) => {
    let currentMonthlyInvestment = monthlyInvestment;
    let totalInvested = 0;
    let futureValue = 0;
    const monthlyRate = expectedReturnsRate / 12;

    // Calculate year by year
    for (let year = 1; year <= years; year++) {
        // Accumulate future value of the investments made IN THIS YEAR over the REMAINING time
        // The investments made in year Y will compound for (years - Y + 1) years.
        // Wait, standard SIP formula applies to the stream of 12 payments for this year, 
        // which then compounds as a lump sum for the remaining (years - Y) years.
        
        let yearEndValue = currentMonthlyInvestment * ((Math.pow(1 + monthlyRate, 12) - 1) / monthlyRate) * (1 + monthlyRate);
        const remainingYears = years - year;
        const compoundedToMaturity = yearEndValue * Math.pow(1 + expectedReturnsRate, remainingYears);
        
        futureValue += compoundedToMaturity;
        totalInvested += currentMonthlyInvestment * 12;

        // Step up investment for next year
        currentMonthlyInvestment = currentMonthlyInvestment * (1 + stepUpPercentage);
    }

    return {
        totalInvested,
        estimatedReturns: futureValue - totalInvested,
        totalValue: futureValue
    };
};

/**
 * Calculates the monthly EMI for a loan.
 * 
 * @param principal - Total loan amount.
 * @param annualInterestRate - Annual interest rate (decimal, e.g., 0.085 for 8.5%).
 * @param years - Tenure of the loan in years.
 */
export const calculateEMI = (principal: number, annualInterestRate: number, years: number) => {
    const monthlyRate = annualInterestRate / 12;
    const months = years * 12;
    
    // Formula: EMI = P * r * (1+r)^n / ((1+r)^n - 1)
    let emi = 0;
    if (monthlyRate === 0) {
        emi = principal / months;
    } else {
        const factor = Math.pow(1 + monthlyRate, months);
        emi = principal * monthlyRate * factor / (factor - 1);
    }

    const totalPayment = emi * months;
    const totalInterest = totalPayment - principal;

    return {
        emi,
        totalPayment,
        totalInterest,
        principal
    };
};
