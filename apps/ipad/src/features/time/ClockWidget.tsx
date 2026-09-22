import { useEffect, useState } from 'react';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Button, Field, Icon, Select, Skeleton, useErrorToast, useToast } from '../../ui/components';
import { location } from '../../native';
import { useCostCodes } from '../financial/shared';

export const fmtDuration = (seconds: number) => { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); return `${h}h ${String(m).padStart(2, '0')}m`; };

/** Live elapsed time for an open entry, minus breaks. */
export function useElapsed(entry: contracts.TimeEntry | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!entry || entry.status !== 'open') return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [entry?.id, entry?.status]);
  if (!entry) return 0;
  if (entry.status !== 'open') return entry.durationSeconds ?? 0;
  const breaks = entry.breaks.reduce((n, b) => n + Math.max(0, Math.round(((b.endedAt ? Date.parse(b.endedAt) : now) - Date.parse(b.startedAt)) / 1000)), 0);
  return Math.max(0, Math.round((now - Date.parse(entry.clockInAt)) / 1000) - breaks);
}

/** Big, one-tap clock in / break / clock out. Works anywhere: field mode, the project Time section, the company Time page. */
export function ClockWidget({ projectId, compact }: { projectId?: string; compact?: boolean }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: current, isLoading, refetch } = useResource<contracts.TimeEntry | null>('/v1/time/current');
  const { data: projects } = useResource<{ items: contracts.ProjectSummary[] }>(!current && !projectId ? '/v1/projects?status=open&limit=50' : null);
  const { data: codes } = useCostCodes();
  const [chosenProject, setChosenProject] = useState(projectId ?? '');
  const [costCodeId, setCostCodeId] = useState('');
  useEffect(() => { if (!chosenProject && projects?.items[0]) setChosenProject(projects.items[0].id); }, [projects]);
  const keys = ['/v1/time', '/v1/projects', '/v1/dashboard'];
  const clockIn = useApiMutation(async () => api.mutate<contracts.TimeEntry>('POST', '/v1/time/clock-in', { projectId: chosenProject || null, costCodeId: costCodeId || null, location: await location.current(), clientMutationId: crypto.randomUUID() }), keys);
  const clockOut = useApiMutation(async () => api.mutate<contracts.TimeEntry>('POST', '/v1/time/clock-out', { location: await location.current() }), keys);
  const breakToggle = useApiMutation((onBreak: boolean) => api.mutate<contracts.TimeEntry>('POST', onBreak ? '/v1/time/break/end' : '/v1/time/break/start', {}), keys);
  const elapsed = useElapsed(current);
  if (isLoading && current === undefined) return <Skeleton lines={2} />;
  if (current) {
    return <div className={`clock ${current.onBreak ? 'on-break' : 'running'}`} data-testid="clock-widget">
      <div className="clock-time" aria-live="polite">{fmtDuration(elapsed)}</div>
      <div className="subtle">{current.onBreak ? 'On break' : 'Clocked in'}{current.projectName ? ` · ${current.projectName}` : ''}{current.costCode ? ` · ${current.costCode}` : ''} · since {new Date(current.clockInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
      <div className="row wrap mt-4">
        <Button size="lg" icon="clock" loading={breakToggle.isPending} onClick={() => breakToggle.mutateAsync(current.onBreak).then(() => void refetch()).catch(errorToast)}>{current.onBreak ? 'End break' : 'Start break'}</Button>
        <Button size="lg" variant="danger" icon="checkCircle" loading={clockOut.isPending} data-testid="clock-out" onClick={() => clockOut.mutateAsync(undefined).then((r) => { toast({ message: `Clocked out: ${fmtDuration(r.data.durationSeconds ?? 0)} submitted for approval.`, tone: 'success' }); void refetch(); }).catch(errorToast)}>Clock out</Button>
      </div>
    </div>;
  }
  return <div className="clock idle" data-testid="clock-widget">
    <div className="clock-time muted">0h 00m</div>
    <div className={compact ? 'stack-sm mt-2' : 'row wrap mt-2'}>
      {!projectId && <Field label="Project"><Select value={chosenProject} onChange={(e) => setChosenProject(e.target.value)} aria-label="Clock in project"><option value="">No project</option>{projects?.items.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</Select></Field>}
      <Field label="Cost code"><Select value={costCodeId} onChange={(e) => setCostCodeId(e.target.value)} aria-label="Clock in cost code"><option value="">No cost code</option>{codes?.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></Field>
      <div style={{ alignSelf: 'end' }}><Button size="lg" variant="primary" icon="clock" loading={clockIn.isPending} data-testid="clock-in" onClick={() => clockIn.mutateAsync(undefined).then(() => { toast({ message: 'Clocked in.', tone: 'success' }); void refetch(); }).catch(errorToast)}>Clock in</Button></div>
    </div>
    <div className="subtle mt-2"><Icon name="info" size={12} /> Your location is recorded at clock in and out when the device allows it.</div>
  </div>;
}
