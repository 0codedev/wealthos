"""
Domain 167 (WP-BQ): Machine-Learned Regime Switching Markov Gaussian Mixture Volatility Sentry

Implements Hamilton (1989) / Ang-Bekaert (2002) 3-state Hidden Markov Model (HMM)
Gaussian Mixture volatility filtering, Viterbi dynamic programming path decoding,
systemic crash jump hazard modeling, and dynamic institutional portfolio leverage scaling.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import math
import sqlite3
from typing import List, Optional, Tuple


@dataclass
class RegimeParameters:
    state_id: int
    name: str
    mu: float
    sigma: float


@dataclass
class MarkovSentryReport:
    symbol: str
    latest_return: float
    active_state: int
    state_name: str
    state_probabilities: List[float]
    crash_jump_hazard: float
    recommended_leverage: float
    regime_directive: str
    viterbi_path: List[int]
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class MarkovRegimeVolatilitySentry:
    """
    3-State Hidden Markov Gaussian Mixture Volatility Sentry.
    Filters latent volatility regimes, estimates crash jump hazard, and governs portfolio leverage.
    """

    def __init__(
        self,
        db_path: str = ":memory:",
        regimes: Optional[List[RegimeParameters]] = None,
        transition_matrix: Optional[List[List[float]]] = None,
        base_leverage: float = 1.50,
    ):
        self.db_path = db_path
        self.base_leverage = base_leverage

        # 3 Default Regimes (Daily Scale): Low Vol (0), Choppy Normal (1), High Vol Crisis (2)
        self.regimes = regimes or [
            RegimeParameters(state_id=0, name="LOW_VOLATILITY_BULL", mu=0.0006, sigma=0.007),
            RegimeParameters(state_id=1, name="MODERATE_CHOPPY_ROTATION", mu=0.0001, sigma=0.015),
            RegimeParameters(state_id=2, name="CRISIS_JUMP_EXPANSION", mu=-0.0035, sigma=0.038),
        ]

        # 3x3 Transition Matrix: P[i][j] = P(S_t = j | S_{t-1} = i)
        self.transition_matrix = transition_matrix or [
            [0.96, 0.035, 0.005],  # Low vol persists
            [0.05, 0.910, 0.040],  # Moderate persists
            [0.01, 0.070, 0.920],  # Crisis persists
        ]

        self._conn = None
        if self.db_path == ":memory:":
            self._conn = sqlite3.connect(":memory:")
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self.db_path == ":memory:":
            return self._conn
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        """Initializes SQLite schema for Markov volatility telemetry."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS markov_regime_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                latest_return REAL NOT NULL,
                active_state INTEGER NOT NULL,
                prob_low REAL NOT NULL,
                prob_med REAL NOT NULL,
                prob_high REAL NOT NULL,
                crash_hazard REAL NOT NULL,
                recommended_leverage REAL NOT NULL,
                directive TEXT NOT NULL
            )
            """
        )
        conn.commit()

    def gaussian_pdf(self, x: float, mu: float, sigma: float) -> float:
        """Calculates normal probability density with numerical floor."""
        sigma = max(1e-6, sigma)
        diff = x - mu
        exponent = -0.5 * (diff / sigma) ** 2
        # Clamp exponent to prevent underflow to zero
        if exponent < -700.0:
            return 1e-300
        return (1.0 / (sigma * math.sqrt(2.0 * math.pi))) * math.exp(exponent)

    def filter_probabilities(
        self,
        returns: List[float],
        initial_prior: Optional[List[float]] = None,
    ) -> List[List[float]]:
        """
        Runs Hamilton (1989) forward filtering algorithm:
        xi_{t|t}(i) = P(S_t = i | r_{1:t})
        Returns sequence of filtered probabilities for all t.
        """
        if not returns:
            return []

        num_states = len(self.regimes)
        prior = initial_prior or [1.0 / num_states] * num_states
        filtered_history: List[List[float]] = []

        curr_prior = list(prior)

        for r in returns:
            # 1. Update step (Bayes rule with state-conditional likelihoods)
            likelihoods = [
                self.gaussian_pdf(r, reg.mu, reg.sigma) for reg in self.regimes
            ]

            joint = [curr_prior[i] * likelihoods[i] for i in range(num_states)]
            marginal = sum(joint)

            if marginal <= 0.0:
                # Uniform fallback if extreme outlier underflows
                filtered = [1.0 / num_states] * num_states
            else:
                filtered = [j / marginal for j in joint]

            filtered_history.append(filtered)

            # 2. Predictor step for next time step: xi_{t+1|t} = P^T * xi_{t|t}
            next_prior = [0.0] * num_states
            for j in range(num_states):
                next_prior[j] = sum(
                    filtered[i] * self.transition_matrix[i][j]
                    for i in range(num_states)
                )
            # Normalize to guarantee exact sum = 1
            sum_next = sum(next_prior)
            curr_prior = [p / sum_next for p in next_prior] if sum_next > 0 else [1.0 / num_states] * num_states

        return filtered_history

    def viterbi_decode(
        self,
        returns: List[float],
        initial_prior: Optional[List[float]] = None,
    ) -> List[int]:
        """
        Computes the most likely sequence of latent volatility regimes via Viterbi dynamic programming:
        S*_{1:T} = argmax P(S_{1:T}, r_{1:T}).
        """
        if not returns:
            return []

        num_states = len(self.regimes)
        T = len(returns)
        prior = initial_prior or [1.0 / num_states] * num_states

        # Log probabilities for numerical stability
        viterbi_table = [[-float("inf")] * num_states for _ in range(T)]
        backpointer = [[0] * num_states for _ in range(T)]

        # t = 0
        r0 = returns[0]
        for i in range(num_states):
            p0 = max(1e-300, prior[i])
            f0 = max(1e-300, self.gaussian_pdf(r0, self.regimes[i].mu, self.regimes[i].sigma))
            viterbi_table[0][i] = math.log(p0) + math.log(f0)

        # Dynamic programming forward pass
        for t in range(1, T):
            rt = returns[t]
            for j in range(num_states):
                fj = max(1e-300, self.gaussian_pdf(rt, self.regimes[j].mu, self.regimes[j].sigma))
                log_fj = math.log(fj)

                best_log_prob = -float("inf")
                best_prev_state = 0

                for i in range(num_states):
                    p_trans = max(1e-300, self.transition_matrix[i][j])
                    prob = viterbi_table[t - 1][i] + math.log(p_trans) + log_fj
                    if prob > best_log_prob:
                        best_log_prob = prob
                        best_prev_state = i

                viterbi_table[t][j] = best_log_prob
                backpointer[t][j] = best_prev_state

        # Backward traceback
        best_last_state = max(range(num_states), key=lambda s: viterbi_table[T - 1][s])
        path = [0] * T
        path[T - 1] = best_last_state

        for t in range(T - 2, -1, -1):
            path[t] = backpointer[t + 1][path[t + 1]]

        return path

    def analyze_regime(
        self,
        symbol: str,
        returns: List[float],
    ) -> MarkovSentryReport:
        """
        Runs complete regime switching analysis:
        1. Filters posterior probabilities.
        2. Solves optimal Viterbi path.
        3. Calculates crash hazard and institutional leverage governor.
        4. Issues portfolio directives.
        """
        if not returns:
            raise ValueError("returns array cannot be empty")

        filtered_history = self.filter_probabilities(returns)
        latest_probs = filtered_history[-1]
        viterbi_path = self.viterbi_decode(returns)
        active_state = viterbi_path[-1]

        prob_low, prob_med, prob_high = latest_probs
        crash_hazard = prob_high

        # Leverage Governor:
        # Scale base leverage down proportionally to crash hazard
        # At prob_high >= 0.50, leverage drops to 0.0 (maximum defensive posture)
        leverage_discount = min(1.0, 2.0 * crash_hazard)
        recommended_leverage = round(self.base_leverage * (1.0 - leverage_discount), 2)

        # Directives
        state_name = self.regimes[active_state].name
        if crash_hazard >= 0.40:
            directive = "SYSTEMIC_CRASH_DELEVERAGING_LONG_VOLATILITY"
        elif prob_low >= 0.65:
            directive = "BULL_EXPANSION_MAX_LEVERAGE"
            recommended_leverage = round(self.base_leverage, 2)
        elif prob_med >= 0.50:
            directive = "ROTATIONAL_RANGE_MARKET_MAKING"
            recommended_leverage = round(self.base_leverage * 0.67, 2)
        else:
            directive = "REGIME_TRANSITION_NEUTRAL"

        report = MarkovSentryReport(
            symbol=symbol,
            latest_return=round(returns[-1], 6),
            active_state=active_state,
            state_name=state_name,
            state_probabilities=[round(p, 4) for p in latest_probs],
            crash_jump_hazard=round(crash_hazard, 4),
            recommended_leverage=recommended_leverage,
            regime_directive=directive,
            viterbi_path=viterbi_path,
        )

        self._record_telemetry(report)
        return report

    def _record_telemetry(self, rep: MarkovSentryReport) -> None:
        """Persists evaluation results to SQLite."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO markov_regime_telemetry (
                timestamp, symbol, latest_return, active_state,
                prob_low, prob_med, prob_high, crash_hazard,
                recommended_leverage, directive
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rep.timestamp,
                rep.symbol,
                rep.latest_return,
                rep.active_state,
                rep.state_probabilities[0],
                rep.state_probabilities[1],
                rep.state_probabilities[2],
                rep.crash_jump_hazard,
                rep.recommended_leverage,
                rep.regime_directive,
            ),
        )
        conn.commit()

    def get_latest_telemetry(self, limit: int = 10) -> List[Tuple]:
        """Retrieves latest persisted telemetry rows."""
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT symbol, latest_return, active_state, crash_hazard, recommended_leverage, directive
            FROM markov_regime_telemetry
            ORDER BY id DESC LIMIT ?
            """,
            (limit,),
        )
        return cursor.fetchall()
