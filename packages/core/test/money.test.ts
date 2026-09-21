import { describe, expect, it } from 'vitest';
import { allocateCents, applyRate, formatCents, marginToMarkup, markupToMargin, mulQuantity, parseMoneyInput, parsePercentInput, parseQuantityInput, roundHalfUp, sumCents } from '../src/money.js';

describe('money', () => {
  it('rounds half away from zero', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4999)).toBe(2);
  });
  it('multiplies by quantity in thousandths', () => {
    expect(mulQuantity(12_345, 2_500)).toBe(30_863); // 123.45 × 2.5 = 308.625 → 308.63
    expect(mulQuantity(100, 333)).toBe(33);
  });
  it('applies basis-point rates deterministically', () => {
    expect(applyRate(10_000, 1_500)).toBe(1_500);
    expect(applyRate(12_345, 1_500)).toBe(1_852);
    expect(applyRate(1, 5_000)).toBe(1);
  });
  it('converts margin and markup', () => {
    expect(marginToMarkup(2_000)).toBe(2_500); // 20% margin = 25% markup
    expect(markupToMargin(2_500)).toBe(2_000);
    expect(() => marginToMarkup(10_000)).toThrow();
  });
  it('rejects non-integer cents', () => {
    expect(() => sumCents([1.5])).toThrow(RangeError);
    expect(() => applyRate(100.1, 100)).toThrow(RangeError);
  });
  it('allocates without losing cents', () => {
    const parts = allocateCents(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocateCents(-101, [1, 1])).toEqual([-51, -50]);
    expect(allocateCents(11, [0, 0])).toEqual([6, 5]);
  });
  it('parses user input', () => {
    expect(parseMoneyInput('$1,234.5')).toBe(123_450);
    expect(parseMoneyInput('-12.34')).toBe(-1_234);
    expect(parseMoneyInput(19.99)).toBe(1_999);
    expect(() => parseMoneyInput('12.345')).toThrow();
    expect(parsePercentInput('15.5%')).toBe(1_550);
    expect(parseQuantityInput('2.5')).toBe(2_500);
  });
  it('formats', () => {
    expect(formatCents(123_456)).toBe('$1,234.56');
    expect(formatCents(-5)).toBe('-$0.05');
  });
});
