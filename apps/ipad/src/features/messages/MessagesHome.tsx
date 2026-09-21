import { useNavigate, useParams, useSearchParams } from 'react-router';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { Button, EmptyState, Toolbar, useIsCompact } from '../../ui/components';
import { useSession } from '../../store/session';
import { ThreadList } from './ThreadList';
import { ThreadView } from './ThreadView';

export default function MessagesHome() {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const compact = useIsCompact();
  const [params, setParams] = useSearchParams();
  return <>
    <Toolbar title="Messages" leading={compact && threadId ? <Button variant="quiet" icon="back" onClick={() => navigate('/messages')} aria-label="Back" /> : <MenuToggle />}>
      {session.has('messages.write') && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New thread</Button>}
      <ToolbarActions />
    </Toolbar>
    <div className={`split ${compact ? 'stacked' : ''}`} style={{ flex: 1, minHeight: 0 }}>
      {(!compact || !threadId) && <div className="split-list"><ThreadList projectId={null} selectedId={threadId} onSelect={(id) => navigate(`/messages/${id}`)} creating={params.get('new') === '1'} onCloseCreate={() => setParams({})} /></div>}
      {(!compact || threadId) && <div className="split-detail" style={{ display: 'flex', flexDirection: 'column' }}>{threadId ? <ThreadView threadId={threadId} /> : <EmptyState icon="messages" title="Select a thread">Threads from every project you are part of appear here.</EmptyState>}</div>}
    </div>
  </>;
}
