import { useState } from 'react';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, EmptyState, ErrorState, Field, Icon, Input, SearchField, Sheet, Skeleton, Switch, Textarea, useDebounced, useErrorToast } from '../../ui/components';
import { timeAgo } from '../../ui/format';
import { useSession } from '../../store/session';

export function ThreadList({ projectId, selectedId, onSelect, creating, onCloseCreate }: { projectId: string | null; selectedId?: string; onSelect: (id: string) => void; creating: boolean; onCloseCreate: () => void }) {
  const [q, setQ] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const debounced = useDebounced(q);
  const { data, isLoading, error, refetch } = useResource<{ items: contracts.Thread[] }>(`/v1/threads?limit=100${projectId ? `&projectId=${projectId}` : ''}${unreadOnly ? '&unreadOnly=true' : ''}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`, { refetchInterval: 30_000 } as any);
  return <>
    <div style={{ padding: 'var(--sp-3) var(--sp-4)' }} className="stack-sm"><SearchField value={q} onChange={setQ} placeholder="Search threads" /><label className="row subtle"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label></div>
    {error && !data && <div style={{ padding: 16 }}><ErrorState error={error} retry={() => void refetch()} /></div>}
    {isLoading && !data && <div style={{ padding: 16 }}><Skeleton lines={5} /></div>}
    {data?.items.length === 0 && <EmptyState icon="messages" title="No threads yet">Start a thread to keep the conversation on the project.</EmptyState>}
    <div className="list">{data?.items.map((t) => <button key={t.id} className={`list-row ${t.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(t.id)} data-testid="thread-row">
      <span className="dot" style={{ background: t.unreadCount ? 'var(--brand)' : 'transparent' }} />
      <span className="grow"><div className="primary truncate" style={{ fontWeight: t.unreadCount ? 700 : 600 }}>{t.subject}</div><div className="secondary truncate">{!projectId && t.projectName ? `${t.projectName} · ` : ''}{t.lastMessage ? `${t.lastMessage.authorName.split(' ')[0]}: ${t.lastMessage.body}` : 'No messages yet'}</div></span>
      <span className="trailing"><span className="subtle">{timeAgo(t.lastMessageAt)}</span>{t.clientVisible && <Icon name="users" size={14} />}</span>
    </button>)}</div>
    {creating && <NewThreadSheet projectId={projectId} onClose={onCloseCreate} onCreated={(id) => { void refetch(); onSelect(id); }} />}
  </>;
}

function NewThreadSheet({ projectId, onClose, onCreated }: { projectId: string | null; onClose: () => void; onCreated: (id: string) => void }) {
  const session = useSession();
  const errorToast = useErrorToast();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [clientVisible, setClientVisible] = useState(false);
  const [everyone, setEveryone] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [chosenProject, setChosenProject] = useState(projectId ?? '');
  const { data: members } = useResource<contracts.Member[]>(session.has('projects.read') ? '/v1/members' : null);
  const { data: projects } = useResource<{ items: contracts.ProjectSummary[] }>(!projectId ? '/v1/projects?status=open&limit=100' : null);
  const create = useApiMutation(() => api.mutate<contracts.Thread>('POST', '/v1/threads', { projectId: chosenProject || null, kind: chosenProject ? 'project' : 'direct', subject, clientVisible, initialMessage: message || undefined, participantUserIds: everyone && chosenProject ? undefined : [...chosen], clientMutationId: crypto.randomUUID() }), ['/v1/threads', '/v1/projects', '/v1/dashboard']);
  return (
    <Sheet open onClose={onClose} title="New thread" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!subject.trim() || (!everyone && chosen.size === 0 && !chosenProject)} loading={create.isPending} onClick={() => create.mutateAsync(undefined).then((r) => { onClose(); onCreated(r.data.id); }).catch(errorToast)} data-testid="create-thread">Start thread</Button></>}>
      <div className="stack">
        {!projectId && <Field label="Project"><select className="select" value={chosenProject} onChange={(e) => setChosenProject(e.target.value)}><option value="">No project (direct)</option>{projects?.items.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</select></Field>}
        <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus placeholder="Cabinet delivery" data-testid="thread-subject" /></Field>
        <Field label="First message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} data-testid="thread-message" /></Field>
        {chosenProject && <Switch label="Everyone on the project" checked={everyone} onChange={setEveryone} />}
        {(!everyone || !chosenProject) && <Field label="Participants"><div className="row wrap">{members?.filter((m) => m.userId !== session.user?.id && m.status === 'active').map((m) => <button key={m.userId} type="button" className={`chip ${chosen.has(m.userId) ? 'on' : ''}`} aria-pressed={chosen.has(m.userId)} onClick={() => { const s = new Set(chosen); if (s.has(m.userId)) s.delete(m.userId); else s.add(m.userId); setChosen(s); }}>{m.firstName} {m.lastName}</button>)}</div></Field>}
        {chosenProject && <Switch label="Visible to client" hint="The client can read and reply from their portal." checked={clientVisible} onChange={setClientVisible} />}
      </div>
    </Sheet>
  );
}
