import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Badge, Button, EmptyState, ErrorState, Icon, ListRow, Select, Skeleton, Textarea, Toolbar, useErrorToast, useIsCompact, useToast } from '../../ui/components';
import { humanize, timeAgo } from '../../ui/format';
import { useSession } from '../../store/session';

/** Chat with the assistant. Every fact comes from a tool that runs with the person's own permissions; every action waits for a tap. */
export default function Assistant() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const compact = useIsCompact();
  const [params] = useSearchParams();
  const { data: list, refetch: refetchList } = useResource<contracts.AiConversation[]>('/v1/ai/conversations');
  const { data: status } = useResource<contracts.AiStatus>('/v1/ai/status');
  const sidebar = (
    <div className="split-list">
      <div style={{ padding: 'var(--sp-3) var(--sp-4)' }}><Button variant="primary" icon="plus" onClick={() => navigate('/assistant')} style={{ width: '100%' }}>New conversation</Button></div>
      {!list ? <div style={{ padding: 16 }}><Skeleton lines={4} /></div> : list.length === 0 ? <p className="muted" style={{ padding: 16 }}>Your conversations appear here.</p> : <div className="list">{list.map((c) => <ListRow key={c.id} selected={c.id === conversationId} onClick={() => navigate(`/assistant/${c.id}`)} leading={<Icon name="ai" />} primary={c.title} secondary={`${c.projectName ? `${c.projectName} · ` : ''}${c.lastMessageAt ? timeAgo(c.lastMessageAt) : 'new'}`} data-testid="conversation-row" />)}</div>}
      {status && <div className="subtle" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>{status.provider === 'rules' ? 'Running without an AI model: the assistant understands everyday questions about your projects.' : `Powered by ${status.model}`}</div>}
    </div>
  );
  return <>
    <Toolbar title="AI Assistant" leading={<>{compact && conversationId ? <Button variant="quiet" icon="back" onClick={() => navigate('/assistant')} aria-label="Back" /> : <MenuToggle />}</>}><ToolbarActions /></Toolbar>
    <div className={`split ${compact ? 'stacked' : ''}`} style={{ flex: 1, minHeight: 0 }}>
      {(!compact || !conversationId) && sidebar}
      {(!compact || conversationId) && <div className="split-detail" style={{ display: 'flex', flexDirection: 'column' }}><Chat key={conversationId ?? 'new'} conversationId={conversationId} defaultProjectId={params.get('projectId')} status={status} onCreated={(c) => { void refetchList(); navigate(`/assistant/${c.id}`, { replace: true }); }} /></div>}
    </div>
  </>;
}

function Chat({ conversationId, defaultProjectId, status, onCreated }: { conversationId?: string; defaultProjectId: string | null; status?: contracts.AiStatus; onCreated: (c: contracts.AiConversation) => void }) {
  const session = useSession();
  const toast = useToast();
  const errorToast = useErrorToast();
  const { data: conv, error, refetch } = useResource<contracts.AiConversation>(conversationId ? `/v1/ai/conversations/${conversationId}` : null);
  const { data: projects } = useResource<{ items: contracts.ProjectSummary[] }>(!conversationId ? '/v1/projects?status=open&limit=50' : null);
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [draft, setDraft] = useState('');
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const send = useApiMutation((content: string) => conversationId ? api.mutate<contracts.AiConversation>('POST', `/v1/ai/conversations/${conversationId}/messages`, { content }) : api.mutate<contracts.AiConversation>('POST', '/v1/ai/conversations', { message: content, projectId: projectId || null }), ['/v1/ai']);
  const confirm = useApiMutation((input: { messageId: string; approve: boolean }) => api.mutate<contracts.AiConversation>('POST', `/v1/ai/conversations/${conversationId}/confirm`, input), ['/v1/ai', '/v1/projects', '/v1/tasks', '/v1/change-orders', '/v1/threads', '/v1/dashboard']);
  const messages = conv?.messages ?? [];
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length, optimistic, send.isPending]);
  const submit = async (text: string) => {
    const content = text.trim();
    if (!content || send.isPending) return;
    setDraft(''); setOptimistic(content);
    try { const r = await send.mutateAsync(content); if (!conversationId) onCreated(r.data); else void refetch(); }
    catch (e) { errorToast(e); setDraft(content); }
    finally { setOptimistic(null); }
  };
  if (error && !conv) return <div className="page-inner"><ErrorState error={error} retry={() => void refetch()} /></div>;
  return <>
    <div className="page" style={{ flex: 1 }}><div className="page-inner chat" style={{ maxWidth: 900 }}>
      {!conversationId && <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        <EmptyState icon="ai" title={`What can I help with, ${session.user?.firstName ?? ''}?`}>I answer from your projects, schedule, budget, invoices, daily logs and time. I can also create to-dos, post messages and draft change orders, but only after you confirm.</EmptyState>
        {projects && projects.items.length > 0 && <div className="row" style={{ justifyContent: 'center' }}><label className="row subtle">About <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Conversation project" style={{ maxWidth: 320 }}><option value="">any project</option>{projects.items.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</Select></label></div>}
        {status && <div className="row wrap" style={{ justifyContent: 'center' }}>{status.suggestions.map((s) => <button key={s} type="button" className="chip" data-testid="suggestion" onClick={() => void submit(s)}>{s}</button>)}</div>}
      </div>}
      {conversationId && !conv && <Skeleton lines={4} />}
      {messages.map((m) => <MessageView key={m.id} m={m} busy={confirm.isPending} onConfirm={(approve) => confirm.mutateAsync({ messageId: m.id, approve }).then(() => { toast({ message: approve ? 'Done.' : 'Cancelled.', tone: approve ? 'success' : undefined }); void refetch(); }).catch(errorToast)} />)}
      {optimistic && <div className="msg mine"><div className="bubble">{optimistic}</div></div>}
      {send.isPending && <div className="msg"><div className="bubble muted" aria-live="polite"><span className="thinking">Looking that up…</span></div></div>}
      <div ref={bottom} />
    </div></div>
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(draft); }}>
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={conversationId ? 'Ask a follow-up…' : 'Ask about a project, the schedule, the budget, invoices…'} aria-label="Message the assistant" data-testid="ai-composer" rows={1} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(draft); } }} />
      <Button type="submit" variant="primary" icon="send" loading={send.isPending} disabled={!draft.trim()} data-testid="ai-send">Send</Button>
    </form>
  </>;
}

function MessageView({ m, busy, onConfirm }: { m: contracts.AiMessage; busy: boolean; onConfirm: (approve: boolean) => void }) {
  const navigate = useNavigate();
  if (m.role === 'user') return <div className="msg mine"><div className="bubble" style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div></div>;
  const reads = (m.toolCalls ?? []).filter((c) => !m.pendingAction || c.id !== m.pendingAction.toolUseId);
  const p = m.pendingAction;
  const links = (m.toolResults ?? []).filter((r) => r.ok && r.link && (!p || r.toolUseId !== p.toolUseId));
  return <div className="msg" data-testid="ai-message">
    <span className="avatar sm" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="ai" size={16} /></span>
    <div className="bubble stack-sm" style={{ maxWidth: '85%' }}>
      {reads.length > 0 && <div className="row wrap">{reads.map((c) => { const r = m.toolResults?.find((x) => x.toolUseId === c.id); return <Badge key={c.id} tone={r && !r.ok ? 'danger' : 'info'}><Icon name={r && !r.ok ? 'alert' : 'check'} size={12} /> {c.summary}</Badge>; })}</div>}
      {m.content && <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
      {links.length > 0 && <div className="row wrap">{links.map((r) => <Button key={r.toolUseId} size="sm" variant="quiet" onClick={() => navigate(r.link!)}>Open {humanize(r.name).toLowerCase().replace(/ status| tasks| schedule| invoices| activity| logs| summary/, '')} <Icon name="arrowRight" size={12} /></Button>)}</div>}
      {p && <div className="action-card" data-testid="pending-action">
        <div className="row"><Icon name={p.status === 'confirmed' ? 'checkCircle' : p.status === 'pending' ? 'alert' : 'circle'} style={{ color: p.status === 'confirmed' ? 'var(--success)' : p.status === 'pending' ? 'var(--warning)' : undefined }} /><strong className="grow">{p.status === 'pending' ? 'Waiting for you to confirm' : p.status === 'confirmed' ? 'Done' : p.status === 'failed' ? 'Failed' : 'Cancelled'}</strong><Badge>{humanize(p.name)}</Badge></div>
        <div>{p.status === 'confirmed' && p.resultSummary ? p.resultSummary : `I will ${p.summary}.`}</div>
        {p.status === 'pending' && <div className="row"><Button size="sm" onClick={() => onConfirm(false)} disabled={busy}>Cancel</Button><Button size="sm" variant="primary" icon="check" loading={busy} data-testid="confirm-action" onClick={() => onConfirm(true)}>Confirm</Button></div>}
        {p.status === 'confirmed' && p.link && <div><Button size="sm" variant="quiet" onClick={() => navigate(p.link!)}>Open it <Icon name="arrowRight" size={12} /></Button></div>}
      </div>}
    </div>
  </div>;
}
