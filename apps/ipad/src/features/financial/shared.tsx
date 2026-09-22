import { useEffect, useState, type ReactNode } from 'react';
import { contracts, formatBasisPoints, formatQuantity, parseMoneyInput, parsePercentInput, parseQuantityInput } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { Badge, Field, Input, Select } from '../../ui/components';
import { money } from '../../ui/format';

export type CostMap = Record<string, number>;
export const COST_TYPE_LABELS: Record<string, string> = { labor: 'Labor', material: 'Material', subcontract: 'Subcontract', equipment: 'Equipment', other: 'Other' };
export const sumCost = (m: Record<string, number | undefined> | null | undefined) => Object.values(m ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);
export const dollars = (cents: number) => (cents / 100).toFixed(2);

/** Text field that reads and writes integer cents; the user types dollars. */
export function MoneyInput({ value, onChange, allowNegative, ...rest }: { value: number; onChange: (cents: number) => void; allowNegative?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value ? dollars(value) : '');
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(value ? dollars(value) : ''); }, [value]);
  return <Input inputMode="decimal" placeholder="0.00" value={text} invalid={bad} onChange={(e) => { setText(e.target.value); setBad(false); }} onBlur={() => { if (text.trim() === '') { onChange(0); setBad(false); return; } try { const c = parseMoneyInput(text); if (c < 0 && !allowNegative) throw new Error('negative'); onChange(c); setText(dollars(c)); setBad(false); } catch { setBad(true); } }} {...rest} />;
}

/** Percent field backed by basis points (8.25% ⇄ 825). */
export function PercentInput({ value, onChange, ...rest }: { value: number; onChange: (bp: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState((value / 100).toString());
  useEffect(() => { setText((value / 100).toString()); }, [value]);
  return <Input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { try { onChange(parsePercentInput(text || '0')); } catch { setText((value / 100).toString()); } }} {...rest} />;
}

/** Quantity field backed by thousandths (2.5 ⇄ 2500). */
export function QuantityInput({ value, onChange, ...rest }: { value: number; onChange: (thousandths: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(formatQuantity(value));
  useEffect(() => { setText(formatQuantity(value)); }, [value]);
  return <Input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { try { onChange(parseQuantityInput(text || '0')); } catch { setText(formatQuantity(value)); } }} {...rest} />;
}

/** One money field per cost type; empty types are omitted from the map. */
export function CostTypeFields({ value, onChange, label = 'Unit cost' }: { value: Record<string, number>; onChange: (v: Record<string, number>) => void; label?: string }) {
  return <Field label={label} className="full"><div className="cost-types">{contracts.COST_TYPES.map((t) => <label key={t} className="stack-sm" style={{ gap: 4 }}><span className="subtle">{COST_TYPE_LABELS[t]}</span><MoneyInput aria-label={`${label} ${COST_TYPE_LABELS[t]}`} value={value[t] ?? 0} onChange={(c) => { const next = { ...value }; if (c) next[t] = c; else delete next[t]; onChange(next); }} /></label>)}</div></Field>;
}

export function useCostCodes() { return useResource<contracts.CostCode[]>('/v1/cost-codes'); }
export function CostCodeSelect({ value, onChange, codes, ...rest }: { value: string | null; onChange: (id: string | null) => void; codes?: contracts.CostCode[] } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}><option value="">No cost code</option>{codes?.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select>;
}
export function BudgetLineSelect({ value, onChange, lines, ...rest }: { value: string | null; onChange: (id: string | null) => void; lines?: contracts.BudgetLine[] } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...rest}><option value="">No budget line</option>{lines?.map((l) => <option key={l.id} value={l.id}>{l.sectionName ? `${l.sectionName} · ` : ''}{l.name}</option>)}</Select>;
}

export function Money({ cents, signed, muted }: { cents: number | null | undefined; signed?: boolean; muted?: boolean }) {
  return <span className={`mono ${muted ? 'muted' : ''}`} style={{ color: signed && cents != null ? (cents < 0 ? 'var(--danger)' : cents > 0 ? 'var(--success)' : undefined) : undefined }}>{cents == null ? '—' : `${signed && cents > 0 ? '+' : ''}${money(cents)}`}</span>;
}
export const pct = (bp: number) => formatBasisPoints(bp, bp % 100 === 0 ? 0 : 2);

/** A short summary line under a table (e.g. "3 lines · $12,400.00"). */
export function Summary({ children }: { children: ReactNode }) { return <div className="subtle" style={{ padding: '6px 12px' }}>{children}</div>; }

export function OverBadge({ cents }: { cents: number | null }) { return cents ? <Badge tone="danger">Over PO by {money(cents)}</Badge> : null; }
