import { useState } from 'react';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { Badge, Button, Card, EmptyState, Skeleton } from '../../ui/components';
import { dateTime } from '../../ui/format';

export function ProjectActivity({ project }: { project: contracts.ProjectDetail }) {
  const [pages, setPages] = useState<string[]>(['']);
  return (
    <div className="page-inner">
      <Card title="Activity history">
        {pages.map((cursor, i) => <ActivityPage key={cursor || 'first'} projectId={project.id} cursor={cursor} last={i === pages.length - 1} onMore={(c) => setPages((p) => [...p, c])} />)}
      </Card>
    </div>
  );
}

function ActivityPage({ projectId, cursor, last, onMore }: { projectId: string; cursor: string; last: boolean; onMore: (c: string) => void }) {
  const { data, isLoading } = useResource<{ items: contracts.ActivityEntry[]; nextCursor: string | null }>(`/v1/projects/${projectId}/activity?limit=40${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  if (isLoading && !data) return <Skeleton lines={4} />;
  if (!data) return null;
  if (data.items.length === 0 && !cursor) return <EmptyState icon="log" title="No activity yet" />;
  return <>
    <div className="timeline">{data.items.map((a) => (
      <div key={a.id} className="timeline-item">
        <span className="avatar sm">{a.actorName.split(' ').map((s) => s[0]).join('')}</span>
        <span>
          <div>{a.summary}{a.clientVisible && <Badge tone="info" className="mt-2" style={{ marginLeft: 8 } as any}>client visible</Badge>}</div>
          {a.diff && Object.keys(a.diff).length > 1 && <div className="subtle" style={{ marginTop: 4 }}>{Object.entries(a.diff).map(([k, v]) => <div key={k}>{k}: {String(v.from ?? '—')} → {String(v.to ?? '—')}</div>)}</div>}
        </span>
        <span className="when">{dateTime(a.occurredAt)}</span>
      </div>
    ))}</div>
    {last && data.nextCursor && <div className="mt-4"><Button onClick={() => onMore(data.nextCursor!)}>Load more</Button></div>}
  </>;
}
