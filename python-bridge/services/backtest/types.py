"""Pydantic contracts for the v2 backtest API (blueprint Section 5.2).

THE TEN GATES. `FalsificationGate` is the module's reason to exist. The legacy UI
carried a permanently-green "ML Fit Test" card: a hardcoded object with
`accuracy: 0.94` and `status: "good"` that never consulted a backtest. It reported
health for a model nobody had measured.

Here a gate is a computed assertion that can FAIL, and `promotable` is false if
any single gate fails. A gate that cannot fail is decoration; that is precisely
what the legacy card was.

A missing gate is a FAILED gate, not an absent one. `FalsificationGate.from_result`
defaults every unset flag to False, so partial evidence can never be read as
partial approval. The API therefore cannot report "promotable" from a partial
evaluation even if a caller omits fields.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# G1..G10, in the order the blueprint lists them.
GATE_NAMES = (
    "has_min_trades",
    "positive_expectancy",
    "survives_costs",
    "sharpe_above_threshold",
    "max_dd_within_budget",
    "oos_folds_positive",
    "passes_bonferroni",
    "passes_dsr",
    "mc_tail_within_bound",
    "not_overfit_plateau",
)

StrategyName = Literal["orb", "squeeze", "vwap", "gap", "mtf", "snap", "zscore"]
TimeframeName = Literal["5minute", "15minute", "day"]


class BacktestRequest(BaseModel):
    """A backtest request. Bounded on every axis that could produce a fake result."""
    model_config = ConfigDict(extra="forbid")

    strategy: StrategyName = Field(..., description="Generator to test")
    symbols: list[str] = Field(..., min_length=1, max_length=60)
    timeframe: TimeframeName = Field("5minute", description="Panel timeframe to load (5minute, 15minute, day)")

    capital: float = Field(100_000.0, gt=0, le=1e9)
    risk_pct: float = Field(0.01, gt=0, le=0.05)
    leverage: float = Field(1.0, ge=1.0, le=5.0)
    max_concurrent: int = Field(3, ge=1, le=20)
    r_mult: float = Field(2.0, gt=0, le=10.0)
    lot_size: int = Field(1, ge=1, le=100000)
    date_from: str | None = None
    date_to: str | None = None
    apply_costs: bool = True
    volume_veto: bool = True
    n_folds: int = Field(4, ge=2, le=20)
    purge_bars: int = Field(5, ge=0, le=500)
    n_param_trials: int = Field(
        1, ge=1, le=10_000,
        description="Parameter combinations SEARCHED, not survivors. Drives the "
                    "Bonferroni and Deflated-Sharpe corrections. Reporting the "
                    "survivor count is what made a 35-trial search look like a "
                    "single test.")
    mc_iterations: int = Field(2000, ge=100, le=50_000)
    mc_block_size: int = Field(0, ge=0, le=10_000)
    min_trades: int = Field(30, ge=1, le=100_000)
    alpha: float = Field(0.05, gt=0, lt=1)

    @field_validator("symbols")
    @classmethod
    def _norm_symbols(cls, v: list[str]) -> list[str]:
        out = [s.strip().upper() for s in v]
        if len(set(out)) != len(out):
            raise ValueError("symbols must be unique")
        return out

    @model_validator(mode="after")
    def _date_order(self) -> "BacktestRequest":
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError(f"date_from {self.date_from} is after date_to {self.date_to}")
        return self

    @property
    def slot_gross_pct(self) -> float:
        return 1.0 / self.max_concurrent


class FalsificationGate(BaseModel):
    """Ten computed assertions. Any False means not promotable.

    Every field defaults to False so an unevaluated gate cannot be mistaken for a
    passed one. The legacy card this replaces was green because it hardcoded True.
    """
    model_config = ConfigDict(extra="forbid")

    has_min_trades: bool = False
    positive_expectancy: bool = False
    survives_costs: bool = False
    sharpe_above_threshold: bool = False
    max_dd_within_budget: bool = False
    oos_folds_positive: bool = False
    passes_bonferroni: bool = False
    passes_dsr: bool = False
    mc_tail_within_bound: bool = False
    not_overfit_plateau: bool = False

    evidence: dict[str, Any] = Field(default_factory=dict)

    @property
    def n_passed(self) -> int:
        return sum(1 for n in GATE_NAMES if getattr(self, n))

    @property
    def n_failed(self) -> int:
        return len(GATE_NAMES) - self.n_passed

    @property
    def promotable(self) -> bool:
        return self.n_failed == 0

    def failed_gates(self) -> list[str]:
        return [n for n in GATE_NAMES if not getattr(self, n)]

    def as_dict(self) -> dict[str, Any]:
        return {**{n: getattr(self, n) for n in GATE_NAMES},
                "promotable": self.promotable, "n_passed": self.n_passed,
                "n_failed": self.n_failed, "failed_gates": self.failed_gates(),
                "evidence": self.evidence}

    @classmethod
    def from_result(cls, *, min_trades: int, n_trades: int, net_pnl: float,
                    gross_pnl: float, costs: float, sharpe: float,
                    sharpe_threshold: float, max_dd_pct: float,
                    dd_budget_pct: float, wfo_folds_positive: int,
                    wfo_folds: int, min_folds: int, bonferroni_pass: bool,
                    dsr_pass: bool, mc_p95_dd_pct: float, mc_tail_bound_pct: float,
                    plateau_status: str) -> "FalsificationGate":
        """Compute all ten from a run. Nothing here is hardcoded True."""
        ev = {
            "n_trades": n_trades, "min_trades": min_trades,
            "net_pnl": round(net_pnl, 2), "gross_pnl": round(gross_pnl, 2),
            "costs": round(costs, 2),
            "cost_share_of_gross": round(costs / gross_pnl, 4) if gross_pnl else None,
            "sharpe": round(sharpe, 4), "sharpe_threshold": sharpe_threshold,
            "max_dd_pct": round(max_dd_pct, 4), "dd_budget_pct": dd_budget_pct,
            "wfo_folds_positive": wfo_folds_positive, "wfo_folds": wfo_folds,
            "min_folds": min_folds, "mc_p95_dd_pct": mc_p95_dd_pct,
            "mc_tail_bound_pct": mc_tail_bound_pct, "plateau_status": plateau_status,
        }
        return cls(
            has_min_trades=n_trades >= min_trades,
            # A trade that cannot pay for itself is not an edge.
            positive_expectancy=net_pnl > 0,
            # Surviving costs is separate from being profitable: an edge that only
            # exists gross is not tradeable, and that is the R-13 failure mode.
            survives_costs=bool(gross_pnl > 0 and net_pnl > 0),
            sharpe_above_threshold=sharpe >= sharpe_threshold,
            max_dd_within_budget=max_dd_pct <= dd_budget_pct,
            oos_folds_positive=wfo_folds_positive >= min_folds,
            passes_bonferroni=bool(bonferroni_pass),
            passes_dsr=bool(dsr_pass),
            mc_tail_within_bound=mc_p95_dd_pct <= mc_tail_bound_pct,
            not_overfit_plateau=plateau_status == "Robust Green Plateau",
            evidence=ev)


class BacktestResponse(BaseModel):
    """Full result. `promotable` is mirrored at the top level for the UI."""
    model_config = ConfigDict(extra="forbid")

    strategy: str
    symbols: list[str]
    capital: float
    config: dict[str, Any] = Field(default_factory=dict)
    viability: dict[str, Any] = Field(default_factory=dict)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    wfo: dict[str, Any] = Field(default_factory=dict)
    monte_carlo: dict[str, Any] = Field(default_factory=dict)
    gate: FalsificationGate
    trades: list[dict[str, Any]] = Field(default_factory=list)
    equity_curve: list[dict[str, Any]] = Field(default_factory=list)
    runtime: dict[str, Any] = Field(default_factory=dict)

    @property
    def promotable(self) -> bool:
        return self.gate.promotable

    @model_validator(mode="after")
    def _no_empty_gate(self) -> "BacktestResponse":
        if self.gate.n_passed == 0 and not self.gate.evidence:
            raise ValueError(
                "gate carries no evidence; a fully-failed gate is only honest when "
                "it records WHY each gate failed")
        return self


class BacktestErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    detail: str
    code: str = "backtest_error"
    context: dict[str, Any] = Field(default_factory=dict)
