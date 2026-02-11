/**
 * Standard Normal Probability Density Function (PDF)
 * N(z) = (1 / sqrt(2π)) * e^(-z^2 / 2)
 */
export const normalPdf = (z: number): number => {
    return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
};

/**
 * Standard Normal Cumulative Distribution Function (CDF)
 * Approximation using Abramowitz & Stegun
 * Max error < 7.5 * 10^-8
 */
export const normalCdf = (z: number): number => {
    const p = 0.2316419;
    const b1 = 0.319381530;
    const b2 = -0.356563782;
    const b3 = 1.781477937;
    const b4 = -1.821255978;
    const b5 = 1.330274429;

    const t = 1 / (1 + p * Math.abs(z));
    const z2 = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

    const prob = 1 - z2 * (b1 * t + b2 * t * t + b3 * Math.pow(t, 3) + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));

    return z > 0 ? prob : 1 - prob;
};

/**
 * Normal PDF for a given mean and standard deviation
 */
export const pdf = (x: number, mean: number = 0, stdDev: number = 1): number => {
    const z = (x - mean) / stdDev;
    return normalPdf(z) / stdDev;
};

/**
 * Normal CDF for a given mean and standard deviation
 */
export const cdf = (x: number, mean: number = 0, stdDev: number = 1): number => {
    const z = (x - mean) / stdDev;
    return normalCdf(z);
};

/**
 * Inverse Standard Normal CDF (Quantile Function)
 * Beasley-Springer-Moro Approximation
 * Given a probability p (0 < p < 1), returns the corresponding z-score
 */
export const inverseNormalCDF = (p: number): number => {
    if (p <= 0 || p >= 1) {
        throw new Error("Probability must be strictly between 0 and 1");
    }
    
    // Constants for the Moro approximation
    const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
    const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833];
    const c = [
        0.3374754822726147, 0.9761690190917186, 0.1607979714918209,
        0.0276436814981974, 0.0038405729373609, 0.0003951896511919,
        0.0000321767881768, 0.0000002888167364, 0.0000003960315187
    ];

    const y = p - 0.5;
    if (Math.abs(y) < 0.42) {
        const r = y * y;
        return y * (((a[3] * r + a[2]) * r + a[1]) * r + a[0]) / ((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r + 1);
    } else {
        let r = p;
        if (y > 0) r = 1 - p;
        r = Math.log(-Math.log(r));
        let x = c[0] + r * (c[1] + r * (c[2] + r * (c[3] + r * (c[4] + r * (c[5] + r * (c[6] + r * (c[7] + r * c[8])))))));
        if (y < 0) x = -x;
        return x;
    }
};

/**
 * Calculates factorial n!
 */
const factorial = (n: number): number => {
    if (n < 0) return 0;
    if (n === 0 || n === 1) return 1;
    let res = 1;
    for (let i = 2; i <= n; i++) res *= i;
    return res;
};

/**
 * Calculates nCr (Combinations)
 */
const combinations = (n: number, r: number): number => {
    if (r < 0 || r > n) return 0;
    if (r === 0 || r === n) return 1;
    if (r > n / 2) r = n - r; 
    let res = 1;
    for (let i = 1; i <= r; i++) {
        res = res * (n - i + 1) / i;
    }
    return Math.round(res);
};

/**
 * Binomial Probability Mass Function (PMF)
 * P(X = k) = nCr * p^k * (1-p)^(n-k)
 */
export const binomialPMF = (n: number, k: number, p: number): number => {
    if (k < 0 || k > n || p < 0 || p > 1) return 0;
    const c = combinations(n, k);
    return c * Math.pow(p, k) * Math.pow(1 - p, n - k);
};

/**
 * Binomial Cumulative Distribution Function (CDF)
 * P(X <= k)
 */
export const binomialCDF = (n: number, k: number, p: number): number => {
    let sum = 0;
    for (let i = 0; i <= k; i++) {
        sum += binomialPMF(n, i, p);
    }
    return sum;
};

/**
 * Poisson Probability Mass Function (PMF)
 */
export const poissonPMF = (lambda: number, k: number): number => {
    if (k < 0 || lambda < 0) return 0;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
};
