import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createProject, createTestApp, inviteMember, registerOrg, type Actor, type TestApp } from './helpers.js';
import { toAnthropicMessages } from '../src/ai/provider.js';

let app: TestApp;
let owner: Actor;
beforeAll(async () => { app = await createTestApp(); owner = await registerOrg(app, { org: 'Assistant Co' }); });
afterAll(async () => { await app.close(); });

describe('AI assistant (rule-based provider, no network)', () => {
  it('answers questions from tools, stages write actions for confirmation, and respects permissions', async () => {
    const c = api(app, owner);
    const project = await createProject(app, owner, { name: 'Lakeside Cabin' });
    await c.post(`/v1/projects/${project.id}/tasks`, { kind: 'todo', name: 'Order windows', dueDate: '2020-01-01' });
    const status = await c.get('/v1/ai/status');
    expect(status.status).toBe(200);
    expect(status.body.provider).toBe('rules');
    expect(status.body.tools.map((t: any) => t.name)).toContain('create_task');

    // A question that needs a tool: the answer is built from real data, and the tool call is recorded.
    const conv = await c.post('/v1/ai/conversations', { message: "What's overdue on Lakeside Cabin?" });
    expect(conv.status).toBe(201);
    const msgs = conv.body.messages;
    expect(msgs[0].role).toBe('user');
    const withTool = msgs.find((m: any) => m.toolCalls?.length);
    expect(withTool.toolCalls[0].name).toBe('overdue_tasks');
    expect(withTool.toolResults[0].ok).toBe(true);
    const answer = msgs[msgs.length - 1];
    expect(answer.role).toBe('assistant');
    expect(answer.content).toContain('Order windows');
    expect(conv.body.title).toContain('overdue');

    // Budget questions resolve the project by name.
    const b = await c.post(`/v1/ai/conversations/${conv.body.id}/messages`, { content: 'How is the Lakeside budget looking?' });
    expect(b.body.messages[b.body.messages.length - 1].content).toMatch(/no budget yet|revised budget/);

    // Write actions are staged, not run, until confirmed.
    const w = await c.post(`/v1/ai/conversations/${conv.body.id}/messages`, { content: 'Create a to-do "Call the inspector" on Lakeside Cabin due tomorrow' });
    const staged = w.body.messages[w.body.messages.length - 1];
    expect(staged.pendingAction).toMatchObject({ name: 'create_task', status: 'pending' });
    expect(staged.pendingAction.input.name).toBe('Call the inspector');
    expect(staged.pendingAction.input.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await c.get(`/v1/projects/${project.id}/tasks?status=open`)).body.items.map((t: any) => t.name)).not.toContain('Call the inspector');
    const confirmed = await c.post(`/v1/ai/conversations/${conv.body.id}/confirm`, { messageId: staged.id, approve: true });
    expect(confirmed.status).toBe(200);
    const done = confirmed.body.messages.find((m: any) => m.id === staged.id);
    expect(done.pendingAction.status).toBe('confirmed');
    expect(done.pendingAction.link).toContain('/tasks/');
    expect(confirmed.body.messages[confirmed.body.messages.length - 1].content).toMatch(/^Done\./);
    expect((await c.get(`/v1/projects/${project.id}/tasks?status=open`)).body.items.map((t: any) => t.name)).toContain('Call the inspector');
    expect((await c.post(`/v1/ai/conversations/${conv.body.id}/confirm`, { messageId: staged.id, approve: true })).status).toBe(409);
    // Cancelling leaves nothing behind.
    const w2 = await c.post(`/v1/ai/conversations/${conv.body.id}/messages`, { content: 'Add a task "Do not create me" on Lakeside' });
    const staged2 = w2.body.messages[w2.body.messages.length - 1];
    const cancelled = await c.post(`/v1/ai/conversations/${conv.body.id}/confirm`, { messageId: staged2.id, approve: false });
    expect(cancelled.body.messages.find((m: any) => m.id === staged2.id).pendingAction.status).toBe('cancelled');
    expect((await c.get(`/v1/projects/${project.id}/tasks?status=open`)).body.items.map((t: any) => t.name)).not.toContain('Do not create me');
    // The activity log shows the assistant acted on the person's behalf.
    const activity = await c.get(`/v1/projects/${project.id}/activity`);
    expect(activity.body.items.some((a: any) => a.actorKind === 'ai' && a.summary.includes('Call the inspector'))).toBe(true);

    // Field crew cannot see budgets, so the assistant says so instead of leaking.
    const crew = await inviteMember(app, owner, 'field_crew', { projectIds: [project.id] });
    const j = api(app, crew);
    expect((await j.get('/v1/ai/status')).body.tools.map((t: any) => t.name)).not.toContain('budget_status');
    const denied = await j.post('/v1/ai/conversations', { message: 'How is the Lakeside budget?' });
    expect(denied.body.messages[denied.body.messages.length - 1].content).toMatch(/don't have access/);
    // Conversations are private to their owner.
    expect((await j.get(`/v1/ai/conversations/${conv.body.id}`)).status).toBe(404);
    expect((await c.get('/v1/ai/conversations')).body).toHaveLength(1);
    expect((await j.get('/v1/ai/conversations')).body).toHaveLength(1);
  });

  it('converts stored messages into the Anthropic tool-use format', () => {
    const out = toAnthropicMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Let me check.', toolCalls: [{ id: 't1', name: 'overdue_tasks', input: {} }], toolResults: [{ toolUseId: 't1', name: 'overdue_tasks', ok: true, summary: 'Nothing is overdue.', output: [] }] },
      { role: 'assistant', content: 'Nothing is overdue.' },
      { role: 'user', content: 'thanks' },
    ]);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect((out[1]!.content as any[]).some((b) => b.type === 'tool_use' && b.id === 't1')).toBe(true);
    expect((out[2]!.content as any[])[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
  });
});
