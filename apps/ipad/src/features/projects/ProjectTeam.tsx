import { useState } from 'react';
import type { contracts } from '@buildline/core';
import { api, useApiMutation, useResource } from '../../api/hooks';
import { Badge, Button, Card, EmptyState, Field, Select, Sheet, SwipeRow, useErrorToast, useToast } from '../../ui/components';
import { useSession } from '../../store/session';

export function ProjectTeam({ project }: { project: contracts.ProjectDetail }) {
  const session = useSession();
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState('');
  const [accessLevel, setAccessLevel] = useState('member');
  const { data: members } = useResource<contracts.Member[]>(adding ? '/v1/members' : null);
  const toast = useToast();
  const errorToast = useErrorToast();
  const add = useApiMutation(() => api.mutate('POST', `/v1/projects/${project.id}/members`, { userId, accessLevel }), [`/v1/projects/${project.id}`]);
  const remove = useApiMutation((id: string) => api.mutate('DELETE', `/v1/projects/${project.id}/members/${id}`), [`/v1/projects/${project.id}`]);
  const canEdit = session.has('projects.write');
  const candidates = (members ?? []).filter((m) => m.status === 'active' && !project.members.some((pm) => pm.userId === m.userId));
  return (
    <div className="page-inner stack">
      <Card title="Project team" actions={canEdit && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add member</Button>}>
        {project.members.length === 0 ? <EmptyState icon="users" title="No team members" /> : <div className="list">{project.members.map((m) => (
          <SwipeRow key={m.id} actions={canEdit ? [{ label: 'Remove', tone: 'danger', onSelect: () => remove.mutate(m.id) }] : []}>
            <div className="list-row"><span className="avatar">{m.displayName.split(' ').map((s) => s[0]).join('')}</span><span className="grow"><div className="primary">{m.displayName}</div><div className="secondary">{m.email ?? ''}{m.roleName ? ` · ${m.roleName}` : ''}</div></span><span className="trailing"><Badge tone={m.accessLevel === 'manager' ? 'brand' : 'neutral'}>{m.accessLevel}</Badge>{canEdit && <Button size="sm" variant="quiet" onClick={() => remove.mutate(m.id)}>Remove</Button>}</span></div>
          </SwipeRow>
        ))}</div>}
      </Card>
      <Sheet open={adding} onClose={() => setAdding(false)} title="Add team member" footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={!userId} loading={add.isPending} onClick={async () => { try { await add.mutateAsync(undefined); toast({ message: 'Member added.', tone: 'success' }); setAdding(false); setUserId(''); } catch (e) { errorToast(e); } }}>Add</Button></>}>
        <div className="stack">
          <Field label="Person"><Select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Choose…</option>{candidates.map((m) => <option key={m.userId} value={m.userId}>{m.firstName} {m.lastName} · {m.roleName}</option>)}</Select></Field>
          <Field label="Access"><Select value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)}><option value="manager">Manager</option><option value="member">Member</option><option value="viewer">Viewer</option></Select></Field>
          {candidates.length === 0 && members && <p className="muted">Everyone in your company is already on this project. Invite more people from Settings → Members.</p>}
        </div>
      </Sheet>
    </div>
  );
}
