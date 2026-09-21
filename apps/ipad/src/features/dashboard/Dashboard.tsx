import { Link, useNavigate } from 'react-router';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Skeleton, Stat, Toolbar } from '../../ui/components';
import { dateShort, money, timeAgo } from '../../ui/format';
import { useSession } from '../../store/session';

export default function Dashboard() {
  const session = useSession();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, fromCache } = useResource<contracts.DashboardResponse>('/v1/dashboard', { refetchInterval: 60_000 } as any);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return <>
    <Toolbar title={`${greeting}, ${session.user?.firstName}`} leading={<MenuToggle />}>
      {fromCache && <Badge tone="warning">Cached</Badge>}
      {session.has('projects.write') && <Button variant="primary" icon="plus" onClick={() => navigate('/projects?new=1')}>New project</Button>}
      <ToolbarActions />
    </Toolbar>
    <div className="page"><div className="page-inner">
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card-grid"><Card><Skeleton /></Card><Card><Skeleton /></Card><Card><Skeleton /></Card></div>}
      {data && <DashboardBody data={data} />}
    </div></div>
  </>;
}

function DashboardBody({ data }: { data: contracts.DashboardResponse }) {
  const navigate = useNavigate();
  const attention = (data.overdueTasks?.count ?? 0) + (data.pendingApprovals?.count ?? 0) + (data.scheduleConflicts?.count ?? 0) + (data.budgetWarnings?.count ?? 0);
  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="stat-row">
        <Stat label="Active projects" value={data.activeProjects.count} />
        {data.overdueTasks && <Stat label="Overdue tasks" value={data.overdueTasks.count} tone={data.overdueTasks.count ? 'danger' : 'ok'} />}
        {data.upcomingDeadlines && <Stat label="Due this week" value={data.upcomingDeadlines.count} />}
        {data.pendingApprovals && <Stat label="Pending approvals" value={data.pendingApprovals.count} tone={data.pendingApprovals.count ? 'warn' : undefined} />}
        {data.unpaidInvoices && <Stat label="Unpaid invoices" value={money(data.unpaidInvoices.totalCents)} tone={data.unpaidInvoices.count ? 'warn' : undefined} />}
        {data.scheduleConflicts && <Stat label="Schedule conflicts" value={data.scheduleConflicts.count} tone={data.scheduleConflicts.count ? 'danger' : 'ok'} />}
      </div>
      {attention === 0 && <div className="banner syncing" style={{ borderRadius: 12 }}><Icon name="checkCircle" size={18} /> Nothing needs your attention right now.</div>}
      <div className="card-grid">
        <Card title="Active projects" actions={<Link to="/projects">All projects</Link>}>
          {data.activeProjects.items.length === 0 ? <EmptyState icon="projects" title="No active projects" action={<Button onClick={() => navigate('/projects?new=1')}>Create a project</Button>} /> : (
            <div className="list">{data.activeProjects.items.map((p) => (
              <button key={p.id} className="list-row" style={{ borderRadius: 8, borderBottom: 0 }} onClick={() => navigate(`/projects/${p.id}`)}>
                <span className="dot" style={{ background: p.color }} />
                <span className="grow"><div className="primary truncate">{p.isFavorite ? '★ ' : ''}{p.number} · {p.name}</div><div className="secondary truncate">{p.clientName ?? 'No client'}{p.nextMilestone ? ` · Next: ${p.nextMilestone.name} ${dateShort(p.nextMilestone.date)}` : ''}</div></span>
                <span className="trailing">{p.overdueTasks > 0 && <Badge tone="danger">{p.overdueTasks} overdue</Badge>}<Badge>{p.openTasks} open</Badge><Icon name="chevronRight" size={16} /></span>
              </button>
            ))}</div>
          )}
        </Card>
        {data.overdueTasks && <Card title={`Overdue tasks (${data.overdueTasks.count})`} actions={<Link to="/tasks">Task manager</Link>}>
          {data.overdueTasks.items.length === 0 ? <p className="muted">Nothing overdue.</p> : <div className="list">{data.overdueTasks.items.map((t) => <button key={t.id} className="list-row" style={{ borderBottom: 0, borderRadius: 8 }} onClick={() => navigate(`/projects/${t.projectId}/tasks/${t.id}`)}><Icon name="alert" style={{ color: 'var(--danger)' }} /><span className="grow"><div className="primary truncate">{t.name}</div><div className="secondary truncate">{t.projectName} · {t.assigneeNames.join(', ') || 'Unassigned'}</div></span><Badge tone="danger">{t.daysOverdue}d late</Badge></button>)}</div>}
        </Card>}
        {data.upcomingDeadlines && <Card title="Coming up this week">
          {data.upcomingDeadlines.items.length === 0 ? <p className="muted">No deadlines in the next 7 days.</p> : <div className="list">{data.upcomingDeadlines.items.map((t) => <button key={t.id} className="list-row" style={{ borderBottom: 0, borderRadius: 8 }} onClick={() => navigate(`/projects/${t.projectId}/tasks/${t.id}`)}><Icon name={t.isMilestone ? 'flag' : 'circle'} /><span className="grow"><div className="primary truncate">{t.name}</div><div className="secondary truncate">{t.projectName}</div></span><span className="subtle">{dateShort(t.dueDate)}</span></button>)}</div>}
        </Card>}
        {data.pendingApprovals && <Card title="Pending approvals">
          {data.pendingApprovals.items.length === 0 ? <p className="muted">No approvals waiting.</p> : <div className="list">{data.pendingApprovals.items.map((a) => <div key={a.id} className="list-row" style={{ borderBottom: 0 }}><Icon name="checkCircle" /><span className="grow"><div className="primary truncate">{a.title}</div><div className="secondary">{a.projectName} · requested {timeAgo(a.requestedAt)}</div></span>{a.amountCents != null && <span className="num">{money(a.amountCents)}</span>}</div>)}</div>}
        </Card>}
        {data.unpaidInvoices && <Card title="Unpaid invoices">
          {data.unpaidInvoices.items.length === 0 ? <p className="muted">Everything is paid up.</p> : <div className="list">{data.unpaidInvoices.items.map((i) => <div key={i.id} className="list-row" style={{ borderBottom: 0 }}><Icon name="invoices" /><span className="grow"><div className="primary">#{i.number} · {i.projectName}</div><div className="secondary">{i.clientName} · due {dateShort(i.dueDate)}</div></span><span className="num">{money(i.balanceCents)}</span><Badge tone={i.status === 'overdue' ? 'danger' : 'warning'}>{i.status.replace('_', ' ')}</Badge></div>)}</div>}
        </Card>}
        {data.budgetWarnings && data.budgetWarnings.count > 0 && <Card title="Budget warnings">
          <div className="list">{data.budgetWarnings.items.map((b, i) => <div key={i} className="list-row" style={{ borderBottom: 0 }}><Icon name="alert" style={{ color: b.status === 'over' ? 'var(--danger)' : 'var(--warning)' }} /><span className="grow"><div className="primary">{b.costCode ? `${b.costCode} · ` : ''}{b.lineName}</div><div className="secondary">{b.projectName}</div></span><span className="num" style={{ color: b.varianceCents < 0 ? 'var(--danger)' : undefined }}>{money(b.varianceCents)}</span></div>)}</div>
        </Card>}
        {data.scheduleConflicts && data.scheduleConflicts.count > 0 && <Card title="Schedule conflicts">
          <div className="list">{data.scheduleConflicts.items.map((c, i) => <div key={i} className="list-row" style={{ borderBottom: 0 }}><Icon name="users" style={{ color: 'var(--danger)' }} /><span className="grow"><div className="primary">{c.resourceName} is double-booked</div><div className="secondary">{c.taskAName} ({c.projectAName}) and {c.taskBName} ({c.projectBName}) · {dateShort(c.overlapStart)}–{dateShort(c.overlapEnd)}</div></span></div>)}</div>
        </Card>}
        {data.recentMessages && <Card title="Recent messages" actions={<Link to="/messages">Inbox</Link>}>
          {data.recentMessages.length === 0 ? <p className="muted">No messages yet.</p> : <div className="list">{data.recentMessages.map((m) => <button key={m.threadId} className="list-row" style={{ borderBottom: 0, borderRadius: 8 }} onClick={() => navigate(m.projectId ? `/projects/${m.projectId}/messages/${m.threadId}` : `/messages/${m.threadId}`)}><span className="dot" style={{ background: m.unread ? 'var(--brand)' : 'transparent' }} /><span className="grow"><div className="primary truncate" style={{ fontWeight: m.unread ? 700 : 500 }}>{m.subject}</div><div className="secondary truncate">{m.projectName ? `${m.projectName} · ` : ''}{m.lastMessagePreview}</div></span><span className="subtle">{timeAgo(m.lastMessageAt)}</span></button>)}</div>}
        </Card>}
        <Card title="Recent activity" wide>
          {data.recentActivity.length === 0 ? <p className="muted">No activity yet.</p> : <div className="timeline">{data.recentActivity.map((a) => <div key={a.id} className="timeline-item"><span className="avatar sm">{a.actorName.split(' ').map((s) => s[0]).join('')}</span><span>{a.summary}</span><span className="when">{timeAgo(a.occurredAt)}</span></div>)}</div>}
        </Card>
      </div>
    </div>
  );
}
