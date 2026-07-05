"""
WealthOS Quant Finance Integration Suite Verification
Tests all 4 newly implemented routers:
1. Macro Engine (/api/macro)
2. Loop Validator (/api/loop-validator)
3. Liquidity Engine (/api/liquidity)
4. Monte Carlo Engine (/api/monte-carlo)
5. Greeks Engine 8-check entry gate
"""

import sys
import os
import unittest
import numpy as np
import pandas as pd

# Add python-bridge root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routers.macro_engine import get_current_regime, get_dynamic_weights, _load_and_prep_data, _train_ensemble
from routers.loop_validator import _interpret_icir
from routers.liquidity_engine import estimate_pre_trade_cost, get_liquidity_alert, TradeRequest
from routers.monte_carlo_engine import compute_trade_probability, price_option_monte_carlo, compute_portfolio_var, SimRequest, OptionsRequest, PortfolioRequest, PortfolioAsset


class TestQuantFinanceIntegration(unittest.TestCase):

    def test_01_macro_engine(self):
        """Test Macro Regime classification & dynamic weights."""
        df, X, y, feature_cols = _load_and_prep_data()
        self.assertGreater(len(y), 10, "Macro dataset should have > 10 rows")
        
        res = _train_ensemble(X, y)
        self.assertIn(res["regime"], ["STRONG_BULL", "BULL", "NEUTRAL", "BEAR", "STRONG_BEAR"])
        self.assertGreaterEqual(res["probability_positive"], 0.0)
        self.assertLessEqual(res["probability_positive"], 1.0)
        
        weights = get_dynamic_weights()
        self.assertIn("g_factor", weights)
        self.assertIn("ci", weights)
        self.assertIn("gex", weights)
        print(f"[PASS] Macro Regime Test Passed: Regime={res['regime']}, P(Bull)={res['probability_positive']*100:.1f}%")

    def test_02_loop_validator(self):
        """Test ICIR interpretation and OOS gate logic."""
        interpretation = _interpret_icir(0.65)
        self.assertIn("ICIR > 0.5", interpretation)
        print("[PASS] Loop Validator Test Passed")

    def test_03_liquidity_engine(self):
        """Test Kyle sqrt Law pre-trade cost & Check 8 alert."""
        req = TradeRequest(
            symbol="NIFTY",
            trade_size_shares=500,
            current_price=24000.0,
            current_adv=5000000.0,
            ann_volatility=0.20
        )
        cost_res = estimate_pre_trade_cost(req)
        self.assertGreater(cost_res["impact"]["blended_bps"], 0.0)
        self.assertIn("SINGLE ORDER", cost_res["execution_strategy"])
        
        alert_res = get_liquidity_alert("NIFTY")
        self.assertTrue(alert_res["gate_8_pass"])
        print(f"[PASS] Liquidity Engine Test Passed: Impact={cost_res['impact']['blended_bps']} bps")

    def test_04_monte_carlo_engine(self):
        """Test Monte Carlo trade probability, options pricing, and portfolio VaR."""
        sim_req = SimRequest(
            symbol="NIFTY",
            current_price=24000.0,
            target_price=24500.0,
            stop_loss_price=23800.0,
            daily_volatility=0.0141,
            horizon_days=10,
            n_simulations=2000
        )
        prob_res = compute_trade_probability(sim_req)
        self.assertGreater(prob_res["p_target_hit_first"], 0.0)
        self.assertGreater(prob_res["p_stop_hit_first"], 0.0)
        
        opt_req = OptionsRequest(
            spot_price=24000.0,
            strike_price=24000.0,
            days_to_expiry=15,
            implied_volatility=0.18,
            option_type="CE",
            n_simulations=10000
        )
        opt_res = price_option_monte_carlo(opt_req)
        self.assertAlmostEqual(opt_res["mc_price"], opt_res["bs_price"], delta=15.0)
        
        port_req = PortfolioRequest(
            assets=[
                PortfolioAsset(symbol="NIFTY", weight=0.6, current_value_inr=600000.0, daily_volatility=0.0141),
                PortfolioAsset(symbol="BANKNIFTY", weight=0.4, current_value_inr=400000.0, daily_volatility=0.0185),
            ],
            correlation_matrix=[[1.0, 0.75], [0.75, 1.0]],
            horizon_days=1,
            n_simulations=2000
        )
        var_res = compute_portfolio_var(port_req)
        self.assertGreater(var_res["var_95_inr"], 0.0)
        print(f"[PASS] Monte Carlo Test Passed: P(Target)={prob_res['p_target_hit_first']*100:.1f}%, Option MC Price={opt_res['mc_price']}, Portfolio VaR 95% = INR {var_res['var_95_inr']:.0f}")

    def test_05_phase_6_enhancements(self):
        """Test Phase 6 endpoints: Heston options pricing, TWAP schedule, and Full Audit."""
        from routers.monte_carlo_engine import price_option_heston_monte_carlo, HestonOptionsRequest
        from routers.liquidity_engine import generate_twap_schedule, TWAPScheduleRequest
        from routers.loop_validator import run_full_strategy_audit, FullAuditRequest

        # Heston
        h_req = HestonOptionsRequest(spot_price=24000.0, strike_price=24000.0, days_to_expiry=15)
        h_res = price_option_heston_monte_carlo(h_req)
        self.assertGreater(h_res["heston_price"], 0.0)

        # TWAP
        tw_req = TWAPScheduleRequest(symbol="NIFTY", total_shares=3000, execution_window_minutes=60)
        tw_res = generate_twap_schedule(tw_req)
        self.assertGreaterEqual(tw_res["n_slices"], 2)

        # Full Audit
        fa_req = FullAuditRequest(
            signal_values=[1.0, 2.0, 1.5, 3.0, 2.5] * 6,
            subsequent_returns=[0.01, 0.02, -0.01, 0.03, 0.01] * 6,
            period_labels=[f"2025-0{i%9+1}" for i in range(30)],
        )
        fa_res = run_full_strategy_audit(fa_req)
        self.assertEqual(fa_res["status"], "success")

        print(f"[PASS] Phase 6 Enhancements Test Passed: Heston Price={h_res['heston_price']}, TWAP Slices={tw_res['n_slices']}")


if __name__ == "__main__":
    unittest.main()

