import { useNavigate } from 'react-router';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Progress, Skeleton, StatusBadge, Toolbar } from '../../ui/components';
import { dateShort, humanize, money, timeAgo } from '../../ui/format';
import { useSession } from '../../store/session';

/** The homeowner's front door: their projects, what needs their decision, and what is due. */
export default function PortalHome() {
  const navigate = useNavigate();
  const session = useSession();
  const { data, isLoading, error, refetch } = useResource<contracts.PortalOverview>('/v1/portal/overview');
  const first = session.user?.firstName ?? '';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return <>
    <Toolbar title={<span>{session.membership?.organization.name}</span>} leading={<MenuToggle />}><ToolbarActions /></Toolbar>
    <div className="page"><div className="page-inner stack" style={{ gap: 'var(--sp-5)' }}>
      <div><h1 style={{ fontSize: 'var(--fs-2xl)' }}>{greeting}, {first}</h1><div className="muted">Here is where your project stands and what needs you.</div></div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <Skeleton lines={5} />}
      {data && data.projects.length === 0 && <EmptyState icon="projects" title="No projects shared with you yet">Your builder will add you to a project when it is ready.</EmptyState>}
      {data && data.approvals.length > 0 && <Card title={<span className="row" style={{ gap: 8 }}>Needs your decision <Badge tone="count">{data.approvals.length}</Badge></span>}>
        <div className="list">{data.approvals.map((a) => <button key={a.id} className="list-row" style={{ borderRadius: 8 }} data-testid="portal-approval" onClick={() => navigate(a.link)}>
          <Icon name={a.objectType === 'proposal' ? 'file' : a.objectType === 'selection' ? 'layout' : 'edit'} />
          <span className="grow"><div className="primary">{a.title}</div><div className="secondary">{humanize(a.objectType)} · {a.projectName ?? ''} · asked {timeAgo(a.requestedAt)}</div></span>
          <span className="trailing">{a.amountCents != null && <span className="mono">{money(a.amountCents)}</span>}<Icon name="chevronRight" size={16} /></span>
        </button>)}</div>
      </Card>}
      {data && data.unpaidInvoices.length > 0 && <Card title={<span className="row" style={{ gap: 8 }}>Invoices due <Badge tone="warning">{money(data.unpaidInvoices.reduce((n, i) => n + i.balanceCents, 0))}</Badge></span>}>
        <div className="list">{data.unpaidInvoices.map((i) => <button key={i.id} className="list-row" style={{ borderRadius: 8 }} data-testid="portal-invoice" onClick={() => navigate(`/projects/${i.projectId}/invoices/${i.id}`)}>
          <Icon name="invoices" />
          <span className="grow"><div className="primary">{i.number}{i.title ? ` · ${i.title}` : ''}</div><div className="secondary">{i.projectName} · due {dateShort(i.dueDate)}</div></span>
          <span className="trailing"><span className="mono">{money(i.balanceCents)}</span><StatusBadge status={i.status} /><Icon name="chevronRight" size={16} /></span>
        </button>)}</div>
      </Card>}
      {data && data.projects.length > 0 && <div className="card-grid">{data.projects.map((p) => <Card key={p.id} title={<span className="row" style={{ gap: 8 }}><span className="swatch" style={{ background: p.color }} />{p.name}</span>} actions={<StatusBadge status={p.status} />}>
        <div className="subtle mb-2">{p.addressLine}{p.startDate ? ` · ${dateShort(p.startDate)} → ${dateShort(p.targetEndDate)}` : ''}</div>
        <div className="row-between mb-2"><span className="muted">Schedule progress</span><strong>{Math.round(p.progressBp / 100)}%</strong></div>
        <Progress value={p.progressBp / 100} />
        <dl className="stack-sm mt-4" style={{ margin: 0 }}>
          {p.nextMilestone && <div className="row-between"><dt className="muted">Next milestone</dt><dd style={{ margin: 0 }}><Icon name="flag" size={14} /> {p.nextMilestone.name} · {dateShort(p.nextMilestone.date)}</dd></div>}
          <div className="row-between"><dt className="muted">Contract</dt><dd style={{ margin: 0 }} className="mono">{money(p.contractValueCents + p.approvedChangesCents)}</dd></div>
          {p.unpaidCents > 0 && <div className="row-between"><dt className="muted">Balance due</dt><dd style={{ margin: 0 }} className="mono">{money(p.unpaidCents)}</dd></div>}
          <div className="row-between"><dt className="muted">Last update</dt><dd style={{ margin: 0 }}>{p.lastUpdateAt ? timeAgo(p.lastUpdateAt) : '—'}</dd></div>
        </dl>
        <SheetProgress projectId={p.id} />
        <div className="row wrap mt-4">
          <Button variant="primary" onClick={() => navigate(`/projects/${p.id}`)} data-testid="portal-open-project">Open project</Button>
          {p.pendingApprovals > 0 && <Badge tone="warning">{p.pendingApprovals} to decide</Badge>}
          {p.unreadMessages > 0 && <Badge tone="count">{p.unreadMessages} unread</Badge>}
        </div>
      </Card>)}</div>}
    </div></div>
  </>;
}

/** "Your selections sheet: 9 of 44 decided" with a shortcut, shown only when the builder has released a sheet. */
function SheetProgress({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { data } = useResource<contracts.SelectionSheet>(`/v1/projects/${projectId}/selections/sheet`);
  if (!data || data.counts.total === 0) return null;
  const signed = data.signoffs.length > 0;
  return <div className="card mt-4" style={{ background: 'var(--bg-sunken)' }} data-testid="portal-sheet">
    <div className="row-between wrap"><div><strong>Your selections sheet</strong><div className="subtle">{data.counts.decided} of {data.counts.total} decided{signed ? ` · signed ${dateShort(data.signoffs[0]!.signedAt)}` : data.counts.decided > 0 ? ' · ready for your signature' : ''}</div></div><Button size="sm" onClick={() => navigate(`/projects/${projectId}/selections/sheet`)}>Open sheet</Button></div>
    <Progress value={data.counts.total ? (data.counts.decided / data.counts.total) * 100 : 0} />
  </div>;
}
