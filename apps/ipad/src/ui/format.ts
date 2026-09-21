import { formatCents } from '@buildline/core';

export const money = (cents: number | null | undefined, currency = 'USD') => cents == null ? '—' : formatCents(cents, { currency });
export const dateShort = (iso: string | null | undefined) => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
export const dateLong = (iso: string | null | undefined) => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso); return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
export const timeAgo = (iso: string | null | undefined) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
  return dateShort(iso);
};
export const dateTime = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
export const humanize = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
