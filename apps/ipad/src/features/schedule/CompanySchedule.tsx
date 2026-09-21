import { useNavigate } from 'react-router';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Card, EmptyState, ErrorState, Icon, Skeleton, Toolbar } from '../../ui/components';
import { dateShort, todayIso } from '../../ui/format';

/** Company-wide view: what is happening on every open project in the next 30 days. */
export default function CompanySchedule() {
  const navigate = useNavigate();
  const today = todayIso();
  const month = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Task[] }>(`/v1/tasks?status=open&kind=schedule&limit=200&sort=startDate:asc&dueAfter=${today}&dueBefore=${month}`);
  const { data: dash } = useResource<contracts.DashboardResponse>('/v1/dashboard');
  const byProject = new Map<string, contracts.Task[]>();
  for (const t of data?.items ?? []) (byProject.get(t.projectName ?? t.projectId) ?? byProject.set(t.projectName ?? t.projectId, []).get(t.projectName ?? t.projectId)!).push(t);
  return <>
    <Toolbar title="Schedule" leading={<MenuToggle />}><ToolbarActions /></Toolbar>
    <div className="page"><div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      {dash?.scheduleConflicts && dash.scheduleConflicts.count > 0 && <Card title="Resource conflicts"><div className="list">{dash.scheduleConflicts.items.map((c, i) => <div key={i} className="list-row" style={{ borderBottom: 0 }}><Icon name="users" style={{ color: 'var(--danger)' }} /><span className="grow"><div className="primary">{c.resourceName}</div><div className="secondary">{c.taskAName} ({c.projectAName}) overlaps {c.taskBName} ({c.projectBName}) · {dateShort(c.overlapStart)}–{dateShort(c.overlapEnd)}</div></span></div>)}</div></Card>}
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <Card><Skeleton lines={6} /></Card>}
      {data && data.items.length === 0 && <EmptyState icon="schedule" title="Nothing scheduled in the next 30 days" />}
      {[...byProject.entries()].map(([name, tasks]) => <Card key={name} title={name}><div className="list">{tasks.map((t) => <button key={t.id} className="list-row" style={{ borderBottom: 0, borderRadius: 8 }} onClick={() => navigate(`/projects/${t.projectId}/schedule`)}><Icon name={t.isMilestone ? 'flag' : 'circle'} /><span className="grow"><div className="primary">{t.name}</div><div className="secondary">{t.assignees.map((a) => a.displayName).join(', ') || 'Unassigned'}</div></span><span className="subtle">{dateShort(t.startDate)} → {dateShort(t.endDate)}</span>{t.status === 'in_progress' && <Badge tone="brand">in progress</Badge>}</button>)}</div></Card>)}
    </div></div>
  </>;
}
