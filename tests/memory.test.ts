import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Store } from '../server/db';
import { Memories, memorySchema } from '../server/memory';
import { Runtime, type TaskRow } from '../server/runtime';
import { Vault } from '../server/security';
import type { Memory, Message } from '../shared/types';

function fixture() {
  const dir = mkdtempSync(resolve(tmpdir(), 'mesh-memory-')),
    store = new Store(resolve(dir, 'memory.db')),
    memories = new Memories(store);
  store.put('projects', { id: 'project', name: '研究', instructions: '' });
  store.put('conversations', {
    id: 'chat',
    assistantId: 'general',
    projectId: 'project',
    title: '长期偏好',
  });
  store.put('conversations', {
    id: 'private',
    assistantId: 'writer',
    projectId: 'project',
    title: '写作私有',
  });
  store.put('messages', {
    id: 'msg',
    conversationId: 'chat',
    role: 'user',
    status: 'completed',
    content: '我希望回答先给结论，再提供必要依据。',
    createdAt: '2026-10-09T00:00:00Z',
  });
  store.put('messages', {
    id: 'secret-msg',
    conversationId: 'private',
    role: 'user',
    status: 'completed',
    content: '私有标记',
    createdAt: '2026-10-09T00:00:00Z',
  });
  return {
    dir,
    store,
    memories,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const input = (extra: Record<string, unknown> = {}) =>
  memorySchema.parse({
    assistantId: 'general',
    projectId: 'project',
    content: '回答先给结论',
    reason: '用户表达了长期偏好',
    sources: [{ type: 'message', id: 'msg', excerpt: '我希望回答先给结论' }],
    status: 'candidate',
    ...extra,
  });

test('memory candidate confirmation, correction, revision conflicts and revoke preserve provenance', () => {
  const f = fixture();
  try {
    const candidate = f.memories.create(input());
    assert.equal(f.memories.list('general', 'project', '结论', true).length, 0);
    assert.ok(!f.memories.context('general', 'project').includes('回答先给结论'));
    assert.equal(f.memories.create(input()).id, candidate.id);
    const confirmed = f.memories.action(candidate.id, 'confirm', {
      revision: 1,
      reason: '确认原文无误',
    });
    assert.equal(confirmed.status, 'active');
    assert.equal(confirmed.revision, 2);
    assert.match(f.memories.context('general', 'project'), /回答先给结论/);
    assert.throws(
      () =>
        f.memories.correct(candidate.id, {
          revision: 1,
          content: '回答更详细',
          reason: '更正',
          sources: [{ type: 'manual' }],
        }),
      /刷新/,
    );
    const corrected = f.memories.correct(candidate.id, {
      revision: 2,
      content: '回答更详细',
      reason: '偏好发生变化',
      sources: [{ type: 'manual' }],
    });
    assert.equal(corrected.sources![0].title, '用户声明');
    assert.equal(corrected.history![0].sources[0].id, 'msg');
    assert.ok(!f.memories.context('general', 'project').includes('回答先给结论'));
    assert.match(f.memories.context('general', 'project'), /回答更详细/);
    f.memories.action(candidate.id, 'revoke', { revision: 3, reason: '不再沿用' });
    assert.deepEqual(f.memories.list('general', 'project', '回答', true), []);
    assert.ok(!f.memories.context('general', 'project').includes('回答更详细'));
    assert.equal(f.memories.create(input({ content: '回答更详细' })).status, 'revoked');
    assert.throws(
      () => f.memories.action(candidate.id, 'confirm', { revision: 4, reason: '确认' }),
      /只有/,
    );
  } finally {
    f.close();
  }
});

test('source scope, exact evidence, source changes/deletion and expiration invalidate memory durably', () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.memories.create(
          input({ sources: [{ type: 'message', id: 'secret-msg', excerpt: '私有标记' }] }),
        ),
      /不属于/,
    );
    assert.throws(
      () =>
        f.memories.create(
          input({ sources: [{ type: 'message', id: 'msg', excerpt: '虚构摘录' }] }),
        ),
      /原文/,
    );
    assert.throws(
      () =>
        f.memories.create(
          input({
            projectId: '',
            sources: [{ type: 'message', id: 'msg', excerpt: '我希望回答先给结论' }],
          }),
        ),
      /不属于/,
    );
    const m = f.memories.create(input({ status: 'active' }));
    const original = f.store.get<Message>('messages', 'msg')!;
    f.store.put('messages', { ...original, content: '我希望回答更详细。' });
    const invalid = f.memories.list('general', 'project')[0];
    assert.equal(invalid.status, 'stale');
    assert.equal(invalid.revision, 2);
    assert.equal(invalid.history!.at(-1)!.action, 'invalidated');
    f.store.put('messages', original);
    assert.equal(f.memories.list('general', 'project')[0].status, 'stale');
    assert.ok(!f.memories.context('general', 'project').includes('回答先给结论'));
    f.memories.correct(m.id, {
      revision: 2,
      content: '重新确认先给结论',
      reason: '重新核对',
      sources: [{ type: 'message', id: 'msg', excerpt: '我希望回答先给结论' }],
    });
    f.store.delete('messages', 'msg');
    assert.equal(f.memories.list('general', 'project')[0].status, 'stale');
    const expired = f.memories.create(
      input({ content: '临时偏好', sources: [{ type: 'manual' }], status: 'active' }),
    );
    f.store.put('memories', { ...expired, expiresAt: '2000-01-01T00:00:00Z' });
    assert.equal(
      f.memories.list('general', 'project').find((x) => x.id === expired.id)!.status,
      'stale',
    );
    assert.equal(f.memories.list('writer', 'project', '', true).length, 0);
    assert.equal(f.memories.list('general', '', '', true).length, 0);
  } finally {
    f.close();
  }
});

test('runtime history tools stay scoped and live memory replaces stale configuration snapshots', async () => {
  const f = fixture();
  try {
    const runtime = new Runtime(f.store, new Vault(f.dir));
    const t = {
      id: 'task',
      assistantId: 'general',
      projectId: 'project',
      parentId: '',
      conversationId: 'chat',
      allowedFiles: [],
      config: {
        system: '工作要求\n\n用户为此助手在当前空间保存的偏好：\n旧偏好唯一标记\n\n工作方式：对话',
        tools: true,
      },
    } as unknown as TaskRow;
    const invoke = (name: string, args: unknown, id = name) =>
      runtime.tool(t, { id, name, arguments: JSON.stringify(args) }, new AbortController().signal);
    const historical = JSON.parse(await invoke('search_history', { query: '结论' }));
    assert.equal(historical[0].id, 'msg');
    assert.deepEqual(JSON.parse(await invoke('search_history', { query: '私有标记' })), []);
    await assert.rejects(
      invoke('propose_memory', {
        content: '私有内容',
        reason: '测试',
        source_type: 'message',
        source_id: 'secret-msg',
        excerpt: '私有标记',
      }),
      /不属于/,
    );
    const proposal = {
      content: '回答先给结论',
      reason: '长期偏好',
      source_type: 'message',
      source_id: 'msg',
      excerpt: '我希望回答先给结论',
    };
    const candidate = JSON.parse(await invoke('propose_memory', proposal, 'proposal'));
    assert.equal(candidate.status, 'candidate');
    assert.deepEqual(JSON.parse(await invoke('search_memory', { query: '结论' })), []);
    assert.equal(JSON.parse(await invoke('propose_memory', proposal, 'proposal')).id, candidate.id);
    f.memories.action(candidate.id, 'confirm', { revision: 1, reason: '用户确认' });
    assert.equal(JSON.parse(await invoke('search_memory', { query: '结论' })).length, 1);
    assert.ok(!runtime.memorySystem(t).includes('旧偏好唯一标记'));
    assert.match(runtime.memorySystem(t), /回答先给结论/);
    f.memories.correct(candidate.id, {
      revision: 2,
      content: '新版偏好',
      reason: '纠错',
      sources: [{ type: 'manual' }],
    });
    assert.ok(!runtime.memorySystem(t).includes('回答先给结论'));
    assert.match(runtime.memorySystem(t), /新版偏好/);
    f.memories.action(candidate.id, 'revoke', { revision: 3, reason: '撤销' });
    assert.ok(!runtime.memorySystem(t).includes('新版偏好'));
    assert.equal(f.store.all<Memory>('memories').length, 1);
  } finally {
    f.close();
  }
});

test('file and webpage evidence retain scope and invalidate when original content changes', () => {
  const f = fixture();
  try {
    f.store.put('files', {
      id: 'file',
      projectId: 'project',
      taskId: '',
      conversationId: '',
      name: '要求.md',
      content: '版本一：先给结论。',
    });
    const file = f.memories.create(
      input({
        content: '文件版本一',
        status: 'active',
        sources: [{ type: 'file', id: 'file', excerpt: '版本一：先给结论。' }],
      }),
    );
    assert.equal(file.sources![0].title, '要求.md');
    f.store.put('files', { ...f.store.get<any>('files', 'file'), content: '版本二：先给背景。' });
    assert.equal(
      f.memories.list('general', 'project').find((m) => m.id === file.id)!.status,
      'stale',
    );
    f.store.put('tasks', { id: 'webtask', assistantId: 'general', projectId: 'project' });
    f.store.put('sources', {
      id: 'websource',
      taskId: 'webtask',
      conversationId: 'chat',
      title: '文章',
      url: 'https://example.com',
      snippet: '摘要中的事实',
      content: '',
      read: false,
    });
    const web = f.memories.create(
      input({
        content: '摘要事实',
        sources: [{ type: 'web', id: 'websource', excerpt: '摘要中的事实' }],
      }),
    );
    assert.match(web.sources![0].title, /搜索摘要/);
    f.store.put('sources', {
      ...f.store.get<any>('sources', 'websource'),
      read: true,
      content: '已读取的文章正文',
    });
    assert.equal(
      f.memories.list('general', 'project').find((m) => m.id === web.id)!.status,
      'stale',
    );
    assert.throws(
      () => f.memories.action(web.id, 'confirm', { revision: 2, reason: '未经重新检查' }),
      /有效的候选/,
    );
    f.store.put('memories', {
      id: 'legacy',
      assistantId: 'general',
      projectId: 'project',
      content: '历史偏好',
      createdAt: '2026-10-09T00:00:00Z',
    });
    const corrected = f.memories.correct('legacy', {
      revision: 1,
      content: '新偏好',
      reason: '纠错',
      sources: [{ type: 'manual' }],
    });
    assert.equal(corrected.history![0].content, '历史偏好');
    assert.equal(corrected.history![0].sources[0].type, 'legacy');
  } finally {
    f.close();
  }
});
