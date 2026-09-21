import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { scheduleCalc, type contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, EmptyState, ErrorState, Field, Icon, Input, Segmented, Sheet, Skeleton, Switch, useErrorToast, useToast } from '../../ui/components';
import { dateShort, todayIso } from '../../ui/format';
import { useSession } from '../../store/session';
import { TaskSheet } from '../tasks/TaskSheet';

type View = 'list' | 'gantt' | 'calendar';

export default function ProjectSchedule({ project }: { project: contracts.ProjectDetail }) {
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>((localStorage.getItem('buildline.scheduleView') as View) || 'gantt');
  const { data, isLoading, error, refetch, fromCache } = useResource<contracts.ScheduleResponse>(`/v1/projects/${project.id}/schedule`);
  const [editing, setEditing] = useState<contracts.Task | null>(null);
  const [phaseSheet, setPhaseSheet] = useState(false);
  const canWrite = session.has('schedule.write');
  const setV = (v: View) => { setView(v); localStorage.setItem('buildline.scheduleView', v); };
  const creating = params.get('new') === '1';
  return (
    <div className="page-inner stack">
      <div className="row wrap">
        <Segmented value={view} onChange={setV} ariaLabel="Schedule view" options={[{ value: 'list', label: 'List', icon: 'list' }, { value: 'gantt', label: 'Timeline', icon: 'gantt' }, { value: 'calendar', label: 'Calendar', icon: 'calendar' }]} />
        {data && data.conflicts.length > 0 && <Badge tone="danger">{data.conflicts.length} conflict{data.conflicts.length === 1 ? '' : 's'}</Badge>}
        {fromCache && <Badge tone="warning">Cached</Badge>}
        <span className="grow" />
        {canWrite && <><Button onClick={() => setPhaseSheet(true)}>Phase</Button><Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>Task</Button></>}
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={6} /></div>}
      {data && data.tasks.length === 0 && <EmptyState icon="schedule" title="No schedule yet" action={canWrite ? <Button variant="primary" onClick={() => setParams({ new: '1' })}>Add the first task</Button> : undefined}>Add phases and tasks; link them with dependencies so a slip moves everything downstream.</EmptyState>}
      {data && data.conflicts.length > 0 && <div className="banner offline" style={{ borderRadius: 12 }}><Icon name="users" size={18} /><span>{data.conflicts.map((c) => `${c.resourceName}: ${data.tasks.find((t) => t.id === c.taskIds[0])?.name} overlaps ${data.tasks.find((t) => t.id === c.taskIds[1])?.name} (${dateShort(c.overlapStart)}–${dateShort(c.overlapEnd)})`).join(' · ')}</span></div>}
      {data && data.tasks.length > 0 && view === 'list' && <ScheduleList data={data} onOpen={setEditing} />}
      {data && data.tasks.length > 0 && view === 'gantt' && <Gantt data={data} projectId={project.id} canWrite={canWrite} onOpen={setEditing} onChanged={() => void refetch()} />}
      {data && data.tasks.length > 0 && view === 'calendar' && <Calendar data={data} onOpen={setEditing} />}
      {creating && <TaskSheet projectId={project.id} defaults={{ kind: 'schedule' }} onClose={() => setParams({})} />}
      {editing && <TaskSheet projectId={project.id} task={editing} onClose={() => { setEditing(null); void refetch(); }} />}
      {phaseSheet && <PhaseSheet projectId={project.id} phases={data?.phases ?? []} onClose={() => { setPhaseSheet(false); void refetch(); }} />}
    </div>
  );
}

function groupByPhase(data: contracts.ScheduleResponse) {
  const groups = data.phases.map((p) => ({ phase: p as contracts.Phase | null, tasks: data.tasks.filter((t) => t.phaseId === p.id) }));
  const loose = data.tasks.filter((t) => !t.phaseId || !data.phases.some((p) => p.id === t.phaseId));
  if (loose.length) groups.push({ phase: null, tasks: loose });
  return groups;
}

function ScheduleList({ data, onOpen }: { data: contracts.ScheduleResponse; onOpen: (t: contracts.Task) => void }) {
  const today = todayIso();
  return <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
    <table className="table"><thead><tr><th>Task</th><th>Start</th><th>End</th><th className="num">Days</th><th>Assigned</th><th>Status</th></tr></thead><tbody>
      {groupByPhase(data).map(({ phase, tasks }) => <>
        <tr key={phase?.id ?? 'none'} style={{ background: 'var(--bg-sunken)' }}><td colSpan={6} style={{ fontWeight: 700 }}>{phase?.name ?? 'Unphased'} <span className="subtle">{phase ? `${phase.completeCount}/${phase.taskCount} complete` : ''}</span></td></tr>
        {tasks.map((t) => <tr key={t.id} onClick={() => onOpen(t)} style={{ cursor: 'pointer' }}>
          <td><span className="row">{t.isMilestone && <Icon name="flag" size={14} />}{t.name}{t.isCritical && <Badge tone="danger">critical</Badge>}{t.predecessors.length > 0 && <Badge>{t.predecessors.length} dep</Badge>}</span></td>
          <td className="num">{dateShort(t.startDate)}</td><td className="num" style={{ color: t.status !== 'complete' && t.endDate && t.endDate < today ? 'var(--danger)' : undefined }}>{dateShort(t.endDate)}</td><td className="num">{t.durationDays}</td>
          <td className="truncate" style={{ maxWidth: 200 }}>{t.assignees.map((a) => a.displayName).join(', ')}</td><td><Badge tone={t.status === 'complete' ? 'success' : t.status === 'in_progress' ? 'brand' : t.status === 'blocked' ? 'danger' : 'neutral'}>{t.status.replace('_', ' ')}</Badge></td>
        </tr>)}
      </>)}
    </tbody></table>
  </div>;
}

const DAY_W = 34;

/** Drag-and-drop timeline. Dragging a bar previews the move through the API (cascade included) and commits on release. */
function Gantt({ data, projectId, canWrite, onOpen, onChanged }: { data: contracts.ScheduleResponse; projectId: string; canWrite: boolean; onOpen: (t: contracts.Task) => void; onChanged: () => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const today = todayIso();
  const dated = data.tasks.filter((t) => t.startDate && t.endDate);
  const min = dated.reduce((m, t) => (t.startDate! < m ? t.startDate! : m), today);
  const max = dated.reduce((m, t) => (t.endDate! > m ? t.endDate! : m), today);
  const start = scheduleCalc.addCalendarDays(min, -3);
  const days = useMemo(() => { const out: string[] = []; let cur = start; const end = scheduleCalc.addCalendarDays(max, 7); while (cur <= end) { out.push(cur); cur = scheduleCalc.addCalendarDays(cur, 1); } return out; }, [start, max]);
  const dayIndex = (iso: string) => Math.round((Date.parse(iso) - Date.parse(start)) / 86_400_000);
  const [drag, setDrag] = useState<{ id: string; dx: number; mode: 'move' | 'resize' } | null>(null);
  const [preview, setPreview] = useState<Map<string, { startDate: string; endDate: string }>>(new Map());
  const dragStart = useRef<{ x: number; task: contracts.Task; mode: 'move' | 'resize' } | null>(null);
  const move = useApiMutation((input: { id: string; startDate?: string; durationDays?: number; commit: boolean }) => api.mutate<{ changes: Array<{ id: string; name: string; to: { startDate: string; endDate: string } }>; committed: boolean }>('POST', `/v1/tasks/${input.id}/move`, input), (i) => (i.commit ? [`/v1/projects/${projectId}`, '/v1/tasks', '/v1/dashboard'] : []));
  const onPointerDown = (e: React.PointerEvent, t: contracts.Task, mode: 'move' | 'resize') => { if (!canWrite || t.locked) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); dragStart.current = { x: e.clientX, task: t, mode }; setDrag({ id: t.id, dx: 0, mode }); };
  const onPointerMove = (e: React.PointerEvent) => { if (!dragStart.current) return; setDrag({ id: dragStart.current.task.id, dx: e.clientX - dragStart.current.x, mode: dragStart.current.mode }); };
  const onPointerUp = async () => {
    if (!dragStart.current || !drag) return;
    const { task, mode } = dragStart.current;
    const deltaDays = Math.round(drag.dx / DAY_W);
    dragStart.current = null; setDrag(null);
    if (deltaDays === 0) return;
    const input = mode === 'move' ? { id: task.id, startDate: scheduleCalc.addCalendarDays(task.startDate!, deltaDays), commit: false } : { id: task.id, durationDays: Math.max(task.isMilestone ? 0 : 1, task.durationDays + deltaDays), commit: false };
    try {
      const prev = await move.mutateAsync(input);
      const map = new Map(prev.data.changes.map((c) => [c.id, c.to]));
      setPreview(map);
      const downstream = prev.data.changes.filter((c) => c.id !== task.id);
      const proceed = downstream.length === 0 || confirm(`Moving "${task.name}" also reschedules ${downstream.length} dependent task${downstream.length === 1 ? '' : 's'}: ${downstream.map((c) => c.name).slice(0, 4).join(', ')}${downstream.length > 4 ? '…' : ''}. Continue?`);
      if (proceed) { await move.mutateAsync({ ...input, commit: true }); toast({ message: `Rescheduled ${prev.data.changes.length} task${prev.data.changes.length === 1 ? '' : 's'}.`, tone: 'success' }); onChanged(); }
    } catch (err) { errorToast(err); } finally { setPreview(new Map()); }
  };
  const rows = groupByPhase(data);
  return (
    <div className="gantt">
      <div className="gantt-names">
        <div className="gantt-head" style={{ paddingLeft: 12, alignItems: 'center' }}>Task</div>
        {rows.map(({ phase, tasks }) => <div key={phase?.id ?? 'none'}><div className="gantt-row phase truncate">{phase?.name ?? 'Unphased'}</div>{tasks.map((t) => <div key={t.id} className="gantt-row"><button className="btn quiet sm truncate" style={{ justifyContent: 'flex-start', width: '100%' }} onClick={() => onOpen(t)}>{t.isMilestone && <Icon name="flag" size={14} />}<span className="truncate">{t.name}</span></button></div>)}</div>)}
      </div>
      <div className="gantt-scroll" style={{ '--day-w': `${DAY_W}px` } as any}>
        <div style={{ width: days.length * DAY_W, position: 'relative' }}>
          <div className="gantt-head">{days.map((d) => { const dt = new Date(`${d}T12:00:00`); const we = dt.getDay() === 0 || dt.getDay() === 6; return <div key={d} className={`gantt-day ${we ? 'weekend' : ''} ${d === today ? 'today' : ''}`} style={{ width: DAY_W }} title={d}>{dt.getDate() === 1 || d === start ? dt.toLocaleDateString(undefined, { month: 'short' }) : dt.getDate()}</div>; })}</div>
          {rows.map(({ phase, tasks }) => <div key={phase?.id ?? 'none'}>
            <div className="gantt-lane phase"><div className="gantt-grid" /></div>
            {tasks.map((t) => {
              if (!t.startDate || !t.endDate) return <div key={t.id} className="gantt-lane"><div className="gantt-grid" /></div>;
              const p = preview.get(t.id);
              const s = p?.startDate ?? t.startDate; const e = p?.endDate ?? t.endDate;
              const isDragging = drag?.id === t.id;
              const left = dayIndex(s) * DAY_W + (isDragging && drag.mode === 'move' ? drag.dx : 0);
              const width = Math.max(DAY_W, (dayIndex(e) - dayIndex(s) + 1) * DAY_W + (isDragging && drag.mode === 'resize' ? drag.dx : 0));
              return <div key={t.id} className="gantt-lane"><div className="gantt-grid" />
                <div className={`gantt-bar ${t.status === 'complete' ? 'complete' : ''} ${t.isCritical ? 'critical' : ''} ${t.isMilestone ? 'milestone' : ''} ${isDragging ? 'dragging' : ''}`} style={{ left, width: t.isMilestone ? undefined : width, background: t.isMilestone ? undefined : t.color ?? undefined }} role="button" tabIndex={0} aria-label={`${t.name} ${dateShort(s)} to ${dateShort(e)}`} title={`${t.name}: ${s} → ${e}`}
                  onPointerDown={(ev) => onPointerDown(ev, t, 'move')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { dragStart.current = null; setDrag(null); }} onDoubleClick={() => onOpen(t)} onKeyDown={(ev) => { if (ev.key === 'Enter') onOpen(t); }}>
                  {!t.isMilestone && <><span className="truncate">{t.name}</span>{canWrite && <span className="handle r" onPointerDown={(ev) => { ev.stopPropagation(); onPointerDown(ev, t, 'resize'); }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />}</>}
                </div>
              </div>;
            })}
          </div>)}
        </div>
      </div>
    </div>
  );
}

function Calendar({ data, onOpen }: { data: contracts.ScheduleResponse; onOpen: (t: contracts.Task) => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const today = todayIso();
  const first = new Date(month.y, month.m, 1);
  const startOffset = first.getDay();
  const cells: string[] = [];
  const startDate = new Date(month.y, month.m, 1 - startOffset);
  for (let i = 0; i < 42; i++) { const d = new Date(startDate); d.setDate(startDate.getDate() + i); cells.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
  const inMonth = (iso: string) => Number(iso.slice(5, 7)) - 1 === month.m;
  return <div className="stack">
    <div className="row"><Button icon="chevronLeft" aria-label="Previous month" onClick={() => setMonth((m) => (m.m === 0 ? { y: m.y - 1, m: 11 } : { y: m.y, m: m.m - 1 }))} /><h3>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3><Button icon="chevronRight" aria-label="Next month" onClick={() => setMonth((m) => (m.m === 11 ? { y: m.y + 1, m: 0 } : { y: m.y, m: m.m + 1 }))} /><Button variant="quiet" onClick={() => { const d = new Date(); setMonth({ y: d.getFullYear(), m: d.getMonth() }); }}>Today</Button></div>
    <div className="calendar">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="calendar-head">{d}</div>)}
      {cells.map((iso) => <div key={iso} className={`calendar-cell ${inMonth(iso) ? '' : 'other'} ${iso === today ? 'today' : ''}`}><div className="day">{Number(iso.slice(8))}</div>
        {data.tasks.filter((t) => t.startDate && t.endDate && t.startDate <= iso && t.endDate >= iso).slice(0, 4).map((t) => <button key={t.id} className={`calendar-event ${t.status === 'complete' ? 'complete' : ''}`} style={{ width: '100%', textAlign: 'left', border: 0 }} onClick={() => onOpen(t)}>{t.isMilestone ? '◆ ' : ''}{t.name}</button>)}
      </div>)}
    </div>
  </div>;
}

function PhaseSheet({ projectId, phases, onClose }: { projectId: string; phases: contracts.Phase[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [clientVisible, setClientVisible] = useState(true);
  const errorToast = useErrorToast();
  const create = useApiMutation(() => api.mutate('POST', `/v1/projects/${projectId}/phases`, { name, clientVisible }), [`/v1/projects/${projectId}`]);
  const remove = useApiMutation((id: string) => api.mutate('DELETE', `/v1/projects/${projectId}/phases/${id}`), [`/v1/projects/${projectId}`]);
  return (
    <Sheet open onClose={onClose} title="Phases" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="stack">
        <div className="list">{phases.map((p) => <div key={p.id} className="list-row" style={{ padding: '8px 0' }}><span className="grow"><div className="primary">{p.name}</div><div className="secondary">{p.taskCount} task{p.taskCount === 1 ? '' : 's'}{p.startDate ? ` · ${dateShort(p.startDate)} → ${dateShort(p.endDate)}` : ''}</div></span><Button size="sm" variant="quiet" icon="trash" aria-label="Delete phase" onClick={() => remove.mutateAsync(p.id).catch(errorToast)} /></div>)}</div>
        <Field label="New phase"><div className="row"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Framing" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { void create.mutateAsync(undefined).then(() => setName('')).catch(errorToast); } }} /><Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutateAsync(undefined).then(() => setName('')).catch(errorToast)}>Add</Button></div></Field>
        <Switch label="Visible to client" checked={clientVisible} onChange={setClientVisible} />
      </div>
    </Sheet>
  );
}
