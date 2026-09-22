import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { approvals, clients, contacts, estimates, projects, proposalSigners, proposals } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { ActivityService, diffRecords } from './activity.service.js';
import type { NotificationService } from './notification.service.js';
import type { DocumentService } from './document.service.js';
import type { EstimateService } from './estimate.service.js';
import { decodeCursor, encodeCursor, page } from '../lib/pagination.js';
import { nextNumber } from '../lib/numbering.js';
import { projectTeamUserIds } from '../lib/recipients.js';
import { contactIdFor, isClientPortal } from '../lib/portal.js';

type Row = typeof proposals.$inferSelect;
const CLIENT_VISIBLE = ['sent', 'viewed', 'accepted', 'declined'] as const;
const OPEN = ['draft', 'sent', 'viewed'] as const;

/**
 * Proposals freeze the estimate into a client-facing document. Sending opens
 * an approval; accepting locks the estimate, sets the contract value and
 * creates the budget in one step.
 */
export class ProposalService {
  constructor(private readonly deps: Deps, private readonly activity: ActivityService, private readonly notifications: NotificationService, private readonly documents: DocumentService, private readonly estimates: EstimateService) {}

  async list(ctx: RequestContext, query: { cursor?: string; limit: number; projectId?: string; status: string }) {
    ctx.require('proposals.read');
    const { db } = this.deps;
    const conditions = [eq(proposals.organizationId, ctx.organizationId), isNull(proposals.archivedAt)];
    if (query.projectId) { await ctx.requireProjectAccess(db, query.projectId, { allowArchived: true }); conditions.push(eq(proposals.projectId, query.projectId)); }
    else { const visible = await ctx.visibleProjectIds(db); if (visible) conditions.push(visible.length ? inArray(proposals.projectId, visible) : sql`false`); }
    if (ctx.membership.external) conditions.push(inArray(proposals.status, [...CLIENT_VISIBLE]));
    if (query.status === 'open') conditions.push(inArray(proposals.status, [...OPEN]));
    else if (query.status !== 'all') conditions.push(eq(proposals.status, query.status));
    const cursor = decodeCursor<{ t: string; id: string }>(query.cursor);
    if (cursor) conditions.push(sql`(${proposals.createdAt}, ${proposals.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
    const rows = await db.select({ p: proposals, projectName: projects.name, clientName: clients.displayName }).from(proposals).innerJoin(projects, eq(projects.id, proposals.projectId)).leftJoin(clients, eq(clients.id, projects.clientId)).where(and(...conditions)).orderBy(desc(proposals.createdAt), desc(proposals.id)).limit(query.limit + 1);
    const result = page(rows, query.limit, (r) => encodeCursor({ t: r.p.createdAt, id: r.p.id }));
    const ids = result.items.map((r) => r.p.id);
    const [signers, apps] = await Promise.all([this.signersFor(db, ids), this.approvalsFor(db, ids)]);
    return { items: result.items.map((r) => serializeProposal(r.p, r.projectName, r.clientName, signers.get(r.p.id) ?? [], apps.get(r.p.id) ?? [])), nextCursor: result.nextCursor };
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.Proposal> {
    ctx.require('proposals.read');
    const { db } = this.deps;
    const [r] = await db.select({ p: proposals, projectName: projects.name, clientName: clients.displayName }).from(proposals).innerJoin(projects, eq(projects.id, proposals.projectId)).leftJoin(clients, eq(clients.id, projects.clientId)).where(and(eq(proposals.id, id), eq(proposals.organizationId, ctx.organizationId))).limit(1);
    if (!r) throw AppError.notFound('Proposal');
    await ctx.requireProjectAccess(db, r.p.projectId, { allowArchived: true });
    if (ctx.membership.external && !CLIENT_VISIBLE.includes(r.p.status as any)) throw AppError.notFound('Proposal');
    if (isClientPortal(ctx) && r.p.status === 'sent') {
      // First look by the client: recorded once, visible to the team.
      await db.transaction(async (tx) => {
        await tx.update(proposals).set({ status: 'viewed', updatedAt: sql`now()` }).where(and(eq(proposals.id, id), eq(proposals.status, 'sent')));
        await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: r.p.projectId, verb: 'viewed', objectType: 'proposal', objectId: id, objectLabel: `${r.p.number} ${r.p.title}`, clientVisible: true });
      });
      r.p.status = 'viewed';
    }
    const [signers, apps, attachments] = await Promise.all([this.signersFor(db, [id]), this.approvalsFor(db, [id]), this.documents.attachmentsFor(db, ctx, 'proposal', [id])]);
    return serializeProposal(r.p, r.projectName, r.clientName, signers.get(id) ?? [], apps.get(id) ?? [], (attachments.get(id) ?? []).map((a) => a.document));
  }

  private async signersFor(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.Proposal['signers']>();
    if (!ids.length) return out;
    const rows = await db.select().from(proposalSigners).where(inArray(proposalSigners.proposalId, ids)).orderBy(asc(proposalSigners.createdAt));
    for (const s of rows) { if (!out.has(s.proposalId)) out.set(s.proposalId, []); out.get(s.proposalId)!.push({ id: s.id, contactId: s.contactId, name: s.name, email: s.email, required: s.required, signedAt: s.signedAt }); }
    return out;
  }

  private async approvalsFor(db: DbOrTx, ids: string[]) {
    const out = new Map<string, contracts.Approval[]>();
    if (!ids.length) return out;
    const rows = await db.select().from(approvals).where(and(eq(approvals.objectType, 'proposal'), inArray(approvals.objectId, ids))).orderBy(desc(approvals.requestedAt));
    for (const a of rows) { if (!out.has(a.objectId)) out.set(a.objectId, []); out.get(a.objectId)!.push({ id: a.id, objectType: a.objectType, objectId: a.objectId, status: a.status as contracts.Approval['status'], requestedAt: a.requestedAt, decidedAt: a.decidedAt, decidedByName: a.decidedByName, decisionNote: a.decisionNote, amountCents: a.amountCents, title: a.title }); }
    return out;
  }

  /** Create a proposal from the project's current estimate (snapshot of the client-visible sections and lines). */
  async create(ctx: RequestContext, projectId: string, input: any): Promise<contracts.Proposal> {
    ctx.require('proposals.write');
    const est = await this.estimates.getForProject(ctx, projectId);
    if (est.sections.every((s) => s.lines.length === 0)) throw AppError.conflict('Add line items to the estimate before creating a proposal.');
    const id = await this.deps.db.transaction(async (tx) => {
      await ctx.requireProjectAccess(tx, projectId);
      const number = await nextNumber(tx, proposals, ctx.organizationId, 'PROP');
      const snapshot = snapshotOf(est);
      const [row] = await tx.insert(proposals).values({ organizationId: ctx.organizationId, projectId, estimateId: est.id, number, title: input.title, status: 'draft', validUntil: input.validUntil ?? null, introduction: input.introduction ?? '', terms: input.terms ?? '', displayOptions: { showLineItems: true, showQuantities: true, showSectionTotals: true, ...(input.displayOptions ?? {}) }, totalCents: snapshot.totals.sellCents, snapshot, createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
      await this.replaceSigners(tx, ctx, row!, input.signers);
      if (input.attachmentDocumentIds?.length) await this.documents.attach(tx, ctx, 'proposal', row!.id, input.attachmentDocumentIds);
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId, verb: 'created', objectType: 'proposal', objectId: row!.id, objectLabel: `${number} ${row!.title}`, metadata: { totalCents: row!.totalCents } });
      return row!.id;
    });
    return this.get(ctx, id);
  }

  /** Default signers: the client's primary contact(s) with an email. */
  private async replaceSigners(tx: DbOrTx, ctx: RequestContext, row: Row, signers: any[] | undefined) {
    if (signers === undefined) {
      const existing = await tx.select({ id: proposalSigners.id }).from(proposalSigners).where(eq(proposalSigners.proposalId, row.id));
      if (existing.length) return;
      const [project] = await tx.select({ clientId: projects.clientId }).from(projects).where(eq(projects.id, row.projectId)).limit(1);
      if (!project?.clientId) return;
      const cs = await tx.select().from(contacts).where(and(eq(contacts.clientId, project.clientId), sql`${contacts.email} is not null`)).orderBy(desc(contacts.isPrimary), asc(contacts.firstName));
      signers = cs.filter((c, i) => c.isPrimary || i === 0).map((c) => ({ contactId: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email: c.email!, required: true }));
    }
    await tx.delete(proposalSigners).where(eq(proposalSigners.proposalId, row.id));
    if (signers.length) await tx.insert(proposalSigners).values(signers.map((s) => ({ organizationId: ctx.organizationId, proposalId: row.id, contactId: s.contactId ?? null, name: s.name, email: s.email, required: s.required ?? true, createdBy: ctx.userId, updatedBy: ctx.userId })));
  }

  async update(ctx: RequestContext, id: string, input: any): Promise<contracts.Proposal> {
    ctx.require('proposals.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.editable(tx, ctx, id);
      const { signers, attachmentDocumentIds, displayOptions, refreshSnapshot, ...patch } = input;
      const values: Record<string, unknown> = { ...patch, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${proposals.version} + 1` };
      if (displayOptions) values.displayOptions = { ...(row.displayOptions as object), ...displayOptions };
      if (refreshSnapshot) { const est = await this.estimates.getForProject(ctx, row.projectId); const snapshot = snapshotOf(est); values.snapshot = snapshot; values.totalCents = snapshot.totals.sellCents; values.estimateId = est.id; }
      const [after] = await tx.update(proposals).set(values as any).where(eq(proposals.id, id)).returning();
      if (signers) await this.replaceSigners(tx, ctx, after!, signers);
      if (attachmentDocumentIds) { await this.documents.detachAll(tx, ctx, 'proposal', id); await this.documents.attach(tx, ctx, 'proposal', id, attachmentDocumentIds); }
      const diff = diffRecords(row as any, after as any, ['updatedAt', 'updatedBy', 'version', 'snapshot', 'displayOptions']);
      if (diff || refreshSnapshot) await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'updated', objectType: 'proposal', objectId: id, objectLabel: `${row.number} ${after!.title}`, diff });
    });
    return this.get(ctx, id);
  }

  private async editable(tx: DbOrTx, ctx: RequestContext, id: string): Promise<Row> {
    const [row] = await tx.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.organizationId, ctx.organizationId))).limit(1);
    if (!row) throw AppError.notFound('Proposal');
    await ctx.requireProjectAccess(tx, row.projectId);
    if (row.status !== 'draft') throw AppError.conflict('Only draft proposals can be edited. Void it and create a new version instead.');
    return row;
  }

  async send(ctx: RequestContext, id: string, input: { message?: string }): Promise<contracts.Proposal> {
    ctx.require('proposals.write');
    await this.deps.db.transaction(async (tx) => {
      const row = await this.editable(tx, ctx, id);
      const signers = await tx.select().from(proposalSigners).where(eq(proposalSigners.proposalId, id));
      await tx.update(approvals).set({ status: 'cancelled' }).where(and(eq(approvals.objectType, 'proposal'), eq(approvals.objectId, id), eq(approvals.status, 'pending')));
      await tx.insert(approvals).values({ organizationId: ctx.organizationId, projectId: row.projectId, objectType: 'proposal', objectId: id, requestedBy: ctx.userId, status: 'pending', amountCents: row.totalCents, title: `${row.number} ${row.title}`, snapshot: { totalCents: row.totalCents, message: input.message ?? null } });
      await tx.update(proposals).set({ status: 'sent', releasedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${proposals.version} + 1` }).where(eq(proposals.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'sent', objectType: 'proposal', objectId: id, objectLabel: `${row.number} ${row.title}`, clientVisible: true, metadata: { totalCents: row.totalCents, signers: signers.map((s) => s.email) } });
      const [project] = await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, row.projectId)).limit(1);
      for (const s of signers) {
        await this.deps.providers.email.send({ to: s.email, subject: `Proposal ${row.number} from ${ctx.actorName}: ${row.title}`, text: `${input.message ?? 'Please review and sign the proposal.'}\n\nOpen your client portal: ${this.deps.config.APP_URL}/portal` });
      }
      const team = await projectTeamUserIds(tx, ctx.organizationId, row.projectId);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'approval.requested', title: `Proposal ${row.number} sent`, body: `${ctx.actorName} sent "${row.title}" to ${project?.name ?? 'the client'} for signature.`, projectId: row.projectId, objectType: 'proposal', objectId: id, link: `/projects/${row.projectId}/proposals/${id}` });
    });
    return this.get(ctx, id);
  }

  /** Record the client's decision. Accepting locks the estimate and sets the contract value. */
  async decide(ctx: RequestContext, id: string, input: { decision: 'accepted' | 'declined'; signerName: string; note?: string; signatureText?: string }): Promise<contracts.Proposal> {
    const portal = isClientPortal(ctx);
    if (!portal) ctx.require('proposals.write');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.organizationId, ctx.organizationId))).limit(1);
      if (!row) throw AppError.notFound('Proposal');
      await ctx.requireProjectAccess(tx, row.projectId);
      const allowed = portal ? ['sent', 'viewed'] : ['sent', 'viewed', 'draft'];
      if (!allowed.includes(row.status)) throw AppError.conflict(`A ${row.status} proposal cannot be decided.`);
      if (row.validUntil && row.validUntil < new Date().toISOString().slice(0, 10) && input.decision === 'accepted' && portal) throw AppError.conflict('This proposal has expired. Ask your builder for an updated one.');
      const contactId = await contactIdFor(tx, ctx);
      let [approval] = await tx.select().from(approvals).where(and(eq(approvals.objectType, 'proposal'), eq(approvals.objectId, id), eq(approvals.status, 'pending'))).limit(1);
      if (!approval) [approval] = await tx.insert(approvals).values({ organizationId: ctx.organizationId, projectId: row.projectId, objectType: 'proposal', objectId: id, requestedBy: ctx.userId, status: 'pending', amountCents: row.totalCents, title: `${row.number} ${row.title}` }).returning();
      const status = input.decision === 'accepted' ? 'approved' : 'declined';
      await tx.update(approvals).set({ status, decidedByUserId: ctx.userId, decidedByContactId: contactId, decidedByName: input.signerName, decidedAt: sql`now()`, decisionNote: input.note ?? null, ipAddress: ctx.meta.ip ?? null, userAgent: ctx.meta.userAgent ?? null, snapshot: { totalCents: row.totalCents, signatureText: input.signatureText ?? null, proposal: row.snapshot } }).where(eq(approvals.id, approval!.id));
      await tx.update(proposals).set({ status: input.decision, decidedAt: sql`now()`, updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${proposals.version} + 1` }).where(eq(proposals.id, id));
      if (input.decision === 'accepted') {
        await tx.update(proposalSigners).set({ signedAt: sql`now()`, ipAddress: ctx.meta.ip ?? null }).where(and(eq(proposalSigners.proposalId, id), contactId ? eq(proposalSigners.contactId, contactId) : sql`true`));
        // The signed proposal is the contract: lock the estimate, set the contract value and create the budget.
        if (row.estimateId) {
          const [est] = await tx.select({ status: estimates.status }).from(estimates).where(eq(estimates.id, row.estimateId)).limit(1);
          if (est && est.status !== 'locked') await this.estimates.lockWithin(tx, ctx, row.projectId, { applyContractValue: true });
          else await tx.update(projects).set({ contractValueCents: row.totalCents, updatedAt: sql`now()`, updatedBy: ctx.userId }).where(eq(projects.id, row.projectId));
        }
        await tx.update(projects).set({ status: sql`case when ${projects.status} = 'lead' then 'pre_construction' else ${projects.status} end` }).where(eq(projects.id, row.projectId));
      }
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: input.decision, objectType: 'proposal', objectId: id, objectLabel: `${row.number} ${row.title}`, clientVisible: true, metadata: { totalCents: row.totalCents, signerName: input.signerName, note: input.note ?? null } });
      const team = await projectTeamUserIds(tx, ctx.organizationId, row.projectId);
      await this.notifications.notify(tx, { organizationId: ctx.organizationId, userIds: team, excludeUserId: ctx.userId, kind: 'approval.decided', title: `Proposal ${row.number} ${input.decision}`, body: `${input.signerName} ${input.decision} "${row.title}".`, projectId: row.projectId, objectType: 'proposal', objectId: id, link: `/projects/${row.projectId}/proposals/${id}` });
    });
    return this.get(ctx, id);
  }

  async void(ctx: RequestContext, id: string): Promise<contracts.Proposal> {
    ctx.require('proposals.write');
    await this.deps.db.transaction(async (tx) => {
      const [row] = await tx.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.organizationId, ctx.organizationId))).limit(1);
      if (!row) throw AppError.notFound('Proposal');
      await ctx.requireProjectAccess(tx, row.projectId);
      if (row.status === 'accepted') throw AppError.conflict('An accepted proposal is a signed contract and cannot be voided.');
      await tx.update(approvals).set({ status: 'cancelled' }).where(and(eq(approvals.objectType, 'proposal'), eq(approvals.objectId, id), eq(approvals.status, 'pending')));
      await tx.update(proposals).set({ status: 'void', updatedAt: sql`now()`, updatedBy: ctx.userId, version: sql`${proposals.version} + 1` }).where(eq(proposals.id, id));
      await this.activity.record(tx, ActivityService.actorFrom(ctx), { projectId: row.projectId, verb: 'voided', objectType: 'proposal', objectId: id, objectLabel: `${row.number} ${row.title}` });
    });
    return this.get(ctx, id);
  }
}

/** Client-facing copy of the estimate: hidden sections/lines are dropped, prices are sell prices. */
export function snapshotOf(est: contracts.Estimate): contracts.Proposal['snapshot'] & object {
  const sections = est.sections.filter((s) => s.clientVisible).map((s) => {
    const lines = s.lines.filter((l) => l.clientVisible).map((l) => ({ name: l.name, description: l.description, quantityThousandths: l.quantityThousandths, unit: l.unit, sellCents: l.totals.sellCents, isAllowance: l.isAllowance, isOptional: l.isOptional, included: l.included }));
    return { name: s.name, description: s.description, totalCents: lines.filter((l) => !(l.isOptional && !l.included)).reduce((n, l) => n + l.sellCents, 0), lines };
  });
  return { sections, totals: { sellCents: est.totals.sellCents, allowanceCents: est.totals.allowanceCents, taxCents: est.totals.taxCents, sellBeforeTaxCents: est.totals.sellBeforeTaxCents } };
}

export function serializeProposal(p: Row, projectName: string | undefined, clientName: string | null | undefined, signers: contracts.Proposal['signers'], apps: contracts.Approval[], attachments?: contracts.Document[]): contracts.Proposal {
  const d = (p.displayOptions as any) ?? {};
  return { id: p.id, organizationId: p.organizationId, createdAt: p.createdAt, updatedAt: p.updatedAt, createdBy: p.createdBy, updatedBy: p.updatedBy, version: p.version, projectId: p.projectId, projectName, clientName: clientName ?? null, estimateId: p.estimateId, number: p.number, title: p.title, status: p.status as contracts.Proposal['status'], validUntil: p.validUntil, introduction: p.introduction, terms: p.terms, displayOptions: { showLineItems: d.showLineItems ?? true, showQuantities: d.showQuantities ?? true, showSectionTotals: d.showSectionTotals ?? true }, totalCents: p.totalCents, snapshot: (p.snapshot as any) ?? null, releasedAt: p.releasedAt, viewedAt: p.status === 'viewed' || p.decidedAt ? p.updatedAt : null, decidedAt: p.decidedAt, signers, approvals: apps, attachments };
}
