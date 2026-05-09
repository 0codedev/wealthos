# Domain 136: Multi-Resolution Wavelet Denoising & Transient Trend Sieve (WP-AL)

**Executive Status**: 🟢 PRODUCTION DELIVERED & MATHEMATICALLY VERIFIED  
**Engine Service**: `python-bridge/services/wavelet_transient_trend_sieve.py`  
**Unit Tests**: `python-bridge/tests/test_wavelet_transient_trend_sieve.py` (5/5 Tests Passing in 0.03s)  
**Target Architecture**: WealthOS v2 Signal Processing & Microstructure Noise Decomposition Engine  
**Benchmark Model**: `opencode/space-bunny-free` / `nemotron-3.5-lightning-free` (`--variant max --thinking --auto`)

---

## 1. Executive Summary & Microstructure Noise Decomposition

Financial time series in high-frequency Indian equity derivatives (NIFTY and BANKNIFTY) are non-stationary, multi-scale, and heavily contaminated by high-frequency microstructure noise—such as bid-ask bounce, order queue flickers, and transient liquidity vacuums.

Conventional smoothing techniques suffer from critical failure modes:
1. **Linear Moving Averages (SMA, EMA)** introduce severe phase lag ($\tau_{\text{lag}} \approx \frac{N-1}{2}$), guaranteeing delayed entry during rapid market regime shifts.
2. **Standard Low-Pass Fourier Filters** assume periodic stationarity, smearing sharp market turning points across time (Gibbs phenomenon).
3. **Naive Breakout Systems** get repeatedly whipsawed by transient liquidity wicks (unfilled stops and fat-finger sweeps that reverse immediately).

The **Multi-Resolution Wavelet Denoising & Transient Trend Sieve** implements the **Discrete Wavelet Transform (DWT)** using an orthonormal Haar basis to perform multi-scale time-frequency localization. It estimates the true Gaussian noise floor $\hat{\sigma}$ using Donoho-Johnstone's robust **Median Absolute Deviation (MAD)** on detail coefficients, applies **VisuShrink soft thresholding** to isolate the true underlying low-frequency trend, and detects transient impulse shocks to filter false breakouts and trigger mean-reversion fade opportunities.

---

## 2. Mathematical Formulations & Wavelet Signal Processing

### 2.1 Discrete Wavelet Transform (Haar Basis)

Let the price sequence be $X = (x_0, x_1, \dots, x_{2N-1})$. A single-level orthogonal Haar decomposition splits the signal into approximation coefficients $a_k$ (low-frequency trend) and detail coefficients $d_k$ (high-frequency microstructure noise):
$$a_k = \frac{x_{2k} + x_{2k+1}}{\sqrt{2}}, \quad d_k = \frac{x_{2k} - x_{2k+1}}{\sqrt{2}}$$

Exact orthogonal reconstruction is given by the inverse transform:
$$x_{2k} = \frac{a_k + d_k}{\sqrt{2}}, \quad x_{2k+1} = \frac{a_k - d_k}{\sqrt{2}}$$

To preserve real-time recency and prevent artifact suppression on odd-length streaming buffers, the engine prepends the initial boundary condition $x_0$, pairing the most recent bar $x_{2N-1}$ directly with its immediate predecessor $x_{2N-2}$.

### 2.2 Donoho-Johnstone VisuShrink Universal Thresholding

In the presence of additive Gaussian microstructure noise $X_t = S_t + \sigma \epsilon_t$, the noise variance $\hat{\sigma}$ is estimated robustly from the detail coefficients $D = \{d_k\}$ via the Median Absolute Deviation (MAD), immune to large trend jumps:
$$\hat{\sigma} = \frac{\text{median}(|d_k - \text{median}(D)|)}{0.6745}$$
where the factor $0.6745 \approx \Phi^{-1}(0.75)$ calibrates the MAD to standard normal deviation.

The **Donoho-Johnstone Universal Threshold** $\lambda_{\text{univ}}$ guarantees asymptotic minimax optimality:
$$\lambda_{\text{univ}} = \hat{\sigma} \sqrt{2 \ln(M)}, \quad M = |D|$$

### 2.3 Soft-Thresholding Shrinkage Operator

Detail coefficients below the noise threshold are zeroed, while coefficients exceeding threshold are shrunk continuously toward zero to avoid discontinuous boundary steps:
$$\eta_{\text{soft}}(d_k, \lambda_{\text{univ}}) = \text{sign}(d_k) \max\left(|d_k| - \lambda_{\text{univ}}, 0\right)$$

Applying the inverse DWT to $a_k$ and $\eta_{\text{soft}}(d_k, \lambda_{\text{univ}})$ yields the **Denoised Trend** $\hat{S}_t$.

### 2.4 Microstructure Residual & Transient Shock Isolation

The high-frequency microstructure residual is:
$$\xi_t = S_t - \hat{S}_t$$

To distinguish a genuine structural trend expansion from a single-bar transient liquidity wick (stop hunt), the engine tests the latest detail innovation against the detail distribution:
$$\text{DetailOutlier}_t = |d_{\text{last}} - \text{median}(D)|$$

A **Transient Liquidity Shock** is registered if:
$$\text{DetailOutlier}_t \ge 3.0 \cdot \lambda_{\text{univ}}$$

When a shock occurs, the engine freezes the denoised trend baseline at the previous uncorrupted bar ($\hat{S}_t = \hat{S}_{t-1}$) and issues an immediate mean-reversion fade directive.  
Conversely, if $\text{DetailOutlier}_t < 3.0 \cdot \lambda_{\text{univ}}$ and the trend slope $|\text{Slope}| \ge 4.0\text{ bps/bar}$, a **Structural Trend** is confirmed.

---

## 3. Operational Regimes & Execution Directives

| Regime | Mathematical Criteria | Microstructure Interpretation | Quantitative Execution Directive |
|---|---|---|---|
| **TRANSIENT_NOISE_FADE (Overbought)** | $\text{DetailOutlier} \ge 3\lambda \land \xi_t > 0$ | Violent single-bar upside liquidity sweep; wick exhausted. | `FADE_OVERBOUGHT_SPIKE_SELL`: Short the spike; target pullback to denoised baseline $\hat{S}$. |
| **TRANSIENT_NOISE_FADE (Oversold)** | $\text{DetailOutlier} \ge 3\lambda \land \xi_t < 0$ | Violent single-bar downside sweep; stop-hunt exhaustion. | `FADE_OVERSOLD_SPIKE_BUY`: Long the spike; target bounce to denoised baseline $\hat{S}$. |
| **STRUCTURAL_TREND_BULL** | $\text{Slope} \ge +4.0\text{ bps/bar} \land \text{DetailOutlier} < 3\lambda$ | Smooth multi-scale low-frequency upward drift confirmed. | `TREND_FOLLOW_LONG`: Enter trend continuation; trail stops along $\hat{S}_t$. |
| **STRUCTURAL_TREND_BEAR** | $\text{Slope} \le -4.0\text{ bps/bar} \land \text{DetailOutlier} < 3\lambda$ | Smooth multi-scale low-frequency downward drift confirmed. | `TREND_FOLLOW_SHORT`: Enter trend continuation; trail stops along $\hat{S}_t$. |
| **STATIONARY_NOISE** | $|\text{Slope}| < 4.0\text{ bps/bar} \land \text{DetailOutlier} < 3\lambda$ | Flat range; microstructure noise dominant over trend. | `HOLD_NEUTRAL`: Halt directional trades; deploy mean-reversion market-making grids. |

---

## 4. Production Service Architecture & Code Integration

The complete production implementation is delivered in `python-bridge/services/wavelet_transient_trend_sieve.py`:
- Forward Haar DWT transform with odd-length recency-preserving boundary prepending.
- Inverse DWT reconstruction with exact length alignment.
- Fast median absolute deviation (MAD) noise variance estimation.
- Donoho-Johnstone VisuShrink soft thresholding.
- Real-time transient impulse outlier detection against median detail levels.
- Relational persistence to SQLite table `wavelet_trend_telemetry` for performance auditability.

---

## 5. Verification & Test Suite

The engine was fully validated against unit tests in `python-bridge/tests/test_wavelet_transient_trend_sieve.py`:
1. `test_haar_forward_inverse_exact_reconstruction`: Confirms lossless mathematical invertibility ($|x - \hat{x}| < 10^{-10}$).
2. `test_estimate_mad_sigma`: Confirms robust MAD noise scale estimation ($2.4 \le \hat{\sigma} \le 3.6$ on $\sigma = 3.0$ Gaussian noise).
3. `test_transient_shock_fade_regime`: Confirms detection of $+120$ pt transient flash spike, classification into `TRANSIENT_NOISE_FADE`, and emission of `FADE_OVERBOUGHT_SPIKE_SELL`.
4. `test_structural_bull_trend_regime`: Validates smooth persistent trend detection ($\text{Slope} \ge 4.0\text{ bps/bar}$), `STRUCTURAL_TREND_BULL` regime, and `TREND_FOLLOW_LONG` execution directive.
5. `test_sqlite_persistence`: Validates relational database insertion and telemetry retrieval.

**Execution Result**:
```
tests/test_wavelet_transient_trend_sieve.py::test_haar_forward_inverse_exact_reconstruction PASSED [ 20%]
tests/test_wavelet_transient_trend_sieve.py::test_estimate_mad_sigma PASSED [ 40%]
tests/test_wavelet_transient_trend_sieve.py::test_transient_shock_fade_regime PASSED [ 60%]
tests/test_wavelet_transient_trend_sieve.py::test_structural_bull_trend_regime PASSED [ 80%]
tests/test_wavelet_transient_trend_sieve.py::test_sqlite_persistence PASSED [100%]
5 passed in 0.03s
```
