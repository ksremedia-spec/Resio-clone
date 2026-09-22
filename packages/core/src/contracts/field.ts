import { z } from 'zod';
import { auditFields, cents, isoDate, isoDateTime, longText, paginationQuery, patchOf, shortText, uuid } from './common.js';
import { documentSchema } from './document.js';

// ---------- time clock ----------
export const TIME_STATUSES = ['open', 'submitted', 'approved', 'rejected', 'exported'] as const;
export const geoPoint = z.object({ latitude: z.number(), longitude: z.number(), accuracyM: z.number().optional(), capturedAt: isoDateTime.optional() });
export const timeBreakSchema = z.object({ id: uuid, startedAt: isoDateTime, endedAt: isoDateTime.nullable() });
export const timeEntrySchema = auditFields.extend({
  userId: uuid, userName: z.string(), projectId: uuid.nullable(), projectName: z.string().nullable(), taskId: uuid.nullable(), taskName: z.string().nullable(), costCodeId: uuid.nullable(), costCode: z.string().nullable(),
  clockInAt: isoDateTime, clockOutAt: isoDateTime.nullable(), breakSeconds: z.number().int(), durationSeconds: z.number().int().nullable(), status: z.enum(TIME_STATUSES), notes: z.string(),
  clockInLocation: geoPoint.nullable(), clockOutLocation: geoPoint.nullable(), hourlyCostCents: z.number().int().nullable(), laborCostCents: z.number().int().nullable(), approvedBy: uuid.nullable(), approvedAt: isoDateTime.nullable(), exportedAt: isoDateTime.nullable(),
  breaks: z.array(timeBreakSchema), onBreak: z.boolean(),
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;
export const clockInBody = z.object({ projectId: uuid.nullable().optional(), taskId: uuid.nullable().optional(), costCodeId: uuid.nullable().optional(), notes: longText.default(''), location: geoPoint.nullable().optional(), clientMutationId: z.string().max(80).optional() });
export const clockOutBody = z.object({ notes: longText.optional(), location: geoPoint.nullable().optional() });
export const manualTimeEntryBody = z.object({ userId: uuid.optional(), projectId: uuid.nullable().optional(), taskId: uuid.nullable().optional(), costCodeId: uuid.nullable().optional(), clockInAt: isoDateTime, clockOutAt: isoDateTime, breakSeconds: z.number().int().min(0).default(0), notes: longText.default('') });
export const updateTimeEntryBody = patchOf(manualTimeEntryBody, ['userId']);
export const listTimeQuery = paginationQuery.extend({ projectId: uuid.optional(), userId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional(), status: z.enum([...TIME_STATUSES, 'pending', 'all']).default('all') });
export const timeDecisionBody = z.object({ ids: z.array(uuid).min(1).max(500), decision: z.enum(['approved', 'rejected']), note: z.string().max(500).optional() });
export const timesheetQuery = z.object({ from: isoDate, to: isoDate, projectId: uuid.optional() });
export const timesheetRow = z.object({ userId: uuid, userName: z.string(), hourlyCostCents: z.number().int().nullable(), days: z.record(z.string(), z.number()), totalSeconds: z.number().int(), pendingSeconds: z.number().int(), approvedSeconds: z.number().int(), laborCostCents: z.number().int(), entryIds: z.array(uuid) });
export const timesheetResponse = z.object({ from: isoDate, to: isoDate, rows: z.array(timesheetRow), totalSeconds: z.number().int(), laborCostCents: z.number().int() });
export type TimesheetResponse = z.infer<typeof timesheetResponse>;
export const payrollExportBody = z.object({ from: isoDate, to: isoDate, markExported: z.boolean().default(true) });

// ---------- bid requests (vendor portal) ----------
export const BID_REQUEST_STATUSES = ['draft', 'open', 'awarded', 'closed'] as const;
export const BID_STATUSES = ['invited', 'submitted', 'declined', 'awarded', 'not_selected'] as const;
export const bidSchema = z.object({ id: uuid, bidRequestId: uuid, vendorId: uuid, vendorName: z.string(), vendorTrade: z.string().nullable(), status: z.enum(BID_STATUSES), amountCents: cents.nullable(), notes: z.string(), submittedAt: isoDateTime.nullable(), validUntil: isoDate.nullable(), attachments: z.array(documentSchema).optional() });
export type Bid = z.infer<typeof bidSchema>;
export const bidRequestSchema = auditFields.extend({ projectId: uuid, projectName: z.string().optional(), title: z.string(), scope: z.string(), costCodeId: uuid.nullable(), costCode: z.string().nullable(), dueDate: isoDate.nullable(), status: z.enum(BID_REQUEST_STATUSES), awardedBidId: uuid.nullable(), purchaseOrderId: uuid.nullable().optional(), bids: z.array(bidSchema), attachments: z.array(documentSchema).optional(), lowestCents: cents.nullable(), submittedCount: z.number().int() });
export type BidRequest = z.infer<typeof bidRequestSchema>;
export const createBidRequestBody = z.object({ title: shortText, scope: longText.default(''), costCodeId: uuid.nullable().optional(), dueDate: isoDate.nullable().optional(), vendorIds: z.array(uuid).max(20).default([]), attachmentDocumentIds: z.array(uuid).max(20).optional() });
export const updateBidRequestBody = patchOf(createBidRequestBody);
export const submitBidBody = z.object({ amountCents: cents.positive(), notes: longText.default(''), validUntil: isoDate.nullable().optional(), attachmentDocumentIds: z.array(uuid).max(20).optional() });
export const awardBidBody = z.object({ bidId: uuid, createPurchaseOrder: z.boolean().default(true) });
export const listBidRequestsQuery = paginationQuery.extend({ projectId: uuid.optional(), status: z.enum([...BID_REQUEST_STATUSES, 'all']).default('all') });

export const vendorOverview = z.object({
  vendor: z.object({ id: uuid, name: z.string(), trade: z.string().nullable() }).nullable(),
  purchaseOrders: z.array(z.object({ id: uuid, number: z.string(), title: z.string(), status: z.string(), projectId: uuid, projectName: z.string(), totalCents: cents, billedCents: cents, issuedAt: isoDateTime.nullable(), acknowledgedAt: isoDateTime.nullable() })),
  bidRequests: z.array(z.object({ id: uuid, title: z.string(), projectId: uuid, projectName: z.string(), dueDate: isoDate.nullable(), status: z.string(), myBid: bidSchema.nullable() })),
  tasks: z.array(z.object({ id: uuid, name: z.string(), projectId: uuid, projectName: z.string(), startDate: isoDate.nullable(), endDate: isoDate.nullable(), status: z.string() })),
  projects: z.array(z.object({ id: uuid, number: z.string(), name: z.string(), addressLine: z.string() })),
});
export type VendorOverview = z.infer<typeof vendorOverview>;
