/**
 * Schedule engine: dependency-aware date calculation (CPM forward pass),
 * cascading moves and resource conflict detection. Dates are ISO calendar
 * days (YYYY-MM-DD); durations are working days. Pure functions so the iPad
 * can preview moves offline and the API can confirm them identically.
 */

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface ScheduleTask {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD, inclusive
  durationDays: number; // working days, >= 1 (milestones use 0)
  isMilestone?: boolean;
  /** When true, the task is pinned and will not be moved by cascades. */
  locked?: boolean;
}

export interface ScheduleDependency {
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number; // may be negative (lead)
}

export interface Calendar {
  /** 0 = Sunday … 6 = Saturday */
  workingDays: number[];
  holidays?: string[];
}

export const DEFAULT_CALENDAR: Calendar = { workingDays: [1, 2, 3, 4, 5], holidays: [] };

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) throw new RangeError(`invalid date ${iso}`);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(iso: string, days: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function isWorkingDay(iso: string, cal: Calendar = DEFAULT_CALENDAR): boolean {
  const d = parseDate(iso);
  if (!cal.workingDays.includes(d.getUTCDay())) return false;
  if (cal.holidays?.includes(iso)) return false;
  return true;
}

export function nextWorkingDay(iso: string, cal: Calendar = DEFAULT_CALENDAR): string {
  let cur = iso;
  let guard = 0;
  while (!isWorkingDay(cur, cal)) {
    cur = addCalendarDays(cur, 1);
    if (++guard > 400) throw new Error('calendar has no working days');
  }
  return cur;
}

export function prevWorkingDay(iso: string, cal: Calendar = DEFAULT_CALENDAR): string {
  let cur = iso;
  let guard = 0;
  while (!isWorkingDay(cur, cal)) {
    cur = addCalendarDays(cur, -1);
    if (++guard > 400) throw new Error('calendar has no working days');
  }
  return cur;
}

/** Add n working days (n may be negative). n = 0 returns the same (snapped) day. */
export function addWorkingDays(iso: string, n: number, cal: Calendar = DEFAULT_CALENDAR): string {
  let cur = n >= 0 ? nextWorkingDay(iso, cal) : prevWorkingDay(iso, cal);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    cur = addCalendarDays(cur, step);
    if (isWorkingDay(cur, cal)) remaining -= 1;
  }
  return cur;
}

/** End date (inclusive) for a start date and duration in working days. */
export function endDateFor(start: string, durationDays: number, cal: Calendar = DEFAULT_CALENDAR): string {
  if (durationDays <= 0) return nextWorkingDay(start, cal);
  return addWorkingDays(start, durationDays - 1, cal);
}

export function workingDaysBetween(startIso: string, endIso: string, cal: Calendar = DEFAULT_CALENDAR): number {
  if (parseDate(endIso) < parseDate(startIso)) return 0;
  let count = 0;
  let cur = startIso;
  while (parseDate(cur) <= parseDate(endIso)) {
    if (isWorkingDay(cur, cal)) count += 1;
    cur = addCalendarDays(cur, 1);
  }
  return count;
}

function earliestStartFromDependency(pred: ScheduleTask, dep: ScheduleDependency, succDuration: number, cal: Calendar): string {
  const lag = dep.lagDays;
  switch (dep.type) {
    case 'FS':
      return addWorkingDays(pred.endDate, 1 + lag, cal);
    case 'SS':
      return addWorkingDays(pred.startDate, lag, cal);
    case 'FF': {
      const end = addWorkingDays(pred.endDate, lag, cal);
      return addWorkingDays(end, -(Math.max(succDuration, 1) - 1), cal);
    }
    case 'SF': {
      const end = addWorkingDays(pred.startDate, lag, cal);
      return addWorkingDays(end, -(Math.max(succDuration, 1) - 1), cal);
    }
  }
}

export interface ScheduleResult {
  tasks: Map<string, ScheduleTask>;
  changed: Array<{ id: string; from: { startDate: string; endDate: string }; to: { startDate: string; endDate: string } }>;
  criticalPath: Set<string>;
  cycles: string[][];
}

/** Topological order; returns cycles found (tasks in a cycle are excluded from order). */
export function topologicalOrder(taskIds: string[], deps: ScheduleDependency[]): { order: string[]; cycles: string[][] } {
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of taskIds) { inDegree.set(id, 0); outgoing.set(id, []); }
  for (const d of deps) {
    if (!inDegree.has(d.predecessorId) || !inDegree.has(d.successorId)) continue;
    inDegree.set(d.successorId, inDegree.get(d.successorId)! + 1);
    outgoing.get(d.predecessorId)!.push(d.successorId);
  }
  const queue = taskIds.filter((id) => inDegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of outgoing.get(id)!) {
      inDegree.set(s, inDegree.get(s)! - 1);
      if (inDegree.get(s) === 0) queue.push(s);
    }
  }
  const remaining = taskIds.filter((id) => !order.includes(id));
  return { order, cycles: remaining.length ? [remaining] : [] };
}

/**
 * Forward pass: every task starts no earlier than its constraints allow.
 * Tasks are only pushed later (never pulled earlier) unless `pullEarlier` is
 * set, which is how "compress the schedule" behaves. Locked tasks never move.
 */
export function recalculateSchedule(
  inputTasks: ScheduleTask[],
  deps: ScheduleDependency[],
  opts: { calendar?: Calendar; pullEarlier?: boolean; anchorIds?: string[] } = {},
): ScheduleResult {
  const cal = opts.calendar ?? DEFAULT_CALENDAR;
  const tasks = new Map(inputTasks.map((t) => [t.id, { ...t }]));
  const { order, cycles } = topologicalOrder([...tasks.keys()], deps);
  const bySuccessor = new Map<string, ScheduleDependency[]>();
  for (const d of deps) {
    if (!tasks.has(d.predecessorId) || !tasks.has(d.successorId)) continue;
    if (!bySuccessor.has(d.successorId)) bySuccessor.set(d.successorId, []);
    bySuccessor.get(d.successorId)!.push(d);
  }
  const changed: ScheduleResult['changed'] = [];
  for (const id of order) {
    const task = tasks.get(id)!;
    const incoming = bySuccessor.get(id) ?? [];
    if (incoming.length === 0 || task.locked) continue;
    let earliest: string | null = null;
    for (const dep of incoming) {
      const pred = tasks.get(dep.predecessorId)!;
      const candidate = earliestStartFromDependency(pred, dep, task.durationDays, cal);
      if (!earliest || parseDate(candidate) > parseDate(earliest)) earliest = candidate;
    }
    if (!earliest) continue;
    const current = task.startDate;
    const mustMoveLater = parseDate(earliest) > parseDate(current);
    const mayMoveEarlier = opts.pullEarlier && parseDate(earliest) < parseDate(current);
    if (mustMoveLater || mayMoveEarlier) {
      const from = { startDate: task.startDate, endDate: task.endDate };
      task.startDate = earliest;
      task.endDate = endDateFor(earliest, task.durationDays, cal);
      changed.push({ id, from, to: { startDate: task.startDate, endDate: task.endDate } });
    }
  }
  const criticalPath = computeCriticalPath(tasks, deps, order, cal);
  return { tasks, changed, criticalPath, cycles };
}

function computeCriticalPath(tasks: Map<string, ScheduleTask>, deps: ScheduleDependency[], order: string[], cal: Calendar): Set<string> {
  // Backward pass on FS-like slack: a task is critical when any delay would
  // delay the project end. Approximation: compute late finish from successors.
  const projectEnd = [...tasks.values()].reduce((max, t) => (parseDate(t.endDate) > parseDate(max) ? t.endDate : max), '1970-01-01');
  const lateFinish = new Map<string, string>();
  const byPred = new Map<string, ScheduleDependency[]>();
  for (const d of deps) {
    if (!byPred.has(d.predecessorId)) byPred.set(d.predecessorId, []);
    byPred.get(d.predecessorId)!.push(d);
  }
  for (const id of [...order].reverse()) {
    const t = tasks.get(id)!;
    let lf = projectEnd;
    for (const d of byPred.get(id) ?? []) {
      const s = tasks.get(d.successorId);
      if (!s) continue;
      const sLf = lateFinish.get(s.id) ?? s.endDate;
      const sLs = addWorkingDays(sLf, -(Math.max(s.durationDays, 1) - 1), cal);
      let candidate: string;
      switch (d.type) {
        case 'FS': candidate = addWorkingDays(sLs, -(1 + d.lagDays), cal); break;
        case 'SS': candidate = addWorkingDays(addWorkingDays(sLs, -d.lagDays, cal), Math.max(t.durationDays, 1) - 1, cal); break;
        case 'FF': candidate = addWorkingDays(sLf, -d.lagDays, cal); break;
        case 'SF': candidate = addWorkingDays(addWorkingDays(sLf, -d.lagDays, cal), Math.max(t.durationDays, 1) - 1, cal); break;
      }
      if (parseDate(candidate) < parseDate(lf)) lf = candidate;
    }
    lateFinish.set(id, lf);
  }
  const critical = new Set<string>();
  for (const [id, lf] of lateFinish) {
    const t = tasks.get(id)!;
    if (workingDaysBetween(t.endDate, lf, cal) <= 1) critical.add(id);
  }
  return critical;
}

/** Move one task and cascade to successors. Returns the full new schedule. */
export function moveTask(
  tasks: ScheduleTask[],
  deps: ScheduleDependency[],
  taskId: string,
  change: { startDate?: string; durationDays?: number },
  calendar: Calendar = DEFAULT_CALENDAR,
): ScheduleResult {
  const updated = tasks.map((t) => {
    if (t.id !== taskId) return t;
    const start = nextWorkingDay(change.startDate ?? t.startDate, calendar);
    const duration = change.durationDays ?? t.durationDays;
    return { ...t, startDate: start, durationDays: duration, endDate: endDateFor(start, duration, calendar), locked: false };
  });
  const original = tasks.find((t) => t.id === taskId);
  const result = recalculateSchedule(updated, deps, { calendar });
  const moved = result.tasks.get(taskId)!;
  if (original && (original.startDate !== moved.startDate || original.endDate !== moved.endDate)) {
    result.changed.unshift({ id: taskId, from: { startDate: original.startDate, endDate: original.endDate }, to: { startDate: moved.startDate, endDate: moved.endDate } });
  }
  return result;
}

export interface ResourceAssignment {
  taskId: string;
  resourceType: 'user' | 'crew' | 'vendor' | 'equipment';
  resourceId: string;
}

export interface ResourceConflict {
  resourceType: ResourceAssignment['resourceType'];
  resourceId: string;
  taskIds: [string, string];
  overlapStart: string;
  overlapEnd: string;
}

/** Detect overlapping assignments of the same resource across tasks (across projects when given). */
export function detectResourceConflicts(tasks: ScheduleTask[], assignments: ResourceAssignment[]): ResourceConflict[] {
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const byResource = new Map<string, ResourceAssignment[]>();
  for (const a of assignments) {
    const key = `${a.resourceType}:${a.resourceId}`;
    if (!byResource.has(key)) byResource.set(key, []);
    byResource.get(key)!.push(a);
  }
  const conflicts: ResourceConflict[] = [];
  for (const list of byResource.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = byTask.get(list[i]!.taskId);
        const b = byTask.get(list[j]!.taskId);
        if (!a || !b || a.id === b.id) continue;
        const start = parseDate(a.startDate) > parseDate(b.startDate) ? a.startDate : b.startDate;
        const end = parseDate(a.endDate) < parseDate(b.endDate) ? a.endDate : b.endDate;
        if (parseDate(start) <= parseDate(end)) {
          conflicts.push({ resourceType: list[i]!.resourceType, resourceId: list[i]!.resourceId, taskIds: [a.id, b.id], overlapStart: start, overlapEnd: end });
        }
      }
    }
  }
  return conflicts;
}
