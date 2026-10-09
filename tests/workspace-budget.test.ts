import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Store } from '../server/db';
import { Vault } from '../server/security';
import { Budgets, defaultBudget } from '../server/budget';
import { Workspaces } from '../server/workspaces';
import { Memories, memorySchema } from '../server/memory';
import { Runtime, type TaskRow } from '../server/runtime';
import { mockProvider } from './mock-provider';

test('workspace paths, grants, symlinks and source changes are enforced', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mesh-workspace-')),
    root = resolve(dir, 'project'),
    outside = resolve(dir, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(resolve(root, 'notes.md'), '研究依据\n稳定事实');
  writeFileSync(resolve(root, '.env'), 'SECRET');
  writeFileSync(resolve(outside, 'private.md'), 'private');
  const store = new Store(resolve(dir, 'db')),
    workspaces = new Workspaces(store),
    memories = new Memories(store);
  try {
    const w = workspaces.create({ name: '研究', path: root });
    assert.throws(() => workspaces.read(w.id, 'notes.md', 'general', ''), /未获准/);
    workspaces.grant(w.id, 'general', '', true);
    assert.equal(workspaces.read(w.id, 'notes.md', 'general', '').content, '研究依据\n稳定事实');
    assert.throws(() => workspaces.read(w.id, '../outside/private.md', 'general', ''), /范围/);
    assert.throws(() => workspaces.read(w.id, '.env', 'general', ''), /保护/);
    assert.throws(() => workspaces.read(w.id, 'notes.md', 'researcher', ''), /未获准/);
    assert.equal(workspaces.search(w.id, '稳定', 'general', '')[0].line, 2);
    symlinkSync(
      outside,
      resolve(root, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.throws(() => workspaces.read(w.id, 'linked/private.md', 'general', ''), /符号链接/);
    assert.equal(workspaces.files(w.id, 'general', '').files.length, 1);
    const m = memories.create(
      memorySchema.parse({
        assistantId: 'general',
        content: '稳定事实',
        sources: [{ type: 'workspace', id: w.id + ':notes.md', excerpt: '稳定事实' }],
      }),
    );
    writeFileSync(resolve(root, 'notes.md'), '事实已变化');
    assert.equal(memories.view(m).status, 'stale');
    workspaces.grant(w.id, 'general', '', false);
    assert.throws(() => workspaces.read(w.id, 'notes.md', 'general', ''), /未获准/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('budget counters persist, unknown usage stays unknown and clock does not reset', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mesh-budget-')),
    store = new Store(resolve(dir, 'db')),
    b = new Budgets(store);
  try {
    b.create('root', { ...defaultBudget(), modelCalls: 1 });
    b.reserve('root', 'modelCalls');
    assert.throws(() => b.reserve('root', 'modelCalls'), /预算/);
    b.usage('root', undefined);
    b.usage('root', 15);
    assert.equal(b.get('root')!.unknownUsage, 1);
    assert.equal(b.get('root')!.knownTokens, 15);
    b.change('root', { ...defaultBudget(), modelCalls: 2 });
    b.reserve('root', 'modelCalls');
    assert.throws(() => b.change('root', { ...defaultBudget(), modelCalls: 1 }), /已经/);
    const clock = b.clock('root');
    await new Promise((r) => setTimeout(r, 30));
    clock.stop();
    const elapsed = b.get('root')!.elapsedMs;
    assert.ok(elapsed > 0);
    const again = b.clock('root');
    again.stop();
    assert.ok(b.get('root')!.elapsedMs >= elapsed);
    assert.throws(() => b.reserve('root', 'toolCalls', 2_000_000), /上下文/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime pauses at shared budget and records corrected memory versions on resume', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mesh-runtime-budget-')),
    store = new Store(resolve(dir, 'db')),
    vault = new Vault(dir),
    runtime = new Runtime(store, vault),
    provider = await mockProvider();
  const wait = async (check: () => boolean) => {
    const end = Date.now() + 15000;
    while (!check()) {
      if (Date.now() > end) throw Error('wait');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  try {
    const c = {
      id: 'c',
      title: '新对话',
      assistantId: 'general',
      projectId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.put('conversations', c);
    const m = new Memories(store).create(
      memorySchema.parse({ assistantId: 'general', content: '先给结论' }),
    );
    const task = runtime.create({
      conversation: c,
      assistant: store.get<any>('assistants', 'general')!,
      connection: {
        id: 'conn',
        provider: 'compatible',
        name: '测试',
        baseUrl: provider.url,
        allowLocal: true,
        hasKey: true,
        encryptedKey: vault.encrypt('test'),
        models: [{ id: 'fixture-model', name: '测试', tools: true }],
        createdAt: c.createdAt,
      },
      modelId: 'fixture-model',
      modelName: '测试',
      goal: '整理资料',
      mode: 'task',
      fileIds: [],
      budget: { ...defaultBudget(), modelCalls: 1 },
    });
    await wait(
      () =>
        store.get<TaskRow>('tasks', task.id)?.status === 'paused' &&
        !runtime.controllers.has(task.id),
    );
    assert.equal(new Budgets(store).get(task.id)!.modelCalls, 1);
    assert.equal(store.all<any>('records').find((r) => r.kind === 'model').memories[0].revision, 1);
    new Memories(store).correct(m.id, {
      revision: 1,
      content: '先给背景',
      reason: '更正',
      sources: [{ type: 'manual' }],
    });
    new Budgets(store).change(task.id, defaultBudget());
    await runtime.control(task.id, 'resume');
    await wait(() => store.get<TaskRow>('tasks', task.id)?.status === 'completed');
    const revisions = store
      .all<any>('records')
      .filter((r) => r.kind === 'model')
      .map((r) => r.memories[0].revision);
    assert.ok(revisions.includes(1));
    assert.ok(revisions.includes(2));
    assert.ok(new Budgets(store).get(task.id)!.modelCalls > 1);
  } finally {
    await runtime.shutdown();
    await provider.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
