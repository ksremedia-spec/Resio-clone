import { describe, expect, it } from 'vitest';
import { rollupBudget, rollupBudgetLine } from '../src/calc/budget.js';

describe('budget rollup', () => {
  it('derives revised, projected, variance, remaining and status', () => {
    const line = rollupBudgetLine({ originalCents: 4_200_000, approvedChangesCents: 450_000, committedCents: 1_000_000, actualCents: 2_000_000, invoicedCents: 0, paidCents: 0 });
    expect(line.revisedCents).toBe(4_650_000);
    expect(line.projectedCents).toBe(3_000_000);
    expect(line.varianceCents).toBe(1_650_000);
    expect(line.remainingCents).toBe(1_650_000);
    expect(line.status).toBe('on_track');
  });
  it('flags over budget', () => {
    const line = rollupBudgetLine({ originalCents: 100_000, approvedChangesCents: 0, committedCents: 0, actualCents: 120_000, invoicedCents: 0, paidCents: 0 });
    expect(line.status).toBe('over');
    expect(line.varianceCents).toBe(-20_000);
  });
  it('sums lines', () => {
    const total = rollupBudget([
      { originalCents: 100, approvedChangesCents: 0, committedCents: 0, actualCents: 10, invoicedCents: 0, paidCents: 0 },
      { originalCents: 200, approvedChangesCents: 50, committedCents: 20, actualCents: 30, invoicedCents: 0, paidCents: 0 },
    ]);
    expect(total.revisedCents).toBe(350);
    expect(total.projectedCents).toBe(60);
  });
});
