import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/db';
import { Workspaces } from '../server/workspaces';
import { Sandboxes } from '../server/sandbox';
import { Runtime, type TaskRow } from '../server/runtime';
import { Vault } from '../server/security';
import { Budgets, defaultBudget } from '../server/budget';

test(
  'real Docker execution, non-root, no network, read-only snapshot, errors and timeout',
  { skip: process.env.EXPERTMESH_TEST_DOCKER !== '1', timeout: 300000 },
  async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'mesh-docker-')),
      store = new Store(resolve(dir, 'db')),
      sandbox = new Sandboxes(store);
    try {
      await sandbox.prepare();
      store.put('settings', {
        id: 'sandbox',
        ...sandbox.settings(),
        enabled: true,
        timeoutSeconds: 20,
      });
      const root = resolve(dir, 'project');
      mkdirSync(root);
      writeFileSync(resolve(root, 'hello.txt'), 'hello');
      const ws = new Workspaces(store),
        w = ws.create({ name: '项目', path: root });
      ws.grant(w.id, 'general', '', true);
      const py = await sandbox.run(
        'task',
        'general',
        '',
        {
          runtime: 'python',
          workspace_id: w.id,
          code: "import os,socket\nassert os.getuid()==65534\nassert len(socket.if_nameindex())==1\nassert open('/workspace/hello.txt').read()=='hello'\ntry:\n open('/workspace/hello.txt','w').write('bad')\n raise Exception('writable')\nexcept (PermissionError,OSError): pass\nassert 'API_KEY' not in os.environ\nprint(6*7)",
        },
        new AbortController().signal,
      );
      assert.equal(py.exitCode, 0);
      assert.match(py.stdout, /42/);
      assert.equal(readFileSync(resolve(root, 'hello.txt'), 'utf8'), 'hello');
      const js = await sandbox.run(
        'task',
        'general',
        '',
        { runtime: 'javascript', code: 'console.log(6*7)' },
        new AbortController().signal,
      );
      assert.equal(js.exitCode, 0);
      assert.match(js.stdout, /42/);
      const runtime = new Runtime(store, new Vault(dir));
      const task = {
        id: 'root',
        parentId: '',
        assistantId: 'general',
        projectId: '',
        conversationId: 'conversation',
        config: { tools: true },
      } as TaskRow;
      const budgets = new Budgets(store);
      budgets.create(task.id, { ...defaultBudget(), sandboxRuns: 1 });
      const result = JSON.parse(
        await runtime.tool(
          task,
          {
            id: 'code',
            name: 'run_code',
            arguments: JSON.stringify({ runtime: 'javascript', code: 'console.log(42)' }),
          },
          new AbortController().signal,
        ),
      );
      assert.equal(result.exitCode, 0);
      assert.equal(store.get<any>('files', result.id + '-log').taskId, task.id);
      assert.equal(budgets.get(task.id)!.sandboxRuns, 1);
      await assert.rejects(
        runtime.tool(
          task,
          {
            id: 'over',
            name: 'run_code',
            arguments: JSON.stringify({ runtime: 'python', code: 'print(42)' }),
          },
          new AbortController().signal,
        ),
        /预算/,
      );
      const fail = await sandbox.run(
        'task',
        'general',
        '',
        { runtime: 'python', code: "raise ValueError('expected failure')" },
        new AbortController().signal,
      );
      assert.equal(fail.status, 'failed');
      assert.notEqual(fail.exitCode, 0);
      store.put('settings', { id: 'sandbox', ...sandbox.settings(), timeoutSeconds: 1 });
      await assert.rejects(
        sandbox.run(
          'task',
          'general',
          '',
          { runtime: 'python', code: "print('before timeout', flush=True)\nwhile True: pass" },
          new AbortController().signal,
        ),
      );
      assert.ok(store.all<any>('sandbox_runs').some((r) => r.stderr === '代码执行超时'));
      assert.ok(
        store
          .all<any>('sandbox_runs')
          .some((r) => r.stderr === '代码执行超时' && r.stdout.includes('before timeout')),
      );
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 200);
      await assert.rejects(
        sandbox.run(
          'task',
          'general',
          '',
          { runtime: 'python', code: 'while True: pass' },
          controller.signal,
        ),
      );
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
