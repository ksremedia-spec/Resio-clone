import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Icon, Input, Select, Sheet, Skeleton, Stepper, Switch, Textarea, useErrorToast, useIsCompact, useKeyboardShortcut, useToast } from '../../ui/components';
import { dateLong, dateShort, todayIso } from '../../ui/format';
import { useSession } from '../../store/session';
import { camera, haptics, voice, type CapturedPhoto } from '../../native';

export default function ProjectDailyLogs({ project }: { project: contracts.ProjectDetail }) {
  const { logId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const compact = useIsCompact();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch, fromCache } = useResource<{ items: contracts.DailyLog[] }>(`/v1/projects/${project.id}/daily-logs?limit=60`);
  const creating = params.get('new') === '1';
  useKeyboardShortcut('mod+n', () => { if (session.has('daily_logs.write')) setParams({ new: '1' }); });
  const selected = data?.items.find((l) => l.id === logId) ?? null;
  const list = (
    <div className="split-list">
      {error && !data && <div style={{ padding: 16 }}><ErrorState error={error} retry={() => void refetch()} /></div>}
      {isLoading && !data && <div style={{ padding: 16 }}><Skeleton lines={5} /></div>}
      {data?.items.length === 0 && <EmptyState icon="log" title="No daily logs yet" action={session.has('daily_logs.write') ? <Button variant="primary" onClick={() => setParams({ new: '1' })}>Write today's log</Button> : undefined}>A log takes under a minute: weather, crew, work done, photos.</EmptyState>}
      <div className="list">{data?.items.map((l) => <button key={l.id} className={`list-row ${l.id === logId ? 'selected' : ''}`} onClick={() => navigate(`/projects/${project.id}/daily-logs/${l.id}`)} data-testid="daily-log-row">
        <span className="grow"><div className="primary">{dateLong(l.logDate)}</div><div className="secondary truncate">{l.summary || `${l.entries.length} entr${l.entries.length === 1 ? 'y' : 'ies'}`}</div><div className="subtle">{l.authorName} · {l.totals.headcount} crew · {l.totals.photoCount} photo{l.totals.photoCount === 1 ? '' : 's'}{l.totals.delayHours ? ` · ${l.totals.delayHours}h delay` : ''}</div></span>
        <span className="trailing">{l.clientVisible && <Badge tone="info">client</Badge>}{l.status === 'draft' && <Badge tone="warning">draft</Badge>}<Icon name="chevronRight" size={16} /></span>
      </button>)}</div>
    </div>
  );
  return <>
    <div className="row-between" style={{ padding: 'var(--sp-3) var(--sp-5) 0' }}>
      <div className="row">{compact && logId && <Button variant="quiet" icon="back" onClick={() => navigate(`/projects/${project.id}/daily-logs`)}>Logs</Button>}{fromCache && <Badge tone="warning">Cached</Badge>}</div>
      {session.has('daily_logs.write') && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New log</Button>}
    </div>
    <div className={`split ${compact ? 'stacked' : ''}`} style={{ marginTop: 12, minHeight: 0 }}>
      {(!compact || !logId) && list}
      {(!compact || logId) && <div className="split-detail">{selected ? <LogDetail log={selected} project={project} onEdit={() => setParams({ edit: selected.id })} /> : logId ? <div className="page-inner"><Skeleton lines={6} /></div> : <EmptyState icon="log" title="Select a log" />}</div>}
    </div>
    {(creating || params.get('edit')) && <DailyLogSheet project={project} log={params.get('edit') ? data?.items.find((l) => l.id === params.get('edit')) : undefined} onClose={() => setParams({})} onSaved={(l) => { void refetch(); navigate(`/projects/${project.id}/daily-logs/${l.id}`); }} />}
  </>;
}

function LogDetail({ log, project, onEdit }: { log: contracts.DailyLog; project: contracts.ProjectDetail; onEdit: () => void }) {
  const session = useSession();
  const w = log.weather;
  const byType = (t: string) => log.entries.filter((e) => e.type === t);
  const canEdit = session.has('daily_logs.write') && (session.has('projects.write') || log.createdBy === session.user?.id);
  return (
    <div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="row-between"><div><h2>{dateLong(log.logDate)}</h2><div className="subtle">{log.authorName}{log.submittedAt ? ` · submitted ${dateShort(log.submittedAt)}` : ''} · {log.clientVisible ? 'Shared with client' : 'Internal only'}</div></div>{canEdit && <Button icon="edit" onClick={onEdit}>Edit</Button>}</div>
      <div className="stat-row">
        <div className="stat"><div className="label">Weather</div><div className="value" style={{ fontSize: 'var(--fs-md)' }}>{w.conditions ?? '—'}{w.temperatureHighF != null ? ` · ${w.temperatureHighF}°` : ''}{w.temperatureLowF != null ? `/${w.temperatureLowF}°` : ''}</div></div>
        <div className="stat"><div className="label">Crew on site</div><div className="value">{log.totals.headcount}</div></div>
        <div className="stat"><div className="label">Labour hours</div><div className="value">{log.totals.laborHours}</div></div>
        <div className={`stat ${log.totals.delayHours ? 'warn' : ''}`}><div className="label">Delays</div><div className="value">{log.totals.delayHours}h</div></div>
      </div>
      {log.summary && <Card title="Summary"><p style={{ whiteSpace: 'pre-wrap' }}>{log.summary}</p></Card>}
      <div className="card-grid">
        {byType('crew').length > 0 && <Card title="Crew"><div className="stack-sm">{byType('crew').map((e) => <div key={e.id} className="row-between"><span>{e.trade ?? 'Crew'}</span><span className="num">{e.headcount ?? 0} × {e.hours ?? 0}h</span></div>)}</div></Card>}
        {byType('work').length > 0 && <Card title="Work completed"><ul style={{ margin: 0, paddingLeft: 18 }}>{byType('work').map((e) => <li key={e.id}>{e.text}</li>)}</ul></Card>}
        {byType('material').length > 0 && <Card title="Materials delivered"><ul style={{ margin: 0, paddingLeft: 18 }}>{byType('material').map((e) => <li key={e.id}>{e.text}{e.quantity != null ? ` (${e.quantity} ${e.unit ?? ''})` : ''}</li>)}</ul></Card>}
        {byType('equipment').length > 0 && <Card title="Equipment"><ul style={{ margin: 0, paddingLeft: 18 }}>{byType('equipment').map((e) => <li key={e.id}>{e.text}</li>)}</ul></Card>}
        {byType('visitor').length > 0 && <Card title="Visitors"><ul style={{ margin: 0, paddingLeft: 18 }}>{byType('visitor').map((e) => <li key={e.id}>{e.text}</li>)}</ul></Card>}
        {(byType('issue').length > 0 || byType('delay').length > 0 || byType('safety').length > 0) && <Card title="Issues & delays"><div className="stack-sm">{[...byType('issue'), ...byType('delay'), ...byType('safety')].map((e) => <div key={e.id} className="row" style={{ alignItems: 'flex-start' }}><Icon name="alert" size={16} style={{ color: 'var(--warning)', marginTop: 3 }} /><span>{e.type === 'delay' && <Badge tone="warning">{(e.delayCause ?? 'delay').replace('_', ' ')}{e.delayHours ? ` · ${e.delayHours}h` : ''}</Badge>} {e.text}</span></div>)}</div></Card>}
        {byType('note').length > 0 && <Card title="Notes">{byType('note').map((e) => <p key={e.id} style={{ whiteSpace: 'pre-wrap' }}>{e.text}</p>)}</Card>}
      </div>
      {log.photos.length > 0 && <Card title={`Photos (${log.photos.length})`} wide><div className="photo-grid">{log.photos.map((p) => <a key={p.id} className="photo" href={p.downloadUrl} target="_blank" rel="noreferrer"><img src={p.thumbnailUrl ?? p.downloadUrl} alt={p.name} loading="lazy" /></a>)}</div></Card>}
      {log.tags.length > 0 && <div className="row wrap">{log.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
      <div className="subtle">Project {project.number} · log #{log.id.slice(0, 8)} · permanent record</div>
    </div>
  );
}

interface EntryDraft { key: string; type: contracts.DailyLogEntry['type']; text: string; trade?: string; headcount?: number; hours?: number; delayCause?: string; delayHours?: number; quantity?: number; unit?: string }

/**
 * Fast daily log entry: designed to be completed in under a minute on site.
 * Big steppers for crew, chips for weather, camera and voice buttons, and it
 * queues offline (photos included).
 */
export function DailyLogSheet({ project, log, onClose, onSaved }: { project: contracts.ProjectDetail; log?: contracts.DailyLog; onClose: () => void; onSaved: (l: contracts.DailyLog) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const editing = !!log;
  const [logDate, setLogDate] = useState(log?.logDate ?? todayIso());
  const [conditions, setConditions] = useState(log?.weather.conditions ?? '');
  const [high, setHigh] = useState(log?.weather.temperatureHighF?.toString() ?? '');
  const [low, setLow] = useState(log?.weather.temperatureLowF?.toString() ?? '');
  const [summary, setSummary] = useState(log?.summary ?? '');
  const [clientVisible, setClientVisible] = useState(log?.clientVisible ?? true);
  const [tags, setTags] = useState(log?.tags.join(', ') ?? '');
  const [entries, setEntries] = useState<EntryDraft[]>(() => log ? log.entries.map((e) => ({ key: e.id, type: e.type, text: e.text, trade: e.trade ?? undefined, headcount: e.headcount ?? undefined, hours: e.hours ?? undefined, delayCause: e.delayCause ?? undefined, delayHours: e.delayHours ?? undefined, quantity: e.quantity ?? undefined, unit: e.unit ?? undefined })) : [{ key: crypto.randomUUID(), type: 'crew', text: '', trade: 'Crew', headcount: 0, hours: 8 }]);
  const [photos, setPhotos] = useState<Array<{ id: string; url: string; queued: boolean; name: string }>>(() => log?.photos.map((p) => ({ id: p.id, url: p.thumbnailUrl ?? p.downloadUrl ?? '', queued: false, name: p.name })) ?? []);
  const [uploading, setUploading] = useState(false);
  const [dictating, setDictating] = useState<{ stop(): void } | null>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const addEntry = (type: EntryDraft['type']) => setEntries((es) => [...es, { key: crypto.randomUUID(), type, text: '', ...(type === 'crew' ? { trade: '', headcount: 1, hours: 8 } : type === 'delay' ? { delayCause: 'weather', delayHours: 1 } : {}) }]);
  const update = (key: string, patch: Partial<EntryDraft>) => setEntries((es) => es.map((e) => e.key === key ? { ...e, ...patch } : e));
  const addPhoto = async (source: 'camera' | 'library') => {
    const shot: CapturedPhoto | null = await camera.capture(source).catch(() => null);
    if (!shot) return;
    setUploading(true);
    try {
      const res = await api.upload<contracts.Document>('/v1/documents/upload', shot.blob, shot.filename, { projectId: project.id, tags: ['daily-log', logDate], clientVisible, photo: { takenAt: shot.takenAt, latitude: shot.latitude, longitude: shot.longitude } }, { queue: { entity: 'document', label: `Upload photo ${shot.filename}`, optimistic: { id: crypto.randomUUID() }, invalidates: [`/v1/documents?projectId=${project.id}`] } });
      const local = URL.createObjectURL(shot.blob);
      setPhotos((ps) => [...ps, { id: res.data.id, url: res.queued ? local : res.data.thumbnailUrl ?? local, queued: res.queued, name: shot.filename }]);
      void haptics.success();
      if (res.queued) toast({ message: 'Photo saved on this iPad. It will upload when you are back online.' });
    } catch (e) { errorToast(e, 'Unable to add the photo.'); } finally { setUploading(false); }
  };
  const toggleDictation = () => {
    if (dictating) { dictating.stop(); setDictating(null); return; }
    const base = summary;
    const handle = voice.start((text, final) => { setSummary(base ? `${base} ${text}` : text); if (final) setDictating(null); });
    if (!handle) { toast({ message: 'Voice dictation is not available in this browser. On iPad, use the microphone key on the keyboard.', tone: 'error' }); return; }
    setDictating(handle);
    summaryRef.current?.focus();
  };
  useEffect(() => () => dictating?.stop(), [dictating]);
  const save = useApiMutation(async () => {
    const body = {
      logDate, summary, clientVisible, status: 'submitted' as const, tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      weather: { conditions: conditions || null, temperatureHighF: high ? Number(high) : null, temperatureLowF: low ? Number(low) : null, source: 'manual' as const },
      entries: entries.filter((e) => e.type === 'crew' ? (e.headcount ?? 0) > 0 : e.text.trim() || e.type === 'delay').map((e) => ({ type: e.type, text: e.text, trade: e.trade || null, headcount: e.headcount ?? null, hours: e.hours ?? null, delayCause: (e.delayCause as any) ?? null, delayHours: e.delayHours ?? null, quantity: e.quantity ?? null, unit: e.unit || null })),
      photoDocumentIds: photos.map((p) => p.id),
    };
    if (editing) return api.mutate<contracts.DailyLog>('PATCH', `/v1/daily-logs/${log!.id}`, { ...body, expectedVersion: log!.version }, { queue: { entity: 'daily_log', label: `Update daily log ${logDate}`, optimistic: { ...log!, ...body }, invalidates: [`/v1/projects/${project.id}`] } });
    const id = crypto.randomUUID();
    return api.mutate<contracts.DailyLog>('POST', `/v1/projects/${project.id}/daily-logs`, { ...body, id, clientMutationId: crypto.randomUUID() }, { queue: { entity: 'daily_log', label: `Daily log for ${logDate}${photos.length ? ` (${photos.length} photos)` : ''}`, optimistic: { id, projectId: project.id, ...body, version: 1, authorName: 'You', entries: [], photos: [], attachments: [], totals: { headcount: 0, laborHours: 0, delayHours: 0, photoCount: photos.length }, submittedAt: null, organizationId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: null, updatedBy: null }, invalidates: [`/v1/projects/${project.id}`, '/v1/daily-logs'] } });
  }, [`/v1/projects/${project.id}`, '/v1/daily-logs', '/v1/dashboard']);
  const submit = async () => {
    try { const r = await save.mutateAsync(undefined); void haptics.success(); toast({ message: r.queued ? 'Log saved on this iPad and queued to sync.' : editing ? 'Daily log updated.' : 'Daily log posted.', tone: r.queued ? undefined : 'success' }); onClose(); onSaved(r.data); }
    catch (e) { errorToast(e); }
  };
  const weatherChips = ['Sunny', 'Partly cloudy', 'Overcast', 'Rain', 'Storms', 'Snow', 'Windy'];
  return (
    <Sheet open onClose={onClose} title={editing ? 'Edit daily log' : 'Daily log'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" size="lg" loading={save.isPending || uploading} onClick={submit} data-testid="save-log">{editing ? 'Save' : 'Post log'}</Button></>}>
      <div className="stack" style={{ gap: 'var(--sp-5)' }}>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Date"><Input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} style={{ width: 190 }} /></Field>
          <Field label="Weather"><div className="row wrap">{weatherChips.map((w) => <button key={w} type="button" className={`chip ${conditions === w ? 'on' : ''}`} aria-pressed={conditions === w} onClick={() => setConditions(w)}>{w}</button>)}</div></Field>
          <Field label="High °F"><Input inputMode="numeric" value={high} onChange={(e) => setHigh(e.target.value)} style={{ width: 90 }} /></Field>
          <Field label="Low °F"><Input inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} style={{ width: 90 }} /></Field>
        </div>
        <div>
          <div className="row-between mb-2"><h4>Crew on site</h4><Button size="sm" icon="plus" onClick={() => addEntry('crew')}>Trade</Button></div>
          <div className="stack-sm">{entries.filter((e) => e.type === 'crew').map((e) => <div key={e.key} className="row wrap"><Input placeholder="Trade (framers, plumbers…)" value={e.trade ?? ''} onChange={(ev) => update(e.key, { trade: ev.target.value })} style={{ maxWidth: 260 }} /><Stepper label="Headcount" value={e.headcount ?? 0} onChange={(v) => update(e.key, { headcount: v })} /><span className="muted">people ×</span><Stepper label="Hours" value={e.hours ?? 0} onChange={(v) => update(e.key, { hours: v })} max={24} /><span className="muted">hours</span><Button size="sm" variant="quiet" icon="close" aria-label="Remove" onClick={() => setEntries((es) => es.filter((x) => x.key !== e.key))} /></div>)}</div>
        </div>
        <Field label="Summary of the day">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <Textarea ref={summaryRef} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What got done, what's next, anything the client should know…" rows={3} data-testid="log-summary" />
            <Button variant={dictating ? 'danger' : 'default'} icon="mic" aria-label={dictating ? 'Stop dictation' : 'Dictate'} onClick={toggleDictation} />
          </div>
        </Field>
        <div className="row wrap">
          {(['work', 'material', 'equipment', 'visitor', 'issue', 'delay', 'note', 'safety'] as const).map((t) => <button key={t} type="button" className="chip" onClick={() => addEntry(t)}><Icon name="plus" size={14} />{t === 'work' ? 'Work completed' : t === 'material' ? 'Material delivered' : t === 'visitor' ? 'Visitor' : t[0]!.toUpperCase() + t.slice(1)}</button>)}
        </div>
        <div className="stack-sm">{entries.filter((e) => e.type !== 'crew').map((e) => <div key={e.key} className="row" style={{ alignItems: 'flex-start' }}>
          <Badge tone={e.type === 'delay' || e.type === 'issue' || e.type === 'safety' ? 'warning' : 'neutral'} className="mt-2" style={{ minWidth: 92, justifyContent: 'center', marginTop: 12 } as any}>{e.type}</Badge>
          <div className="grow stack-sm">
            <Input value={e.text} onChange={(ev) => update(e.key, { text: ev.target.value })} placeholder={e.type === 'delay' ? 'What was delayed and why' : e.type === 'material' ? 'What arrived' : 'Details'} autoFocus={!e.text} />
            {e.type === 'delay' && <div className="row"><Select value={e.delayCause ?? 'weather'} onChange={(ev) => update(e.key, { delayCause: ev.target.value })} style={{ maxWidth: 200 }}>{contracts.DELAY_CAUSES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</Select><Stepper label="Delay hours" value={e.delayHours ?? 0} onChange={(v) => update(e.key, { delayHours: v })} max={24} /><span className="muted">hours lost</span></div>}
            {e.type === 'material' && <div className="row"><Input inputMode="decimal" placeholder="Qty" value={e.quantity ?? ''} onChange={(ev) => update(e.key, { quantity: ev.target.value ? Number(ev.target.value) : undefined })} style={{ width: 100 }} /><Input placeholder="Unit" value={e.unit ?? ''} onChange={(ev) => update(e.key, { unit: ev.target.value })} style={{ width: 100 }} /></div>}
          </div>
          <Button size="sm" variant="quiet" icon="close" aria-label="Remove entry" onClick={() => setEntries((es) => es.filter((x) => x.key !== e.key))} style={{ marginTop: 4 }} />
        </div>)}</div>
        <div>
          <div className="row-between mb-2"><h4>Photos</h4><div className="row"><Button icon="camera" loading={uploading} onClick={() => addPhoto('camera')} data-testid="add-photo">Camera</Button><Button icon="photo" onClick={() => addPhoto('library')}>Library</Button></div></div>
          {photos.length > 0 && <div className="photo-grid">{photos.map((p) => <div key={p.id} className="photo"><img src={p.url} alt={p.name} />{p.queued && <span className="queued">Waiting to upload</span>}<button className="btn quiet icon" style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.4)', color: '#fff' }} aria-label="Remove photo" onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}><Icon name="close" size={16} /></button></div>)}</div>}
        </div>
        <div className="form-grid">
          <Field label="Tags" hint="Comma separated"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="framing, inspection" /></Field>
          <div style={{ alignSelf: 'end' }}><Switch label="Share with client" hint="Client sees weather, crew, work and photos — never internal notes or costs." checked={clientVisible} onChange={setClientVisible} /></div>
        </div>
      </div>
    </Sheet>
  );
}
