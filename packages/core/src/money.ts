/**
 * Deterministic money arithmetic.
 *
 * All monetary values are integers in minor units (cents). Percentages are
 * integers in basis points (1 % = 100 bp, 100 % = 10 000 bp). Never use
 * floating point for stored values; use these helpers for every calculation
 * so the API and the client agree to the cent.
 */

export type Cents = number;
export type BasisPoints = number;

export const BP_SCALE = 10_000;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isInteger(value)) throw new RangeError(`${label} must be an integer number of cents, got ${value}`);
  if (Math.abs(value) > MAX_SAFE) throw new RangeError(`${label} exceeds safe integer range`);
  return value;
}

export function assertBasisPoints(value: number, label = 'rate'): BasisPoints {
  if (!Number.isInteger(value)) throw new RangeError(`${label} must be an integer number of basis points, got ${value}`);
  return value;
}

/** Round half away from zero to an integer (deterministic, symmetric). */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5);
}

/** Multiply cents by a decimal quantity given with fixed precision. */
export function mulQuantity(cents: Cents, quantityThousandths: number): Cents {
  assertCents(cents);
  if (!Number.isInteger(quantityThousandths)) throw new RangeError('quantity must be in integer thousandths');
  return roundHalfUp((cents * quantityThousandths) / 1000);
}

/** Apply a basis-point rate to cents: 12 345 cents × 1 500 bp = 1 852 cents. */
export function applyRate(cents: Cents, bp: BasisPoints): Cents {
  assertCents(cents);
  assertBasisPoints(bp);
  return roundHalfUp((cents * bp) / BP_SCALE);
}

/** Convert a margin (on sell price) into the equivalent markup (on cost). */
export function marginToMarkup(marginBp: BasisPoints): BasisPoints {
  assertBasisPoints(marginBp);
  if (marginBp >= BP_SCALE) throw new RangeError('margin must be below 100%');
  return roundHalfUp((marginBp * BP_SCALE) / (BP_SCALE - marginBp));
}

/** Convert a markup (on cost) into the equivalent margin (on sell). */
export function markupToMargin(markupBp: BasisPoints): BasisPoints {
  assertBasisPoints(markupBp);
  return roundHalfUp((markupBp * BP_SCALE) / (BP_SCALE + markupBp));
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return assertCents(total, 'total');
}

/** Allocate a total across weights without losing cents (largest remainder). */
export function allocateCents(total: Cents, weights: number[]): Cents[] {
  assertCents(total);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (weightSum === 0) {
    const each = Math.trunc(total / weights.length);
    const out = weights.map(() => each);
    out[0]! += total - each * weights.length;
    return out;
  }
  const raw = weights.map((w) => (total * w) / weightSum);
  const floors = raw.map((r) => Math.trunc(r));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.trunc(r) }))
    .sort((a, b) => b.frac - a.frac);
  const step = remainder < 0 ? -1 : 1;
  for (const { i } of order) {
    if (remainder === 0) break;
    floors[i]! += step;
    remainder -= step;
  }
  return floors;
}

export function parseMoneyInput(input: string | number): Cents {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new RangeError('invalid amount');
    return roundHalfUp(input * 100);
  }
  const cleaned = input.replace(/[\s,$]/g, '');
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '' || cleaned === '-') throw new RangeError(`invalid amount "${input}"`);
  const negative = cleaned.startsWith('-');
  const [whole = '0', frac = ''] = cleaned.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

export function formatCents(cents: Cents, opts: { currency?: string; locale?: string; showSign?: boolean } = {}): string {
  const { currency = 'USD', locale = 'en-US', showSign = false } = opts;
  const formatted = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }).format(cents / 100);
  return showSign && cents > 0 ? `+${formatted}` : formatted;
}

export function formatBasisPoints(bp: BasisPoints, fractionDigits = 2): string {
  return `${(bp / 100).toFixed(fractionDigits)}%`;
}

export function parsePercentInput(input: string | number): BasisPoints {
  const n = typeof input === 'number' ? input : Number(String(input).replace(/[%\s,]/g, ''));
  if (!Number.isFinite(n)) throw new RangeError(`invalid percent "${input}"`);
  return roundHalfUp(n * 100);
}

export function parseQuantityInput(input: string | number): number {
  const n = typeof input === 'number' ? input : Number(String(input).replace(/[\s,]/g, ''));
  if (!Number.isFinite(n)) throw new RangeError(`invalid quantity "${input}"`);
  return roundHalfUp(n * 1000);
}

export function formatQuantity(thousandths: number): string {
  const s = (thousandths / 1000).toFixed(3);
  return s.replace(/\.?0+$/, '');
}
