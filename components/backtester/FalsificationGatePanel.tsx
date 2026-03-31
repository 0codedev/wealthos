/**
 * FalsificationGatePanel — renders the engine's real ten-gate verdict.
 *
 * THIS REPLACES THE PERMANENTLY-GREEN "ML FIT TEST" CARD.
 *
 * The card it replaces (PerformanceReport.tsx:99-103) read:
 *
 *   value    = fitResult?.isOverfit ? 'OVERFIT' : 'VALID EDGE'
 *   subtext  = fitResult ? `p-value: ${(fitResult.pValue ?? 0.02)}` : 'Permutations 500'
 *   trend    = fitResult?.isOverfit ? 'down' : 'up'
 *
 * With no `fitResult` present, all three fields resolve to the PASSING branch:
 * the card reported "VALID EDGE", printed a p-value of 0.020 that no test had
 * produced, and rendered an upward trend arrow. It was incapable of showing a
 * red state, and it fabricated the evidence for doing so. The
 * `not_falsifiable_by_shuffling` guard in the engine was never consulted.
 *
 * This panel has no default state. Every gate renders from an actual value in
 * `FalsificationGate`, and an unrun or unscored state renders as explicitly
 * unknown rather than as a pass. Three states, not two:
 *
 *   scored + promotable  -> all ten green
 *   scored + not         -> the failures red, named, with the reason
 *   not scored           -> "not run", no colour verdict at all
 *
 * The last state is the point. A gate that cannot fail is decoration, which is
 * precisely what the legacy card was.
 */
import React, { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
} from 'lucide-react';
import {
  GATE_LABELS,
  GATE_NAMES,
  GATE_WHY,
  isScored,
  verdictLine,
  type BacktestResponse,
  type GateName,
} from '../../services/VectorbtBacktestService';

interface Props {
  run: BacktestResponse | null;
  loading: boolean;
  className?: string;
}

const PASS = 'text-emerald-400';
const FAIL = 'text-rose-400';
const IDLE = 'text-zinc-500';

export const FalsificationGatePanel: React.FC<Props> = ({
  run,
  loading,
  className = '',
}) => {
  const scored = isScored(run);
  const gate = scored ? run.gate : null;

  const passed = useMemo(
    () => (gate ? gate.n_passed : 0),
    [gate],
  );
  const total = GATE_NAMES.length;

  if (loading) {
    return (
      <section
        className={`rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 ${className}`}
        aria-busy="true"
      >
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Scoring strategy against 10 falsification gates…</span>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Walk-forward folds, multiple-comparison correction and a Monte Carlo
          drawdown distribution. This takes a few seconds.
        </p>
      </section>
    );
  }

  // The state the legacy card could not represent.
  if (!scored) {
    return (
      <section
        className={`rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 ${className}`}
      >
        <h3 className="text-sm font-semibold text-zinc-300">
          Falsification gates
        </h3>
        <p className="mt-2 text-sm text-zinc-500">
          Not yet scored. Run a backtest to evaluate this strategy against the
          ten gates. Until then there is no verdict — in either direction.
        </p>
        <p className="mt-3 text-xs text-zinc-600">
          These gates exist because a strategy can look excellent on the data it
          was selected on. A gate that has not run is not a pass.
        </p>
      </section>
    );
  }

  const promotable = gate!.promotable;

  return (
    <section
      className={`rounded-xl border bg-zinc-900/40 p-5 ${
        promotable ? 'border-emerald-800/60' : 'border-rose-900/60'
      } ${className}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            Falsification gates
          </h3>
          <p
            className={`mt-1 text-sm font-medium ${promotable ? PASS : FAIL}`}
            role="status"
          >
            {verdictLine(run)}
          </p>
        </div>
        <div className="text-right">
          <div
            className={`text-2xl font-semibold tabular-nums ${
              promotable ? PASS : FAIL
            }`}
          >
            {passed}
            <span className="text-zinc-600">/{total}</span>
          </div>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">
            gates passed
          </div>
        </div>
      </header>

      <ul className="mt-4 space-y-1.5">
        {GATE_NAMES.map((name: GateName) => {
          const ok = gate![name];
          const Icon = ok ? CheckCircle2 : XCircle;
          const tone = ok ? PASS : FAIL;
          return (
            <li
              key={name}
              className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-zinc-800/40"
            >
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-[13px] font-medium ${tone}`}>
                    {GATE_LABELS[name]}
                  </span>
                  <span
                    className={`text-[11px] font-medium uppercase tracking-wide ${tone}`}
                  >
                    {ok ? 'pass' : 'fail'}
                  </span>
                </div>
                {!ok && (
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {GATE_WHY[name]}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {!promotable && gate!.failed_gates.length > 0 && (
        <div className="mt-4 rounded-lg border border-rose-900/40 bg-rose-950/20 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Blockers
          </div>
          <ul className="mt-1.5 space-y-1">
            {gate!.failed_gates.map((name) => (
              <li key={name} className="text-[12px] text-rose-200/90">
                • {GATE_LABELS[name]} — {GATE_WHY[name]}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Footnote run={run!} />
    </section>
  );
};

/**
 * The multiplicity correction, shown whenever it is what blocked promotion.
 *
 * This is the most misread number in the product. A Sharpe of 2.9 with every
 * fold profitable looks like a result; the same Sharpe selected from 35
 * parameter combinations is the expected maximum of 35 draws. Surfacing
 * `n_trials` next to the threshold is the only way a reader can tell those
 * apart.
 */
const Footnote: React.FC<{ run: BacktestResponse }> = ({ run }) => {
  const mult = run.wfo?.aggregate?.multiplicity;
  if (!mult) return null;
  const blocked = !mult.bonferroni_pass || !mult.dsr_pass;
  if (!blocked) return null;

  return (
    <div className="mt-4 border-t border-zinc-800 pt-3 text-[11px] text-zinc-500">
      <span className="font-semibold text-zinc-400">
        Multiple-comparison correction
      </span>
      <div className="mt-1 space-y-0.5">
        <div>
          Observed Sharpe {mult.observed_sharpe?.toFixed(2)} after{' '}
          <span className="text-zinc-300">
            {mult.n_trials ?? '?'} parameter trial
            {(mult.n_trials ?? 0) === 1 ? '' : 's'}
          </span>
          {mult.bonferroni_threshold != null && (
            <>
              {' '}
              · Bonferroni bar p &lt;{' '}
              {mult.bonferroni_threshold.toExponential(2)}
            </>
          )}
        </div>
        {mult.deflated_sharpe != null && (
          <div>
            Deflated Sharpe {mult.deflated_sharpe.toFixed(4)}{' '}
            {mult.dsr_pass ? '(pass)' : '(fail)'}
            {run.wfo?.aggregate?.n_return_obs != null &&
              ` over ${run.wfo.aggregate.n_return_obs.toLocaleString()} return observations`}
          </div>
        )}
      </div>
      {run.wfo?.reasons && run.wfo.reasons.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {run.wfo.reasons.map((reason) => (
            <li key={reason} className="text-zinc-500">
              • {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default FalsificationGatePanel;
