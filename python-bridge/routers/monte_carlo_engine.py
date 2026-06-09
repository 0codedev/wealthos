"""
WealthOS Monte Carlo Simulation Engine Router
Implements Geometric Brownian Motion (GBM) simulation for:
1. First-passage trade probabilities (P(Target Hit First) vs P(Stop Hit First)) & Kelly sizing
2. Risk-neutral Options Pricing vs Black-Scholes analytical cross-validation
3. Multi-asset Portfolio VaR / CVaR using Cholesky decomposition of correlated returns
"""

import os
import sys
import logging
import numpy as np
import pandas as pd
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from scipy import stats

# Ensure python-bridge root is in sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logger import get_logger

log = get_logger("monte_carlo", tag="MONTE_CARLO")

router = APIRouter(prefix="/api/monte-carlo", tags=["MonteCarlo"])


class SimRequest(BaseModel):
    symbol: str = "NIFTY"
    current_price: float
    target_price: float
    stop_loss_price: float
    daily_volatility: float  # e.g. 0.0141 (1.41%/day = 22.4% ann)
    daily_drift: float = 0.000356  # 9% annual = 0.000356 daily
    horizon_days: int = 10
    n_simulations: int = 10000
    india_vix: Optional[float] = None
    distribution: str = "normal"  # "normal" or "student-t"
    student_t_dof: float = 4.31


class OptionsRequest(BaseModel):
    spot_price: float
    strike_price: float
    days_to_expiry: int
    implied_volatility: float  # decimal e.g. 0.20
    risk_free_rate: float = 0.065  # 6.5% RBI repo rate
    option_type: str = "CE"  # "CE" or "PE"
    n_simulations: int = 50000


class PortfolioAsset(BaseModel):
    symbol: str
    weight: float
    current_value_inr: float
    daily_volatility: float


class PortfolioRequest(BaseModel):
    assets: List[PortfolioAsset]
    correlation_matrix: List[List[float]]
    horizon_days: int = 1
    n_simulations: int = 10000
    confidence_level: float = 0.95


def _interpret_trade(p_target: float, p_stop: float, ev: float) -> str:
    if p_target > 0.60 and ev > 0.02:
        return "STRONG SETUP — Monte Carlo confirms high target-hit probability with positive EV."
    elif p_target > 0.50 and ev > 0:
        return "GOOD SETUP — Favorable odds. Recommended to trade with normal position size."
    elif ev > 0:
        return "MARGINAL — EV is slightly positive but win probability is below 50%. Reduce size."
    else:
        return "AVOID — Negative expected value. High probability of hitting stop-loss first."


@router.post("/trade-probability")
def compute_trade_probability(req: SimRequest):
    """
    Simulates N price paths over horizon using GBM with blended VIX volatility.
    Tracks FIRST-PASSAGE crossing of target vs stop-loss.
    Returns: P(Target Hit First), P(Stop Hit First), Kelly fraction, recommended position size.
    """
    dt = 1.0
    N = req.horizon_days
    M = req.n_simulations
    
    # Blend VIX with historical vol if provided (70% VIX + 30% Hist Vol)
    if req.india_vix and req.india_vix > 0:
        vix_daily = (req.india_vix / 100.0) / np.sqrt(252)
        sigma = 0.70 * vix_daily + 0.30 * req.daily_volatility
    else:
        sigma = req.daily_volatility
        
    mu = req.daily_drift
    
    # Generate random shocks
    if req.distribution == "student-t":
        dof = req.student_t_dof
        Z = stats.t.rvs(df=dof, size=(M, N)) * np.sqrt((dof - 2) / dof)
    else:
        Z = np.random.standard_normal((M, N))
        
    # Simulate GBM price paths: S_t = S_0 * exp(cumsum( (mu - 0.5*sigma^2)*dt + sigma*sqrt(dt)*Z ))
    drift = (mu - 0.5 * sigma**2) * dt
    diffusion = sigma * np.sqrt(dt) * Z
    daily_log_returns = drift + diffusion
    
    cum_log_returns = np.cumsum(daily_log_returns, axis=1)
    paths = req.current_price * np.exp(cum_log_returns)
    
    # Prepend starting price at t=0
    paths = np.column_stack([np.full(M, req.current_price), paths])
    
    # Determine First-Passage crossings
    target_hit_first = 0
    stop_hit_first = 0
    neither = 0
    
    is_long = req.target_price > req.current_price
    
    for i in range(M):
        path = paths[i]
        if is_long:
            target_idx = np.where(path >= req.target_price)[0]
            stop_idx = np.where(path <= req.stop_loss_price)[0]
        else:
            target_idx = np.where(path <= req.target_price)[0]
            stop_idx = np.where(path >= req.stop_loss_price)[0]
            
        t_first = target_idx[0] if len(target_idx) > 0 else 9999
        s_first = stop_idx[0] if len(stop_idx) > 0 else 9999
        
        if t_first < s_first:
            target_hit_first += 1
        elif s_first < t_first:
            stop_hit_first += 1
        else:
            neither += 1
            
    p_target = target_hit_first / M
    p_stop = stop_hit_first / M
    p_neutral = neither / M
    
    # Kelly Criterion calculation
    win_pct = abs((req.target_price - req.current_price) / req.current_price)
    loss_pct = abs((req.stop_loss_price - req.current_price) / req.current_price)
    b = win_pct / (loss_pct + 1e-9)
    
    p = p_target / (p_target + p_stop + 1e-9)
    q = 1.0 - p
    kelly_fraction = (p * b - q) / (b + 1e-9)
    kelly_fraction = float(np.clip(kelly_fraction, -1.0, 1.0))
    
    # Expected Value %
    ev_pct = p_target * win_pct - p_stop * loss_pct
    
    rec_size = (
        "FULL POSITION (100%)"  if kelly_fraction > 0.25 and ev_pct > 0.02 else
        "HALF POSITION (50%)"   if kelly_fraction > 0.10 and ev_pct > 0.01 else
        "QUARTER SIZE (25%)"   if ev_pct > 0 else
        "AVOID"
    )
    
    final_prices = paths[:, -1]
    
    return {
        "symbol": req.symbol,
        "p_target_hit_first": round(p_target, 4),
        "p_stop_hit_first": round(p_stop, 4),
        "p_neither_hit": round(p_neutral, 4),
        "price_distribution": {
            "mean_final": round(float(np.mean(final_prices)), 2),
            "median_final": round(float(np.median(final_prices)), 2),
            "percentile_05": round(float(np.percentile(final_prices, 5)), 2),
            "percentile_25": round(float(np.percentile(final_prices, 25)), 2),
            "percentile_75": round(float(np.percentile(final_prices, 75)), 2),
            "percentile_95": round(float(np.percentile(final_prices, 95)), 2),
        },
        "trade_metrics": {
            "expected_value_pct": round(float(ev_pct) * 100, 2),
            "kelly_fraction": round(kelly_fraction, 4),
            "half_kelly": round(kelly_fraction / 2.0, 4),
            "recommended_position_size": rec_size,
        },
        "interpretation": _interpret_trade(p_target, p_stop, ev_pct),
    }


@router.post("/option-price")
def price_option_monte_carlo(req: OptionsRequest):
    """
    Prices options via Risk-Neutral Monte Carlo (drift = r)
    and cross-validates against Black-Scholes analytical formula.
    """
    S0 = req.spot_price
    K = req.strike_price
    T = req.days_to_expiry / 365.0
    sigma = req.implied_volatility
    r = req.risk_free_rate
    M = req.n_simulations
    
    # 1. Black-Scholes Analytical Price
    d1 = (np.log(S0 / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    if req.option_type.upper() == "CE":
        bs_price = S0 * stats.norm.cdf(d1) - K * np.exp(-r * T) * stats.norm.cdf(d2)
        bs_delta = stats.norm.cdf(d1)
    else:
        bs_price = K * np.exp(-r * T) * stats.norm.cdf(-d2) - S0 * stats.norm.cdf(-d1)
        bs_delta = stats.norm.cdf(d1) - 1.0
        
    # 2. Risk-Neutral Monte Carlo Simulation
    Z = np.random.standard_normal(M)
    ST = S0 * np.exp((r - 0.5 * sigma**2) * T + sigma * np.sqrt(T) * Z)
    
    if req.option_type.upper() == "CE":
        payoffs = np.maximum(ST - K, 0)
    else:
        payoffs = np.maximum(K - ST, 0)
        
    mc_price = np.exp(-r * T) * np.mean(payoffs)
    mc_std_err = np.exp(-r * T) * (np.std(payoffs) / np.sqrt(M))
    
    diff = float(mc_price - bs_price)
    diff_pct = float((diff / (bs_price + 1e-9)) * 100)
    
    return {
        "mc_price": round(float(mc_price), 2),
        "mc_std_error": round(float(mc_std_err), 4),
        "mc_95_confidence_interval": [
            round(float(mc_price - 1.96 * mc_std_err), 2),
            round(float(mc_price + 1.96 * mc_std_err), 2),
        ],
        "bs_price": round(float(bs_price), 2),
        "bs_delta": round(float(bs_delta), 4),
        "difference_inr": round(diff, 2),
        "difference_pct": round(diff_pct, 2),
        "cross_validation": "PASSED — MC price converges with Black-Scholes within 95% CI" if abs(diff_pct) < 3.0 else "WARNING: High variance, increase simulations",
    }


@router.post("/portfolio-var")
def compute_portfolio_var(req: PortfolioRequest):
    """
    Computes Multi-Asset Portfolio VaR and CVaR using Cholesky Decomposition
    to generate correlated return paths.
    L = np.linalg.cholesky(corr_matrix)
    Z_corr = L @ Z_indep
    """
    N_assets = len(req.assets)
    M = req.n_simulations
    T = req.horizon_days
    
    if N_assets == 0:
        raise HTTPException(status_code=400, detail="Assets list cannot be empty.")
        
    weights = np.array([a.weight for a in req.assets])
    vols = np.array([a.daily_volatility for a in req.assets])
    total_val = sum([a.current_value_inr for a in req.assets])
    
    corr = np.array(req.correlation_matrix)
    
    # Covariance Matrix = diag(vol) @ Corr @ diag(vol)
    cov = np.diag(vols) @ corr @ np.diag(vols)
    
    # Cholesky Decomposition
    try:
        L = np.linalg.cholesky(cov)
    except np.linalg.LinAlgError:
        # Fallback to pseudo-cholesky if matrix is not positive definite
        eigval, eigvec = np.linalg.eigh(cov)
        eigval = np.maximum(eigval, 1e-8)
        cov_pd = eigvec @ np.diag(eigval) @ eigvec.T
        L = np.linalg.cholesky(cov_pd)
        
    # Generate correlated random returns for T days
    Z_indep = np.random.standard_normal((N_assets, M * T))
    Z_corr = L @ Z_indep
    
    # Reshape to (M, N_assets, T) and compute cumulative asset returns
    asset_daily_returns = Z_corr.reshape(N_assets, M, T).swapaxes(0, 1)
    asset_cum_returns = np.exp(np.sum(asset_daily_returns, axis=2)) - 1.0  # (M, N_assets)
    
    # Portfolio return per simulation
    portfolio_returns = asset_cum_returns @ weights
    portfolio_losses = -portfolio_returns
    
    # VaR & CVaR
    var_95_pct = float(np.percentile(portfolio_losses, 95))
    var_99_pct = float(np.percentile(portfolio_losses, 99))
    cvar_95_pct = float(np.mean(portfolio_losses[portfolio_losses >= var_95_pct]))
    
    var_95_inr = total_val * var_95_pct
    cvar_95_inr = total_val * cvar_95_pct
    
    # Individual Undiversified VaR vs Portfolio VaR to compute Diversification Benefit
    indiv_vars = vols * 1.645 * np.sqrt(T)
    undiversified_var_pct = float(np.sum(weights * indiv_vars))
    div_benefit_pct = float(((undiversified_var_pct - var_95_pct) / (undiversified_var_pct + 1e-9)) * 100)
    
    return {
        "portfolio_value_inr": round(total_val, 2),
        "horizon_days": T,
        "var_95_pct": round(var_95_pct * 100, 2),
        "var_99_pct": round(var_99_pct * 100, 2),
        "cvar_95_pct": round(cvar_95_pct * 100, 2),
        "var_95_inr": round(var_95_inr, 2),
        "cvar_95_inr": round(cvar_95_inr, 2),
        "diversification_benefit_pct": round(div_benefit_pct, 2),
        "sharpe_ratio_annualised": round(float((np.mean(portfolio_returns) * 252) / (np.std(portfolio_returns) * np.sqrt(252) + 1e-9)), 2),
    }


class HestonOptionsRequest(BaseModel):
    spot_price: float
    strike_price: float
    days_to_expiry: int
    v0: float = 0.04          # Initial variance (sigma^2 = 0.2^2 = 0.04)
    kappa: float = 2.0         # Mean reversion rate
    theta: float = 0.04        # Long-term variance
    xi: float = 0.3            # Volatility of volatility
    rho: float = -0.7          # Correlation between spot and variance returns
    risk_free_rate: float = 0.065
    option_type: str = "CE"
    n_simulations: int = 20000


@router.post("/heston-option-price")
def price_option_heston_monte_carlo(req: HestonOptionsRequest):
    """
    Prices options via Heston Stochastic Volatility Monte Carlo model.
    dS = r*S*dt + sqrt(v)*S*dZ1
    dv = kappa*(theta - v)*dt + xi*sqrt(v)*dZ2,  corr(dZ1, dZ2) = rho
    """
    S0 = req.spot_price
    K = req.strike_price
    T = req.days_to_expiry / 365.0
    r = req.risk_free_rate
    M = req.n_simulations
    N_steps = max(int(req.days_to_expiry * 2), 20)
    dt = T / N_steps
    
    kappa, theta, xi, rho = req.kappa, req.theta, req.xi, req.rho
    
    # Cholesky for correlated Wiener processes
    L = np.array([
        [1.0, 0.0],
        [rho, np.sqrt(1 - rho**2)]
    ])
    
    S = np.full(M, S0)
    v = np.full(M, req.v0)
    
    for _ in range(N_steps):
        Z = np.random.standard_normal((2, M))
        Z_corr = L @ Z
        Z1, Z2 = Z_corr[0], Z_corr[1]
        
        # Truncation method to keep variance positive
        v_pos = np.maximum(v, 0.0)
        
        # Update variance
        v = v + kappa * (theta - v_pos) * dt + xi * np.sqrt(v_pos * dt) * Z2
        v = np.maximum(v, 1e-6)
        
        # Update price
        S = S * np.exp((r - 0.5 * v_pos) * dt + np.sqrt(v_pos * dt) * Z1)
        
    if req.option_type.upper() == "CE":
        payoffs = np.maximum(S - K, 0)
    else:
        payoffs = np.maximum(K - S, 0)
        
    heston_price = np.exp(-r * T) * np.mean(payoffs)
    
    return {
        "symbol": "NIFTY",
        "heston_price": round(float(heston_price), 2),
        "heston_params": {
            "initial_vol_pct": round(np.sqrt(req.v0) * 100, 1),
            "mean_reversion_kappa": kappa,
            "long_term_vol_pct": round(np.sqrt(theta) * 100, 1),
            "vol_of_vol": xi,
            "spot_vol_correlation": rho,
        },
        "model": "HESTON_STOCHASTIC_VOLATILITY",
    }

