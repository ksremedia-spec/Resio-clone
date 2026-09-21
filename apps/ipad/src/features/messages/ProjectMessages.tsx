import { useNavigate, useParams, useSearchParams } from 'react-router';
import type { contracts } from '@buildline/core';
import { Button, EmptyState, useIsCompact, useKeyboardShortcut } from '../../ui/components';
import { useSession } from '../../store/session';
import { ThreadList } from './ThreadList';
import { ThreadView } from './ThreadView';

export default function ProjectMessages({ project }: { project: contracts.ProjectDetail }) {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const compact = useIsCompact();
  const [params, setParams] = useSearchParams();
  useKeyboardShortcut('mod+n', () => { if (session.has('messages.write')) setParams({ new: '1' }); });
  return <>
    <div className="row-between" style={{ padding: 'var(--sp-3) var(--sp-5) 0' }}>
      <div>{compact && threadId && <Button variant="quiet" icon="back" onClick={() => navigate(`/projects/${project.id}/messages`)}>Threads</Button>}</div>
      {session.has('messages.write') && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New thread</Button>}
    </div>
    <div className={`split ${compact ? 'stacked' : ''}`} style={{ marginTop: 12, minHeight: 0, flex: 1 }}>
      {(!compact || !threadId) && <div className="split-list"><ThreadList projectId={project.id} selectedId={threadId} onSelect={(id) => navigate(`/projects/${project.id}/messages/${id}`)} creating={params.get('new') === '1'} onCloseCreate={() => setParams({})} /></div>}
      {(!compact || threadId) && <div className="split-detail" style={{ display: 'flex', flexDirection: 'column' }}>{threadId ? <ThreadView threadId={threadId} /> : <EmptyState icon="messages" title="Select a thread" />}</div>}
    </div>
  </>;
}
