import { z } from 'zod';
import { auditFields, cents, isoDate, isoDateTime, longText, paginationQuery, patchOf, shortText, uuid } from './common.js';
import { approvalSchema } from './financial.js';
import { documentSchema } from './document.js';

// ---------- proposals ----------
export const PROPOSAL_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'void'] as const;
export const proposalSnapshotLine = z.object({ name: z.string(), description: z.string(), quantityThousandths: z.number().int(), unit: z.string(), sellCents: cents, isAllowance: z.boolean(), isOptional: z.boolean(), included: z.boolean() });
export const proposalSnapshot = z.object({ sections: z.array(z.object({ name: z.string(), description: z.string(), totalCents: cents, lines: z.array(proposalSnapshotLine) })), totals: z.object({ sellCents: cents, allowanceCents: cents, taxCents: cents, sellBeforeTaxCents: cents }) });
export const proposalSignerSchema = z.object({ id: uuid, contactId: uuid.nullable(), name: z.string(), email: z.string(), required: z.boolean(), signedAt: isoDateTime.nullable() });
export const proposalDisplayOptions = z.object({ showLineItems: z.boolean().default(true), showQuantities: z.boolean().default(true), showSectionTotals: z.boolean().default(true) });
export const proposalSchema = auditFields.extend({
  projectId: uuid, projectName: z.string().optional(), clientName: z.string().nullable().optional(), estimateId: uuid.nullable(), number: z.string(), title: z.string(), status: z.enum(PROPOSAL_STATUSES), validUntil: isoDate.nullable(), introduction: z.string(), terms: z.string(),
  displayOptions: proposalDisplayOptions, totalCents: cents, snapshot: proposalSnapshot.nullable(), releasedAt: isoDateTime.nullable(), viewedAt: isoDateTime.nullable(), decidedAt: isoDateTime.nullable(), signers: z.array(proposalSignerSchema), approvals: z.array(approvalSchema), attachments: z.array(documentSchema).optional(),
});
export type Proposal = z.infer<typeof proposalSchema>;
export const signerInput = z.object({ contactId: uuid.nullable().optional(), name: shortText, email: z.string().email().max(320), required: z.boolean().default(true) });
export const createProposalBody = z.object({ title: shortText, introduction: longText.default(''), terms: longText.default(''), validUntil: isoDate.nullable().optional(), displayOptions: proposalDisplayOptions.partial().optional(), signers: z.array(signerInput).max(10).optional(), attachmentDocumentIds: z.array(uuid).max(20).optional() });
export const updateProposalBody = patchOf(createProposalBody);
export const sendProposalBody = z.object({ message: z.string().max(2000).optional() });
export const decideProposalBody = z.object({ decision: z.enum(['accepted', 'declined']), signerName: shortText, note: z.string().max(1000).optional(), signatureText: z.string().max(200).optional() });
export const listProposalsQuery = paginationQuery.extend({ projectId: uuid.optional(), status: z.enum([...PROPOSAL_STATUSES, 'open', 'all']).default('all') });

// ---------- selections ----------
export const SELECTION_STATUSES = ['pending', 'released', 'decided', 'void'] as const;
export const selectionOptionSchema = z.object({ id: uuid, name: z.string(), description: z.string(), manufacturer: z.string().nullable(), model: z.string().nullable(), finish: z.string().nullable(), costCents: cents, priceCents: cents, sourceUrl: z.string().nullable(), imageDocumentId: uuid.nullable(), isRecommended: z.boolean(), sortOrder: z.number().int() });
export const selectionSchema = auditFields.extend({
  projectId: uuid, projectName: z.string().optional(), category: z.string(), room: z.string().nullable(), name: z.string(), description: z.string(), status: z.enum(SELECTION_STATUSES), allowanceCents: cents, selectedOptionId: uuid.nullable(), dueDate: isoDate.nullable(), releasedAt: isoDateTime.nullable(), decidedAt: isoDateTime.nullable(),
  changeOrderId: uuid.nullable(), budgetLineId: uuid.nullable(), estimateLineId: uuid.nullable(), sortOrder: z.number().int(), options: z.array(selectionOptionSchema), overageCents: cents, approvals: z.array(approvalSchema),
  // Standard selections sheet fields
  section: z.string().nullable(), templateKey: z.string().nullable(), areas: z.array(z.string()), chosenAreas: z.array(z.string()), fields: z.array(z.string()), answers: z.record(z.string(), z.string()), matchExisting: z.boolean(), comment: z.string(), defaultSpec: z.string(), byAllowance: z.boolean(), decidedByName: z.string().nullable(),
});
export type Selection = z.infer<typeof selectionSchema>;
export const selectionOptionInput = z.object({ id: uuid.optional(), name: shortText, description: longText.default(''), manufacturer: z.string().max(120).nullable().optional(), model: z.string().max(120).nullable().optional(), finish: z.string().max(120).nullable().optional(), costCents: cents.default(0), priceCents: cents.default(0), sourceUrl: z.string().max(500).nullable().optional(), imageDocumentId: uuid.nullable().optional(), isRecommended: z.boolean().default(false) });
export const createSelectionBody = z.object({ category: shortText, room: z.string().max(120).nullable().optional(), name: shortText, description: longText.default(''), allowanceCents: cents.default(0), dueDate: isoDate.nullable().optional(), budgetLineId: uuid.nullable().optional(), estimateLineId: uuid.nullable().optional(), options: z.array(selectionOptionInput).max(20).default([]), section: z.string().max(120).nullable().optional(), areas: z.array(z.string().trim().min(1).max(120)).max(30).optional(), fields: z.array(z.string().trim().min(1).max(120)).max(30).optional(), defaultSpec: longText.optional(), byAllowance: z.boolean().optional() });
export const updateSelectionBody = patchOf(createSelectionBody);
/** optionId may be omitted for tick-all-that-apply items (no priced options); chosenAreas records the ticks. */
export const decideSelectionBody = z.object({ optionId: uuid.optional(), chosenAreas: z.array(z.string().trim().min(1).max(120)).max(30).optional(), answers: z.record(z.string().max(120), z.string().max(1000)).optional(), matchExisting: z.boolean().optional(), decidedByName: shortText.optional(), note: z.string().max(1000).optional() });
export const selectionTemplateItemSchema = z.object({ key: z.string(), name: z.string(), choices: z.array(z.string()), areas: z.array(z.string()), fields: z.array(z.string()), defaultChoice: z.string().nullable(), defaultSpec: z.string(), byAllowance: z.boolean(), note: z.string() });
export const selectionTemplateSectionSchema = z.object({ key: z.string(), label: z.string(), note: z.string(), items: z.array(selectionTemplateItemSchema) });
export const selectionTemplateSchema = z.object({ templates: z.array(z.object({ key: z.string(), name: z.string(), description: z.string(), intro: z.string(), sections: z.array(selectionTemplateSectionSchema) })) });
export const applySelectionTemplateBody = z.object({ templateKey: z.string().max(40).default('checklist'), itemKeys: z.array(z.string().max(80)).max(200).optional(), release: z.boolean().default(false), dueDate: isoDate.nullable().optional() });
export const applySelectionTemplateResponse = z.object({ created: z.number().int(), skipped: z.number().int(), items: z.array(selectionSchema) });
export const selectionSignoffSchema = z.object({ id: uuid, projectId: uuid, signerName: z.string(), signatureText: z.string().nullable(), note: z.string(), signedAt: isoDateTime, decidedCount: z.number().int(), byClient: z.boolean() });
export type SelectionSignoff = z.infer<typeof selectionSignoffSchema>;
export const signSelectionSheetBody = z.object({ signerName: shortText, signatureText: z.string().max(200).optional(), note: z.string().max(1000).optional() });
export const selectionSheetSchema = z.object({
  generatedAt: isoDateTime,
  company: z.string(),
  project: z.object({ id: uuid, number: z.string(), name: z.string(), clientName: z.string().nullable(), addressLine: z.string(), startDate: isoDate.nullable() }),
  sections: z.array(z.object({ key: z.string(), label: z.string(), note: z.string(), items: z.array(selectionSchema) })),
  counts: z.object({ total: z.number().int(), decided: z.number().int(), released: z.number().int(), pending: z.number().int() }),
  signoffs: z.array(selectionSignoffSchema),
});
export type SelectionSheet = z.infer<typeof selectionSheetSchema>;
export const publishSelectionSheetBody = z.object({ vendorVisible: z.boolean().default(true) });
export const listSelectionsQuery = paginationQuery.extend({ projectId: uuid.optional(), status: z.enum([...SELECTION_STATUSES, 'open', 'all']).default('all') });

// ---------- approvals & portal ----------
export const approvalItem = z.object({ id: uuid, objectType: z.enum(['proposal', 'change_order', 'selection', 'invoice', 'time_entry']), objectId: uuid, projectId: uuid.nullable(), projectName: z.string().nullable(), title: z.string(), amountCents: cents.nullable(), requestedAt: isoDateTime, status: z.enum(['pending', 'approved', 'declined', 'cancelled']), decidedAt: isoDateTime.nullable(), decidedByName: z.string().nullable(), link: z.string() });
export type ApprovalItem = z.infer<typeof approvalItem>;
export const listApprovalsQuery = paginationQuery.extend({ projectId: uuid.optional(), status: z.enum(['pending', 'decided', 'all']).default('pending') });

export const portalProject = z.object({ id: uuid, number: z.string(), name: z.string(), status: z.string(), color: z.string(), addressLine: z.string(), startDate: isoDate.nullable(), targetEndDate: isoDate.nullable(), progressBp: z.number().int(), nextMilestone: z.object({ name: z.string(), date: isoDate.nullable() }).nullable(), pendingApprovals: z.number().int(), unpaidCents: cents, unreadMessages: z.number().int(), lastUpdateAt: isoDateTime.nullable(), contractValueCents: cents, approvedChangesCents: cents });
export const portalOverview = z.object({ projects: z.array(portalProject), approvals: z.array(approvalItem), unpaidInvoices: z.array(z.object({ id: uuid, number: z.string(), title: z.string(), projectId: uuid, projectName: z.string(), dueDate: isoDate.nullable(), balanceCents: cents, status: z.string() })) });
export type PortalOverview = z.infer<typeof portalOverview>;
export const payInvoiceBody = z.object({ method: z.enum(['card', 'ach']).default('card') });
export const paymentIntentResponse = z.object({ id: z.string(), status: z.string(), clientSecret: z.string().optional(), checkoutUrl: z.string().optional(), paid: z.boolean() });
