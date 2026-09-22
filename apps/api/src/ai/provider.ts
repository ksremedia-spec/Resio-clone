import type { ToolDef } from './tools.js';
import { toolInputSchema } from './tools.js';

export interface LlmToolCall { id: string; name: string; input: Record<string, unknown> }
export interface LlmMessage { role: 'user' | 'assistant'; content: string; toolCalls?: LlmToolCall[] | null; toolResults?: Array<{ toolUseId: string; name: string; ok: boolean; summary: string; output?: unknown }> | null }
export interface LlmContext {
  system: string;
  messages: LlmMessage[];
  tools: ToolDef[];
  /** Hints the rule-based provider needs to resolve names; the language model gets them in the system prompt instead. */
  projects: Array<{ id: string; number: string; name: string }>;
  projectId: string | null;
}
export interface LlmReply { text: string; toolCalls: LlmToolCall[] }
export interface LlmProvider { readonly name: string; readonly model: string | null; complete(ctx: LlmContext): Promise<LlmReply> }

// ---------------------------------------------------------------------------
// Anthropic Messages API with tool use.
// ---------------------------------------------------------------------------
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  constructor(private readonly apiKey: string, readonly model: string, private readonly opts: { browser?: boolean; baseUrl?: string } = {}) {}

  async complete(ctx: LlmContext): Promise<LlmReply> {
    const tools = ctx.tools.map((t) => ({ name: t.name, description: t.description, input_schema: toolInputSchema(t) }));
    const messages = toAnthropicMessages(ctx.messages);
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' };
    if (this.opts.browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';
    const res = await fetch(`${this.opts.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, { method: 'POST', headers, body: JSON.stringify({ model: this.model, max_tokens: 1024, system: ctx.system, tools, messages }) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`The AI service returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json() as { content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> };
    const text = data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
    const toolCalls = data.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} }));
    return { text, toolCalls };
  }
}

/** Our stored shape → Anthropic's alternating user/assistant blocks (tool results ride in a user turn). */
export function toAnthropicMessages(messages: LlmMessage[]): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const out: Array<{ role: 'user' | 'assistant'; content: any[] }> = [];
  const push = (role: 'user' | 'assistant', blocks: any[]) => {
    if (!blocks.length) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks); else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') { push('user', m.content ? [{ type: 'text', text: m.content }] : []); continue; }
    const blocks: any[] = [];
    if (m.content) blocks.push({ type: 'text', text: m.content });
    for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
    push('assistant', blocks);
    const results = (m.toolCalls ?? []).map((c) => {
      const r = (m.toolResults ?? []).find((x) => x.toolUseId === c.id);
      return { type: 'tool_result', tool_use_id: c.id, content: r ? JSON.stringify({ ok: r.ok, summary: r.summary, data: r.output ?? null }).slice(0, 12_000) : 'The person has not confirmed this action yet.', is_error: r ? !r.ok : false };
    });
    push('user', results);
  }
  // The API requires the conversation to start with a user turn and end with one.
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(conversation start)' }] });
  return out.map((m) => ({ role: m.role, content: m.content }));
}

// ---------------------------------------------------------------------------
// Rule-based provider: no network, no key. Recognises everyday questions and
// maps them onto tools, then turns the tool summaries into an answer. Used in
// tests, the browser demo and any deployment without an API key.
// ---------------------------------------------------------------------------
export class RuleBasedProvider implements LlmProvider {
  readonly name = 'rules';
  readonly model = null;

  async complete(ctx: LlmContext): Promise<LlmReply> {
    const last = ctx.messages[ctx.messages.length - 1];
    if (!last) return { text: 'Ask me about a project, the schedule, the budget or invoices.', toolCalls: [] };
    // Second pass: answer from the tool results we just collected.
    if (last.role === 'assistant' && last.toolResults?.length) {
      const failed = last.toolResults.filter((r) => !r.ok);
      const text = last.toolResults.map((r) => r.summary).join('\n\n');
      return { text: failed.length ? `${text}\n\nSome of that could not be checked: ${failed.map((f) => f.summary).join('; ')}` : text, toolCalls: [] };
    }
    if (last.role !== 'user') return { text: '', toolCalls: [] };
    const q = last.content.trim();
    const lower = q.toLowerCase();
    const has = (name: string) => ctx.tools.some((t) => t.name === name);
    const call = (name: string, input: Record<string, unknown>): LlmReply => ({ text: '', toolCalls: [{ id: `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name, input }] });
    const project = resolveProject(lower, ctx);
    const needProject = (name: string, extra: Record<string, unknown> = {}): LlmReply => {
      if (!has(name)) return { text: "You don't have access to that in Buildline, so I can't look it up.", toolCalls: [] };
      if (!project) return { text: `Which project? ${ctx.projects.length ? `I can see ${ctx.projects.slice(0, 6).map((p) => p.name).join(', ')}${ctx.projects.length > 6 ? ' and more' : ''}.` : ''}`.trim(), toolCalls: [] };
      return call(name, { projectId: project.id, ...extra });
    };
    const optProject = (name: string, extra: Record<string, unknown> = {}): LlmReply => has(name) ? call(name, { ...(project ? { projectId: project.id } : {}), ...extra }) : { text: "You don't have access to that in Buildline, so I can't look it up.", toolCalls: [] };

    // ----- write intents -----
    const todo = lower.match(/^(?:please\s+)?(?:create|add|make|new)\s+(?:a\s+|an\s+)?(?:to-?do|task|reminder)\b/);
    if (todo) {
      const name = extractQuoted(q) ?? q.replace(/^(?:please\s+)?(?:create|add|make|new)\s+(?:a\s+|an\s+)?(?:to-?do|task|reminder)\b\s*(?:to\s+|for\s+|called\s+|:\s*)?/i, '').replace(/\s+(?:on|for|in)\s+(?:the\s+)?(?:project\s+)?[\w\s'&—-]+?$/i, '').replace(/\s+(?:due|by)\s+.*$/i, '').replace(/\s+for\s+[A-Z]\w+$/, '').trim();
      if (!has('create_task')) return { text: "You can't create tasks with your role.", toolCalls: [] };
      if (!project) return { text: 'Which project should the to-do go on?', toolCalls: [] };
      const due = parseDue(lower);
      const assignee = q.match(/\bfor\s+([A-Z][a-z]+)(?:\s|$)/)?.[1];
      return call('create_task', { projectId: project.id, name: name || q, ...(due ? { dueDate: due } : {}), ...(assignee && !/^(the|project)$/i.test(assignee) ? { assigneeName: assignee } : {}) });
    }
    if (/^(?:please\s+)?(?:send|post|start)\s+(?:a\s+)?(?:message|thread|note)\b/.test(lower)) {
      if (!has('post_message')) return { text: "You can't post messages with your role.", toolCalls: [] };
      if (!project) return { text: 'Which project should the message go on?', toolCalls: [] };
      const body = extractQuoted(q) ?? q.replace(/^(?:please\s+)?(?:send|post|start)\s+(?:a\s+)?(?:message|thread|note)\b\s*(?:to\s+(?:the\s+)?(?:team|client)\s*)?(?:on|about|saying|:)?\s*/i, '').trim();
      return call('post_message', { projectId: project.id, subject: body.slice(0, 60), body, clientVisible: /client/.test(lower) });
    }
    const co = lower.match(/(?:draft|create|add|make)\s+(?:a\s+)?change order\b/);
    if (co) {
      if (!has('create_change_order')) return { text: "You can't create change orders with your role.", toolCalls: [] };
      if (!project) return { text: 'Which project is the change order for?', toolCalls: [] };
      const amount = parseMoney(q);
      const title = extractQuoted(q) ?? q.replace(/.*change order\s*(?:for|called|:)?\s*/i, '').replace(/\s*(?:for|at|of)?\s*\$?[\d,]+(?:\.\d{2})?\s*(?:dollars)?.*$/i, '').replace(/\s+on\s+.*$/i, '').trim();
      if (!amount) return { text: 'How much should the change order be for?', toolCalls: [] };
      return call('create_change_order', { projectId: project.id, title: title || 'Additional work', amountCents: amount });
    }

    // ----- read intents -----
    if (/\b(overdue|late|behind|slipp)/.test(lower)) return optProject('overdue_tasks');
    if (/\b(budget|over budget|job cost|margin|spend|spent|committed|variance)\b/.test(lower)) return needProject('budget_status');
    if (/\b(invoice|unpaid|outstanding|owe|owes|balance|receivable|paid)\b/.test(lower)) return optProject('unpaid_invoices');
    if (/\b(approv|waiting on|pending|decision|sign)/.test(lower)) return optProject('pending_approvals');
    if (/\b(hours|timesheet|time clock|clocked|payroll|labor|labour)\b/.test(lower)) return optProject('time_summary');
    if (/\b(daily log|logs?|on site|site today|yesterday|weather|delay)/.test(lower)) return needProject('daily_logs', { days: /month/.test(lower) ? 30 : 7 });
    if (/\b(schedule|upcoming|next week|this week|coming up|milestone|when (?:does|will|is))\b/.test(lower)) return needProject('upcoming_schedule', { days: /month/.test(lower) ? 30 : /today|tomorrow/.test(lower) ? 2 : 14 });
    if (/\b(activity|recent|latest|what happened|updates?|news)\b/.test(lower)) return optProject('recent_activity');
    if (/\b(projects?)\b/.test(lower) && /\b(list|which|what|show|all|how many|my)\b/.test(lower) && !project) return has('list_projects') ? call('list_projects', {}) : { text: 'You do not have project access.', toolCalls: [] };
    if (project && /\b(status|summary|summar|overview|how is|how's|going|update on|tell me about|contract)\b/.test(lower)) return call('project_overview', { projectId: project.id });
    if (project) return call('project_overview', { projectId: project.id });
    if (/^(hi|hello|hey|thanks|thank you)\b/.test(lower)) return { text: "Hello! Ask me things like \"what's overdue on Smith Residence\", \"how is the Baker budget\", \"which invoices are unpaid\", or \"create a to-do to order tile on Smith\".", toolCalls: [] };
    return has('search') ? call('search', { query: q.slice(0, 200) }) : { text: 'I can help with projects, schedules, budgets, invoices, approvals, daily logs and time. Try naming a project.', toolCalls: [] };
  }
}

function resolveProject(lower: string, ctx: LlmContext): { id: string; name: string } | null {
  for (const p of ctx.projects) {
    const name = p.name.toLowerCase();
    const first = name.split(/[\s—–-]+/).filter((w) => w.length > 3)[0];
    if (lower.includes(name) || lower.includes(p.number.toLowerCase()) || (first && new RegExp(`\\b${escape(first)}\\b`).test(lower))) return { id: p.id, name: p.name };
  }
  if (ctx.projectId) { const p = ctx.projects.find((x) => x.id === ctx.projectId); if (p) return { id: p.id, name: p.name }; }
  return null;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function extractQuoted(q: string): string | null { const m = q.match(/["“”']([^"“”']{2,200})["“”']/); return m ? m[1]!.trim() : null; }
function parseMoney(q: string): number | null { const m = q.match(/\$\s?([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)/i); if (!m) return null; const n = Number((m[1] ?? m[2] ?? '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; }
function parseDue(lower: string): string | null {
  const today = new Date(); const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (/\btomorrow\b/.test(lower)) { const d = new Date(today); d.setDate(d.getDate() + 1); return iso(d); }
  if (/\btoday\b/.test(lower)) return iso(today);
  const m = lower.match(/\b(?:due|by)\s+(\d{4}-\d{2}-\d{2})/); if (m) return m[1]!;
  const day = lower.match(/\b(?:due|by|on)\s+(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (day) { const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']; const target = names.indexOf(day[1]!); const d = new Date(today); let diff = (target - d.getDay() + 7) % 7; if (diff === 0) diff = 7; d.setDate(d.getDate() + diff); return iso(d); }
  const inDays = lower.match(/\bin\s+(\d+)\s+days?\b/); if (inDays) { const d = new Date(today); d.setDate(d.getDate() + Number(inDays[1])); return iso(d); }
  return null;
}
