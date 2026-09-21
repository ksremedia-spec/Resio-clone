import { and, asc, desc, eq, inArray, isNull, sql, or, ilike } from 'drizzle-orm';
import { scheduleCalc, type contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { one } from '../lib/rows.js';
import type { DbOrTx, Tx } from '../db/client.js';
import { attachments, checklistItems, checklists, memberships, organizations, projectPhases, projects, taskAssignees, taskDependencies, tasks, users, vendors } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import type { DocumentService } from './document.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';

type TaskRow = typeof tasks.$inferSelect;

export class ScheduleService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService, private readonly documents: DocumentService) {}

  private async calendar(db: DbOrTx, orgId: string): Promise<scheduleCalc.Calendar> {
    const [org] = await db.select({ workingDays: organizations.workingDays }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return { workingDays: org?.workingDays ?? [1, 2, 3, 4, 5], holidays: [] };
  }

  // ---------- phases ----------

  async listPhases(ctx: RequestContext, projectId: string): Promise<contracts.Phase[]> {
    ctx.require('schedule.read');
    await ctx.requireProjectAccess(this.deps.db, projectId, { allowArchived: true });
    return this.phasesFor(this.deps.db, ctx, projectId);
  }

  private async phasesFor(db: DbOrTx, ctx: RequestContext, projectId: string): Promise<contracts.Phase[]> {
    const rows = await db.select({
      p: projectPhases,
      // Raw identifiers on purpose: Drizzle un-qualifies column refs inside single-table selects.
      startDate: sql<string | null>`(select min(t.start_date) from tasks t where t.phase_id = project_phases.id and t.archived_at is null)`,
      endDate: sql<string | null>`(select max(t.end_date) from tasks t where t.phase_id = project_phases.id and t.archived_at is null)`,
      taskCount: sql<number>`(select count(*) from tasks t where t.phase_id = project_phases.id and t.archived_at is null)::int`,
      completeCount: sql<number>`(select count(*) from tasks t where t.phase_id = project_phases.id and t.archived_at is null and t.status = 'complete')::int`,
    }).from(projectPhases).where(and(eq(projectPhases.projectId, projectId), ctx.membership.external ? eq(projectPhases.clientVisible, true) : sql`true`)).orderBy(asc(projectPhases.sortOrder), asc(projectPhases.createdAt));
    return rows.map((r) => ({ id: r.p.id, organizationId: r.p.organizationId, createdAt: r.p.createdAt, updatedAt: r.p.updatedAt, createdBy: r.p.createdBy, updatedBy: r.p.updatedBy, version: r.p.version, projectId: r.p.projectId, name: r.p.name, sortOrder: r.p.sortOrder, color: r.p.color, startDate: r.startDate, endDate: r.endDate, clientVisible: r.p.clientVisible, taskCount: r.taskCount, completeCount: r.completeCount }));
  }

  async createPhase(ctx: RequestContext, projectId: string, input: { name: string; sortOrder?: number; color?: string | null; clientVisible: boolean }): Promise<contracts.Phase> {
    ctx.require('schedule.write');
    return this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const { max } = one(await tx.select({ max: sql<number>`coalesce(max(${projectPhases.sortOrder}), -1)::int` }).from(projectPhases).where(eq(projectPhases.projectId, projectId)));
      const [row] = await tx.insert(projectPhases).values({ organizationId: ctx.organizationId, projectId, name: input.name, sortOrder: input.sortOrder ?? max + 1, color: input.color ?? null, clientVisible: input.clientVisible, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'created', objectType: 'phase', objectId: row!.id, objectLabel: row!.name });
      return (await this.phasesFor(tx, ctx, projectId)).find((p) => p.id === row!.id)!;
    });
  }

  async updatePhase(ctx: RequestContext, projectId: string, phaseId: string, input: Record<string, unknown>): Promise<contracts.Phase> {
    ctx.require('schedule.write');
    return this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const [before] = await tx.select().from(projectPhases).where(and(eq(projectPhases.id, phaseId), eq(projectPhases.projectId, projectId))).limit(1);
      if (!before) throw AppError.notFound('Phase');
      const [after] = await tx.update(projectPhases).set({ ...input, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${projectPhases.version} + 1` } as any).where(eq(projectPhases.id, phaseId)).returning();
      const diff = diffRecords(before as any, after as any);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'updated', objectType: 'phase', objectId: phaseId, objectLabel: after!.name, diff });
      return (await this.phasesFor(tx, ctx, projectId)).find((p) => p.id === phaseId)!;
    });
  }

  async deletePhase(ctx: RequestContext, projectId: string, phaseId: string) {
    ctx.require('schedule.write');
    await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const [row] = await tx.delete(projectPhases).where(and(eq(projectPhases.id, phaseId), eq(projectPhases.projectId, projectId))).returning();
      if (!row) throw AppError.notFound('Phase');
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'deleted', objectType: 'phase', objectId: phaseId, objectLabel: row.name });
    });
  }

  // ---------- tasks ----------

  async schedule(ctx: RequestContext, projectId: string): Promise<contracts.ScheduleResponse> {
    ctx.require('schedule.read');
    const { db } = this.deps;
    await ctx.requireProjectAccess(db, projectId, { allowArchived: true });
    const phases = await this.phasesFor(db, ctx, projectId);
    const rows = await db.select().from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt), eq(tasks.kind, 'schedule'), ctx.membership.external ? eq(tasks.clientVisible, true) : sql`true`)).orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
    const deps = await db.select().from(taskDependencies).where(eq(taskDependencies.projectId, projectId));
    const calendar = await this.calendar(db, ctx.organizationId);
    const calc = scheduleCalc.recalculateSchedule(rows.filter((t) => t.startDate && t.endDate).map(toCalcTask), deps.map(toCalcDep), { calendar });
    const serialized = await this.serializeMany(db, ctx, rows, deps);
    for (const t of serialized) t.isCritical = calc.criticalPath.has(t.id);
    const assignments = await db.select().from(taskAssignees).where(inArray(taskAssignees.taskId, rows.map((r) => r.id).concat(['00000000-0000-0000-0000-000000000000'])));
    const conflicts = scheduleCalc.detectResourceConflicts(rows.filter((t) => t.startDate && t.endDate && t.status !== 'complete' && t.status !== 'cancelled').map(toCalcTask),
      assignments.map((a) => ({ taskId: a.taskId, resourceType: a.userId ? 'user' as const : 'vendor' as const, resourceId: a.userId ?? a.vendorId ?? '' })));
    const names = new Map<string, string>();
    for (const t of serialized) for (const a of t.assignees) names.set(`${a.kind}:${a.userId ?? a.vendorId}`, a.displayName);
    return { phases, tasks: serialized, dependencies: deps.map(serializeDep), criticalPath: [...calc.criticalPath], conflicts: conflicts.map((c) => ({ resourceType: c.resourceType, resourceId: c.resourceId, resourceName: names.get(`${c.resourceType}:${c.resourceId}`) ?? 'Unknown', taskIds: c.taskIds, overlapStart: c.overlapStart, overlapEnd: c.overlapEnd })), workingDays: calendar.workingDays };
  }

  async listTasks(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; phaseId?: string; status: string; kind: string; assigneeUserId?: string; mine?: boolean; dueBefore?: string; dueAfter?: string; q?: string; sort: string }) {
    ctx.require('tasks.read');
    const { db } = this.deps;
    const conditions = [eq(tasks.organizationId, ctx.organizationId), isNull(tasks.archivedAt)];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(tasks.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? inArray(tasks.projectId, visible) : sql`false`); }
    if (query.phaseId) conditions.push(eq(tasks.phaseId, query.phaseId));
    if (query.status === 'open') conditions.push(sql`${tasks.status} not in ('complete','cancelled')`);
    else if (query.status !== 'all') conditions.push(eq(tasks.status, query.status));
    if (query.kind !== 'all') conditions.push(eq(tasks.kind, query.kind));
    const assignee = query.mine ? ctx.userId : query.assigneeUserId;
    if (assignee || ctx.membership.roleKey === 'field_crew') conditions.push(sql`exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.userId} = ${assignee ?? ctx.userId})`);
    if (query.dueBefore) conditions.push(sql`coalesce(${tasks.dueDate}, ${tasks.endDate}) <= ${query.dueBefore}`);
    if (query.dueAfter) conditions.push(sql`coalesce(${tasks.dueDate}, ${tasks.endDate}) >= ${query.dueAfter}`);
    if (query.q) conditions.push(or(ilike(tasks.name, `%${query.q}%`), ilike(tasks.description, `%${query.q}%`))!);
    if (ctx.membership.external) conditions.push(eq(tasks.clientVisible, true));
    const [field, dir] = query.sort.split(':') as [string, 'asc' | 'desc'];
    const col = field === 'startDate' ? tasks.startDate : field === 'dueDate' ? sql`coalesce(${tasks.dueDate}, ${tasks.endDate})` : field === 'updatedAt' ? tasks.updatedAt : tasks.sortOrder;
    const cursor = decodeCursor<{ k: string | number | null; id: string }>(query.cursor);
    if (cursor) conditions.push(dir === 'asc' ? sql`(${col}, ${tasks.id}) > (${cursor.k}, ${cursor.id}::uuid)` : sql`(${col}, ${tasks.id}) < (${cursor.k}, ${cursor.id}::uuid)`);
    const rows = await db.select({ t: tasks, projectName: projects.name }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(...conditions)).orderBy(dir === 'asc' ? asc(col) : desc(col), dir === 'asc' ? asc(tasks.id) : desc(tasks.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ k: field === 'dueDate' ? (r.t.dueDate ?? r.t.endDate) : (r.t as any)[field] ?? null, id: r.t.id }));
    const deps = result.items.length ? await db.select().from(taskDependencies).where(or(inArray(taskDependencies.successorId, result.items.map((r) => r.t.id)), inArray(taskDependencies.predecessorId, result.items.map((r) => r.t.id)))) : [];
    const serialized = await this.serializeMany(db, ctx, result.items.map((r) => r.t), deps);
    const nameById = new Map(result.items.map((r) => [r.t.id, r.projectName]));
    for (const t of serialized) t.projectName = nameById.get(t.id);
    return { items: serialized, nextCursor: result.nextCursor };
  }

  async getTask(ctx: RequestContext, taskId: string): Promise<contracts.Task> {
    ctx.require('tasks.read');
    const { db } = this.deps;
    const [row] = await db.select({ t: tasks, projectName: projects.name }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Task');
    await ctx.requireProjectAccess(db, row.t.projectId, { allowArchived: true });
    if (ctx.membership.external && !row.t.clientVisible) throw AppError.notFound('Task');
    const deps = await db.select().from(taskDependencies).where(or(eq(taskDependencies.successorId, taskId), eq(taskDependencies.predecessorId, taskId)));
    const [t] = await this.serializeMany(db, ctx, [row.t], deps);
    t!.projectName = row.projectName;
    return t!;
  }

  async createTask(ctx: RequestContext, projectId: string, input: any): Promise<contracts.Task> {
    ctx.require(input.kind === 'todo' ? 'tasks.write' : 'schedule.write');
    const id = await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      if (input.clientMutationId) {
        const [dup] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, projectId), sql`${tasks.id} = ${input.id ?? '00000000-0000-0000-0000-000000000000'}`)).limit(1);
        if (dup) return dup.id;
      }
      const calendar = await this.calendar(tx, ctx.organizationId);
      let startDate = input.startDate ?? null;
      let durationDays = input.isMilestone ? 0 : (input.durationDays ?? (input.startDate && input.endDate ? scheduleCalc.workingDaysBetween(input.startDate, input.endDate, calendar) : 1));
      let endDate = startDate ? scheduleCalc.endDateFor(startDate, durationDays, calendar) : (input.endDate ?? null);
      if (input.kind === 'schedule' && !startDate) { startDate = scheduleCalc.nextWorkingDay(new Date().toISOString().slice(0, 10), calendar); endDate = scheduleCalc.endDateFor(startDate, durationDays, calendar); }
      if (input.phaseId) {
        const [ph] = await tx.select({ id: projectPhases.id }).from(projectPhases).where(and(eq(projectPhases.id, input.phaseId), eq(projectPhases.projectId, projectId))).limit(1);
        if (!ph) throw AppError.notFound('Phase');
      }
      const { max } = one(await tx.select({ max: sql<number>`coalesce(max(${tasks.sortOrder}), -1)::int` }).from(tasks).where(eq(tasks.projectId, projectId)));
      const [row] = await tx.insert(tasks).values({
        ...(input.id ? { id: input.id } : {}), organizationId: ctx.organizationId, projectId, phaseId: input.phaseId ?? null, parentTaskId: input.parentTaskId ?? null, kind: input.kind, name: input.name, description: input.description, status: input.status, priority: input.priority,
        isMilestone: input.isMilestone, startDate, endDate, dueDate: input.dueDate ?? (input.kind === 'todo' ? null : endDate), durationDays, sortOrder: input.sortOrder ?? max + 1, clientVisible: input.clientVisible, color: input.color ?? null, costCodeId: input.costCodeId ?? null,
        baselineStartDate: startDate, baselineEndDate: endDate, createdBy: ctx.userId, updatedBy: ctx.userId,
      }).returning();
      await this.setAssignees(tx, ctx, row!, input.assigneeUserIds ?? [], input.assigneeVendorIds ?? [], true);
      if (input.checklist?.length) {
        const [cl] = await tx.insert(checklists).values({ organizationId: ctx.organizationId, objectType: 'task', objectId: row!.id, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
        await tx.insert(checklistItems).values(input.checklist.map((text: string, i: number) => ({ organizationId: ctx.organizationId, checklistId: cl!.id, text, sortOrder: i, createdBy: ctx.userId, updatedBy: ctx.userId })));
      }
      for (const dep of input.predecessors ?? []) await this.addDependencyTx(tx, ctx, projectId, { predecessorId: dep.taskId, successorId: row!.id, type: dep.type, lagDays: dep.lagDays });
      if (input.predecessors?.length) await this.recalculateTx(tx, ctx, projectId, calendar);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'created', objectType: 'task', objectId: row!.id, objectLabel: row!.name, clientVisible: row!.clientVisible });
      return row!.id;
    });
    return this.getTask(ctx, id);
  }

  private async setAssignees(tx: Tx, ctx: RequestContext, task: TaskRow, userIds: string[], vendorIds: string[], isNew: boolean) {
    const existing = await tx.select().from(taskAssignees).where(eq(taskAssignees.taskId, task.id));
    const existingUsers = new Set(existing.filter((e) => e.userId).map((e) => e.userId!));
    const validUsers = userIds.length ? (await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, ctx.organizationId), inArray(memberships.userId, userIds)))).map((m) => m.userId) : [];
    const validVendors = vendorIds.length ? (await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.organizationId, ctx.organizationId), inArray(vendors.id, vendorIds)))).map((v) => v.id) : [];
    await tx.delete(taskAssignees).where(and(eq(taskAssignees.taskId, task.id), or(validUsers.length ? sql`${taskAssignees.userId} not in ${validUsers}` : sql`${taskAssignees.userId} is not null`, validVendors.length ? sql`${taskAssignees.vendorId} not in ${validVendors}` : sql`${taskAssignees.vendorId} is not null`)!));
    const newUsers = validUsers.filter((u) => !existingUsers.has(u));
    const values = [
      ...newUsers.map((userId) => ({ organizationId: ctx.organizationId, taskId: task.id, userId, createdBy: ctx.userId, updatedBy: ctx.userId })),
      ...validVendors.filter((v) => !existing.some((e) => e.vendorId === v)).map((vendorId) => ({ organizationId: ctx.organizationId, taskId: task.id, vendorId, createdBy: ctx.userId, updatedBy: ctx.userId })),
    ];
    if (values.length) await tx.insert(taskAssignees).values(values).onConflictDoNothing();
    if (newUsers.length) {
      const [p] = await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, task.projectId)).limit(1);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: newUsers, excludeUserId: ctx.userId, kind: 'task.assigned', title: `New task: ${task.name}`, body: `${ctx.actorName} assigned you "${task.name}" on ${p!.name}${task.dueDate ?? task.endDate ? ` (due ${task.dueDate ?? task.endDate})` : ''}.`, projectId: task.projectId, objectType: 'task', objectId: task.id, link: `/projects/${task.projectId}/tasks/${task.id}` });
    }
    return { newUsers, isNew };
  }

  async updateTask(ctx: RequestContext, taskId: string, input: Record<string, any>): Promise<contracts.Task> {
    const { db } = this.deps;
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, ctx.organizationId))).limit(1);
      if (!before) throw AppError.notFound('Task');
      await ctx.requireProjectAccess(tx, before.projectId);
      const onlyStatus = Object.keys(input).every((k) => ['status', 'percentComplete', 'checklist', 'expectedVersion'].includes(k));
      if (!ctx.has('schedule.write')) {
        // Without schedule.write a user may only progress tasks assigned to them, or edit to-dos they created.
        ctx.require('tasks.write');
        const [assigned] = await tx.select({ id: taskAssignees.id }).from(taskAssignees).where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, ctx.userId))).limit(1);
        const isCreator = before.createdBy === ctx.userId && before.kind === 'todo';
        if (!assigned && !isCreator) throw AppError.forbidden('You can only update tasks assigned to you.');
        if (!isCreator && !onlyStatus) throw AppError.forbidden('You can update the status and checklist of this task, but not its details.');
      }
      if (input.expectedVersion !== undefined && input.expectedVersion !== before.version) throw AppError.versionConflict({ current: before });
      const { assigneeUserIds, assigneeVendorIds, checklist, expectedVersion: _v, ...rest } = input;
      const calendar = await this.calendar(tx, ctx.organizationId);
      const patch: Record<string, unknown> = { ...rest, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${tasks.version} + 1` };
      const datesTouched = rest.startDate !== undefined || rest.durationDays !== undefined || rest.endDate !== undefined || rest.isMilestone !== undefined;
      if (datesTouched && before.kind === 'schedule') {
        const start = rest.startDate ?? before.startDate;
        const milestone = rest.isMilestone ?? before.isMilestone;
        let duration = milestone ? 0 : (rest.durationDays ?? (rest.endDate && start ? scheduleCalc.workingDaysBetween(start, rest.endDate, calendar) : before.durationDays));
        if (start) { const snapped = scheduleCalc.nextWorkingDay(start, calendar); patch.startDate = snapped; patch.endDate = scheduleCalc.endDateFor(snapped, duration, calendar); patch.durationDays = duration; if (rest.dueDate === undefined && (before.dueDate === before.endDate || !before.dueDate)) patch.dueDate = patch.endDate; }
      }
      if (rest.status === 'complete' && before.status !== 'complete') { patch.completedAt = sql`now()`; patch.completedBy = ctx.userId; patch.percentComplete = 100; }
      if (rest.status && rest.status !== 'complete' && before.status === 'complete') { patch.completedAt = null; patch.completedBy = null; }
      const [after] = await tx.update(tasks).set(patch as any).where(eq(tasks.id, taskId)).returning();
      if (assigneeUserIds || assigneeVendorIds) await this.setAssignees(tx, ctx, after!, assigneeUserIds ?? (await tx.select().from(taskAssignees).where(eq(taskAssignees.taskId, taskId))).filter((a) => a.userId).map((a) => a.userId!), assigneeVendorIds ?? (await tx.select().from(taskAssignees).where(eq(taskAssignees.taskId, taskId))).filter((a) => a.vendorId).map((a) => a.vendorId!), false);
      if (checklist) await this.replaceChecklist(tx, ctx, taskId, checklist);
      if (datesTouched && before.kind === 'schedule') await this.recalculateTx(tx, ctx, before.projectId, calendar, taskId);
      const diff = diffRecords(before as any, after as any, ['updatedAt', 'updatedBy', 'version', 'completedBy']);
      if (diff) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: before.projectId, verb: rest.status === 'complete' ? 'completed' : diff.startDate || diff.endDate ? 'rescheduled' : 'updated', objectType: 'task', objectId: taskId, objectLabel: after!.name, diff, clientVisible: after!.clientVisible });
    });
    return this.getTask(ctx, taskId);
  }

  private async replaceChecklist(tx: Tx, ctx: RequestContext, taskId: string, items: Array<{ id?: string; text: string; done: boolean }>) {
    let [cl] = await tx.select().from(checklists).where(and(eq(checklists.objectType, 'task'), eq(checklists.objectId, taskId))).limit(1);
    if (!cl) [cl] = await tx.insert(checklists).values({ organizationId: ctx.organizationId, objectType: 'task', objectId: taskId, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    const keep = items.map((i) => i.id).filter(Boolean) as string[];
    await tx.delete(checklistItems).where(and(eq(checklistItems.checklistId, cl!.id), keep.length ? sql`${checklistItems.id} not in ${keep}` : sql`true`));
    for (const [i, item] of items.entries()) {
      if (item.id) await tx.update(checklistItems).set({ text: item.text, done: item.done, sortOrder: i, doneAt: item.done ? sql`coalesce(${checklistItems.doneAt}, now())` : null, doneBy: item.done ? ctx.userId : null, updatedAt: sql`now()` }).where(and(eq(checklistItems.id, item.id), eq(checklistItems.checklistId, cl!.id)));
      else await tx.insert(checklistItems).values({ organizationId: ctx.organizationId, checklistId: cl!.id, text: item.text, done: item.done, sortOrder: i, doneAt: item.done ? sql`now()` : null, doneBy: item.done ? ctx.userId : null, createdBy: ctx.userId, updatedBy: ctx.userId });
    }
  }

  async archiveTask(ctx: RequestContext, taskId: string) {
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, ctx.organizationId))).limit(1);
      if (!row) throw AppError.notFound('Task');
      ctx.require(row.kind === 'todo' ? 'tasks.write' : 'schedule.write');
      await ctx.requireProjectAccess(tx, row.projectId);
      await tx.update(tasks).set({ archivedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${tasks.version} + 1` }).where(eq(tasks.id, taskId));
      await tx.delete(taskDependencies).where(or(eq(taskDependencies.predecessorId, taskId), eq(taskDependencies.successorId, taskId)));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'deleted', objectType: 'task', objectId: taskId, objectLabel: row.name });
    });
  }

  // ---------- dependencies & cascade ----------

  private async addDependencyTx(tx: Tx, ctx: RequestContext, projectId: string, dep: { predecessorId: string; successorId: string; type: string; lagDays: number }) {
    if (dep.predecessorId === dep.successorId) throw AppError.validation('A task cannot depend on itself.');
    const rows = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, projectId), inArray(tasks.id, [dep.predecessorId, dep.successorId]), isNull(tasks.archivedAt)));
    if (rows.length !== 2) throw AppError.notFound('Task');
    const existing = await tx.select().from(taskDependencies).where(eq(taskDependencies.projectId, projectId));
    const all = [...existing.map(toCalcDep), { predecessorId: dep.predecessorId, successorId: dep.successorId, type: dep.type as scheduleCalc.DependencyType, lagDays: dep.lagDays }];
    const ids = [...new Set(all.flatMap((d) => [d.predecessorId, d.successorId]))];
    const { cycles } = scheduleCalc.topologicalOrder(ids, all);
    if (cycles.length) throw AppError.conflict('That dependency would create a loop in the schedule.');
    const [row] = await tx.insert(taskDependencies).values({ organizationId: ctx.organizationId, projectId, predecessorId: dep.predecessorId, successorId: dep.successorId, type: dep.type, lagDays: dep.lagDays, createdBy: ctx.userId, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: [taskDependencies.predecessorId, taskDependencies.successorId], set: { type: dep.type, lagDays: dep.lagDays, updatedAt: sql`now()` } }).returning();
    return row!;
  }

  async addDependency(ctx: RequestContext, taskId: string, input: { predecessorId: string; type: string; lagDays: number }): Promise<contracts.Task> {
    ctx.require('schedule.write');
    await this.deps.db.transaction(async (tx) => {
      const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, ctx.organizationId))).limit(1);
      if (!task) throw AppError.notFound('Task');
      await ctx.requireProjectAccess(tx, task.projectId);
      const row = await this.addDependencyTx(tx, ctx, task.projectId, { predecessorId: input.predecessorId, successorId: taskId, type: input.type, lagDays: input.lagDays });
      await this.recalculateTx(tx, ctx, task.projectId, await this.calendar(tx, ctx.organizationId));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: task.projectId, verb: 'linked', objectType: 'task_dependency', objectId: row.id, objectLabel: task.name });
    });
    return this.getTask(ctx, taskId);
  }

  async removeDependency(ctx: RequestContext, taskId: string, dependencyId: string): Promise<contracts.Task> {
    ctx.require('schedule.write');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.delete(taskDependencies).where(and(eq(taskDependencies.id, dependencyId), eq(taskDependencies.organizationId, ctx.organizationId), or(eq(taskDependencies.successorId, taskId), eq(taskDependencies.predecessorId, taskId)))).returning();
      if (!row) throw AppError.notFound('Dependency');
      await ctx.requireProjectAccess(tx, row.projectId);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'unlinked', objectType: 'task_dependency', objectId: dependencyId });
    });
    return this.getTask(ctx, taskId);
  }

  /** Preview or commit a move; downstream tasks cascade. */
  async moveTask(ctx: RequestContext, taskId: string, input: { startDate?: string; durationDays?: number; commit: boolean }) {
    ctx.require('schedule.write');
    const { db } = this.deps;
    const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, ctx.organizationId))).limit(1);
    if (!task) throw AppError.notFound('Task');
    await ctx.requireProjectAccess(db, task.projectId);
    const calendar = await this.calendar(db, ctx.organizationId);
    const rows = await db.select().from(tasks).where(and(eq(tasks.projectId, task.projectId), isNull(tasks.archivedAt), eq(tasks.kind, 'schedule')));
    const deps = await db.select().from(taskDependencies).where(eq(taskDependencies.projectId, task.projectId));
    const calcTasks = rows.filter((t) => t.startDate && t.endDate).map(toCalcTask);
    const result = scheduleCalc.moveTask(calcTasks, deps.map(toCalcDep), taskId, input, calendar);
    const nameById = new Map(rows.map((r) => [r.id, r.name]));
    const changes = result.changed.map((c) => ({ id: c.id, name: nameById.get(c.id) ?? '', from: c.from, to: c.to }));
    if (input.commit) {
      await db.transaction(async (tx) => {
        for (const c of result.changed) {
          const moved = result.tasks.get(c.id)!;
          await tx.update(tasks).set({ startDate: moved.startDate, endDate: moved.endDate, durationDays: moved.durationDays, dueDate: sql`case when ${tasks.dueDate} is null or ${tasks.dueDate} = ${tasks.endDate} then ${moved.endDate}::date else ${tasks.dueDate} end`, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${tasks.version} + 1` }).where(eq(tasks.id, c.id));
          await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: task.projectId, verb: c.id === taskId ? 'moved' : 'rescheduled', objectType: 'task', objectId: c.id, objectLabel: nameById.get(c.id) ?? '', diff: { startDate: { from: c.from.startDate, to: c.to.startDate }, endDate: { from: c.from.endDate, to: c.to.endDate } }, clientVisible: !!rows.find((r) => r.id === c.id)?.clientVisible });
        }
        const affectedUsers = result.changed.length ? await tx.select({ userId: taskAssignees.userId }).from(taskAssignees).where(and(inArray(taskAssignees.taskId, result.changed.map((c) => c.id)), sql`${taskAssignees.userId} is not null`)) : [];
        if (affectedUsers.length) await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: affectedUsers.map((u) => u.userId!), excludeUserId: ctx.userId, kind: 'schedule.changed', title: `Schedule updated: ${task.name}`, body: `${ctx.actorName} moved "${task.name}"; ${result.changed.length} task(s) were rescheduled.`, projectId: task.projectId, objectType: 'task', objectId: taskId, link: `/projects/${task.projectId}/schedule` });
      });
    }
    return { changes, criticalPath: [...result.criticalPath], committed: input.commit };
  }

  /** Re-run the forward pass after a change and persist any pushed tasks. */
  private async recalculateTx(tx: Tx, ctx: RequestContext, projectId: string, calendar: scheduleCalc.Calendar, originId?: string) {
    const rows = await tx.select().from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt), eq(tasks.kind, 'schedule')));
    const deps = await tx.select().from(taskDependencies).where(eq(taskDependencies.projectId, projectId));
    const result = scheduleCalc.recalculateSchedule(rows.filter((t) => t.startDate && t.endDate).map(toCalcTask), deps.map(toCalcDep), { calendar });
    for (const c of result.changed) {
      if (c.id === originId) continue;
      await tx.update(tasks).set({ startDate: c.to.startDate, endDate: c.to.endDate, dueDate: sql`case when ${tasks.dueDate} is null or ${tasks.dueDate} = ${tasks.endDate} then ${c.to.endDate}::date else ${tasks.dueDate} end`, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${tasks.version} + 1` }).where(eq(tasks.id, c.id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'rescheduled', objectType: 'task', objectId: c.id, objectLabel: rows.find((r) => r.id === c.id)?.name ?? '', diff: { startDate: { from: c.from.startDate, to: c.to.startDate }, endDate: { from: c.from.endDate, to: c.to.endDate } } });
    }
    return result;
  }

  // ---------- serialization ----------

  private async serializeMany(db: DbOrTx, ctx: RequestContext, rows: TaskRow[], deps: Array<typeof taskDependencies.$inferSelect>): Promise<contracts.Task[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const assignees = await db.select({ a: taskAssignees, u: users, v: vendors }).from(taskAssignees).leftJoin(users, eq(users.id, taskAssignees.userId)).leftJoin(vendors, eq(vendors.id, taskAssignees.vendorId)).where(inArray(taskAssignees.taskId, ids));
    const checklistRows = await db.select({ i: checklistItems, objectId: checklists.objectId }).from(checklistItems).innerJoin(checklists, eq(checklists.id, checklistItems.checklistId)).where(and(eq(checklists.objectType, 'task'), inArray(checklists.objectId, ids))).orderBy(asc(checklistItems.sortOrder));
    const attachmentCounts = await db.select({ objectId: attachments.objectId, n: sql<number>`count(*)::int` }).from(attachments).where(and(eq(attachments.objectType, 'task'), inArray(attachments.objectId, ids))).groupBy(attachments.objectId);
    const countBy = new Map(attachmentCounts.map((a) => [a.objectId, a.n]));
    return rows.map((t) => ({
      id: t.id, organizationId: t.organizationId, createdAt: t.createdAt, updatedAt: t.updatedAt, createdBy: t.createdBy, updatedBy: t.updatedBy, version: t.version,
      projectId: t.projectId, phaseId: t.phaseId, parentTaskId: t.parentTaskId, kind: t.kind as contracts.Task['kind'], name: t.name, description: t.description, status: t.status as contracts.Task['status'], priority: t.priority as contracts.Task['priority'],
      isMilestone: t.isMilestone, startDate: t.startDate, endDate: t.endDate, dueDate: t.dueDate, durationDays: t.durationDays, percentComplete: t.percentComplete, sortOrder: t.sortOrder, locked: t.locked, clientVisible: t.clientVisible, color: t.color, costCodeId: t.costCodeId, completedAt: t.completedAt,
      assignees: assignees.filter((a) => a.a.taskId === t.id).map(({ a, u, v }) => ({ id: a.id, userId: a.userId, vendorId: a.vendorId, displayName: u ? `${u.firstName} ${u.lastName}` : v?.name ?? 'Unknown', kind: u ? 'user' as const : 'vendor' as const, accepted: a.accepted })),
      predecessors: deps.filter((d) => d.successorId === t.id).map(serializeDep),
      successors: deps.filter((d) => d.predecessorId === t.id).map(serializeDep),
      checklist: checklistRows.filter((c) => c.objectId === t.id).map(({ i }) => ({ id: i.id, text: i.text, done: i.done, sortOrder: i.sortOrder })),
      attachmentCount: countBy.get(t.id) ?? 0,
    }));
  }
}

function toCalcTask(t: TaskRow): scheduleCalc.ScheduleTask {
  return { id: t.id, startDate: t.startDate!, endDate: t.endDate!, durationDays: t.durationDays, isMilestone: t.isMilestone, locked: t.locked };
}
function toCalcDep(d: typeof taskDependencies.$inferSelect): scheduleCalc.ScheduleDependency {
  return { predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as scheduleCalc.DependencyType, lagDays: d.lagDays };
}
function serializeDep(d: typeof taskDependencies.$inferSelect): contracts.TaskDependency {
  return { id: d.id, predecessorId: d.predecessorId, successorId: d.successorId, type: d.type as contracts.TaskDependency['type'], lagDays: d.lagDays };
}
