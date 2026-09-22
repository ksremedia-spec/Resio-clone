import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, ConfirmDialog, ErrorState, Icon, MenuButton, Skeleton, Spinner, StatusBadge, useErrorToast, useIsCompact, useToast } from '../../ui/components';
import { useSession } from '../../store/session';
import { ProjectFormSheet } from './ProjectForm';
import { ProjectOverview } from './ProjectOverview';
import { ProjectTeam } from './ProjectTeam';
import { ProjectActivity } from './ProjectActivity';
import { ComingSoonSection } from './ComingSoonSection';

const sectionModules = {
  schedule: () => import('../schedule/ProjectSchedule'),
  tasks: () => import('../tasks/ProjectTasks'),
  dailyLogs: () => import('../dailyLogs/ProjectDailyLogs'),
  documents: () => import('../documents/ProjectDocuments'),
  messages: () => import('../messages/ProjectMessages'),
  estimate: () => import('../estimating/ProjectEstimate'),
  budget: () => import('../budget/ProjectBudget'),
  changeOrders: () => import('../changeOrders/ProjectChangeOrders'),
  invoices: () => import('../invoices/ProjectInvoices'),
  purchasing: () => import('../purchasing/ProjectPurchasing'),
  proposals: () => import('../proposals/ProjectProposals'),
  selections: () => import('../selections/ProjectSelections'),
  time: () => import('../time/ProjectTime'),
};
const ProjectSchedule = lazy(sectionModules.schedule);
const ProjectTasks = lazy(sectionModules.tasks);
const ProjectDailyLogs = lazy(sectionModules.dailyLogs);
const ProjectDocuments = lazy(sectionModules.documents);
const ProjectMessages = lazy(sectionModules.messages);
const ProjectEstimate = lazy(sectionModules.estimate);
const ProjectBudget = lazy(sectionModules.budget);
const ProjectChangeOrders = lazy(sectionModules.changeOrders);
const ProjectInvoices = lazy(sectionModules.invoices);
const ProjectPurchasing = lazy(sectionModules.purchasing);
const ProjectProposals = lazy(sectionModules.proposals);
const ProjectSelections = lazy(sectionModules.selections);
const ProjectTime = lazy(sectionModules.time);
/** Warm every section chunk once a project opens so sections keep working if connectivity drops afterwards. */
function prefetchSections() { for (const load of Object.values(sectionModules)) void load().catch(() => {}); }

export function useProject(projectId: string | undefined) {
  return useResource<contracts.ProjectDetail>(projectId ? `/v1/projects/${projectId}` : null);
}

export default function ProjectHub() {
  const { projectId } = useParams();
  const session = useSession();
  const navigate = useNavigate();
  const compact = useIsCompact();
  const { data: project, isLoading, error, refetch, fromCache } = useProject(projectId);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  useEffect(() => { prefetchSections(); }, []);
  const toast = useToast();
  const errorToast = useErrorToast();
  const favorite = useApiMutation((fav: boolean) => api.mutate('POST', `/v1/projects/${projectId}/favorite`, { favorite: fav }), [`/v1/projects`]);
  const archive = useApiMutation((archived: boolean) => api.mutate('POST', `/v1/projects/${projectId}/archive`, { archived }), ['/v1/projects', '/v1/dashboard']);
  if (error && !project) return <><div className="toolbar"><MenuToggle /><Button variant="quiet" icon="back" onClick={() => navigate('/projects')}>Projects</Button></div><div className="page-inner"><ErrorState error={error} retry={() => void refetch()} /></div></>;
  if (isLoading && !project) return <div className="page-inner"><Skeleton lines={6} /></div>;
  if (!project) return null;
  const sections: Array<{ to: string; label: string; icon?: string; perm?: string; count?: number }> = [
    { to: '', label: 'Overview' },
    { to: 'estimate', label: 'Estimate', perm: 'estimates.read' },
    { to: 'budget', label: 'Budget', perm: 'budget.read' },
    { to: 'schedule', label: 'Schedule', perm: 'schedule.read' },
    { to: 'tasks', label: 'Tasks', perm: 'tasks.read', count: project.counts.openTasks },
    { to: 'daily-logs', label: 'Daily Logs', perm: 'daily_logs.read', count: project.counts.dailyLogs },
    { to: 'selections', label: 'Selections', perm: 'selections.read' },
    { to: 'change-orders', label: 'Change Orders', perm: 'change_orders.read' },
    { to: 'proposals', label: 'Proposals', perm: 'proposals.read' },
    { to: 'invoices', label: 'Invoices', perm: 'invoices.read' },
    { to: 'purchasing', label: 'Purchasing', perm: 'purchasing.read' },
    { to: 'documents', label: 'Documents', perm: 'documents.read', count: project.counts.documents },
    { to: 'messages', label: 'Messages', perm: 'messages.read', count: project.counts.unreadMessages },
    { to: 'time', label: 'Time', perm: 'time.clock' },
    { to: 'activity', label: 'Activity', perm: 'activity.read' },
    { to: 'team', label: 'Team' },
  ].filter((s) => !s.perm || session.has(s.perm));
  return <>
    <header className="project-header">
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <MenuToggle />
        <Button variant="quiet" icon="back" onClick={() => navigate('/projects')} aria-label="Back to projects">{compact ? '' : 'Projects'}</Button>
        <div className="title grow" style={{ minWidth: 0 }}>
          <span className="swatch" style={{ background: project.color }} />
          <h1 className="truncate" style={{ fontSize: 'var(--fs-xl)' }}>{project.number} · {project.name}</h1>
          <StatusBadge status={project.status} />
          {fromCache && <Badge tone="warning">Cached</Badge>}
        </div>
        <button className="btn quiet icon" aria-label={project.isFavorite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={project.isFavorite} onClick={() => favorite.mutate(!project.isFavorite)}><Icon name="star" style={{ fill: project.isFavorite ? 'var(--warning)' : 'none', color: project.isFavorite ? 'var(--warning)' : undefined }} /></button>
        {!session.membership?.external && session.membership?.defaultMode !== 'portal' && <Button variant="quiet" icon="hardhat" onClick={() => navigate(`/field/${project.id}`)}>{compact ? '' : 'Field mode'}</Button>}
        {session.has('projects.write') && <MenuButton items={[
          { label: 'Edit project', icon: 'edit', onSelect: () => setEditing(true) },
          ...(session.has('projects.archive') ? [{ label: project.archivedAt ? 'Restore project' : 'Archive project', icon: 'trash' as const, danger: !project.archivedAt, onSelect: () => setArchiving(true) }] : []),
        ]} />}
        <ToolbarActions />
      </div>
      <div className="subtle" style={{ padding: '2px 0 0 4px' }}>{project.clientName ?? 'No client'}{project.address.line1 ? ` · ${project.address.line1}${project.address.city ? `, ${project.address.city}` : ''}` : ''}</div>
      <nav className="section-bar" aria-label="Project sections">
        {sections.map((s) => <NavLink key={s.to} to={`/projects/${project.id}${s.to ? `/${s.to}` : ''}`} end={s.to === ''} className={({ isActive }) => (isActive ? 'active' : '')}>{s.label}{!!s.count && <Badge tone={s.to === 'messages' ? 'count' : 'neutral'}>{s.count}</Badge>}</NavLink>)}
      </nav>
    </header>
    <div className="page">
      <Suspense fallback={<div className="page-inner"><Spinner /></div>}>
        <Routes>
          <Route index element={<ProjectOverview project={project} />} />
          <Route path="schedule" element={<ProjectSchedule project={project} />} />
          <Route path="tasks" element={<ProjectTasks project={project} />} />
          <Route path="tasks/:taskId" element={<ProjectTasks project={project} />} />
          <Route path="daily-logs" element={<ProjectDailyLogs project={project} />} />
          <Route path="daily-logs/:logId" element={<ProjectDailyLogs project={project} />} />
          <Route path="documents" element={<ProjectDocuments project={project} />} />
          <Route path="messages" element={<ProjectMessages project={project} />} />
          <Route path="messages/:threadId" element={<ProjectMessages project={project} />} />
          <Route path="activity" element={<ProjectActivity project={project} />} />
          <Route path="team" element={<ProjectTeam project={project} />} />
          <Route path="estimate" element={<ProjectEstimate project={project} />} />
          <Route path="budget" element={<ProjectBudget project={project} />} />
          <Route path="selections" element={<ProjectSelections project={project} />} />
          <Route path="selections/:selectionId" element={<ProjectSelections project={project} />} />
          <Route path="change-orders" element={<ProjectChangeOrders project={project} />} />
          <Route path="change-orders/:coId" element={<ProjectChangeOrders project={project} />} />
          <Route path="proposals" element={<ProjectProposals project={project} />} />
          <Route path="proposals/:proposalId" element={<ProjectProposals project={project} />} />
          <Route path="invoices" element={<ProjectInvoices project={project} />} />
          <Route path="invoices/:invoiceId" element={<ProjectInvoices project={project} />} />
          <Route path="purchasing" element={<ProjectPurchasing project={project} />} />
          <Route path="time" element={<ProjectTime project={project} />} />
          <Route path="*" element={<Navigate to="" replace />} />
        </Routes>
      </Suspense>
    </div>
    {editing && <ProjectFormSheet open onClose={() => setEditing(false)} project={project} onSaved={() => void refetch()} />}
    <ConfirmDialog open={archiving} onClose={() => setArchiving(false)} danger={!project.archivedAt} title={project.archivedAt ? 'Restore project?' : 'Archive project?'} confirmLabel={project.archivedAt ? 'Restore' : 'Archive'} message={project.archivedAt ? 'The project will return to the active list.' : 'Archived projects are hidden from lists but keep every record. You can restore them later.'} onConfirm={async () => { try { await archive.mutateAsync(!project.archivedAt); toast({ message: project.archivedAt ? 'Project restored.' : 'Project archived.', tone: 'success' }); void refetch(); } catch (e) { errorToast(e); throw e; } }} />
  </>;
}
