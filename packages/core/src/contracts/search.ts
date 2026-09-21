import { z } from 'zod';
import { uuid } from './common.js';

export const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  types: z.string().optional(), // comma separated
  projectId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchResult = z.object({
  type: z.enum(['project', 'client', 'vendor', 'task', 'document', 'message', 'estimate', 'change_order', 'invoice', 'daily_log', 'lead', 'contact']),
  id: uuid,
  title: z.string(),
  subtitle: z.string(),
  projectId: uuid.nullable(),
  link: z.string(),
  score: z.number(),
});
export const searchResponse = z.object({ results: z.array(searchResult) });
export type SearchResult = z.infer<typeof searchResult>;
