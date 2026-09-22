import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { EmptyState, ErrorState, SearchField, Segmented, Skeleton, Stat, StatusBadge, Toolbar, useDebounced } from '../../ui/components';
import { dateShort, humanize, money } from '../../ui/format';
import { Money } from '../financial/shared';
import { InvoiceDetail } from './ProjectInvoices';

/** Accounts receivable across every project. */
export default function InvoicesHome() {
  const navigate = useNavigate();
  const { invoiceId } = useParams();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'open' | 'overdue' | 'paid' | 'draft' | 'all'>((['open', 'overdue', 'paid', 'draft', 'all'].includes(params.get('status') ?? '') ? params.get('status') : 'open') as 'open' | 'overdue' | 'paid' | 'draft' | 'all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Invoice[] }>(`/v1/invoices?status=${status}&limit=200${dq ? `&q=${encodeURIComponent(dq)}` : ''}`);
  const { data: open } = useResource<{ items: contracts.Invoice[] }>('/v1/invoices?status=open&limit=200');
  const items = data?.items ?? [];
  const outstanding = (open?.items ?? []).reduce((n, i) => n + i.balanceCents, 0);
  const overdue = (open?.items ?? []).filter((i) => i.status === 'overdue');
  const selected = items.find((i) => i.id === invoiceId) ?? open?.items.find((i) => i.id === invoiceId);
  return <>
    <Toolbar title="Invoices" leading={<MenuToggle />}><ToolbarActions /></Toolbar>
    <div className="page"><div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="stat-row">
        <Stat label="Outstanding" value={money(outstanding)} tone={outstanding > 0 ? 'warn' : 'ok'} />
        <Stat label="Overdue" value={money(overdue.reduce((n, i) => n + i.balanceCents, 0))} tone={overdue.length ? 'danger' : 'ok'} />
        <Stat label="Unpaid invoices" value={open?.items.length ?? 0} />
      </div>
      <div className="row wrap">
        <Segmented value={status} onChange={setStatus} ariaLabel="Invoice filter" options={[{ value: 'open', label: 'Unpaid' }, { value: 'overdue', label: 'Overdue' }, { value: 'paid', label: 'Paid' }, { value: 'draft', label: 'Drafts' }, { value: 'all', label: 'All' }]} />
        <div style={{ minWidth: 260 }}><SearchField value={q} onChange={setQ} placeholder="Search number, title or project" /></div>
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={5} /></div>}
      {data && items.length === 0 && <EmptyState icon="invoices" title={status === 'open' ? 'Nothing outstanding' : 'No invoices'}>Invoices are created from each project's Invoices section.</EmptyState>}
      {items.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="table-wrap"><table className="table">
        <thead><tr><th>Invoice</th><th>Project</th><th>Client</th><th>Issued</th><th>Due</th><th className="num">Total</th><th className="num">Balance</th><th>Status</th></tr></thead>
        <tbody>{items.map((i) => <tr key={i.id} className="clickable" data-testid="invoice-row" onClick={() => navigate(`/invoices/${i.id}`)}>
          <td className="name"><div className="primary">{i.number}</div><div className="secondary">{i.title || humanize(i.billingType)}</div></td>
          <td>{i.projectName}</td><td>{i.clientName ?? '—'}</td><td>{dateShort(i.issueDate)}</td><td>{dateShort(i.dueDate)}</td>
          <td className="num"><Money cents={i.totalCents} /></td><td className="num"><Money cents={i.balanceCents} /></td><td><StatusBadge status={i.status} /></td>
        </tr>)}</tbody>
      </table></div></div>}
      {invoiceId && <InvoiceDetail project={{ id: selected?.projectId ?? '' }} invoiceId={invoiceId} onClose={() => navigate('/invoices')} />}
    </div></div>
  </>;
}
