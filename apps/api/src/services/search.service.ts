import { and, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import { clients, contacts, dailyLogs, documents, leads, messageThreads, messages, projects, tasks, vendors, threadParticipants } from '../db/schema/index.js';
import type { RequestContext } from '../lib/context.js';

export class SearchService {
  constructor(private readonly deps: Deps) {}

  async search(ctx: RequestContext, query: { q: string; types?: string; projectId?: string; limit: number }): Promise<contracts.SearchResult[]> {
    const { db } = this.deps;
    const q = query.q.trim();
    const like = `%${q}%`;
    const types = query.types ? new Set(query.types.split(',')) : null;
    const want = (t: string) => !types || types.has(t);
    const visible = await ctx.visibleProjectIds(db);
    const projectScope = (col: any) => visible ? (visible.length ? inArray(col, visible) : sql`false`) : sql`true`;
    const perType = Math.max(3, Math.ceil(query.limit / 4));
    const results: contracts.SearchResult[] = [];
    const rank = (text: string) => { const t = text.toLowerCase(); const ql = q.toLowerCase(); return t === ql ? 3 : t.startsWith(ql) ? 2 : t.includes(ql) ? 1 : 0.5; };

    if (want('project') && ctx.has('projects.read')) {
      const rows = await db.select({ p: projects, clientName: clients.displayName }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId))
        .where(and(eq(projects.organizationId, ctx.organizationId), isNull(projects.archivedAt), projectScope(projects.id), query.projectId ? eq(projects.id, query.projectId) : sql`true`, or(ilike(projects.name, like), ilike(projects.number, like), sql`to_tsvector('simple', ${projects.searchText}) @@ plainto_tsquery('simple', ${q})`)!)).limit(perType);
      for (const { p, clientName } of rows) results.push({ type: 'project', id: p.id, title: `${p.number} · ${p.name}`, subtitle: [clientName, p.status.replace('_', ' ')].filter(Boolean).join(' · '), projectId: p.id, link: `/projects/${p.id}`, score: rank(p.name) + 1 });
    }
    if (want('client') && ctx.has('clients.read') && !query.projectId) {
      const rows = await db.select().from(clients).where(and(eq(clients.organizationId, ctx.organizationId), isNull(clients.archivedAt), or(ilike(clients.displayName, like), ilike(clients.companyName, like), ilike(clients.email, like))!)).limit(perType);
      for (const c of rows) results.push({ type: 'client', id: c.id, title: c.displayName, subtitle: [c.companyName, c.email].filter(Boolean).join(' · '), projectId: null, link: `/clients/${c.id}`, score: rank(c.displayName) });
      const contactRows = await db.select().from(contacts).where(and(eq(contacts.organizationId, ctx.organizationId), sql`${contacts.clientId} is not null`, or(ilike(contacts.firstName, like), ilike(contacts.lastName, like), ilike(contacts.email, like))!)).limit(perType);
      for (const c of contactRows) results.push({ type: 'contact', id: c.id, title: `${c.firstName} ${c.lastName}`.trim(), subtitle: c.email ?? c.phone ?? '', projectId: null, link: `/clients/${c.clientId}`, score: rank(`${c.firstName} ${c.lastName}`) });
    }
    if (want('vendor') && ctx.has('vendors.read') && !query.projectId) {
      const rows = await db.select().from(vendors).where(and(eq(vendors.organizationId, ctx.organizationId), isNull(vendors.archivedAt), or(ilike(vendors.name, like), ilike(vendors.trade, like))!)).limit(perType);
      for (const v of rows) results.push({ type: 'vendor', id: v.id, title: v.name, subtitle: v.trade ?? '', projectId: null, link: `/vendors/${v.id}`, score: rank(v.name) });
    }
    if (want('lead') && ctx.has('leads.read') && !query.projectId) {
      const rows = await db.select().from(leads).where(and(eq(leads.organizationId, ctx.organizationId), isNull(leads.archivedAt), or(ilike(leads.name, like), ilike(leads.contactName, like))!)).limit(perType);
      for (const l of rows) results.push({ type: 'lead', id: l.id, title: l.name, subtitle: l.stage, projectId: null, link: `/leads/${l.id}`, score: rank(l.name) });
    }
    if (want('task') && ctx.has('tasks.read')) {
      const rows = await db.select({ t: tasks, projectName: projects.name }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(tasks.organizationId, ctx.organizationId), isNull(tasks.archivedAt), projectScope(tasks.projectId), query.projectId ? eq(tasks.projectId, query.projectId) : sql`true`, or(ilike(tasks.name, like), sql`to_tsvector('simple', ${tasks.name} || ' ' || ${tasks.description}) @@ plainto_tsquery('simple', ${q})`)!)).limit(perType);
      for (const { t, projectName } of rows) results.push({ type: 'task', id: t.id, title: t.name, subtitle: `${projectName} · ${t.status.replace('_', ' ')}${t.dueDate ?? t.endDate ? ` · due ${t.dueDate ?? t.endDate}` : ''}`, projectId: t.projectId, link: `/projects/${t.projectId}/tasks/${t.id}`, score: rank(t.name) });
    }
    if (want('document') && ctx.has('documents.read')) {
      const rows = await db.select({ d: documents, projectName: projects.name }).from(documents).leftJoin(projects, eq(projects.id, documents.projectId))
        .where(and(eq(documents.organizationId, ctx.organizationId), isNull(documents.archivedAt), sql`(${documents.projectId} is null or ${projectScope(documents.projectId)})`, query.projectId ? eq(documents.projectId, query.projectId) : sql`true`, or(ilike(documents.name, like), sql`to_tsvector('simple', ${documents.searchText}) @@ plainto_tsquery('simple', ${q})`)!, ctx.membership.external ? eq(documents.clientVisible, true) : sql`true`)).limit(perType);
      for (const { d, projectName } of rows) results.push({ type: 'document', id: d.id, title: d.name, subtitle: [projectName, d.kind].filter(Boolean).join(' · '), projectId: d.projectId, link: d.projectId ? `/projects/${d.projectId}/documents?doc=${d.id}` : `/documents?doc=${d.id}`, score: rank(d.name) });
    }
    if (want('daily_log') && ctx.has('daily_logs.read')) {
      const rows = await db.select({ l: dailyLogs, projectName: projects.name }).from(dailyLogs).innerJoin(projects, eq(projects.id, dailyLogs.projectId))
        .where(and(eq(dailyLogs.organizationId, ctx.organizationId), isNull(dailyLogs.archivedAt), projectScope(dailyLogs.projectId), query.projectId ? eq(dailyLogs.projectId, query.projectId) : sql`true`, sql`to_tsvector('simple', ${dailyLogs.searchText}) @@ plainto_tsquery('simple', ${q})`, ctx.membership.external ? eq(dailyLogs.clientVisible, true) : sql`true`)).limit(perType);
      for (const { l, projectName } of rows) results.push({ type: 'daily_log', id: l.id, title: `Daily log · ${l.logDate}`, subtitle: `${projectName} · ${l.summary.slice(0, 80)}`, projectId: l.projectId, link: `/projects/${l.projectId}/daily-logs/${l.id}`, score: 0.8 });
    }
    if (want('message') && ctx.has('messages.read')) {
      const rows = await db.select({ m: messages, t: messageThreads }).from(messages).innerJoin(messageThreads, eq(messageThreads.id, messages.threadId))
        .innerJoin(threadParticipants, and(eq(threadParticipants.threadId, messageThreads.id), eq(threadParticipants.userId, ctx.userId)))
        .where(and(eq(messages.organizationId, ctx.organizationId), isNull(messages.deletedAt), query.projectId ? eq(messageThreads.projectId, query.projectId) : sql`true`, sql`to_tsvector('simple', ${messages.body}) @@ plainto_tsquery('simple', ${q})`)).limit(perType);
      for (const { m, t } of rows) results.push({ type: 'message', id: m.id, title: t.subject, subtitle: m.body.slice(0, 100), projectId: t.projectId, link: t.projectId ? `/projects/${t.projectId}/messages/${t.id}` : `/messages/${t.id}`, score: 0.7 });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, query.limit);
  }
}
