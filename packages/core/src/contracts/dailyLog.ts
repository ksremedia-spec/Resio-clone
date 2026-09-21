import { z } from 'zod';
import { auditFields, isoDate, isoDateTime, longText, paginationQuery, uuid, patchOf } from './common.js';
import { documentSchema } from './document.js';

export const DAILY_LOG_ENTRY_TYPES = ['work', 'crew', 'material', 'equipment', 'visitor', 'issue', 'delay', 'note', 'voice', 'safety'] as const;
export const DELAY_CAUSES = ['weather', 'material', 'subcontractor', 'owner_decision', 'inspection', 'labor', 'design', 'other'] as const;

export const weatherSchema = z.object({
  conditions: z.string().max(80).nullable().default(null),
  temperatureHighF: z.number().nullable().default(null),
  temperatureLowF: z.number().nullable().default(null),
  precipitationIn: z.number().nullable().default(null),
  windMph: z.number().nullable().default(null),
  source: z.enum(['manual', 'auto']).default('manual'),
});

export const dailyLogEntrySchema = z.object({
  id: uuid,
  type: z.enum(DAILY_LOG_ENTRY_TYPES),
  text: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  trade: z.string().nullable(),
  headcount: z.number().int().nullable(),
  hours: z.number().nullable(),
  delayCause: z.enum(DELAY_CAUSES).nullable(),
  delayHours: z.number().nullable(),
  taskId: uuid.nullable(),
  vendorId: uuid.nullable(),
  documentId: uuid.nullable(),
  sortOrder: z.number().int(),
});
export type DailyLogEntry = z.infer<typeof dailyLogEntrySchema>;

export const dailyLogSchema = auditFields.extend({
  projectId: uuid,
  projectName: z.string().optional(),
  logDate: isoDate,
  authorName: z.string(),
  weather: weatherSchema,
  summary: z.string(),
  tags: z.array(z.string()),
  clientVisible: z.boolean(),
  status: z.enum(['draft', 'submitted']),
  submittedAt: isoDateTime.nullable(),
  entries: z.array(dailyLogEntrySchema),
  photos: z.array(documentSchema),
  attachments: z.array(documentSchema),
  totals: z.object({ headcount: z.number().int(), laborHours: z.number(), delayHours: z.number(), photoCount: z.number().int() }),
});
export type DailyLog = z.infer<typeof dailyLogSchema>;

export const dailyLogEntryInput = z.object({
  id: uuid.optional(),
  type: z.enum(DAILY_LOG_ENTRY_TYPES),
  text: z.string().max(5000).default(''),
  quantity: z.number().nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  trade: z.string().max(80).nullable().optional(),
  headcount: z.number().int().min(0).max(10_000).nullable().optional(),
  hours: z.number().min(0).max(10_000).nullable().optional(),
  delayCause: z.enum(DELAY_CAUSES).nullable().optional(),
  delayHours: z.number().min(0).max(1000).nullable().optional(),
  taskId: uuid.nullable().optional(),
  vendorId: uuid.nullable().optional(),
  documentId: uuid.nullable().optional(),
});

export const createDailyLogBody = z.object({
  id: uuid.optional(),
  logDate: isoDate,
  weather: weatherSchema.partial().optional(),
  summary: longText.default(''),
  tags: z.array(z.string().max(40)).max(20).default([]),
  clientVisible: z.boolean().default(false),
  status: z.enum(['draft', 'submitted']).default('submitted'),
  entries: z.array(dailyLogEntryInput).max(500).default([]),
  photoDocumentIds: z.array(uuid).max(500).default([]),
  attachmentDocumentIds: z.array(uuid).max(100).default([]),
  clientMutationId: z.string().max(64).optional(),
});
export const updateDailyLogBody = patchOf(createDailyLogBody, ['id', 'clientMutationId']).extend({ expectedVersion: z.number().int().optional() });

export const listDailyLogsQuery = paginationQuery.extend({
  projectId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  tag: z.string().max(40).optional(),
  clientVisibleOnly: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(),
});
