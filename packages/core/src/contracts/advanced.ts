import { z } from 'zod';
import { addressSchema, auditFields, cents, email, isoDate, isoDateTime, longText, paginationQuery, patchOf, shortText, uuid } from './common.js';

// ---------------------------------------------------------------------------
// Leads / CRM
// ---------------------------------------------------------------------------

export const LEAD_STAGES = ['new', 'contacted', 'qualified', 'estimating', 'proposal_sent', 'won', 'lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const OPEN_LEAD_STAGES: readonly LeadStage[] = ['new', 'contacted', 'qualified', 'estimating', 'proposal_sent'];
export const LEAD_SOURCES = ['referral', 'website', 'social', 'repeat_client', 'architect', 'walk_in', 'other'] as const;
export const LEAD_ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting', 'task', 'stage'] as const;

export const leadActivitySchema = z.object({
  id: uuid,
  leadId: uuid,
  kind: z.enum(LEAD_ACTIVITY_KINDS),
  body: z.string(),
  occurredAt: isoDateTime,
  dueAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
  createdBy: uuid.nullable(),
  createdByName: z.string().nullable(),
});
export type LeadActivity = z.infer<typeof leadActivitySchema>;

export const leadSchema = auditFields.extend({
  name: z.string(),
  clientId: uuid.nullable(),
  clientName: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  address: addressSchema,
  source: z.string().nullable(),
  stage: z.enum(LEAD_STAGES),
  projectType: z.string().nullable(),
  estimatedValueCents: cents.nullable(),
  budgetRangeLowCents: cents.nullable(),
  budgetRangeHighCents: cents.nullable(),
  targetStartDate: isoDate.nullable(),
  ownerUserId: uuid.nullable(),
  ownerName: z.string().nullable(),
  notes: z.string(),
  nextFollowUpAt: isoDateTime.nullable(),
  convertedProjectId: uuid.nullable(),
  convertedProjectName: z.string().nullable().optional(),
  lostReason: z.string().nullable(),
  archivedAt: isoDateTime.nullable(),
  daysInStage: z.number().int().optional(),
  activities: z.array(leadActivitySchema).optional(),
});
export type Lead = z.infer<typeof leadSchema>;

export const createLeadBody = z.object({
  name: shortText,
  clientId: uuid.nullable().optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactEmail: email.nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  address: addressSchema.partial().optional(),
  source: z.string().trim().max(60).nullable().optional(),
  stage: z.enum(LEAD_STAGES).default('new'),
  projectType: z.string().trim().max(60).nullable().optional(),
  estimatedValueCents: cents.nullable().optional(),
  budgetRangeLowCents: cents.nullable().optional(),
  budgetRangeHighCents: cents.nullable().optional(),
  targetStartDate: isoDate.nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  notes: longText.default(''),
  nextFollowUpAt: isoDateTime.nullable().optional(),
});
export const updateLeadBody = patchOf(createLeadBody);

export const listLeadsQuery = paginationQuery.extend({
  stage: z.enum([...LEAD_STAGES, 'open', 'closed', 'all']).default('open'),
  q: z.string().max(200).optional(),
  ownerUserId: uuid.optional(),
  includeArchived: z.coerce.boolean().default(false),
});

export const moveLeadBody = z.object({ stage: z.enum(LEAD_STAGES), lostReason: z.string().trim().max(500).optional() });
export const leadActivityBody = z.object({
  kind: z.enum(['note', 'call', 'email', 'meeting', 'task']),
  body: longText.min(1),
  dueAt: isoDateTime.nullable().optional(),
});
export const convertLeadBody = z.object({
  projectName: shortText.optional(),
  /** Reuse an existing client instead of creating one from the lead's contact details. */
  clientId: uuid.nullable().optional(),
  contractValueCents: cents.optional(),
  startDate: isoDate.nullable().optional(),
  type: z.string().max(40).optional(),
});

export const leadBoardResponse = z.object({
  columns: z.array(z.object({ stage: z.enum(LEAD_STAGES), count: z.number().int(), valueCents: cents, leads: z.array(leadSchema) })),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const REPORT_KEYS = ['job_cost', 'ar_aging', 'time_by_project', 'pipeline'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const reportQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  projectId: uuid.optional(),
  status: z.enum(['open', 'all']).default('open'),
  format: z.enum(['json', 'csv']).default('json'),
});

export const jobCostRow = z.object({
  projectId: uuid, number: z.string(), name: z.string(), status: z.string(), clientName: z.string().nullable(),
  originalCents: cents, approvedChangesCents: cents, revisedCents: cents, committedCents: cents, actualCents: cents, projectedCents: cents, varianceCents: cents,
  revisedContractCents: cents, invoicedCents: cents, paidCents: cents, outstandingCents: cents, projectedMarginCents: cents, projectedMarginBp: z.number().int(),
  percentSpentBp: z.number().int(), health: z.enum(['on_track', 'watch', 'over']),
});
export const jobCostReport = z.object({ generatedAt: isoDateTime, rows: z.array(jobCostRow), totals: jobCostRow.omit({ projectId: true, number: true, name: true, status: true, clientName: true, health: true }) });

export const AGING_BUCKETS = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_90_plus'] as const;
export const arAgingRow = z.object({
  invoiceId: uuid, number: z.string(), title: z.string(), projectId: uuid, projectName: z.string(), clientName: z.string().nullable(),
  issueDate: isoDate.nullable(), dueDate: isoDate.nullable(), totalCents: cents, paidCents: cents, balanceCents: cents, daysOverdue: z.number().int(), bucket: z.enum(AGING_BUCKETS),
});
export const arAgingReport = z.object({
  generatedAt: isoDateTime,
  asOf: isoDate,
  rows: z.array(arAgingRow),
  buckets: z.record(z.enum(AGING_BUCKETS), cents),
  totalCents: cents,
  byClient: z.array(z.object({ clientName: z.string(), balanceCents: cents, overdueCents: cents })),
});

export const timeByProjectRow = z.object({
  projectId: uuid.nullable(), projectName: z.string(), seconds: z.number().int(), laborCostCents: cents, entries: z.number().int(), approvedSeconds: z.number().int(),
  people: z.array(z.object({ userId: uuid, name: z.string(), seconds: z.number().int(), laborCostCents: cents })),
});
export const timeByProjectReport = z.object({ generatedAt: isoDateTime, from: isoDate, to: isoDate, rows: z.array(timeByProjectRow), totals: z.object({ seconds: z.number().int(), laborCostCents: cents, entries: z.number().int(), approvedSeconds: z.number().int() }) });

export const pipelineReport = z.object({
  generatedAt: isoDateTime,
  stages: z.array(z.object({ stage: z.enum(LEAD_STAGES), count: z.number().int(), valueCents: cents })),
  sources: z.array(z.object({ source: z.string(), count: z.number().int(), wonCount: z.number().int(), valueCents: cents })),
  openCount: z.number().int(), openValueCents: cents, wonCount: z.number().int(), wonValueCents: cents, lostCount: z.number().int(),
  winRateBp: z.number().int(),
  followUpsDue: z.number().int(),
});

export const reportCatalogEntry = z.object({ key: z.enum(REPORT_KEYS), name: z.string(), description: z.string(), permission: z.string() });

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

/** Events an automation can react to. Activity events fire the moment the activity entry is written; scheduled events are evaluated by the daily check. */
export const AUTOMATION_EVENTS = [
  'daily_log.posted', 'task.completed', 'task.created', 'change_order.approved', 'change_order.declined', 'invoice.paid', 'invoice.sent',
  'proposal.accepted', 'selection.decided', 'bid.received', 'purchase_order.acknowledged', 'document.uploaded', 'project.created', 'lead.created', 'lead.won', 'lead.lost', 'time_entry.approved',
  'invoice.overdue', 'task.overdue', 'lead.follow_up_due',
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];
export const SCHEDULED_EVENTS: readonly AutomationEvent[] = ['invoice.overdue', 'task.overdue', 'lead.follow_up_due'];

export const automationTrigger = z.object({
  event: z.enum(AUTOMATION_EVENTS),
  /** Limit to one project, or null for every project. */
  projectId: uuid.nullable().default(null),
});

const roleKey = z.string().trim().min(1).max(60);
export const automationAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify'), to: z.enum(['project_team', 'role', 'actor', 'project_managers']), roleKey: roleKey.optional(), title: shortText, body: z.string().max(2000).default('') }),
  z.object({ type: z.literal('create_task'), name: shortText, description: z.string().max(2000).default(''), daysUntilDue: z.number().int().min(0).max(365).default(1), priority: z.enum(['low', 'medium', 'high']).default('medium'), assignTo: z.enum(['actor', 'project_managers', 'role', 'nobody']).default('project_managers'), roleKey: roleKey.optional() }),
  z.object({ type: z.literal('email'), to: z.enum(['client', 'address', 'actor']), address: email.optional(), subject: shortText, body: z.string().max(5000).default('') }),
]);
export type AutomationAction = z.infer<typeof automationAction>;

export const automationSchema = auditFields.extend({
  name: z.string(),
  description: z.string(),
  trigger: automationTrigger,
  actions: z.array(automationAction),
  enabled: z.boolean(),
  lastRunAt: isoDateTime.nullable(),
  runCount: z.number().int().optional(),
  projectName: z.string().nullable().optional(),
});
export type Automation = z.infer<typeof automationSchema>;

export const createAutomationBody = z.object({
  name: shortText,
  description: z.string().trim().max(1000).default(''),
  trigger: automationTrigger,
  actions: z.array(automationAction).min(1).max(10),
  enabled: z.boolean().default(true),
});
export const updateAutomationBody = patchOf(createAutomationBody);

export const automationRunSchema = z.object({
  id: uuid,
  automationId: uuid,
  automationName: z.string().optional(),
  status: z.enum(['running', 'succeeded', 'failed', 'skipped']),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  input: z.object({ event: z.string(), summary: z.string(), projectId: uuid.nullable(), objectType: z.string().nullable(), objectId: uuid.nullable(), actorName: z.string() }),
  output: z.array(z.object({ action: z.string(), result: z.string() })).nullable(),
  error: z.string().nullable(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const listAutomationRunsQuery = paginationQuery.extend({ automationId: uuid.optional() });

export const automationTemplate = z.object({ key: z.string(), name: z.string(), description: z.string(), trigger: automationTrigger, actions: z.array(automationAction) });
export const automationCatalog = z.object({
  events: z.array(z.object({ key: z.enum(AUTOMATION_EVENTS), label: z.string(), scheduled: z.boolean() })),
  templates: z.array(automationTemplate),
  placeholders: z.array(z.object({ key: z.string(), description: z.string() })),
});

export const runScheduledResponse = z.object({ evaluated: z.number().int(), fired: z.number().int() });

// ---------------------------------------------------------------------------
// Offline download (client-side full sync)
// ---------------------------------------------------------------------------

export const offlineManifest = z.object({
  projects: z.array(z.object({ id: uuid, name: z.string(), number: z.string() })),
  urls: z.array(z.string()),
});
