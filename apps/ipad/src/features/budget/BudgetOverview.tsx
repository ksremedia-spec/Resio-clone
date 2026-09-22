import { useNavigate } from 'react-router';
import type { contracts } from '@buildline/core';
import { useResource } from '../../api/hooks';
import { MenuToggle, ToolbarActions } from '../../layouts/AppShell';
import { EmptyState, ErrorState, Skeleton, Stat, StatusBadge, Toolbar } from '../../ui/components';
import { humanize, money } from '../../ui/format';
import { Money, pct } from '../financial/shared';

type Row = { projectId: string; projectNumber: string; projectName: string; status: string; totals: contracts.Budget['totals']; contract: contracts.Budget['contract'] };

/** Every active project's budget health on one screen. */
export default function BudgetOverview() {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useResource<Row[]>('/v1/budget/overview');
  const rows = data ?? [];
  const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
  const over = rows.filter((r) => r.totals.status === 'over');
  return <>
    <Toolbar title="Budget" leading={<MenuToggle />}><ToolbarActions /></Toolbar>
    <div className="page"><div className="page-inner stack" style={{ gap: 'var(--sp-4)' }}>
      <div className="stat-row">
        <Stat label="Revised budgets" value={money(sum((r) => r.totals.revisedCents))} />
        <Stat label="Committed" value={money(sum((r) => r.totals.committedCents))} />
        <Stat label="Actual cost" value={money(sum((r) => r.totals.actualCents))} />
        <Stat label="Projected margin" value={money(sum((r) => r.contract.projectedMarginCents))} tone={sum((r) => r.contract.projectedMarginCents) < 0 ? 'danger' : 'ok'} />
        <Stat label="Over budget" value={over.length} tone={over.length ? 'danger' : 'ok'} />
      </div>
      {error && !data && <ErrorState error={error} retry={() => void refetch()} />}
      {isLoading && !data && <div className="card"><Skeleton lines={5} /></div>}
      {data && rows.length === 0 && <EmptyState icon="budget" title="No budgets yet">Lock a project's estimate to create its budget. Every project with a budget appears here with its job-cost health.</EmptyState>}
      {rows.length > 0 && <div className="card" style={{ padding: 0, overflow: 'hidden' }}><div className="table-wrap"><table className="table">
        <thead><tr><th>Project</th><th className="num">Revised contract</th><th className="num">Revised budget</th><th className="num">Committed</th><th className="num">Actual</th><th className="num">Projected</th><th className="num">Variance</th><th className="num">Margin</th><th>Health</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.projectId} className="clickable" data-testid="budget-project-row" onClick={() => navigate(`/projects/${r.projectId}/budget`)}>
          <td className="name"><div className="primary">{r.projectNumber} · {r.projectName}</div><div className="secondary">{humanize(r.status)} · {pct(r.totals.percentSpentBp)} spent or committed</div></td>
          <td className="num"><Money cents={r.contract.revisedContractCents} /></td>
          <td className="num"><Money cents={r.totals.revisedCents} /></td>
          <td className="num"><Money cents={r.totals.committedCents} /></td>
          <td className="num"><Money cents={r.totals.actualCents} /></td>
          <td className="num"><Money cents={r.totals.projectedCents} /></td>
          <td className="num"><Money cents={r.totals.varianceCents} signed /></td>
          <td className="num"><Money cents={r.contract.projectedMarginCents} signed /></td>
          <td><StatusBadge status={r.totals.status} /></td>
        </tr>)}</tbody>
      </table></div></div>}
    </div></div>
  </>;
}
