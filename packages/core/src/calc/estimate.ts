import { applyRate, assertCents, mulQuantity, sumCents, type BasisPoints, type Cents } from '../money.js';

export type CostType = 'labor' | 'material' | 'subcontract' | 'equipment' | 'other';
export const COST_TYPES: readonly CostType[] = ['labor', 'material', 'subcontract', 'equipment', 'other'];

export interface LineItemInput {
  /** Quantity in thousandths (2.5 => 2500). */
  quantityThousandths: number;
  /** Unit cost per cost type, in cents. Missing types are zero. */
  unitCostCents: Partial<Record<CostType, Cents>>;
  /** Markup per cost type in basis points; falls back to defaultMarkupBp. */
  markupBp?: Partial<Record<CostType, BasisPoints>>;
  defaultMarkupBp: BasisPoints;
  /** Tax rate in basis points applied to the sell price (0 when non-taxable). */
  taxBp?: BasisPoints;
  /** Allowance lines are shown to the client as allowances; maths is unchanged. */
  isAllowance?: boolean;
  /** Optional lines are excluded from totals until accepted. */
  isOptional?: boolean;
  included?: boolean;
}

export interface LineItemTotals {
  costByType: Record<CostType, Cents>;
  directCostCents: Cents;
  markupCents: Cents;
  sellBeforeTaxCents: Cents;
  taxCents: Cents;
  sellCents: Cents;
  includedInTotals: boolean;
}

export function calculateLineItem(input: LineItemInput): LineItemTotals {
  const costByType = {} as Record<CostType, Cents>;
  let direct = 0;
  let markup = 0;
  for (const type of COST_TYPES) {
    const unit = assertCents(input.unitCostCents[type] ?? 0, `unitCost.${type}`);
    const cost = mulQuantity(unit, input.quantityThousandths);
    costByType[type] = cost;
    direct += cost;
    const rate = input.markupBp?.[type] ?? input.defaultMarkupBp;
    markup += applyRate(cost, rate);
  }
  const sellBeforeTax = direct + markup;
  const tax = applyRate(sellBeforeTax, input.taxBp ?? 0);
  const includedInTotals = !(input.isOptional && input.included === false);
  return {
    costByType,
    directCostCents: direct,
    markupCents: markup,
    sellBeforeTaxCents: sellBeforeTax,
    taxCents: tax,
    sellCents: sellBeforeTax + tax,
    includedInTotals,
  };
}

export interface SectionTotals {
  directCostCents: Cents;
  markupCents: Cents;
  sellBeforeTaxCents: Cents;
  taxCents: Cents;
  sellCents: Cents;
  allowanceCents: Cents;
  costByType: Record<CostType, Cents>;
}

export function emptyTotals(): SectionTotals {
  return {
    directCostCents: 0, markupCents: 0, sellBeforeTaxCents: 0, taxCents: 0, sellCents: 0, allowanceCents: 0,
    costByType: { labor: 0, material: 0, subcontract: 0, equipment: 0, other: 0 },
  };
}

export function sumLineItems(items: Array<{ input: LineItemInput; totals: LineItemTotals }>): SectionTotals {
  const out = emptyTotals();
  for (const { input, totals } of items) {
    if (!totals.includedInTotals) continue;
    out.directCostCents += totals.directCostCents;
    out.markupCents += totals.markupCents;
    out.sellBeforeTaxCents += totals.sellBeforeTaxCents;
    out.taxCents += totals.taxCents;
    out.sellCents += totals.sellCents;
    if (input.isAllowance) out.allowanceCents += totals.sellCents;
    for (const t of COST_TYPES) out.costByType[t] += totals.costByType[t];
  }
  return out;
}

export function mergeTotals(sections: SectionTotals[]): SectionTotals {
  const out = emptyTotals();
  for (const s of sections) {
    out.directCostCents += s.directCostCents;
    out.markupCents += s.markupCents;
    out.sellBeforeTaxCents += s.sellBeforeTaxCents;
    out.taxCents += s.taxCents;
    out.sellCents += s.sellCents;
    out.allowanceCents += s.allowanceCents;
    for (const t of COST_TYPES) out.costByType[t] += s.costByType[t];
  }
  return out;
}

export function grossMarginBp(totals: Pick<SectionTotals, 'sellBeforeTaxCents' | 'directCostCents'>): BasisPoints {
  if (totals.sellBeforeTaxCents === 0) return 0;
  return Math.round(((totals.sellBeforeTaxCents - totals.directCostCents) * 10_000) / totals.sellBeforeTaxCents);
}

export { sumCents };
