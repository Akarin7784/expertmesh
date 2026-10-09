import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { basename, extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type {
  ExecutionRecord,
  Assistant,
  Connection,
  Conversation,
  FileRecord,
  Memory,
  Message,
  Project,
  TaskEvent,
  WebSource,
} from '../shared/types';
import { providers } from '../shared/types';
import { Store, now, uid } from './db';
import { Vault, validateEndpoint } from './security';
import { discover, type CredentialConnection } from './providers';
import { Runtime, publicTask, type TaskRow } from './runtime';
import { Mcp } from './mcp';
import { Memories, memorySchema, correctionSchema, actionSchema } from './memory';
import { publicSearch, searchWeb, type SearchConfig } from './search';

const string = z.string().trim().max(200);
const modelSchema = z.object({
  id: string.min(1),
  name: string.min(1),
  tools: z.boolean().default(true),
});
const connectionSchema = z.object({
  provider: z.enum([
    'openai',
    'anthropic',
    'gemini',
    'deepseek',
    'qwen',
    'glm',
    'ollama',
    'compatible',
  ]),
  name: string.min(1),
  baseUrl: z.string().max(2000).default(''),
  apiKey: z.string().max(8000).default(''),
  models: z.array(modelSchema).min(1).max(100),
  allowLocal: z.boolean().default(false),
});
const projectSchema = z.object({
  name: string.min(1),
  instructions: z.string().max(12000).default(''),
});
const assistantSchema = z.object({
  name: string.min(1),
  description: z.string().max(500).default(''),
  instructions: z.string().min(1).max(12000),
  model: z.string().max(500).default(''),
  tools: z.boolean().default(true),
});
function publicConnection(c: CredentialConnection): Connection {
  const { encryptedKey, ...safe } = c;
  return { ...safe, hasKey: !!encryptedKey };
}
const fileMeta = (f: FileRecord) => ({ ...f, content: '' });
export function createApp(store: Store, vault: Vault) {
  const app = express(),
    runtime = new Runtime(store, vault),
    mcp = new Mcp(store, vault);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(req.hostname))
      return res.status(403).json({ error: '请通过本机地址访问' });
    if (req.path.startsWith('/api')) {
      res.setHeader('Cache-Control', 'no-store');
      const origin = req.headers.origin;
      if (origin) {
        try {
          const u = new URL(origin);
          if (
            !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
            !['http:', 'https:'].includes(u.protocol) ||
            ![String(process.env.PORT || 3001), '5173'].includes(u.port)
          )
            return res.status(403).json({ error: '请求来源不允许' });
        } catch {
          return res.status(403).json({ error: '请求来源无效' });
        }
      }
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return res.status(403).json({ error: '请求来源不允许' });
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  const requireRow = <T>(table: Parameters<Store['get']>[0], id: string): T => {
    const row = store.get<T>(table, id);
    if (!row) throw Object.assign(Error('内容不存在'), { status: 404 });
    return row;
  };
  function assertIdle(predicate: (t: TaskRow) => boolean) {
    if (
      store
        .all<TaskRow>('tasks')
        .some((t) => ['queued', 'running', 'paused'].includes(t.status) && predicate(t))
    )
      throw Error('请先结束关联任务，再进行此操作');
  }
  const listConnections = () =>
    store.all<CredentialConnection>('connections').map(publicConnection);
  const listFiles = () => store.all<FileRecord>('files').map(fileMeta);
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));
  app.get('/api/bootstrap', (_req, res) =>
    res.json({
      toolConnections: mcp.list(),
      connections: listConnections(),
      projects: store.all('projects'),
      assistants: store.all('assistants'),
      conversations: store
        .all<Conversation>('conversations')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      tasks: store
        .all<TaskRow>('tasks')
        .filter((t) => !t.parentId && t.mode === 'task')
        .map(publicTask),
      files: listFiles(),
      search: publicSearch(store.get<SearchConfig>('settings', 'search')),
      defaultModel:
        store.get<{ id: string; value: string }>('settings', 'defaultModel')?.value || '',
    }),
  );
  app.put('/api/settings/default-model', (req, res) => {
    const value = z.string().max(500).parse(req.body.value);
    if (value) {
      const [cid, mid] = value.split('::');
      const c = store.get<Connection>('connections', cid);
      if (!c?.models.some((m) => m.id === mid)) throw Error('选择的模型不存在');
    }
    store.put('settings', { id: 'defaultModel', value });
    res.json({ ok: true });
  });
  app.put('/api/settings/search', async (req, res) => {
    const input = z
      .object({
        provider: z.enum(['tavily', 'searxng']),
        baseUrl: z.string().max(2000),
        apiKey: z.string().max(8000).default(''),
        allowLocal: z.boolean().default(false),
        enabled: z.boolean(),
      })
      .parse(req.body);
    const previous = store.get<SearchConfig>('settings', 'search');
    const baseUrl = await validateEndpoint(input.baseUrl, input.allowLocal);
    const sameDestination = previous?.provider === input.provider && previous.baseUrl === baseUrl;
    if (previous?.encryptedKey && !sameDestination && !input.apiKey && input.provider === 'tavily')
      throw Error('更换搜索服务时请重新填写搜索密钥');
    const encryptedKey = input.apiKey
      ? vault.encrypt(input.apiKey)
      : sameDestination
        ? previous?.encryptedKey || ''
        : '';
    if (input.enabled && input.provider === 'tavily' && !encryptedKey)
      throw Error('请填写 Tavily API Key');
    const config: SearchConfig = {
      id: 'search',
      provider: input.provider,
      baseUrl,
      allowLocal: input.allowLocal,
      enabled: input.enabled,
      encryptedKey,
      hasKey: !!encryptedKey,
    };
    store.put('settings', config);
    res.json(publicSearch(config));
  });
  app.post('/api/settings/search/test', async (req, res) => {
    const config = store.get<SearchConfig>('settings', 'search');
    if (!config?.enabled) throw Error('请先保存并启用搜索服务');
    const { query } = z.object({ query: z.string().trim().min(1).max(500) }).parse(req.body);
    const results = await searchWeb(
      config,
      vault.decrypt(config.encryptedKey),
      query,
      new AbortController().signal,
    );
    res.json({ results });
  });
  async function saveConnection(body: unknown, id?: string) {
    const input = connectionSchema.parse(body);
    const existing = id ? requireRow<CredentialConnection>('connections', id) : undefined;
    if (existing) assertIdle((t) => t.connectionId === id);
    if (input.models.some((m) => m.id.includes('::'))) throw Error('模型 ID 不能包含 ::');
    if (new Set(input.models.map((m) => m.id)).size !== input.models.length)
      throw Error('模型 ID 不能重复');
    const baseUrl = await validateEndpoint(
      input.baseUrl || providers.find((p) => p.id === input.provider)!.baseUrl,
      input.allowLocal,
    );
    if (existing && existing.baseUrl !== baseUrl && existing.encryptedKey && !input.apiKey)
      throw Error('修改服务地址时请重新填写密钥');
    const encryptedKey = input.apiKey ? vault.encrypt(input.apiKey) : existing?.encryptedKey || '';
    if (input.provider !== 'ollama' && !encryptedKey) throw Error('请填写 API Key');
    const c = store.put<CredentialConnection>('connections', {
      id: id || uid(),
      provider: input.provider,
      name: input.name,
      baseUrl,
      models: input.models,
      allowLocal: input.allowLocal,
      encryptedKey,
      hasKey: !!encryptedKey,
      createdAt: existing?.createdAt || now(),
    });
    if (!store.get('settings', 'defaultModel'))
      store.put('settings', { id: 'defaultModel', value: `${c.id}::${c.models[0].id}` });
    return publicConnection(c);
  }
  app.post('/api/connections', async (req, res) =>
    res.status(201).json(await saveConnection(req.body)),
  );
  app.put('/api/connections/:id', async (req, res) =>
    res.json(await saveConnection(req.body, req.params.id)),
  );
  app.delete('/api/connections/:id', (req, res) => {
    requireRow('connections', req.params.id);
    assertIdle((t) => t.connectionId === req.params.id);
    store.delete('connections', req.params.id);
    if (
      store
        .get<{ value: string }>('settings', 'defaultModel')
        ?.value.startsWith(req.params.id + '::')
    )
      store.delete('settings', 'defaultModel');
    res.json({ ok: true });
  });
  app.post('/api/connections/:id/test', async (req, res) => {
    const c = requireRow<CredentialConnection>('connections', req.params.id);
    res.json({ models: await discover(c, vault.decrypt(c.encryptedKey)) });
  });
  app.post('/api/projects', (req, res) =>
    res
      .status(201)
      .json(
        store.put('projects', { id: uid(), ...projectSchema.parse(req.body), createdAt: now() }),
      ),
  );
  app.put('/api/projects/:id', (req, res) =>
    res.json(
      store.put('projects', {
        ...requireRow<Project>('projects', req.params.id),
        ...projectSchema.parse(req.body),
      }),
    ),
  );
  app.delete('/api/projects/:id', (req, res) => {
    requireRow('projects', req.params.id);
    assertIdle((t) => t.projectId === req.params.id);
    store.transaction(() => {
      store.delete('projects', req.params.id);
      for (const g of store
        .all<{ id: string; projectId: string }>('tool_grants')
        .filter((g) => g.projectId === req.params.id))
        store.delete('tool_grants', g.id);
      for (const c of store
        .all<Conversation>('conversations')
        .filter((c) => c.projectId === req.params.id))
        store.put('conversations', { ...c, projectId: '' });
      for (const f of store.all<FileRecord>('files').filter((f) => f.projectId === req.params.id))
        store.put('files', { ...f, projectId: '' });
      for (const m of store.all<Memory>('memories').filter((m) => m.projectId === req.params.id))
        store.delete('memories', m.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/assistants', (req, res) =>
    res.status(201).json(
      store.put('assistants', {
        id: uid(),
        ...assistantSchema.parse(req.body),
        createdAt: now(),
      }),
    ),
  );
  app.put('/api/assistants/:id', (req, res) =>
    res.json(
      store.put('assistants', {
        ...requireRow<Assistant>('assistants', req.params.id),
        ...assistantSchema.parse(req.body),
      }),
    ),
  );
  app.delete('/api/assistants/:id', (req, res) => {
    if (['general', 'researcher', 'writer', 'coder'].includes(req.params.id))
      throw Error('内置助手可以编辑，不能删除');
    requireRow('assistants', req.params.id);
    assertIdle((t) => t.assistantId === req.params.id);
    store.delete('assistants', req.params.id);
    for (const g of store
      .all<{ id: string; assistantId: string }>('tool_grants')
      .filter((g) => g.assistantId === req.params.id))
      store.delete('tool_grants', g.id);
    for (const m of store.all<Memory>('memories').filter((m) => m.assistantId === req.params.id))
      store.delete('memories', m.id);
    for (const c of store
      .all<Conversation>('conversations')
      .filter((c) => c.assistantId === req.params.id))
      store.put('conversations', { ...c, assistantId: 'general' });
    res.json({ ok: true });
  });
  const memories = new Memories(store);
  app.get('/api/memories', (req, res) => {
    const assistantId = z.string().min(1).parse(req.query.assistantId),
      projectId = z.string().parse(req.query.projectId || '');
    res.json(
      memories.list(assistantId, projectId, typeof req.query.q === 'string' ? req.query.q : ''),
    );
  });
  app.post('/api/memories', (req, res) =>
    res.status(201).json(memories.create(memorySchema.parse(req.body))),
  );
  app.put('/api/memories/:id', (req, res) =>
    res.json(memories.correct(req.params.id, correctionSchema.parse(req.body))),
  );
  app.post('/api/memories/:id/:action', (req, res) =>
    res.json(
      memories.action(
        req.params.id,
        z.enum(['confirm', 'revoke']).parse(req.params.action),
        actionSchema.parse(req.body),
      ),
    ),
  );
  app.delete('/api/memories/:id', (req, res) => {
    requireRow('memories', req.params.id);
    store.delete('memories', req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/tool-connections', (_req, res) => res.json(mcp.list()));
  app.post('/api/tool-connections', async (req, res) =>
    res.status(201).json(await mcp.save(req.body)),
  );
  app.put('/api/tool-connections/:id', async (req, res) => {
    requireRow('tool_connections', req.params.id);
    res.json(await mcp.save(req.body, req.params.id));
  });
  app.post('/api/tool-connections/:id/test', async (req, res) =>
    res.json(await mcp.test(req.params.id)),
  );
  app.patch('/api/tool-connections/:id', (req, res) =>
    res.json(mcp.setEnabled(req.params.id, z.boolean().parse(req.body.enabled))),
  );
  app.delete('/api/tool-connections/:id', (req, res) => {
    requireRow('tool_connections', req.params.id);
    store.transaction(() => {
      store.delete('tool_connections', req.params.id);
      for (const g of store
        .all<{ id: string; connectionId: string }>('tool_grants')
        .filter((g) => g.connectionId === req.params.id))
        store.delete('tool_grants', g.id);
    });
    res.json({ ok: true });
  });
  app.get('/api/tool-grants', (req, res) =>
    res.json(
      mcp.grants(
        z.string().min(1).parse(req.query.assistantId),
        z.string().parse(req.query.projectId || ''),
      ),
    ),
  );
  app.put('/api/tool-grants', (req, res) => {
    const b = z
      .object({
        connectionId: z.string().min(1),
        assistantId: z.string().min(1),
        projectId: z.string().default(''),
        tools: z.array(z.string().min(1)).max(100),
        confirmedReadOnly: z.literal(true),
      })
      .strict()
      .parse(req.body);
    res.json(mcp.grant(b.connectionId, b.assistantId, b.projectId, b.tools));
  });
  app.post('/api/conversations', (req, res) => {
    const b = z
      .object({ projectId: string.default(''), assistantId: string.default('general') })
      .parse(req.body || {});
    if (b.projectId) requireRow('projects', b.projectId);
    requireRow('assistants', b.assistantId);
    res.status(201).json(
      store.put('conversations', {
        id: uid(),
        title: '新对话',
        ...b,
        createdAt: now(),
        updatedAt: now(),
      }),
    );
  });
  app.get('/api/conversations/:id', (req, res) => {
    const conversation = requireRow<Conversation>('conversations', req.params.id),
      tasks = store.all<TaskRow>('tasks').filter((t) => t.conversationId === conversation.id),
      ids = new Set(tasks.map((t) => t.id));
    const memoryReviews = [
      ...new Set([conversation.assistantId, ...tasks.map((t) => t.assistantId)]),
    ]
      .map((assistantId) => ({
        assistantId,
        count: memories
          .list(assistantId, conversation.projectId)
          .filter((m) => m.status === 'candidate').length,
      }))
      .filter((r) => r.count > 0);
    res.json({
      conversation,
      messages: store
        .all<Message>('messages')
        .filter((m) => m.conversationId === conversation.id)
        .reverse(),
      tasks: tasks.map(publicTask),
      records: store
        .all<ExecutionRecord>('records')
        .filter((r) => ids.has(r.taskId))
        .reverse(),
      events: store
        .all<TaskEvent>('events')
        .filter((e) => ids.has(e.taskId))
        .reverse()
        .slice(-300),
      files: listFiles().filter((f) => f.conversationId === conversation.id),
      memoryCandidates: memoryReviews.reduce((sum, r) => sum + r.count, 0),
      memoryReviews,
      sources: store
        .all<WebSource>('sources')
        .filter((s) => s.conversationId === conversation.id)
        .map(({ content, ...source }) => source),
    });
  });
  app.post('/api/conversations/:id/fork', (req, res) => {
    const original = requireRow<Conversation>('conversations', req.params.id);
    assertIdle((t) => t.conversationId === original.id);
    const { beforeMessageId } = z.object({ beforeMessageId: string.min(1) }).parse(req.body);
    const history = store
      .all<Message>('messages')
      .filter((m) => m.conversationId === original.id)
      .reverse();
    const at = history.findIndex((m) => m.id === beforeMessageId && m.role === 'user');
    if (at < 0) throw Error('要修改的问题不存在');
    const conversation = {
      ...original,
      id: uid(),
      title: original.title + ' · 新版本',
      createdAt: now(),
      updatedAt: now(),
    };
    store.transaction(() => {
      store.put('conversations', conversation);
      for (const m of history.slice(0, at).filter((m) => m.status === 'completed'))
        store.put('messages', { ...m, id: uid(), conversationId: conversation.id, taskId: '' });
    });
    res.status(201).json(conversation);
  });
  app.delete('/api/conversations/:id', (req, res) => {
    requireRow('conversations', req.params.id);
    assertIdle((t) => t.conversationId === req.params.id);
    store.transaction(() => {
      store.delete('conversations', req.params.id);
      for (const m of store
        .all<Message>('messages')
        .filter((m) => m.conversationId === req.params.id))
        store.delete('messages', m.id);
      const ids = new Set(
        store
          .all<TaskRow>('tasks')
          .filter((t) => t.conversationId === req.params.id)
          .map((t) => t.id),
      );
      for (const id of ids) store.delete('tasks', id);
      for (const r of store.all<ExecutionRecord>('records').filter((r) => ids.has(r.taskId)))
        store.delete('records', r.id);
      for (const source of store
        .all<WebSource>('sources')
        .filter((s) => s.conversationId === req.params.id))
        store.delete('sources', source.id);
      for (const e of store.all<TaskEvent>('events').filter((e) => ids.has(e.taskId)))
        store.delete('events', e.id);
      for (const r of store
        .all<{ id: string }>('tool_results')
        .filter((r) => [...ids].some((id) => r.id.startsWith(id + ':'))))
        store.delete('tool_results', r.id);
      for (const f of store
        .all<FileRecord>('files')
        .filter((f) => f.conversationId === req.params.id))
        store.put('files', { ...f, conversationId: '', taskId: '' });
    });
    res.json({ ok: true });
  });
  app.post('/api/conversations/:id/messages', (req, res) => {
    const c = requireRow<Conversation>('conversations', req.params.id);
    const b = z
      .object({
        content: z.string().trim().min(1).max(16000),
        connectionId: string.min(1),
        modelId: string.min(1),
        mode: z.enum(['chat', 'task']).default('chat'),
        fileIds: z.array(string).max(10).default([]),
        web: z.boolean().default(false),
      })
      .parse(req.body);
    const connection = requireRow<CredentialConnection>('connections', b.connectionId),
      model = connection.models.find((m) => m.id === b.modelId);
    if (!model) throw Error('选择的模型不存在');
    const active = store
      .all<TaskRow>('tasks')
      .filter((t) => !t.parentId && ['queued', 'running', 'paused'].includes(t.status));
    if (active.some((t) => t.conversationId === c.id)) throw Error('请先继续或结束当前任务');
    if (active.filter((t) => t.status !== 'paused').length >= 3)
      throw Error('已有三个任务正在执行，请稍后再试');
    for (const fid of b.fileIds) {
      const f = requireRow<FileRecord>('files', fid);
      if (f.projectId && f.projectId !== c.projectId) throw Error('附件属于其他项目');
    }
    const assistant = requireRow<Assistant>('assistants', c.assistantId);
    const search = store.get<SearchConfig>('settings', 'search');
    if (b.web && !search?.enabled) throw Error('请先在设置中配置联网搜索');
    if (b.web && (!assistant.tools || !model.tools))
      throw Error('联网搜索需要助手和模型启用工具调用');
    const task = runtime.create({
      conversation: c,
      assistant,
      connection,
      modelId: b.modelId,
      modelName: model.name,
      goal: b.content,
      mode: b.mode,
      fileIds: b.fileIds,
      search: b.web ? search : undefined,
    });
    res.status(202).json(task);
  });
  app.get('/api/tasks/:id', (req, res) => {
    const task = requireRow<TaskRow>('tasks', req.params.id);
    const ids = new Set([
      task.id,
      ...store
        .all<TaskRow>('tasks')
        .filter((t) => t.parentId === task.id)
        .map((t) => t.id),
    ]);
    res.json({
      records: store
        .all<ExecutionRecord>('records')
        .filter((r) => ids.has(r.taskId))
        .reverse(),
      task: publicTask(task),
      children: store
        .all<TaskRow>('tasks')
        .filter((t) => t.parentId === task.id)
        .map(publicTask),
      events: store
        .all<TaskEvent>('events')
        .filter((e) => e.taskId === task.id)
        .reverse(),
      files: listFiles().filter((f) => f.taskId === task.id),
    });
  });
  app.post('/api/tasks/:id/:action', async (req, res) => {
    const action = z.enum(['pause', 'resume', 'cancel']).parse(req.params.action);
    await runtime.control(req.params.id, action);
    res.json(publicTask(requireRow<TaskRow>('tasks', req.params.id)));
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 10 },
  });
  const extensions = new Set([
    '.txt',
    '.md',
    '.markdown',
    '.csv',
    '.json',
    '.yaml',
    '.yml',
    '.xml',
    '.html',
    '.css',
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.py',
    '.java',
    '.go',
    '.rs',
    '.sql',
    '.log',
    '.sh',
    '.toml',
  ]);
  app.post('/api/files', upload.array('files', 10), (req, res) => {
    const projectId = z
      .string()
      .max(200)
      .parse(req.body.projectId || '');
    if (projectId) requireRow('projects', projectId);
    const files = req.files as Express.Multer.File[];
    if (!files?.length) throw Error('请选择文件');
    // Validate the whole batch before persisting any part.
    const records = files.map((f) => {
      const name = basename(Buffer.from(f.originalname, 'latin1').toString('utf8')).slice(0, 200),
        ext = extname(name).toLowerCase();
      if (!extensions.has(ext) || f.buffer.includes(0))
        throw Error('目前支持文本、Markdown、表格文本和代码文件，不支持 PDF 或二进制文件');
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(f.buffer);
      } catch {
        throw Error('请上传 UTF-8 编码的文件');
      }
      return {
        id: uid(),
        name,
        content,
        projectId,
        conversationId: '',
        taskId: '',
        kind: 'upload' as const,
        size: f.size,
        createdAt: now(),
      };
    });
    store.transaction(() => records.forEach((f) => store.put('files', f)));
    res.status(201).json(records.map(fileMeta));
  });
  app.get('/api/files/:id', (req, res) => res.json(requireRow<FileRecord>('files', req.params.id)));
  app.get('/api/files/:id/download', (req, res) => {
    const f = requireRow<FileRecord>('files', req.params.id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="file.txt"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    );
    res.type('text/plain; charset=utf-8').send(f.content);
  });
  app.delete('/api/files/:id', (req, res) => {
    const f = requireRow<FileRecord>('files', req.params.id);
    assertIdle((t) => t.allowedFiles.includes(req.params.id) || t.id === f.taskId);
    store.delete('files', req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="expertmesh-export.json"');
    res.json({
      version: 1,
      exportedAt: now(),
      projects: store.all('projects'),
      assistants: store.all('assistants'),
      memories: store.all<Memory>('memories').map((m) => memories.view(m)),
      conversations: store.all('conversations'),
      messages: store.all('messages'),
      tasks: store.all<TaskRow>('tasks').map(publicTask),
      records: store.all<ExecutionRecord>('records'),
      files: store.all('files'),
      sources: store.all('sources'),
      search: publicSearch(store.get<SearchConfig>('settings', 'search')),
      connections: listConnections(),
      toolConnections: mcp.list(),
      toolGrants: store.all('tool_grants'),
    });
  });
  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(
      express.static(dist, {
        setHeaders: (res) =>
          res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'",
          ),
      }),
    );
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(resolve(dist, 'index.html'));
    });
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use(
    (error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (res.headersSent) return;
      const message =
        error instanceof z.ZodError
          ? '请检查必填内容和格式'
          : error instanceof multer.MulterError
            ? '上传文件过大或数量过多'
            : error.message || '请求失败';
      res.status(error.status || 400).json({ error: message });
    },
  );
  return { app, runtime };
}
