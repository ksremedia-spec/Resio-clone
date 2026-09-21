import { describe, expect, it } from 'vitest';
import { calculateLineItem, grossMarginBp, mergeTotals, sumLineItems } from '../src/calc/estimate.js';

describe('estimate calculations', () => {
  it('computes direct cost, markup, tax and sell price', () => {
    const totals = calculateLineItem({
      quantityThousandths: 10_000, // 10 units
      unitCostCents: { labor: 5_000, material: 12_000 },
      defaultMarkupBp: 2_000,
      taxBp: 800,
    });
    expect(totals.directCostCents).toBe(170_000);
    expect(totals.markupCents).toBe(34_000);
    expect(totals.sellBeforeTaxCents).toBe(204_000);
    expect(totals.taxCents).toBe(16_320);
    expect(totals.sellCents).toBe(220_320);
  });
  it('supports per-cost-type markup', () => {
    const t = calculateLineItem({ quantityThousandths: 1_000, unitCostCents: { labor: 10_000, subcontract: 10_000 }, markupBp: { subcontract: 1_000 }, defaultMarkupBp: 3_000 });
    expect(t.markupCents).toBe(3_000 + 1_000);
  });
  it('excludes unaccepted optional lines and tracks allowances', () => {
    const a = { input: { quantityThousandths: 1_000, unitCostCents: { material: 50_000 }, defaultMarkupBp: 1_000, isAllowance: true }, totals: null as any };
    a.totals = calculateLineItem(a.input);
    const b = { input: { quantityThousandths: 1_000, unitCostCents: { material: 50_000 }, defaultMarkupBp: 1_000, isOptional: true, included: false }, totals: null as any };
    b.totals = calculateLineItem(b.input);
    const section = sumLineItems([a, b]);
    expect(section.sellCents).toBe(55_000);
    expect(section.allowanceCents).toBe(55_000);
    const merged = mergeTotals([section, section]);
    expect(merged.sellCents).toBe(110_000);
    expect(grossMarginBp(merged)).toBe(909); // 10% markup ≈ 9.09% margin
  });
});
