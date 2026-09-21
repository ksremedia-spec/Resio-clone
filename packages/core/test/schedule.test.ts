import { describe, expect, it } from 'vitest';
import { addWorkingDays, detectResourceConflicts, endDateFor, moveTask, recalculateSchedule, topologicalOrder, workingDaysBetween, type ScheduleDependency, type ScheduleTask } from '../src/calc/schedule.js';

const t = (id: string, start: string, duration: number): ScheduleTask => ({ id, startDate: start, durationDays: duration, endDate: endDateFor(start, duration) });

describe('working-day calendar', () => {
  it('skips weekends', () => {
    expect(addWorkingDays('2026-06-12', 1)).toBe('2026-06-15'); // Fri → Mon
    expect(endDateFor('2026-06-12', 2)).toBe('2026-06-15');
    expect(workingDaysBetween('2026-06-12', '2026-06-15')).toBe(2);
    expect(addWorkingDays('2026-06-15', -1)).toBe('2026-06-12');
  });
  it('respects holidays', () => {
    const cal = { workingDays: [1, 2, 3, 4, 5], holidays: ['2026-07-03'] };
    expect(addWorkingDays('2026-07-02', 1, cal)).toBe('2026-07-06');
  });
});

describe('dependency cascade', () => {
  const tasks = [t('foundation', '2026-06-01', 5), t('framing', '2026-06-08', 10), t('roofing', '2026-06-22', 5), t('exterior', '2026-06-29', 5)];
  const deps: ScheduleDependency[] = [
    { predecessorId: 'foundation', successorId: 'framing', type: 'FS', lagDays: 0 },
    { predecessorId: 'framing', successorId: 'roofing', type: 'FS', lagDays: 0 },
    { predecessorId: 'roofing', successorId: 'exterior', type: 'FS', lagDays: 0 },
  ];
  it('is stable when constraints are satisfied', () => {
    const r = recalculateSchedule(tasks, deps);
    expect(r.changed).toEqual([]);
    expect(r.cycles).toEqual([]);
  });
  it('pushes downstream tasks when a task slips', () => {
    const r = moveTask(tasks, deps, 'foundation', { durationDays: 8 });
    expect(r.tasks.get('foundation')!.endDate).toBe('2026-06-10');
    expect(r.tasks.get('framing')!.startDate).toBe('2026-06-11');
    expect(r.tasks.get('roofing')!.startDate).toBe('2026-06-25');
    expect(r.tasks.get('exterior')!.startDate).toBe('2026-07-02');
    expect(r.changed.map((c) => c.id)).toEqual(['foundation', 'framing', 'roofing', 'exterior']);
    expect([...r.criticalPath].sort()).toEqual(['exterior', 'foundation', 'framing', 'roofing']);
  });
  it('honours lag and SS dependencies', () => {
    const r = recalculateSchedule([t('pour', '2026-06-01', 1), t('frame', '2026-06-01', 3)], [{ predecessorId: 'pour', successorId: 'frame', type: 'FS', lagDays: 3 }]);
    expect(r.tasks.get('frame')!.startDate).toBe('2026-06-05'); // 1 + 3 lag working days after Mon
    const ss = recalculateSchedule([t('a', '2026-06-01', 5), t('b', '2026-06-01', 2)], [{ predecessorId: 'a', successorId: 'b', type: 'SS', lagDays: 2 }]);
    expect(ss.tasks.get('b')!.startDate).toBe('2026-06-03');
  });
  it('handles FF dependencies', () => {
    const r = recalculateSchedule([t('a', '2026-06-01', 5), t('b', '2026-06-01', 2)], [{ predecessorId: 'a', successorId: 'b', type: 'FF', lagDays: 0 }]);
    expect(r.tasks.get('b')!.endDate).toBe('2026-06-05');
    expect(r.tasks.get('b')!.startDate).toBe('2026-06-04');
  });
  it('does not move locked tasks', () => {
    const locked = tasks.map((x) => (x.id === 'framing' ? { ...x, locked: true } : x));
    const r = moveTask(locked, deps, 'foundation', { durationDays: 8 });
    expect(r.tasks.get('framing')!.startDate).toBe('2026-06-08');
  });
  it('detects cycles', () => {
    const { cycles } = topologicalOrder(['a', 'b'], [
      { predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 },
      { predecessorId: 'b', successorId: 'a', type: 'FS', lagDays: 0 },
    ]);
    expect(cycles).toEqual([['a', 'b']]);
  });
});

describe('resource conflicts', () => {
  it('finds overlapping assignments of the same resource', () => {
    const conflicts = detectResourceConflicts([t('a', '2026-06-01', 5), t('b', '2026-06-04', 3), t('c', '2026-06-15', 1)], [
      { taskId: 'a', resourceType: 'user', resourceId: 'u1' },
      { taskId: 'b', resourceType: 'user', resourceId: 'u1' },
      { taskId: 'c', resourceType: 'user', resourceId: 'u1' },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ taskIds: ['a', 'b'], overlapStart: '2026-06-04', overlapEnd: '2026-06-05' });
  });
});
