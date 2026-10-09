import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { Assistant, Conversation, FileRecord, Task, ExecutionRecord } from '../shared/types';
import { createApp } from '../server/app';
import { Store } from '../server/db';
import { Vault, isPrivateAddress, validateEndpoint, secureFetch } from '../server/security';
import { type TaskRow } from '../server/runtime';
import { mockProvider } from './mock-provider';
const wait = async (check: () => boolean | Promise<boolean>, timeout = 12000) => {
  const at = Date.now();
  while (!(await check())) {
    if (Date.now() - at > timeout) throw Error('wait timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
};

test('full API: credentials, project isolation, agent collaboration, recovery and artifacts', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'expertmesh-test-')),
    mock = await mockProvider();
  let store = new Store(resolve(dir, 'test.db')),
    vault = new Vault(dir),
    service = createApp(store, vault),
    server: Server;
  const listen = async () => {
    server = service.app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    return `http://127.0.0.1:${(server.address() as any).port}/api`;
  };
  let base = await listen();
  const send = async (path: string, body?: unknown, method = body ? 'POST' : 'GET') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = (await r.json()) as any;
    return { status: r.status, value };
  };
  const stop = async () => {
    await service.runtime.shutdown();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  };
  try {
    const rejected = await send('/connections', {
      provider: 'compatible',
      name: 'local',
      baseUrl: mock.url,
      apiKey: 'secret',
      models: [{ id: 'fixture-model', name: 'Fixture', tools: true }],
    });
    assert.equal(rejected.status, 400);
    assert.match(rejected.value.error, /本地/);
    const connection = (
      await send('/connections', {
        provider: 'compatible',
        name: 'Fixture',
        baseUrl: mock.url,
        apiKey: 'never-expose-key',
        allowLocal: true,
        models: [{ id: 'fixture-model', name: 'Fixture', tools: true }],
      })
    ).value;
    assert.equal(connection.hasKey, true);
    assert.equal(connection.encryptedKey, undefined);
    assert.ok(
      !JSON.stringify(store.get('connections', connection.id)).includes('never-expose-key'),
    );
    const discovered = await send('/connections/' + connection.id + '/test', {});
    assert.equal(discovered.status, 200, JSON.stringify(discovered.value));
    assert.deepEqual(discovered.value.models, ['fixture-model', 'fixture-text']);
    const previewInput = { provider: 'compatible', baseUrl: mock.url, allowLocal: true };
    const preview = await send('/connections/discover', { ...previewInput, apiKey: 'preview-key' });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.value.models, ['fixture-model', 'fixture-text']);
    assert.equal(store.all('connections').length, 1);
    assert.ok(!JSON.stringify(preview.value).includes('preview-key'));
    const savedPreview = await send('/connections/discover', {
      ...previewInput,
      connectionId: connection.id,
    });
    assert.equal(savedPreview.status, 200);
    const changedEndpoint = await send('/connections/discover', {
      ...previewInput,
      baseUrl: mock.url + '/other',
      connectionId: connection.id,
    });
    assert.equal(changedEndpoint.status, 400);
    assert.match(changedEndpoint.value.error, /重新填写/);
    assert.equal((await send('/connections/discover', previewInput)).status, 400);
    const dnsResponse = await secureFetch(
      mock.url.replace('127.0.0.1', 'localhost') + '/models',
      {},
      true,
    );
    assert.equal(dnsResponse.status, 200);
    await dnsResponse.text();
    const p = (await send('/projects', { name: '研究', instructions: '使用当前项目资料' })).value,
      p2 = (await send('/projects', { name: '隔离项目' })).value;
    const upload = async (projectId: string, name: string, content: string) => {
      const form = new FormData();
      form.append('projectId', projectId);
      form.append('files', new Blob([content]), name);
      const r = await fetch(base + '/files', { method: 'POST', body: form });
      assert.equal(r.status, 201);
      return ((await r.json()) as FileRecord[])[0];
    };
    const own = await upload(p.id, '资料.md', '# 项目资料\n用户提供的内容'),
      other = await upload(p2.id, 'secret.txt', '其他项目内容');
    const convo = (await send('/conversations', { projectId: p.id, assistantId: 'general' }))
      .value as Conversation;
    const payload = {
      content: '请整理资料',
      connectionId: connection.id,
      modelId: 'fixture-model',
      mode: 'task',
      fileIds: [own.id],
    };
    assert.equal(
      (await send('/conversations/' + convo.id + '/messages', { ...payload, fileIds: [other.id] }))
        .status,
      400,
    );
    const task = (await send('/conversations/' + convo.id + '/messages', payload)).value as Task;
    await wait(() => store.get<TaskRow>('tasks', task.id)?.status === 'completed');
    const result = (await send('/conversations/' + convo.id)).value;
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[1].status, 'completed');
    assert.ok(result.files.length >= 2);
    assert.ok(mock.requests.some((b) => JSON.stringify(b.messages).includes('用户提供的内容')));
    assert.ok(!mock.requests.some((b) => JSON.stringify(b.messages).includes('其他项目内容')));
    assert.equal(result.tasks[0].config, undefined);
    assert.ok(!JSON.stringify(result).includes('never-expose-key'));
    const fork = (
      await send('/conversations/' + convo.id + '/fork', { beforeMessageId: result.messages[0].id })
    ).value;
    assert.notEqual(fork.id, convo.id);
    assert.equal((await send('/conversations/' + convo.id)).value.messages.length, 2);
    assert.equal((await send('/conversations/' + fork.id)).value.messages.length, 0);
    const exported = await fetch(base + '/export').then((r) => r.text());
    assert.ok(!exported.includes('never-expose-key'));
    assert.ok(!exported.includes('encryptedKey'));
    const candidateApi = (
      await send('/memories', {
        assistantId: 'general',
        projectId: p.id,
        content: '待确认资料偏好',
        status: 'candidate',
        reason: '用户资料为依据',
        sources: [{ type: 'message', id: result.messages[0].id, excerpt: '请整理资料' }],
      })
    ).value;
    assert.equal(candidateApi.status, 'candidate');
    assert.equal(
      (
        await send('/memories', {
          assistantId: 'writer',
          projectId: p.id,
          content: '越权来源',
          sources: [{ type: 'message', id: result.messages[0].id, excerpt: '请整理资料' }],
        })
      ).status,
      400,
    );
    assert.equal(
      (await send('/memories/' + candidateApi.id + '/confirm', { revision: 1, reason: '核对原文' }))
        .value.status,
      'active',
    );
    assert.equal(
      (
        await send(
          '/memories/' + candidateApi.id,
          { revision: 1, content: '错误覆盖', reason: '旧页面', sources: [{ type: 'manual' }] },
          'PUT',
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await send(
          '/memories/' + candidateApi.id,
          {
            revision: 2,
            content: '更正后的偏好',
            reason: '明确更正',
            sources: [{ type: 'manual' }],
          },
          'PUT',
        )
      ).value.revision,
      3,
    );
    assert.equal(
      (await send('/memories/' + candidateApi.id + '/revoke', { revision: 3, reason: '不再使用' }))
        .value.status,
      'revoked',
    );
    // Child identity and project-specific memory do not inherit another assistant's private notes.
    await send('/memories', {
      assistantId: 'researcher',
      projectId: p.id,
      content: '研究偏好唯一标记',
    });
    await send('/memories', { assistantId: 'writer', projectId: p.id, content: '写作私有标记' });
    const collaboration = (await send('/conversations', { projectId: p.id })).value;
    const delegated = (
      await send('/conversations/' + collaboration.id + '/messages', {
        ...payload,
        content: '请协作整理资料',
        fileIds: [],
      })
    ).value;
    await wait(() => store.get<TaskRow>('tasks', delegated.id)?.status === 'completed');
    const children = store.all<TaskRow>('tasks').filter((t) => t.parentId === delegated.id);
    assert.equal(children.length, 1);
    assert.equal(children[0].assistantId, 'researcher');
    assert.equal(children[0].contract?.deliverable, '简明资料摘要');
    assert.deepEqual(children[0].contract?.fileIds, []);
    assert.equal(children[0].review?.decision, 'adopted');
    assert.equal(children[0].review?.checks.length, children[0].contract?.criteria.length);
    assert.ok(
      !service.runtime
        .available(children[0])
        .some((x) => ['delegate_task', 'review_task'].includes(x.name)),
    );
    assert.ok(!service.runtime.files(children[0]).some((f) => f.id === own.id));
    const parent = store.get<TaskRow>('tasks', delegated.id)!;
    const invoke = (name: string, args: unknown) =>
      service.runtime.tool(
        parent,
        { id: 'invalid-contract', name, arguments: JSON.stringify(args) },
        new AbortController().signal,
      );
    await assert.rejects(
      invoke('delegate_task', { assistant_id: 'researcher', goal: '缺少契约' }),
      /契约不完整/,
    );
    const contractArgs = {
      assistant_id: 'researcher',
      goal: '独立工作',
      input: '输入说明',
      file_ids: [other.id],
      deliverable: '摘要',
      criteria: ['有证据'],
      dependencies: [],
    };
    await assert.rejects(invoke('delegate_task', contractArgs), /文件/);
    await assert.rejects(
      invoke('delegate_task', { ...contractArgs, file_ids: [], dependencies: ['unrelated'] }),
      /依赖/,
    );
    await assert.rejects(
      invoke('review_task', {
        task_id: children[0].id,
        decision: 'adopted',
        reason: '测试',
        checks: [{ index: 1, passed: true, evidence: '错误索引' }],
      }),
      /每条验收/,
    );
    await assert.rejects(
      invoke('review_task', {
        task_id: children[0].id,
        decision: 'adopted',
        reason: '测试',
        checks: [{ index: 0, passed: false, evidence: '不满足' }],
      }),
      /不能采用/,
    );
    const execution = (await send('/tasks/' + delegated.id)).value.records as ExecutionRecord[];
    assert.ok(execution.some((r) => r.taskId === children[0].id && r.kind === 'model'));
    const sharedBudget = store.get<TaskRow>('tasks', delegated.id)!.budget!;
    assert.equal(sharedBudget.modelCalls, execution.filter((r) => r.kind === 'model').length);
    assert.equal(children[0].budget, undefined);
    assert.ok(execution.some((r) => r.name === 'review_task' && r.status === 'succeeded'));
    assert.ok(
      execution.every(
        (r) => r.status === 'succeeded' && r.durationMs !== null && r.costUsd === null,
      ),
    );
    assert.ok(
      execution
        .filter((r) => r.kind === 'model')
        .every((r) => r.usage?.input === 100 && r.usage.output === 20),
    );
    assert.ok(
      mock.requests.filter((r) => r.messages).every((r) => r.stream_options?.include_usage),
    );

    assert.ok(service.runtime.memorySystem(children[0]).includes('研究偏好唯一标记'));
    assert.ok(!service.runtime.memorySystem(children[0]).includes('写作私有标记'));
    // Opt-in web tools are inherited by children; saved sources contain no credentials.
    const searchSettings = {
      provider: 'tavily',
      baseUrl: mock.url.replace('/v1', ''),
      apiKey: 'search-secret',
      allowLocal: true,
      enabled: true,
    };
    assert.equal((await send('/settings/search', searchSettings, 'PUT')).status, 200);
    const publicSettings = (await send('/bootstrap')).value.search;
    assert.equal(publicSettings.hasKey, true);
    assert.ok(!JSON.stringify(publicSettings).includes('secret'));
    const webConvo = (await send('/conversations', {})).value;
    const webTask = (
      await send('/conversations/' + webConvo.id + '/messages', {
        ...payload,
        content: '联网协作搜索资料',
        fileIds: [],
        web: true,
      })
    ).value;
    await wait(() => store.get<TaskRow>('tasks', webTask.id)?.status === 'completed');
    const webResult = (await send('/conversations/' + webConvo.id)).value;
    assert.equal(webResult.sources.length, 2);
    assert.ok(webResult.sources.every((s: any) => !s.read && s.content === undefined));
    assert.match(webResult.messages[1].content, /https:\/\/example.com\/research/);
    assert.ok(!JSON.stringify(webResult).includes('search-secret'));
    const searchesBefore = mock.requests.filter((r) => r.search).length;
    const offline = (await send('/conversations', {})).value;
    const offlineTask = (
      await send('/conversations/' + offline.id + '/messages', {
        ...payload,
        content: '联网搜索资料',
        fileIds: [],
        web: false,
      })
    ).value;
    await wait(() => store.get<TaskRow>('tasks', offlineTask.id)?.status === 'completed');
    assert.equal(mock.requests.filter((r) => r.search).length, searchesBefore);
    assert.deepEqual((await send('/conversations/' + offline.id)).value.sources, []);
    const root = store.get<TaskRow>('tasks', webTask.id)!;
    const unrelated = { ...store.get<TaskRow>('tasks', offlineTask.id)!, config: root.config };
    await assert.rejects(
      service.runtime.tool(
        unrelated,
        {
          id: 'forbidden-source',
          name: 'read_webpage',
          arguments: JSON.stringify({ source_id: webResult.sources[0].id }),
        },
        new AbortController().signal,
      ),
      /不属于当前任务/,
    );
    // Children and root share a budget, including unsuccessful attempts.
    for (let i = 0; i < 6; i++)
      await service.runtime.tool(
        root,
        {
          id: 'budget-' + i,
          name: 'search_web',
          arguments: '{"query":"empty"}',
        },
        new AbortController().signal,
      );
    await assert.rejects(
      service.runtime.tool(
        root,
        {
          id: 'budget-exceeded',
          name: 'search_web',
          arguments: '{"query":"empty"}',
        },
        new AbortController().signal,
      ),
      /8 次/,
    );
    assert.ok(!(await fetch(base + '/export').then((r) => r.text())).includes('search-secret'));
    await send('/conversations/' + webConvo.id, undefined, 'DELETE');
    assert.ok(!store.all<any>('sources').some((s) => s.conversationId === webConvo.id));
    // Pause after file creation, then reopen the database and continue without duplicate writes.
    const slow = (await send('/conversations', {})).value;
    const slowTask = (
      await send('/conversations/' + slow.id + '/messages', {
        ...payload,
        content: '慢任务，请生成文件',
        fileIds: [],
      })
    ).value;
    await wait(() => store.all<FileRecord>('files').some((f) => f.taskId === slowTask.id));
    await wait(() => !!store.get<TaskRow>('tasks', slowTask.id)?.result);
    assert.equal((await send('/tasks/' + slowTask.id + '/pause', {})).status, 200);
    await wait(() => !service.runtime.controllers.has(slowTask.id));
    const before = store
      .all<FileRecord>('files')
      .filter((f) => f.taskId === slowTask.id)
      .map((f) => f.id);
    await stop();
    store = new Store(resolve(dir, 'test.db'));
    vault = new Vault(dir);
    service = createApp(store, vault);
    base = await listen();
    assert.equal(store.get<TaskRow>('tasks', slowTask.id)?.status, 'paused');
    assert.equal((await send('/tasks/' + slowTask.id + '/resume', {})).status, 200);
    await wait(() => store.get<TaskRow>('tasks', slowTask.id)?.status === 'completed');
    const after = store
      .all<FileRecord>('files')
      .filter((f) => f.taskId === slowTask.id)
      .map((f) => f.id);
    assert.ok(before.every((id) => after.includes(id)));
    assert.equal(after.filter((id) => id.endsWith('write-1')).length, 1);
    const resumedRecords = (await send('/tasks/' + slowTask.id)).value.records as ExecutionRecord[];
    assert.ok(resumedRecords.some((r) => r.kind === 'model' && r.status === 'interrupted'));
    assert.equal(resumedRecords.filter((r) => r.name === 'write_artifact' && !r.cached).length, 1);
    assert.ok(resumedRecords.filter((r) => r.kind === 'execution').length >= 2);

    const failure = (await send('/conversations', {})).value;
    const failing = (
      await send('/conversations/' + failure.id + '/messages', {
        ...payload,
        content: '认证失败',
        fileIds: [],
      })
    ).value;
    await wait(() => store.get<TaskRow>('tasks', failing.id)?.status === 'failed');
    assert.match(store.get<TaskRow>('tasks', failing.id)!.error, /认证失败/);
    assert.ok(!store.get<TaskRow>('tasks', failing.id)!.error.includes('secret'));
    const next = (
      await send('/conversations/' + failure.id + '/messages', {
        ...payload,
        content: '慢任务',
        fileIds: [],
      })
    ).value;
    assert.equal((await send('/tasks/' + failing.id + '/resume', {})).status, 400);
    await send('/tasks/' + next.id + '/cancel', {});
    await wait(() => !service.runtime.controllers.has(next.id));
    assert.equal(store.get<TaskRow>('tasks', next.id)?.status, 'cancelled');
    const csrf = await fetch(base + '/projects', {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
      body: '{"name":"attack"}',
    });
    assert.equal(csrf.status, 403);
    assert.ok(!readFileSync(resolve(dir, 'test.db')).includes(Buffer.from('never-expose-key')));
    assert.equal((await send('/conversations/' + convo.id, undefined, 'DELETE')).status, 200);
    assert.ok(!store.all<TaskRow>('tasks').some((t) => t.conversationId === convo.id));
    assert.ok(!store.all<ExecutionRecord>('records').some((r) => r.taskId === task.id));
    assert.ok(store.get('files', own.id));
  } finally {
    await stop();
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('private endpoint classification includes mapped IPv6 and local opt-in', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.1.1',
    '192.168.1.2',
    '169.254.169.254',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ])
    assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  await assert.rejects(validateEndpoint('http://127.0.0.1:1234', false));
  assert.equal(await validateEndpoint('http://127.0.0.1:1234', true), 'http://127.0.0.1:1234');
  await assert.rejects(validateEndpoint('https://user:secret@example.com', false));
});
