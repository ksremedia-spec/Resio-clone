import { z } from 'zod';
import { auditFields, basisPoints, cents, isoDate, isoDateTime, longText, paginationQuery, patchOf, shortText, uuid } from './common.js';
import { documentSchema } from './document.js';

export const COST_TYPES = ['labor', 'material', 'subcontract', 'equipment', 'other'] as const;
const costMap = z.partialRecord(z.enum(COST_TYPES), cents);
const bpMap = z.partialRecord(z.enum(COST_TYPES), basisPoints);

// ---------- cost codes & catalog ----------
export const costCodeSchema = auditFields.extend({
  code: z.string(), name: z.string(), parentId: uuid.nullable(), category: z.string().nullable(), defaultCostType: z.enum(COST_TYPES), sortOrder: z.number().int(), archivedAt: isoDateTime.nullable(),
});
export type CostCode = z.infer<typeof costCodeSchema>;
export const createCostCodeBody = z.object({ code: z.string().trim().min(1).max(20), name: shortText, parentId: uuid.nullable().optional(), category: z.string().max(80).nullable().optional(), defaultCostType: z.enum(COST_TYPES).default('material'), sortOrder: z.number().int().optional() });
export const updateCostCodeBody = patchOf(createCostCodeBody);

export const catalogItemSchema = auditFields.extend({
  costCodeId: uuid.nullable(), costCode: z.string().nullable(), name: z.string(), description: z.string(), unit: z.string(), unitCostCents: costMap, markupBp: bpMap.nullable(), vendorId: uuid.nullable(), isAllowance: z.boolean(), tags: z.array(z.string()), sourceUrl: z.string().nullable(), archivedAt: isoDateTime.nullable(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export const createCatalogItemBody = z.object({ costCodeId: uuid.nullable().optional(), name: shortText, description: longText.default(''), unit: z.string().max(20).default('ea'), unitCostCents: costMap.default({}), markupBp: bpMap.nullable().optional(), vendorId: uuid.nullable().optional(), isAllowance: z.boolean().default(false), tags: z.array(z.string().max(40)).max(20).default([]), sourceUrl: z.string().max(500).nullable().optional() });
export const updateCatalogItemBody = patchOf(createCatalogItemBody);
export const listCatalogQuery = paginationQuery.extend({ q: z.string().max(200).optional(), costCodeId: uuid.optional(), includeArchived: z.coerce.boolean().default(false) });

// ---------- vendors ----------
export const vendorSchema = auditFields.extend({ name: z.string(), trade: z.string().nullable(), email: z.string().nullable(), phone: z.string().nullable(), website: z.string().nullable(), notes: z.string(), status: z.string(), archivedAt: isoDateTime.nullable(), openPoCents: cents.optional(), contacts: z.array(z.object({ id: uuid, firstName: z.string(), lastName: z.string(), email: z.string().nullable(), phone: z.string().nullable(), title: z.string().nullable(), isPrimary: z.boolean() })).optional() });
export type Vendor = z.infer<typeof vendorSchema>;
export const createVendorBody = z.object({ name: shortText, trade: z.string().max(80).nullable().optional(), email: z.string().max(320).nullable().optional(), phone: z.string().max(40).nullable().optional(), website: z.string().max(200).nullable().optional(), notes: longText.default('') });
export const updateVendorBody = patchOf(createVendorBody);
export const listVendorsQuery = paginationQuery.extend({ q: z.string().max(200).optional(), trade: z.string().max(80).optional(), includeArchived: z.coerce.boolean().default(false) });

// ---------- estimates ----------
export const lineTotals = z.object({ directCostCents: cents, markupCents: cents, sellBeforeTaxCents: cents, taxCents: cents, sellCents: cents, costByType: costMap.optional() });
export const estimateLineSchema = auditFields.extend({
  estimateId: uuid, sectionId: uuid, parentLineId: uuid.nullable(), costCodeId: uuid.nullable(), costCode: z.string().nullable(), catalogItemId: uuid.nullable(), name: z.string(), description: z.string(),
  quantityThousandths: z.number().int(), unit: z.string(), unitCostCents: costMap, markupBp: bpMap.nullable(), taxable: z.boolean(), isAllowance: z.boolean(), isOptional: z.boolean(), included: z.boolean(), notes: z.string(), sortOrder: z.number().int(), clientVisible: z.boolean(), totals: lineTotals,
});
export type EstimateLine = z.infer<typeof estimateLineSchema>;
export const estimateSectionSchema = auditFields.extend({ estimateId: uuid, parentId: uuid.nullable(), name: z.string(), description: z.string(), costCodeId: uuid.nullable(), sortOrder: z.number().int(), clientVisible: z.boolean(), totals: lineTotals.extend({ allowanceCents: cents }), lines: z.array(estimateLineSchema) });
export type EstimateSection = z.infer<typeof estimateSectionSchema>;
export const estimateSchema = auditFields.extend({
  projectId: uuid, name: z.string(), status: z.enum(['draft', 'locked']), defaultMarkupBp: basisPoints, markupByCostType: bpMap, taxBp: basisPoints, notes: z.string(), lockedAt: isoDateTime.nullable(),
  totals: lineTotals.extend({ allowanceCents: cents, grossMarginBp: basisPoints }), sections: z.array(estimateSectionSchema),
});
export type Estimate = z.infer<typeof estimateSchema>;
export const updateEstimateBody = z.object({ name: shortText.optional(), defaultMarkupBp: basisPoints.optional(), markupByCostType: bpMap.optional(), taxBp: basisPoints.optional(), notes: longText.optional() });
export const createSectionBody = z.object({ name: shortText, description: longText.default(''), costCodeId: uuid.nullable().optional(), parentId: uuid.nullable().optional(), sortOrder: z.number().int().optional(), clientVisible: z.boolean().default(true) });
export const updateSectionBody = patchOf(createSectionBody);
export const createLineBody = z.object({
  sectionId: uuid, name: shortText.optional(), description: longText.default(''), costCodeId: uuid.nullable().optional(), catalogItemId: uuid.nullable().optional(), parentLineId: uuid.nullable().optional(),
  quantityThousandths: z.number().int().min(0).default(1000), unit: z.string().max(20).default('ea'), unitCostCents: costMap.default({}), markupBp: bpMap.nullable().optional(), taxable: z.boolean().default(false),
  isAllowance: z.boolean().default(false), isOptional: z.boolean().default(false), included: z.boolean().default(true), notes: longText.default(''), sortOrder: z.number().int().optional(), clientVisible: z.boolean().default(true),
});
export const updateLineBody = patchOf(createLineBody, ['sectionId']).extend({ sectionId: uuid.optional() });
export const bulkLinesBody = z.object({ lines: z.array(updateLineBody.extend({ id: uuid })).min(1).max(500) });
export const lockEstimateBody = z.object({ applyContractValue: z.boolean().default(true) });

// ---------- budget ----------
export const budgetLineSchema = z.object({
  id: uuid, budgetId: uuid, projectId: uuid, costCodeId: uuid.nullable(), costCode: z.string().nullable(), estimateLineId: uuid.nullable(), sectionName: z.string(), name: z.string(), clientVisible: z.boolean(), sortOrder: z.number().int(), version: z.number().int(),
  originalCents: cents, originalSellCents: cents, approvedChangesCents: cents, revisedCents: cents, committedCents: cents, actualCents: cents, projectedExtraCents: cents, projectedCents: cents, invoicedCents: cents, varianceCents: cents, remainingCents: cents, percentSpentBp: basisPoints, status: z.enum(['under', 'on_track', 'warning', 'over']),
});
export type BudgetLine = z.infer<typeof budgetLineSchema>;
export const budgetSchema = z.object({ id: uuid.nullable(), projectId: uuid, status: z.string(), sourceEstimateId: uuid.nullable(), lines: z.array(budgetLineSchema), totals: budgetLineSchema.pick({ originalCents: true, approvedChangesCents: true, revisedCents: true, committedCents: true, actualCents: true, projectedCents: true, invoicedCents: true, varianceCents: true, remainingCents: true, percentSpentBp: true, status: true }), contract: z.object({ contractValueCents: cents, approvedChangesCents: cents, revisedContractCents: cents, invoicedCents: cents, paidCents: cents, outstandingCents: cents, projectedMarginCents: cents }) });
export type Budget = z.infer<typeof budgetSchema>;
export const createBudgetLineBody = z.object({ name: shortText, sectionName: z.string().max(200).default(''), costCodeId: uuid.nullable().optional(), originalCents: cents.default(0), originalSellCents: cents.default(0), clientVisible: z.boolean().default(false) });
export const updateBudgetLineBody = patchOf(createBudgetLineBody).extend({ projectedExtraCents: cents.optional() });
export const budgetTransaction = z.object({ kind: z.enum(['change_order', 'purchase_order', 'bill', 'time_entry', 'invoice']), id: uuid, number: z.string(), title: z.string(), status: z.string(), date: isoDate.nullable(), amountCents: cents, link: z.string() });
export const budgetLineDetail = z.object({ line: budgetLineSchema, transactions: z.array(budgetTransaction) });

// ---------- purchase orders & bills ----------
export const PO_STATUSES = ['draft', 'awaiting_approval', 'approved', 'committed', 'matched', 'closed', 'void'] as const;
export const poLineSchema = z.object({ id: uuid, budgetLineId: uuid.nullable(), budgetLineName: z.string().nullable(), costCodeId: uuid.nullable(), description: z.string(), quantityThousandths: z.number().int(), unit: z.string(), unitCostCents: cents, amountCents: cents, billedCents: cents, sortOrder: z.number().int() });
export const purchaseOrderSchema = auditFields.extend({ projectId: uuid, projectName: z.string().optional(), vendorId: uuid.nullable(), vendorName: z.string().nullable(), number: z.string(), title: z.string(), status: z.enum(PO_STATUSES), notes: z.string(), totalCents: cents, billedCents: cents, approvedAt: isoDateTime.nullable(), issuedAt: isoDateTime.nullable(), closedAt: isoDateTime.nullable(), lines: z.array(poLineSchema), attachments: z.array(documentSchema).optional() });
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export const poLineInput = z.object({ id: uuid.optional(), budgetLineId: uuid.nullable().optional(), costCodeId: uuid.nullable().optional(), description: shortText, quantityThousandths: z.number().int().min(0).default(1000), unit: z.string().max(20).default('ea'), unitCostCents: cents.default(0) });
export const createPurchaseOrderBody = z.object({ vendorId: uuid.nullable().optional(), title: shortText, notes: longText.default(''), lines: z.array(poLineInput).max(200).default([]), attachmentDocumentIds: z.array(uuid).max(20).optional() });
export const updatePurchaseOrderBody = patchOf(createPurchaseOrderBody);
export const poTransitionBody = z.object({ action: z.enum(['submit', 'approve', 'issue', 'close', 'void', 'reopen']) });
export const listPurchaseOrdersQuery = paginationQuery.extend({ projectId: uuid.optional(), vendorId: uuid.optional(), status: z.enum([...PO_STATUSES, 'open', 'all']).default('open'), q: z.string().max(200).optional() });

export const BILL_STATUSES = ['draft', 'approved', 'scheduled', 'paid', 'void'] as const;
export const billLineSchema = z.object({ id: uuid, budgetLineId: uuid.nullable(), budgetLineName: z.string().nullable(), costCodeId: uuid.nullable(), purchaseOrderLineId: uuid.nullable(), description: z.string(), amountCents: cents, sortOrder: z.number().int() });
export const billSchema = auditFields.extend({ projectId: uuid.nullable(), projectName: z.string().nullable(), vendorId: uuid.nullable(), vendorName: z.string().nullable(), purchaseOrderId: uuid.nullable(), purchaseOrderNumber: z.string().nullable(), number: z.string(), vendorReference: z.string().nullable(), status: z.enum(BILL_STATUSES), billDate: isoDate.nullable(), dueDate: isoDate.nullable(), subtotalCents: cents, taxCents: cents, totalCents: cents, paidCents: cents, notes: z.string(), lines: z.array(billLineSchema), overPoCents: cents.nullable(), attachments: z.array(documentSchema).optional() });
export type Bill = z.infer<typeof billSchema>;
export const billLineInput = z.object({ id: uuid.optional(), budgetLineId: uuid.nullable().optional(), costCodeId: uuid.nullable().optional(), purchaseOrderLineId: uuid.nullable().optional(), description: shortText, amountCents: cents });
export const createBillBody = z.object({ projectId: uuid.nullable().optional(), vendorId: uuid.nullable().optional(), purchaseOrderId: uuid.nullable().optional(), vendorReference: z.string().max(80).nullable().optional(), billDate: isoDate.nullable().optional(), dueDate: isoDate.nullable().optional(), taxCents: cents.default(0), notes: longText.default(''), lines: z.array(billLineInput).max(200).default([]), attachmentDocumentIds: z.array(uuid).max(20).optional() });
export const updateBillBody = patchOf(createBillBody);
export const billTransitionBody = z.object({ action: z.enum(['approve', 'schedule', 'void', 'reopen']) });
export const recordBillPaymentBody = z.object({ amountCents: cents.positive(), method: z.enum(['check', 'ach', 'card', 'cash', 'other']).default('check'), reference: z.string().max(120).nullable().optional(), receivedAt: isoDateTime.optional(), notes: z.string().max(500).default('') });
export const listBillsQuery = paginationQuery.extend({ projectId: uuid.optional(), vendorId: uuid.optional(), status: z.enum([...BILL_STATUSES, 'open', 'unmatched', 'all']).default('open'), q: z.string().max(200).optional() });

// ---------- change orders ----------
export const CO_STATUSES = ['draft', 'pending_internal', 'sent', 'viewed', 'approved', 'declined', 'void'] as const;
export const coLineSchema = z.object({ id: uuid, budgetLineId: uuid.nullable(), budgetLineName: z.string().nullable(), costCodeId: uuid.nullable(), estimateLineId: uuid.nullable(), name: z.string(), description: z.string(), quantityThousandths: z.number().int(), unit: z.string(), unitCostCents: costMap, markupBp: bpMap.nullable(), taxable: z.boolean(), costCents: cents, sellCents: cents, sortOrder: z.number().int() });
export const approvalSchema = z.object({ id: uuid, objectType: z.string(), objectId: uuid, status: z.enum(['pending', 'approved', 'declined', 'cancelled']), requestedAt: isoDateTime, decidedAt: isoDateTime.nullable(), decidedByName: z.string().nullable(), decisionNote: z.string().nullable(), amountCents: cents.nullable(), title: z.string() });
export type Approval = z.infer<typeof approvalSchema>;
export const changeOrderSchema = auditFields.extend({ projectId: uuid, projectName: z.string().optional(), number: z.number().int(), title: z.string(), description: z.string(), reason: z.string().nullable(), status: z.enum(CO_STATUSES), costCents: cents, markupCents: cents, taxCents: cents, totalCents: cents, scheduleImpactDays: z.number().int(), sentAt: isoDateTime.nullable(), viewedAt: isoDateTime.nullable(), decidedAt: isoDateTime.nullable(), lines: z.array(coLineSchema), approvals: z.array(approvalSchema), attachments: z.array(documentSchema).optional(), invoiceId: uuid.nullable() });
export type ChangeOrder = z.infer<typeof changeOrderSchema>;
export const coLineInput = z.object({ id: uuid.optional(), budgetLineId: uuid.nullable().optional(), costCodeId: uuid.nullable().optional(), estimateLineId: uuid.nullable().optional(), name: shortText, description: longText.default(''), quantityThousandths: z.number().int().default(1000), unit: z.string().max(20).default('ea'), unitCostCents: costMap.default({}), markupBp: bpMap.nullable().optional(), taxable: z.boolean().default(false) });
export const createChangeOrderBody = z.object({ title: shortText, description: longText.default(''), reason: z.string().max(80).nullable().optional(), scheduleImpactDays: z.number().int().min(-365).max(365).default(0), lines: z.array(coLineInput).max(200).default([]), attachmentDocumentIds: z.array(uuid).max(20).optional() });
export const updateChangeOrderBody = patchOf(createChangeOrderBody);
export const sendChangeOrderBody = z.object({ message: z.string().max(2000).optional() });
export const decideChangeOrderBody = z.object({ decision: z.enum(['approved', 'declined']), decidedByName: shortText, note: z.string().max(1000).optional(), signatureDocumentId: uuid.optional() });
export const listChangeOrdersQuery = paginationQuery.extend({ projectId: uuid.optional(), status: z.enum([...CO_STATUSES, 'open', 'all']).default('all') });

// ---------- invoices & payments ----------
export const INVOICE_STATUSES = ['draft', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'void'] as const;
export const BILLING_TYPES = ['progress', 'milestone', 'change_order', 'cost_plus', 'final'] as const;
export const invoiceLineSchema = z.object({ id: uuid, budgetLineId: uuid.nullable(), changeOrderId: uuid.nullable(), description: z.string(), quantityThousandths: z.number().int(), unitPriceCents: cents, amountCents: cents, percentBp: basisPoints.nullable(), taxable: z.boolean(), sortOrder: z.number().int() });
export const paymentSchema = z.object({ id: uuid, invoiceId: uuid.nullable(), billId: uuid.nullable(), direction: z.enum(['in', 'out']), method: z.string(), status: z.string(), amountCents: cents, feeCents: cents, receivedAt: isoDateTime, reference: z.string().nullable(), notes: z.string(), provider: z.string().nullable(), voidedAt: isoDateTime.nullable() });
export type Payment = z.infer<typeof paymentSchema>;
export const invoiceSchema = auditFields.extend({ projectId: uuid, projectName: z.string().optional(), clientId: uuid.nullable(), clientName: z.string().nullable(), number: z.string(), title: z.string(), billingType: z.enum(BILLING_TYPES), status: z.enum(INVOICE_STATUSES), issueDate: isoDate.nullable(), dueDate: isoDate.nullable(), subtotalCents: cents, taxCents: cents, retainageCents: cents, totalCents: cents, paidCents: cents, balanceCents: cents, notes: z.string(), terms: z.string(), sentAt: isoDateTime.nullable(), viewedAt: isoDateTime.nullable(), paidAt: isoDateTime.nullable(), lines: z.array(invoiceLineSchema), payments: z.array(paymentSchema), attachments: z.array(documentSchema).optional() });
export type Invoice = z.infer<typeof invoiceSchema>;
export const invoiceLineInput = z.object({ id: uuid.optional(), budgetLineId: uuid.nullable().optional(), changeOrderId: uuid.nullable().optional(), description: shortText, quantityThousandths: z.number().int().default(1000), unitPriceCents: cents.default(0), percentBp: basisPoints.nullable().optional(), taxable: z.boolean().default(false) });
export const createInvoiceBody = z.object({ title: z.string().max(200).default(''), billingType: z.enum(BILLING_TYPES).default('progress'), issueDate: isoDate.optional(), dueDate: isoDate.nullable().optional(), taxBp: basisPoints.default(0), retainageBp: basisPoints.default(0), notes: longText.default(''), terms: longText.default(''), lines: z.array(invoiceLineInput).max(200).default([]), changeOrderIds: z.array(uuid).max(50).optional(), attachmentDocumentIds: z.array(uuid).max(20).optional() });
export const updateInvoiceBody = patchOf(createInvoiceBody);
export const recordPaymentBody = z.object({ amountCents: cents.positive(), method: z.enum(['check', 'ach', 'card', 'cash', 'other']).default('check'), reference: z.string().max(120).nullable().optional(), receivedAt: isoDateTime.optional(), notes: z.string().max(500).default('') });
export const invoiceTransitionBody = z.object({ action: z.enum(['send', 'void', 'reopen']) });
export const listInvoicesQuery = paginationQuery.extend({ projectId: uuid.optional(), clientId: uuid.optional(), status: z.enum([...INVOICE_STATUSES, 'open', 'all']).default('all'), q: z.string().max(200).optional() });
