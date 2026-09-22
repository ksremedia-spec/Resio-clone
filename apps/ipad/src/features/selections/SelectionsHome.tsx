import { useNavigate } from 'react-router';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Progress, Skeleton, StatusBadge, Toolbar } from '../../ui/components';
import { dateTime, timeAgo } from '../../ui/format';
import { useSession } from '../../store/session';

const choiceOf = (s: contracts.Selection) => {
  const opt = s.options.find((o) => o.id === s.selectedOptionId)?.name;
  const parts = [opt, s.matchExisting ? 'match existing' : null, s.chosenAreas.length ? s.chosenAreas.join(', ') : null, ...Object.entries(s.answers).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].filter(Boolean);
  return parts.join(' · ');
};

/** Every client choice across every project you can see, straight from the server and refreshed as it changes. */
export default function SelectionsHome() {
  const navigate = useNavigate();
  const session = useSession();
  const { data, isLoading, error, refetch, fromCache } = useResource<{ items: contracts.Selection[] }>('/v1/selections?status=all&limit=200', { refetchInterval: 30_000 } as any);
  const items = (data?.items ?? []).filter((s) => s.status !== 'void');
  const portal = !!session.membership?.external;
  const byProject = new Map<string, { name: string; items: contracts.Selection[] }>();
  for (const s of items) { if (!byProject.has(s.projectId)) byProject.set(s.projectId, { name: s.projectName ?? 'Project', items: [] }); byProject.get(s.projectId)!.items.push(s); }
  const recent = items.filter((s) => s.status === 'decided' && s.decidedAt).sort((a, b) => (b.decidedAt! > a.decidedAt! ? 1 : -1)).slice(0, 12);
  return <>
    <Toolbar title="Selections" leading={<MenuToggle />}>{fromCache && <Badge tone="warning">Cached</Badge>}<ToolbarActions /></Toolbar>
    <div className="page"><div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <p className="muted">{portal ? 'Every choice you have made, and what is still waiting on you. Your builder and their crew see the same list.' : 'What each client has chosen, live. The crew, the office and subcontractors on the project all see the same record the moment a choice is confirmed.'}</p>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={5} /></div>}
      {data && items.length === 0 && <EmptyState icon="layout" title="No selections yet">{portal ? 'Your builder has not released any selections to you.' : 'Open a project and add the standard sheet to start collecting choices.'}</EmptyState>}
      {byProject.size > 0 && <div className="card-grid">{[...byProject.entries()].map(([projectId, p]) => {
        const decided = p.items.filter((s) => s.status === 'decided').length;
        const waiting = p.items.filter((s) => s.status === 'released').length;
        const latest = p.items.filter((s) => s.decidedAt).sort((a, b) => (b.decidedAt! > a.decidedAt! ? 1 : -1))[0];
        return <Card key={projectId} title={p.name} actions={<Button size="sm" onClick={() => navigate(`/projects/${projectId}/selections/sheet`)} data-testid="home-open-sheet">Open sheet</Button>} data-testid="project-selections-card">
          <div className="row-between"><span className="muted">{decided} of {p.items.length} decided</span>{waiting > 0 && <Badge tone="warning">{waiting} {portal ? 'for you to decide' : 'waiting on the client'}</Badge>}</div>
          <Progress value={p.items.length ? (decided / p.items.length) * 100 : 0} />
          {latest && <div className="subtle mt-2">Last choice {timeAgo(latest.decidedAt)}{latest.decidedByName ? ` by ${latest.decidedByName}` : ''}</div>}
          <div className="list mt-2">{p.items.filter((s) => s.status === 'decided').slice(0, 5).map((s) => <button key={s.id} className="list-row" style={{ borderRadius: 8, borderBottom: 0, minHeight: 44 }} onClick={() => navigate(`/projects/${projectId}/selections/${s.id}?from=sheet`)}><span className="grow"><div className="primary truncate">{s.name}</div><div className="secondary truncate">{choiceOf(s) || '—'}</div></span><Icon name="chevronRight" size={16} /></button>)}</div>
          <div className="row mt-2"><Button size="sm" variant="quiet" onClick={() => navigate(`/projects/${projectId}/selections`)}>All {p.items.length} items</Button></div>
        </Card>;
      })}</div>}
      {recent.length > 0 && <Card title="Latest decisions" wide>
        <div className="list" data-testid="recent-decisions">{recent.map((s) => <button key={s.id} className="list-row" style={{ borderRadius: 8, borderBottom: 0 }} onClick={() => navigate(`/projects/${s.projectId}/selections/${s.id}?from=sheet`)}>
          <Icon name="checkCircle" style={{ color: 'var(--success)' }} />
          <span className="grow"><div className="primary">{s.name}: {choiceOf(s) || 'decided'}</div><div className="secondary">{s.projectName}{s.decidedByName ? ` · ${s.decidedByName}` : ''} · {dateTime(s.decidedAt)}{s.comment ? ` · “${s.comment}”` : ''}</div></span>
          <span className="trailing"><StatusBadge status={s.status} /><Icon name="chevronRight" size={16} /></span>
        </button>)}</div>
      </Card>}
    </div></div>
  </>;
}
