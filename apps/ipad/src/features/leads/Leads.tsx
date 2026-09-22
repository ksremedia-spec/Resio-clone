import { useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Icon, Input, ListRow, MenuButton, SearchField, Segmented, Select, Sheet, Skeleton, Textarea, Toolbar, useDebounced, useErrorToast, useIsCompact, useKeyboardShortcut, useToast } from '../../ui/components';
import { dateShort, dateTime, humanize, money, timeAgo, todayIso } from '../../ui/format';
import { useSession } from '../../store/session';
import { MoneyInput } from '../financial/shared';

const STAGE_LABELS: Record<contracts.LeadStage, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', estimating: 'Estimating', proposal_sent: 'Proposal sent', won: 'Won', lost: 'Lost' };
const STAGE_TONE: Record<contracts.LeadStage, 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'> = { new: 'info', contacted: 'info', qualified: 'brand', estimating: 'brand', proposal_sent: 'warning', won: 'success', lost: 'danger' };
const SOURCE_LABELS: Record<string, string> = { referral: 'Referral', website: 'Website', social: 'Social media', repeat_client: 'Repeat client', architect: 'Architect / designer', walk_in: 'Walk-in', other: 'Other' };
const followUpDue = (l: contracts.Lead) => !!l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() <= Date.now();

/** Sales pipeline: a board for the whole funnel, a list for working one lead at a time. */
export default function Leads() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const compact = useIsCompact();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'board' | 'list'>(() => { try { return (localStorage.getItem('buildline.leadsView') as 'board' | 'list') || 'board'; } catch { return 'board'; } });
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('open');
  const debounced = useDebounced(q);
  const creating = params.get('new') === '1';
  const canWrite = session.has('leads.write');
  useKeyboardShortcut('mod+n', () => { if (canWrite) setParams({ new: '1' }); });
  const { data: board, isLoading, error, refetch } = useResource<{ columns: Array<{ stage: contracts.LeadStage; count: number; valueCents: number; leads: contracts.Lead[] }> }>('/v1/leads/board');
  const { data: list } = useResource<{ items: contracts.Lead[] }>(view === 'list' ? `/v1/leads?limit=200&stage=${stage}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}` : null);
  const switchView = (v: 'board' | 'list') => { setView(v); try { localStorage.setItem('buildline.leadsView', v); } catch { /* ignore */ } };
  const open = board?.columns.filter((c) => !['won', 'lost'].includes(c.stage)) ?? [];
  const openCount = open.reduce((n, c) => n + c.count, 0);
  const openValue = open.reduce((n, c) => n + c.valueCents, 0);
  const dueCount = open.flatMap((c) => c.leads).filter(followUpDue).length;

  const listPane = (
    <div className="split-list">
      <div style={{ padding: 'var(--sp-3) var(--sp-4)' }} className="stack-sm">
        <SearchField value={q} onChange={setQ} placeholder="Search leads" />
        <Select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage filter"><option value="open">Open leads</option>{contracts.LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}<option value="closed">Won and lost</option><option value="all">Everything</option></Select>
      </div>
      {!list && <div style={{ padding: 16 }}><Skeleton lines={5} /></div>}
      {list?.items.length === 0 && <EmptyState icon="leads" title={debounced ? 'No matches' : 'No leads here'} />}
      <div className="list">{list?.items.map((l) => <ListRow key={l.id} selected={l.id === leadId} onClick={() => navigate(`/leads/${l.id}`)} leading={<Avatar name={l.contactName ?? l.name} />} primary={l.name} secondary={`${STAGE_LABELS[l.stage]} · ${money(l.estimatedValueCents)}${l.contactName ? ` · ${l.contactName}` : ''}`} trailing={<>{followUpDue(l) && <Badge tone="warning">Follow up</Badge>}<Icon name="chevronRight" size={16} /></>} data-testid="lead-row" />)}</div>
    </div>
  );

  return <>
    <Toolbar title="Leads" leading={<>{compact && leadId && view === 'list' ? <Button variant="quiet" icon="back" onClick={() => navigate('/leads')} aria-label="Back" /> : <MenuToggle />}</>}>
      {!compact && <Segmented value={view} onChange={switchView} ariaLabel="Leads view" options={[{ value: 'board', label: 'Board', icon: 'layout' }, { value: 'list', label: 'List', icon: 'list' }]} />}
      {canWrite && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New lead</Button>}
      <ToolbarActions />
    </Toolbar>
    {view === 'board' && !compact ? (
      <div className="page"><div className="page-inner stack" style={{ gap: 'var(--sp-4)', maxWidth: 'none' }}>
        <div className="stat-row">
          <div className="stat"><div className="label">Open leads</div><div className="value">{openCount}</div></div>
          <div className="stat"><div className="label">Pipeline value</div><div className="value">{money(openValue)}</div></div>
          <div className={`stat ${dueCount ? 'warn' : ''}`}><div className="label">Follow-ups due</div><div className="value">{dueCount}</div></div>
          <div className="stat"><div className="label">Won (90 days)</div><div className="value">{board?.columns.find((c) => c.stage === 'won')?.count ?? 0}</div></div>
        </div>
        {error && !board && <ErrorState error={error} retry={() => void refetch()} />}
        {isLoading && !board && <Skeleton lines={6} />}
        {board && <div className="kanban" data-testid="lead-board">{board.columns.map((col) => (
          <section key={col.stage} className={`kanban-col ${col.stage}`} aria-label={STAGE_LABELS[col.stage]}>
            <header className="row-between"><strong>{STAGE_LABELS[col.stage]}</strong><span className="subtle">{col.count}{col.valueCents ? ` · ${money(col.valueCents)}` : ''}</span></header>
            <div className="stack-sm">
              {col.leads.map((l) => <button key={l.id} type="button" className="kanban-card" onClick={() => navigate(`/leads/${l.id}`)} data-testid="lead-card">
                <div className="row-between"><strong className="truncate">{l.name}</strong>{followUpDue(l) && <Icon name="alert" size={14} style={{ color: 'var(--warning)' }} />}</div>
                <div className="subtle truncate">{l.contactName ?? '—'}{l.source ? ` · ${SOURCE_LABELS[l.source] ?? humanize(l.source)}` : ''}</div>
                <div className="row-between"><span style={{ fontWeight: 600 }}>{money(l.estimatedValueCents)}</span><span className="subtle">{l.stage === 'won' || l.stage === 'lost' ? timeAgo(l.updatedAt) : `${l.daysInStage ?? 0}d in stage`}</span></div>
              </button>)}
              {col.leads.length === 0 && <div className="subtle" style={{ padding: 'var(--sp-2)' }}>Nothing here</div>}
            </div>
          </section>
        ))}</div>}
      </div></div>
    ) : (
      <div className={`split ${compact ? 'stacked' : ''}`} style={{ flex: 1, minHeight: 0 }}>
        {(!compact || !leadId) && listPane}
        {(!compact || leadId) && <div className="split-detail">{leadId ? <LeadDetail leadId={leadId} onGone={() => navigate('/leads')} /> : <EmptyState icon="leads" title="Select a lead">Contact details, stage history and follow-ups appear here.</EmptyState>}</div>}
      </div>
    )}
    {view === 'board' && !compact && leadId && <Sheet open onClose={() => navigate('/leads')} title="Lead" size="lg"><LeadDetail leadId={leadId} onGone={() => navigate('/leads')} inSheet /></Sheet>}
    {creating && <LeadFormSheet onClose={() => setParams({})} onSaved={(l) => navigate(`/leads/${l.id}`)} />}
  </>;
}

function LeadDetail({ leadId, onGone, inSheet }: { leadId: string; onGone: () => void; inSheet?: boolean }) {
  const session = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: lead, error, refetch } = useResource<contracts.Lead>(`/v1/leads/${leadId}`);
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [losing, setLosing] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [note, setNote] = useState({ kind: 'note', body: '', dueAt: '' });
  const move = useApiMutation((input: { stage: contracts.LeadStage; lostReason?: string }) => api.mutate<contracts.Lead>('POST', `/v1/leads/${leadId}/move`, input), ['/v1/leads', '/v1/reports']);
  const log = useApiMutation(() => api.mutate<contracts.Lead>('POST', `/v1/leads/${leadId}/activities`, { kind: note.kind, body: note.body, dueAt: note.dueAt ? new Date(`${note.dueAt}T09:00:00`).toISOString() : null }), ['/v1/leads']);
  const complete = useApiMutation((activityId: string) => api.mutate<contracts.Lead>('POST', `/v1/leads/${leadId}/activities/${activityId}/complete`), ['/v1/leads']);
  const archive = useApiMutation(() => api.mutate('POST', `/v1/leads/${leadId}/archive`, { archived: true }), ['/v1/leads']);
  if (error && !lead) return <div className="page-inner"><ErrorState error={error} retry={() => void refetch()} /></div>;
  if (!lead) return <div className="page-inner"><Skeleton lines={6} /></div>;
  const canWrite = session.has('leads.write');
  const closed = lead.stage === 'won' || lead.stage === 'lost';
  const addr = lead.address;
  const goStage = (s: contracts.LeadStage) => {
    if (s === lead.stage) return;
    if (s === 'won') { setConverting(true); return; }
    if (s === 'lost') { setLosing(true); return; }
    move.mutateAsync({ stage: s }).then(() => toast({ message: `Moved to ${STAGE_LABELS[s]}.`, tone: 'success' })).catch(errorToast);
  };
  return (
    <div className={inSheet ? 'stack' : 'page-inner stack'} style={{ gap: 'var(--sp-4)' }}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 'var(--sp-3)' }}><Avatar name={lead.contactName ?? lead.name} /><div><h2 data-testid="lead-title">{lead.name}</h2><div className="row subtle wrap"><Badge tone={STAGE_TONE[lead.stage]}>{STAGE_LABELS[lead.stage]}</Badge><span>{money(lead.estimatedValueCents)}</span>{lead.ownerName && <span>· {lead.ownerName}</span>}{lead.archivedAt && <Badge tone="warning">archived</Badge>}</div></div></div>
        {canWrite && <MenuButton items={[{ label: 'Edit lead', icon: 'edit', onSelect: () => setEditing(true) }, ...(lead.convertedProjectId ? [{ label: 'Open project', icon: 'projects' as const, onSelect: () => navigate(`/projects/${lead.convertedProjectId}`) }] : []), { label: 'Archive', icon: 'trash', danger: true, onSelect: () => setArchiving(true) }]} />}
      </div>
      {canWrite && !lead.archivedAt && <div className="row wrap" role="group" aria-label="Stage">{contracts.LEAD_STAGES.map((s) => <button key={s} type="button" className={`chip ${s === lead.stage ? 'on' : ''}`} aria-pressed={s === lead.stage} disabled={move.isPending || (closed && s !== lead.stage)} onClick={() => goStage(s)} data-testid={`stage-${s}`}>{STAGE_LABELS[s]}</button>)}</div>}
      {lead.stage === 'won' && lead.convertedProjectId && <div className="banner syncing" style={{ borderRadius: 'var(--radius-md)' }}><Icon name="checkCircle" size={18} /><span className="grow">Won. Project <strong>{lead.convertedProjectName}</strong> was created from this lead.</span><Button size="sm" onClick={() => navigate(`/projects/${lead.convertedProjectId}`)}>Open project</Button></div>}
      {lead.stage === 'lost' && <div className="banner offline" style={{ borderRadius: 'var(--radius-md)' }}><Icon name="alert" size={18} /><span className="grow">Lost{lead.lostReason ? `: ${lead.lostReason}` : ''}.</span></div>}
      {followUpDue(lead) && <div className="banner offline" style={{ borderRadius: 'var(--radius-md)', background: 'var(--warning-soft)', color: 'var(--fg)' }}><Icon name="alert" size={18} /><span className="grow">Follow-up was due {timeAgo(lead.nextFollowUpAt)}. Log a call or note below to clear it.</span></div>}
      <div className="card-grid">
        <Card title="Contact">
          <dl className="stack-sm" style={{ margin: 0 }}>
            <div className="row-between"><dt className="muted">Name</dt><dd style={{ margin: 0 }}>{lead.contactName ?? '—'}</dd></div>
            <div className="row-between"><dt className="muted">Email</dt><dd style={{ margin: 0 }}>{lead.contactEmail ? <a href={`mailto:${lead.contactEmail}`}>{lead.contactEmail}</a> : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Phone</dt><dd style={{ margin: 0 }}>{lead.contactPhone ? <a href={`tel:${lead.contactPhone}`}>{lead.contactPhone}</a> : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Address</dt><dd style={{ margin: 0, textAlign: 'right' }}>{[addr.line1, addr.city, addr.region].filter(Boolean).join(', ') || '—'}</dd></div>
            <div className="row-between"><dt className="muted">Existing client</dt><dd style={{ margin: 0 }}>{lead.clientId ? <a onClick={() => navigate(`/clients/${lead.clientId}`)} style={{ cursor: 'pointer' }}>{lead.clientName}</a> : '—'}</dd></div>
          </dl>
        </Card>
        <Card title="Opportunity">
          <dl className="stack-sm" style={{ margin: 0 }}>
            <div className="row-between"><dt className="muted">Estimated value</dt><dd style={{ margin: 0 }}>{money(lead.estimatedValueCents)}</dd></div>
            <div className="row-between"><dt className="muted">Client budget</dt><dd style={{ margin: 0 }}>{lead.budgetRangeLowCents || lead.budgetRangeHighCents ? `${money(lead.budgetRangeLowCents)} – ${money(lead.budgetRangeHighCents)}` : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Type</dt><dd style={{ margin: 0 }}>{lead.projectType ? humanize(lead.projectType) : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Source</dt><dd style={{ margin: 0 }}>{lead.source ? SOURCE_LABELS[lead.source] ?? humanize(lead.source) : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Target start</dt><dd style={{ margin: 0 }}>{lead.targetStartDate ? dateShort(lead.targetStartDate) : '—'}</dd></div>
            <div className="row-between"><dt className="muted">Next follow-up</dt><dd style={{ margin: 0 }}>{lead.nextFollowUpAt ? dateTime(lead.nextFollowUpAt) : '—'}</dd></div>
            <div className="row-between"><dt className="muted">In this stage</dt><dd style={{ margin: 0 }}>{lead.daysInStage ?? 0} day{lead.daysInStage === 1 ? '' : 's'}</dd></div>
          </dl>
          {lead.notes && <p className="muted mt-4" style={{ whiteSpace: 'pre-wrap' }}>{lead.notes}</p>}
          {canWrite && !closed && <div className="row mt-4"><Button variant="primary" icon="check" onClick={() => setConverting(true)} data-testid="convert-lead">Won — create project</Button></div>}
        </Card>
        <Card title="Activity" wide>
          {canWrite && !lead.archivedAt && <form className="stack-sm" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!note.body.trim()) return; log.mutateAsync(undefined).then(() => { setNote({ kind: 'note', body: '', dueAt: '' }); toast({ message: 'Logged.', tone: 'success' }); }).catch(errorToast); }}>
            <div className="row wrap">
              <Select value={note.kind} onChange={(e) => setNote({ ...note, kind: e.target.value })} aria-label="Activity kind" style={{ maxWidth: 160 }}><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="task">To-do</option></Select>
              <label className="row subtle" style={{ gap: 6 }}>Follow up on <Input type="date" value={note.dueAt} min={todayIso()} onChange={(e) => setNote({ ...note, dueAt: e.target.value })} aria-label="Follow-up date" style={{ maxWidth: 170 }} /></label>
            </div>
            <Textarea value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })} placeholder="What happened? e.g. Walked the site, budget confirmed." rows={2} aria-label="Activity note" data-testid="lead-note" />
            <div className="row"><Button type="submit" size="sm" variant="primary" loading={log.isPending} disabled={!note.body.trim()}>Log it</Button></div>
          </form>}
          <div className="timeline mt-4">{(lead.activities ?? []).map((a) => <div key={a.id} className="timeline-item" data-testid="lead-activity">
            <span className={`dot ${a.kind === 'stage' ? 'brand' : ''}`} />
            <div className="grow"><div className="row wrap"><Badge tone={a.kind === 'stage' ? 'brand' : 'neutral'}>{humanize(a.kind)}</Badge><span className="subtle">{dateTime(a.occurredAt)}{a.createdByName ? ` · ${a.createdByName}` : ''}</span>{a.dueAt && <span className={`subtle ${!a.completedAt && new Date(a.dueAt).getTime() <= Date.now() ? 'text-warning' : ''}`}>{a.completedAt ? 'Done' : `Due ${dateTime(a.dueAt)}`}</span>}</div><div style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div></div>
            {a.dueAt && !a.completedAt && canWrite && <Button size="sm" variant="quiet" icon="check" onClick={() => complete.mutateAsync(a.id).catch(errorToast)}>Done</Button>}
          </div>)}</div>
        </Card>
      </div>
      {editing && <LeadFormSheet lead={lead} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {converting && <ConvertSheet lead={lead} onClose={() => setConverting(false)} onDone={(projectId) => { setConverting(false); navigate(`/projects/${projectId}`); }} />}
      <Sheet open={losing} onClose={() => setLosing(false)} title="Mark as lost" footer={<><Button onClick={() => setLosing(false)}>Cancel</Button><Button variant="danger" loading={move.isPending} onClick={() => move.mutateAsync({ stage: 'lost', lostReason: lostReason.trim() || undefined }).then(() => { setLosing(false); toast({ message: 'Marked lost.' }); }).catch(errorToast)}>Mark lost</Button></>}>
        <Field label="Why did we lose it?" hint="Shows on the pipeline report so you can see patterns."><Textarea value={lostReason} onChange={(e) => setLostReason(e.target.value)} rows={3} placeholder="e.g. Went with a cheaper bid" /></Field>
      </Sheet>
      <ConfirmDialog open={archiving} onClose={() => setArchiving(false)} title="Archive this lead?" message="It disappears from the board and list. Its history is kept." confirmLabel="Archive" danger onConfirm={async () => { await archive.mutateAsync(undefined); setArchiving(false); toast({ message: 'Lead archived.' }); onGone(); }} />
    </div>
  );
}

function ConvertSheet({ lead, onClose, onDone }: { lead: contracts.Lead; onClose: () => void; onDone: (projectId: string) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: clients } = useResource<{ items: contracts.Client[] }>('/v1/clients?limit=200');
  const [form, setForm] = useState({ projectName: lead.name, clientId: lead.clientId ?? '', contractValueCents: lead.estimatedValueCents ?? 0, startDate: lead.targetStartDate ?? '' });
  const convert = useApiMutation(() => api.mutate<{ lead: contracts.Lead; project: contracts.ProjectDetail }>('POST', `/v1/leads/${lead.id}/convert`, { projectName: form.projectName, clientId: form.clientId || null, contractValueCents: form.contractValueCents, startDate: form.startDate || null }), ['/v1/leads', '/v1/projects', '/v1/clients', '/v1/dashboard', '/v1/reports']);
  return <Sheet open onClose={onClose} title="Won! Create the project" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" loading={convert.isPending} data-testid="confirm-convert" onClick={() => convert.mutateAsync(undefined).then((r) => { toast({ message: `Project ${r.data.project.number} created.`, tone: 'success' }); onDone(r.data.project.id); }).catch(errorToast)}>Create project</Button></>}>
    <div className="stack">
      <p className="muted">The lead moves to Won, the client record is {form.clientId ? 'linked' : `created from ${lead.contactName ?? 'the lead'}`}, and a project starts in pre-construction with the details below.</p>
      <Field label="Project name"><Input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} /></Field>
      <Field label="Client" hint="Leave as 'new client' to create one from the lead's contact details."><Select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">New client: {lead.contactName ?? lead.name}</option>{clients?.items.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}</Select></Field>
      <div className="form-grid">
        <Field label="Contract value"><MoneyInput value={form.contractValueCents} onChange={(c) => setForm({ ...form, contractValueCents: c })} /></Field>
        <Field label="Start date"><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
      </div>
    </div>
  </Sheet>;
}

function LeadFormSheet({ lead, onClose, onSaved }: { lead?: contracts.Lead; onClose: () => void; onSaved: (l: contracts.Lead) => void }) {
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: members } = useResource<contracts.Member[]>('/v1/members');
  const [form, setForm] = useState({
    name: lead?.name ?? '', contactName: lead?.contactName ?? '', contactEmail: lead?.contactEmail ?? '', contactPhone: lead?.contactPhone ?? '', line1: lead?.address.line1 ?? '', city: lead?.address.city ?? '', region: lead?.address.region ?? '',
    source: lead?.source ?? 'referral', projectType: lead?.projectType ?? 'remodel', stage: lead?.stage ?? 'new', estimatedValueCents: lead?.estimatedValueCents ?? 0, budgetRangeLowCents: lead?.budgetRangeLowCents ?? 0, budgetRangeHighCents: lead?.budgetRangeHighCents ?? 0,
    targetStartDate: lead?.targetStartDate ?? '', ownerUserId: lead?.ownerUserId ?? '', notes: lead?.notes ?? '', nextFollowUp: lead?.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 10) : '',
  });
  const body = () => ({ name: form.name, contactName: form.contactName || null, contactEmail: form.contactEmail || null, contactPhone: form.contactPhone || null, address: { line1: form.line1, city: form.city, region: form.region }, source: form.source || null, projectType: form.projectType || null, ...(lead ? {} : { stage: form.stage }), estimatedValueCents: form.estimatedValueCents, budgetRangeLowCents: form.budgetRangeLowCents, budgetRangeHighCents: form.budgetRangeHighCents, targetStartDate: form.targetStartDate || null, ownerUserId: form.ownerUserId || null, notes: form.notes, nextFollowUpAt: form.nextFollowUp ? new Date(`${form.nextFollowUp}T09:00:00`).toISOString() : null });
  const save = useApiMutation(() => lead ? api.mutate<contracts.Lead>('PATCH', `/v1/leads/${lead.id}`, body()) : api.mutate<contracts.Lead>('POST', '/v1/leads', body()), ['/v1/leads', '/v1/reports']);
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutateAsync(undefined).then((r) => { toast({ message: lead ? 'Lead updated.' : 'Lead added.', tone: 'success' }); onSaved(r.data); }).catch(errorToast); };
  return <Sheet open onClose={onClose} title={lead ? 'Edit lead' : 'New lead'} size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!form.name.trim()} onClick={submit as any} data-testid="save-lead">{lead ? 'Save' : 'Add lead'}</Button></>}>
    <form className="stack" onSubmit={submit}>
      <Field label="Lead name" hint="Usually the family or company and the job, e.g. Garcia garage conversion."><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus data-testid="lead-name" /></Field>
      <div className="form-grid">
        <Field label="Contact name"><Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
        <Field label="Phone"><Input type="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></Field>
        <Field label="Source"><Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>{contracts.LEAD_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}</Select></Field>
        <Field label="Street"><Input value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} /></Field>
        <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
        <Field label="State / region"><Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></Field>
        <Field label="Project type"><Select value={form.projectType} onChange={(e) => setForm({ ...form, projectType: e.target.value })}>{contracts.PROJECT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
        {!lead && <Field label="Stage"><Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as contracts.LeadStage })}>{contracts.OPEN_LEAD_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</Select></Field>}
        <Field label="Estimated value"><MoneyInput value={form.estimatedValueCents} onChange={(c) => setForm({ ...form, estimatedValueCents: c })} data-testid="lead-value" /></Field>
        <Field label="Client budget from"><MoneyInput value={form.budgetRangeLowCents} onChange={(c) => setForm({ ...form, budgetRangeLowCents: c })} /></Field>
        <Field label="Client budget to"><MoneyInput value={form.budgetRangeHighCents} onChange={(c) => setForm({ ...form, budgetRangeHighCents: c })} /></Field>
        <Field label="Target start"><Input type="date" value={form.targetStartDate} onChange={(e) => setForm({ ...form, targetStartDate: e.target.value })} /></Field>
        <Field label="Next follow-up"><Input type="date" value={form.nextFollowUp} onChange={(e) => setForm({ ...form, nextFollowUp: e.target.value })} /></Field>
        <Field label="Owner"><Select value={form.ownerUserId} onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}><option value="">Me</option>{members?.map((m) => <option key={m.userId} value={m.userId}>{m.firstName} {m.lastName}</option>)}</Select></Field>
      </div>
      <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} /></Field>
    </form>
  </Sheet>;
}
