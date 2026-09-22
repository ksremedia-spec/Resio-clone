import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { contracts } from '@buildline/core';
import type { Deps } from './deps.js';
import type { DbOrTx } from '../db/client.js';
import { aiConversations, aiMessages, organizations, projects } from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import type { ActivityService } from './activity.service.js';
import type { Services } from './index.js';
import { buildTools, type ToolDef } from '../ai/tools.js';
import { AnthropicProvider, RuleBasedProvider, type LlmMessage, type LlmProvider } from '../ai/provider.js';

const MAX_TOOL_ROUNDS = 4;
const HISTORY = 30;

/**
 * The assistant: a conversation per person, a tool layer that only reaches
 * the product through the services (so permissions always apply), and a
 * confirmation step before anything is written.
 */
export class AiService {
  private tools: ToolDef[] = [];
  private provider: LlmProvider;

  constructor(private readonly deps: Deps, private readonly activity: ActivityService, opts: { provider?: LlmProvider } = {}) {
    const cfg = deps.config;
    this.provider = opts.provider ?? (cfg.AI_PROVIDER !== 'rules' && cfg.ANTHROPIC_API_KEY ? new AnthropicProvider(cfg.ANTHROPIC_API_KEY, cfg.AI_MODEL, { browser: cfg.DATABASE_URL.startsWith('pglite://browser') }) : new RuleBasedProvider());
  }

  /** Called once the full service registry exists (tools call other services). */
  attach(services: Services) { this.tools = buildTools(services); }
  setProvider(p: LlmProvider) { this.provider = p; }

  status(ctx: RequestContext): contracts.AiStatus {
    ctx.require('ai.use');
    const tools = this.allowedTools(ctx);
    const can = (n: string) => tools.some((t) => t.name === n);
    const suggestions = [
      can('overdue_tasks') ? "What's overdue this week?" : null,
      can('budget_status') ? 'How is the Smith Residence budget doing?' : null,
      can('unpaid_invoices') ? 'Which invoices are unpaid?' : null,
      can('upcoming_schedule') ? "What's coming up on Smith Residence in the next two weeks?" : null,
      can('daily_logs') ? 'Summarise the last week of daily logs on Smith Residence' : null,
      can('create_task') ? 'Create a to-do to order the pot filler on Smith Residence due Friday' : null,
      can('time_summary') ? 'How many hours did the crew work this week?' : null,
    ].filter((x): x is string => !!x);
    return { provider: this.provider.name, model: this.provider.model, tools: tools.map((t) => ({ name: t.name, description: t.description, kind: t.kind })), suggestions };
  }

  private allowedTools(ctx: RequestContext): ToolDef[] { return this.tools.filter((t) => !t.permission || ctx.has(t.permission)); }

  async listConversations(ctx: RequestContext): Promise<contracts.AiConversation[]> {
    ctx.require('ai.use');
    const rows = await this.deps.db.select({ c: aiConversations, projectName: projects.name }).from(aiConversations).leftJoin(projects, eq(projects.id, aiConversations.projectId)).where(and(eq(aiConversations.organizationId, ctx.organizationId), eq(aiConversations.userId, ctx.userId))).orderBy(desc(aiConversations.lastMessageAt), desc(aiConversations.createdAt)).limit(50);
    return rows.map((r) => serializeConversation(r.c, r.projectName));
  }

  async create(ctx: RequestContext, input: { projectId?: string | null; message?: string }): Promise<contracts.AiConversation> {
    ctx.require('ai.use');
    if (input.projectId) await ctx.requireProjectAccess(this.deps.db, input.projectId, { allowArchived: true });
    const [row] = await this.deps.db.insert(aiConversations).values({ organizationId: ctx.organizationId, userId: ctx.userId, projectId: input.projectId ?? null, title: input.message ? input.message.slice(0, 80) : 'New conversation', createdBy: ctx.userId, updatedBy: ctx.userId }).returning();
    if (input.message) return this.send(ctx, row!.id, input.message);
    return this.get(ctx, row!.id);
  }

  async get(ctx: RequestContext, id: string): Promise<contracts.AiConversation> {
    ctx.require('ai.use');
    const [r] = await this.deps.db.select({ c: aiConversations, projectName: projects.name }).from(aiConversations).leftJoin(projects, eq(projects.id, aiConversations.projectId)).where(and(eq(aiConversations.id, id), eq(aiConversations.organizationId, ctx.organizationId), eq(aiConversations.userId, ctx.userId))).limit(1);
    if (!r) throw AppError.notFound('Conversation');
    const msgs = await this.deps.db.select().from(aiMessages).where(eq(aiMessages.conversationId, id)).orderBy(asc(aiMessages.createdAt));
    return { ...serializeConversation(r.c, r.projectName), messages: msgs.map(serializeMessage) };
  }

  async remove(ctx: RequestContext, id: string) {
    ctx.require('ai.use');
    const [row] = await this.deps.db.delete(aiConversations).where(and(eq(aiConversations.id, id), eq(aiConversations.organizationId, ctx.organizationId), eq(aiConversations.userId, ctx.userId))).returning({ id: aiConversations.id });
    if (!row) throw AppError.notFound('Conversation');
  }

  /** Send a message and run the tool loop until the assistant answers or needs a confirmation. */
  async send(ctx: RequestContext, conversationId: string, content: string): Promise<contracts.AiConversation> {
    ctx.require('ai.use');
    const conv = await this.get(ctx, conversationId);
    const { db } = this.deps;
    await db.insert(aiMessages).values({ organizationId: ctx.organizationId, conversationId, role: 'user', content });
    if (conv.title === 'New conversation') await db.update(aiConversations).set({ title: content.slice(0, 80) }).where(eq(aiConversations.id, conversationId));
    const tools = this.allowedTools(ctx);
    const context = await this.context(ctx, conv);
    let history: LlmMessage[] = [...(conv.messages ?? []).map(toLlm), { role: 'user' as const, content }].slice(-HISTORY);
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let reply;
      try { reply = await this.provider.complete({ system: context.system, messages: history, tools, projects: context.projects, projectId: conv.projectId }); }
      catch (err) { await this.assistant(db, ctx, conversationId, `I couldn't reach the AI service: ${(err as Error).message}`); break; }
      const known = reply.toolCalls.filter((c) => tools.some((t) => t.name === c.name));
      const writes = known.filter((c) => tools.find((t) => t.name === c.name)!.kind === 'write');
      const reads = known.filter((c) => tools.find((t) => t.name === c.name)!.kind === 'read');
      const results: contracts.AiMessage['toolResults'] = [];
      for (const c of reads) results!.push(await this.runTool(ctx, tools, c.id, c.name, c.input));
      const calls = known.map((c) => { const t = tools.find((x) => x.name === c.name)!; const parsed = t.input.safeParse(c.input); return { id: c.id, name: c.name, input: c.input, summary: parsed.success ? t.summarize(parsed.data) : `use ${c.name}` }; });
      if (writes.length) {
        // Stage the first write for confirmation; the others are dropped so nothing runs unasked.
        const w = writes[0]!;
        const t = tools.find((x) => x.name === w.name)!;
        const parsed = t.input.safeParse(w.input);
        if (!parsed.success) { await this.assistant(db, ctx, conversationId, `I could not work out the details for that: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}. Can you rephrase?`, calls.filter((c) => c.id !== w.id), results); break; }
        const pending: contracts.AiPendingAction = { toolUseId: w.id, name: w.name, input: parsed.data, summary: t.summarize(parsed.data), status: 'pending', resultSummary: null, link: null, decidedAt: null };
        const text = reply.text || `I'm ready to ${pending.summary}. Confirm and I'll do it.`;
        await this.assistant(db, ctx, conversationId, text, calls.filter((c) => c.id === w.id || reads.some((r) => r.id === c.id)), results, pending);
        break;
      }
      if (!reads.length) { await this.assistant(db, ctx, conversationId, reply.text || 'I did not find anything to say about that.'); break; }
      const msg = await this.assistant(db, ctx, conversationId, reply.text, calls, results);
      history = [...history, toLlm(msg)];
      if (round === MAX_TOOL_ROUNDS - 1) await this.assistant(db, ctx, conversationId, results!.map((r) => r.summary).join('\n\n'));
    }
    await db.update(aiConversations).set({ lastMessageAt: sql`now()`, updatedAt: sql`now()` }).where(eq(aiConversations.id, conversationId));
    return this.get(ctx, conversationId);
  }

  /** The person confirms (or cancels) a staged write action. */
  async confirm(ctx: RequestContext, conversationId: string, input: { messageId: string; approve: boolean }): Promise<contracts.AiConversation> {
    ctx.require('ai.use');
    const conv = await this.get(ctx, conversationId);
    const { db } = this.deps;
    const [msg] = await db.select().from(aiMessages).where(and(eq(aiMessages.id, input.messageId), eq(aiMessages.conversationId, conversationId))).limit(1);
    const pending = (msg?.pendingAction as contracts.AiPendingAction | null) ?? null;
    if (!msg || !pending || pending.status !== 'pending') throw AppError.conflict('There is nothing waiting for confirmation.');
    const tools = this.allowedTools(ctx);
    const existing = ((msg.toolResults as contracts.AiMessage['toolResults']) ?? []);
    if (!input.approve) {
      await db.update(aiMessages).set({ pendingAction: { ...pending, status: 'cancelled', decidedAt: new Date().toISOString() }, toolResults: [...existing, { toolUseId: pending.toolUseId, name: pending.name, ok: false, summary: 'Cancelled by the person.' }] }).where(eq(aiMessages.id, msg.id));
      await this.assistant(db, ctx, conversationId, 'Okay, I have not done that.');
      return this.get(ctx, conversationId);
    }
    const result = await this.runTool(ctx, tools, pending.toolUseId, pending.name, pending.input);
    await db.update(aiMessages).set({ pendingAction: { ...pending, status: result.ok ? 'confirmed' : 'failed', resultSummary: result.summary, link: result.link ?? null, decidedAt: new Date().toISOString() }, toolResults: [...existing, result] }).where(eq(aiMessages.id, msg.id));
    if (result.ok) await this.activity.record(db, { organizationId: ctx.organizationId, userId: ctx.userId, name: `${ctx.actorName} (via assistant)`, kind: 'ai' }, { projectId: (pending.input.projectId as string) ?? conv.projectId, verb: 'confirmed', objectType: 'ai_conversation', objectId: conversationId, objectLabel: pending.summary });
    let text = result.ok ? `Done. ${result.summary}` : `That didn't work: ${result.summary}`;
    if (this.provider.name !== 'rules') {
      try {
        const refreshed = await this.get(ctx, conversationId);
        const context = await this.context(ctx, conv);
        const reply = await this.provider.complete({ system: context.system, messages: (refreshed.messages ?? []).map(toLlm).slice(-HISTORY), tools, projects: context.projects, projectId: conv.projectId });
        if (reply.text) text = reply.text;
      } catch { /* keep the template */ }
    }
    await this.assistant(db, ctx, conversationId, text);
    return this.get(ctx, conversationId);
  }

  private async runTool(ctx: RequestContext, tools: ToolDef[], toolUseId: string, name: string, input: Record<string, unknown>): Promise<NonNullable<contracts.AiMessage['toolResults']>[number]> {
    const t = tools.find((x) => x.name === name);
    if (!t) return { toolUseId, name, ok: false, summary: `You don't have access to ${name}.` };
    const parsed = t.input.safeParse(input);
    if (!parsed.success) return { toolUseId, name, ok: false, summary: `Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` };
    try {
      const r = await t.run(ctx, parsed.data);
      return { toolUseId, name, ok: true, summary: r.summary, output: r.output, link: r.link ?? null };
    } catch (err) {
      const e = err as Error & { status?: number };
      this.deps.log.warn({ err: e.message, tool: name }, 'assistant tool failed');
      return { toolUseId, name, ok: false, summary: e.status && e.status < 500 ? e.message : `${name} failed.` };
    }
  }

  private async assistant(db: DbOrTx, ctx: RequestContext, conversationId: string, content: string, toolCalls: contracts.AiMessage['toolCalls'] = null, toolResults: contracts.AiMessage['toolResults'] = null, pendingAction: contracts.AiPendingAction | null = null): Promise<contracts.AiMessage> {
    const [row] = await db.insert(aiMessages).values({ organizationId: ctx.organizationId, conversationId, role: 'assistant', content, toolCalls: toolCalls?.length ? toolCalls : null, toolResults: toolResults?.length ? toolResults : null, pendingAction }).returning();
    return serializeMessage(row!);
  }

  private async context(ctx: RequestContext, conv: contracts.AiConversation) {
    const rows = await this.deps.db.select({ id: projects.id, number: projects.number, name: projects.name }).from(projects).where(and(eq(projects.organizationId, ctx.organizationId), sql`${projects.archivedAt} is null`)).orderBy(asc(projects.number)).limit(100);
    const visible = await ctx.visibleProjectIds(this.deps.db);
    const list = visible ? rows.filter((p) => visible.includes(p.id)) : rows;
    const [org] = await this.deps.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.organizationId)).limit(1);
    const system = [
      `You are the Buildline assistant for ${org?.name ?? 'a construction company'}, a residential construction management app.`,
      `You are talking to ${ctx.actorName} (${ctx.membership.roleName}). Today is ${new Date().toISOString().slice(0, 10)}.`,
      conv.projectId ? `This conversation is about project "${conv.projectName}" (id ${conv.projectId}); assume questions refer to it unless another project is named.` : '',
      `Projects they can see: ${list.map((p) => `${p.number} ${p.name} (id ${p.id})`).join('; ') || 'none'}.`,
      'Answer only from tool results; never invent numbers, dates or names. Use the tools for anything factual. Money is US dollars. Be concise and plain-spoken, like a helpful office manager. When you use a write tool the app asks the person to confirm before it runs, so do not claim it is done. If a tool is unavailable, say the person does not have access rather than guessing.',
    ].filter(Boolean).join('\n');
    return { system, projects: list };
  }
}

function toLlm(m: contracts.AiMessage): LlmMessage {
  return { role: m.role, content: m.content, toolCalls: m.toolCalls?.map((c) => ({ id: c.id, name: c.name, input: c.input })) ?? null, toolResults: m.toolResults ?? null };
}

export function serializeConversation(c: typeof aiConversations.$inferSelect, projectName: string | null): contracts.AiConversation {
  return { id: c.id, organizationId: c.organizationId, createdAt: c.createdAt, updatedAt: c.updatedAt, createdBy: c.createdBy, updatedBy: c.updatedBy, version: c.version, userId: c.userId, projectId: c.projectId, projectName, title: c.title, lastMessageAt: c.lastMessageAt };
}
export function serializeMessage(m: typeof aiMessages.$inferSelect): contracts.AiMessage {
  return { id: m.id, conversationId: m.conversationId, role: m.role as 'user' | 'assistant', content: m.content, toolCalls: (m.toolCalls as contracts.AiMessage['toolCalls']) ?? null, toolResults: (m.toolResults as contracts.AiMessage['toolResults']) ?? null, pendingAction: (m.pendingAction as contracts.AiPendingAction | null) ?? null, createdAt: m.createdAt };
}
