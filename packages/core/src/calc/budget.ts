import type { Cents } from '../money.js';

/**
 * Budget line rollup. Inputs are already-aggregated cents per source; the
 * function is pure so the API and the client compute identical numbers.
 */
export interface BudgetLineSources {
  originalCents: Cents;
  approvedChangesCents: Cents;
  committedCents: Cents;   // approved purchase orders + accepted bids not yet billed
  actualCents: Cents;      // posted bills + approved labour
  projectedExtraCents?: Cents; // manual forecast adjustments
  invoicedCents: Cents;
  paidCents: Cents;
}

export interface BudgetLineTotals extends BudgetLineSources {
  revisedCents: Cents;
  projectedCents: Cents;
  varianceCents: Cents;
  remainingCents: Cents;
  percentSpentBp: number;
  status: 'under' | 'on_track' | 'warning' | 'over';
}

export function rollupBudgetLine(src: BudgetLineSources, warningThresholdBp = 9_000): BudgetLineTotals {
  const revised = src.originalCents + src.approvedChangesCents;
  const projected = Math.max(src.actualCents + src.committedCents, src.actualCents) + (src.projectedExtraCents ?? 0);
  const variance = revised - projected; // positive = under budget
  const remaining = revised - src.actualCents - src.committedCents;
  const percentSpentBp = revised === 0 ? (projected > 0 ? 10_000 : 0) : Math.round((projected * 10_000) / revised);
  let status: BudgetLineTotals['status'] = 'on_track';
  if (projected > revised) status = 'over';
  else if (percentSpentBp >= warningThresholdBp) status = 'warning';
  else if (percentSpentBp < 5_000) status = 'under';
  return { ...src, revisedCents: revised, projectedCents: projected, varianceCents: variance, remainingCents: remaining, percentSpentBp, status };
}

export function rollupBudget(lines: BudgetLineSources[]): BudgetLineTotals {
  const sum: BudgetLineSources = { originalCents: 0, approvedChangesCents: 0, committedCents: 0, actualCents: 0, projectedExtraCents: 0, invoicedCents: 0, paidCents: 0 };
  for (const l of lines) {
    sum.originalCents += l.originalCents;
    sum.approvedChangesCents += l.approvedChangesCents;
    sum.committedCents += l.committedCents;
    sum.actualCents += l.actualCents;
    sum.projectedExtraCents! += l.projectedExtraCents ?? 0;
    sum.invoicedCents += l.invoicedCents;
    sum.paidCents += l.paidCents;
  }
  return rollupBudgetLine(sum);
}
