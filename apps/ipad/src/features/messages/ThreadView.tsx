import { useEffect, useRef, useState } from 'react';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, EmptyState, ErrorState, Icon, Skeleton, Textarea, useErrorToast } from '../../ui/components';
import { dateTime } from '../../ui/format';
import { useSession } from '../../store/session';
import { camera } from '../../native';

export function ThreadView({ threadId }: { threadId: string }) {
  const session = useSession();
  const errorToast = useErrorToast();
  const { data: thread } = useResource<contracts.Thread>(`/v1/threads/${threadId}`);
  const { data, isLoading, error, refetch, fromCache } = useResource<{ items: contracts.Message[]; nextCursor: string | null }>(`/v1/threads/${threadId}/messages?limit=100`, { refetchInterval: 20_000 } as any);
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<contracts.Document[]>([]);
  const [pending, setPending] = useState<contracts.Message[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const send = useApiMutation(() => {
    const text = body.trim();
    const mentions = (thread?.participants ?? []).filter((p) => p.userId && text.includes(`@${p.displayName}`)).map((p) => p.userId!);
    const optimistic: contracts.Message = { id: crypto.randomUUID(), threadId, authorUserId: session.user!.id, authorContactId: null, authorName: `${session.user!.firstName} ${session.user!.lastName}`, authorKind: 'user', body: text, mentions, attachments, createdAt: new Date().toISOString(), editedAt: null, deletedAt: null };
    return api.mutate<contracts.Message>('POST', `/v1/threads/${threadId}/messages`, { body: text, mentions, attachmentDocumentIds: attachments.map((a) => a.id), clientMutationId: crypto.randomUUID() }, { queue: { entity: 'message', label: `Message in "${thread?.subject ?? 'thread'}"`, optimistic, invalidates: [`/v1/threads/${threadId}`, '/v1/threads'] } });
  }, [`/v1/threads/${threadId}`, '/v1/threads', '/v1/projects', '/v1/dashboard']);
  useEffect(() => { if (thread && thread.unreadCount > 0) void api.mutate('POST', `/v1/threads/${threadId}/read`).then(() => refetch()); }, [thread?.id, thread?.lastMessageAt]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [data?.items.length, pending.length]);
  const submit = async () => {
    if (!body.trim()) return;
    try { const r = await send.mutateAsync(undefined); if (r.queued) setPending((p) => [...p, r.data]); setBody(''); setAttachments([]); }
    catch (e) { errorToast(e); }
  };
  const messages = [...(data?.items ?? []), ...pending.filter((p) => !data?.items.some((m) => m.body === p.body && m.authorUserId === p.authorUserId && Math.abs(Date.parse(m.createdAt) - Date.parse(p.createdAt)) < 60_000))];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: '1px solid var(--line)' }} className="row-between">
        <div><h3>{thread?.subject ?? '…'}</h3><div className="subtle">{thread?.projectName ? `${thread.projectName} · ` : ''}{thread?.participants.map((p) => p.displayName).join(', ')}</div></div>
        <div className="row">{fromCache && <Badge tone="warning">Cached</Badge>}{thread?.clientVisible && <Badge tone="info">client visible</Badge>}</div>
      </div>
      <div className="page" style={{ padding: 'var(--sp-3) var(--sp-5)' }}>
        {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
        {isLoading && !data && <Skeleton lines={4} />}
        {data && messages.length === 0 && <EmptyState icon="messages" title="No messages yet" />}
        {messages.map((m) => { const mine = m.authorUserId === session.user?.id; return (
          <div key={m.id} className={`msg ${mine ? 'mine' : ''}`}>
            {!mine && <span className="avatar sm">{m.authorName.split(' ').map((s) => s[0]).join('')}</span>}
            <div className="bubble">
              {!mine && <div className="subtle" style={{ marginBottom: 2 }}>{m.authorName}</div>}
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.deletedAt ? <em className="muted">Message removed</em> : m.body}</div>
              {m.attachments.length > 0 && <div className="row wrap mt-2">{m.attachments.map((a) => <a key={a.id} className="chip" href={a.downloadUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}><Icon name={a.kind === 'photo' ? 'photo' : 'file'} size={14} />{a.name}</a>)}</div>}
              <div className="subtle" style={{ marginTop: 4, opacity: 0.8, color: 'inherit' }}>{dateTime(m.createdAt)}{pending.includes(m) ? ' · queued' : ''}</div>
            </div>
          </div>); })}
        <div ref={bottom} />
      </div>
      {session.has('messages.write') && <div className="composer">
        <Button icon="upload" aria-label="Attach file" onClick={async () => { const [f] = await camera.pickFiles('*/*', false); if (!f) return; try { const r = await api.upload<contracts.Document>('/v1/documents/upload', f, f.name, { projectId: thread?.projectId ?? null }); setAttachments((a) => [...a, r.data]); } catch (e) { errorToast(e); } }} />
        <div className="grow stack-sm">
          {attachments.length > 0 && <div className="row wrap">{attachments.map((a) => <span key={a.id} className="chip">{a.name}<button className="btn quiet sm icon" aria-label="Remove attachment" onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))} style={{ width: 24, minHeight: 24 }}><Icon name="close" size={12} /></button></span>)}</div>}
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message… use @Name to mention" rows={1} aria-label="Message" data-testid="composer" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }} />
        </div>
        <Button variant="primary" icon="send" aria-label="Send" onClick={submit} loading={send.isPending} disabled={!body.trim()} data-testid="send" />
      </div>}
    </div>
  );
}
