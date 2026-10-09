import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { Store, uid, now } from './db';
import { Workspaces } from './workspaces';
import type { SandboxRun, SandboxSettings } from '../shared/types';

export const sandboxSchema = z
  .object({ enabled: z.boolean(), timeoutSeconds: z.number().int().min(1).max(120).default(30) })
  .strict();
export const codeSchema = z
  .object({
    runtime: z.enum(['python', 'javascript']),
    code: z.string().min(1).max(64000),
    workspace_id: z.string().optional(),
  })
  .strict();
const tags = { python: 'python:3.13-slim', javascript: 'node:24-alpine' };
function cli(
  args: string[],
  input = '',
  signal = AbortSignal.timeout(30_000),
  limit = 64_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    signal.throwIfAborted();
    const child = spawn('docker', args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let out = '',
      err = '',
      size = 0,
      failure: Error | undefined;
    const stop = () => {
      failure = signal.reason instanceof Error ? signal.reason : Error('执行已中断');
      child.kill();
    };
    signal.addEventListener('abort', stop, { once: true });
    const collect = (chunk: Buffer, stderr: boolean) => {
      size += chunk.length;
      if (size > limit) {
        failure = Error('执行输出超过 64 KB 限额');
        child.kill();
        return;
      }
      if (stderr) err += chunk.toString('utf8');
      else out += chunk.toString('utf8');
    };
    child.stdout.on('data', (c) => collect(c, false));
    child.stderr.on('data', (c) => collect(c, true));
    child.stdin.on('error', () => {});
    child.on('error', () => {
      signal.removeEventListener('abort', stop);
      fail(Error('无法启动 Docker，请先安装并启动 Docker'));
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', stop);
      if (failure) fail(Object.assign(failure, { stdout: out, stderr: err }));
      else done({ exitCode: code ?? -1, stdout: out, stderr: err });
    });
    child.stdin.end(input);
  });
}
export class Sandboxes {
  constructor(private store: Store) {
    for (const r of store.all<SandboxRun>('sandbox_runs'))
      if (r.status === 'running') {
        store.put('sandbox_runs', {
          ...r,
          status: 'interrupted',
          endedAt: now(),
          stderr: '进程中断，未确认完成，不会自动重跑',
        });
        void cli(['rm', '-f', 'expertmesh-' + r.id]).catch(() => {});
      }
  }
  settings(): SandboxSettings {
    return (
      this.store.get<any>('settings', 'sandbox') || {
        enabled: false,
        timeoutSeconds: 30,
        images: {},
      }
    );
  }
  async status() {
    try {
      const host =
        process.env.DOCKER_HOST ||
        (await cli(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])).stdout.trim();
      if (!/^(?:npipe:|unix:)/.test(host)) throw Error('首版仅允许本机 Docker，不连接远端执行环境');
      const info = await cli(['info', '--format', '{{.OSType}}']);
      if (info.exitCode || info.stdout.trim() !== 'linux')
        throw Error('请启动 Docker 的 Linux 容器引擎');
      return { ready: true, settings: this.settings(), message: '执行环境可用' };
    } catch (e) {
      return {
        ready: false,
        settings: this.settings(),
        message: e instanceof Error ? e.message : 'Docker 不可用',
      };
    }
  }
  private args(name: string, image: string, runtime: 'python' | 'javascript', inputDir?: string) {
    return [
      'run',
      '--rm',
      '--pull=never',
      '--name',
      name,
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user=65534:65534',
      '--memory=256m',
      '--memory-swap=256m',
      '--cpus=1',
      '--pids-limit=64',
      '--ulimit',
      'nofile=128:128',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m,mode=1777',
      '--tmpfs',
      '/output:rw,noexec,nosuid,size=16m,mode=1777',
      '--workdir=/output',
      ...(inputDir ? ['--mount', `type=bind,source=${inputDir},target=/workspace,readonly`] : []),
      '-i',
      image,
      ...(runtime === 'python'
        ? ['python', '-u', '-c', "import sys;exec(compile(sys.stdin.read(),'<task>','exec'))"]
        : ['node', '--max-old-space-size=128', '-']),
    ];
  }
  async prepare() {
    const status = await this.status();
    if (!status.ready) throw Error(status.message);
    const images: SandboxSettings['images'] = {};
    for (const runtime of ['python', 'javascript'] as const) {
      const pull = await cli(['pull', tags[runtime]], '', AbortSignal.timeout(180_000));
      if (pull.exitCode) throw Error('运行镜像下载失败，请检查 Docker 网络');
      const result = await cli(['image', 'inspect', '--format', '{{.Id}}', tags[runtime]]);
      if (!/^sha256:[a-f0-9]{64}$/.test(result.stdout.trim())) throw Error('镜像身份无法确认');
      images[runtime] = result.stdout.trim();
      const probe =
        runtime === 'python'
          ? "import os,socket\nassert os.getuid()==65534\nassert len(socket.if_nameindex())==1\ntry:\n open('/etc/sandbox-check','w')\n raise Exception('root writable')\nexcept PermissionError: pass\nexcept OSError: pass\nopen('/output/check.txt','w').write('ok')\nprint('EXPERTMESH_SANDBOX_OK')"
          : "const fs=require('fs'),os=require('os');if(process.getuid()!==65534)throw Error('uid');if(Object.keys(os.networkInterfaces()).some(x=>x!=='lo'))throw Error('network');try{fs.writeFileSync('/etc/sandbox-check','x');throw Error('root writable')}catch(e){if(!['EROFS','EACCES'].includes(e.code))throw e}fs.writeFileSync('/output/check.txt','ok');console.log('EXPERTMESH_SANDBOX_OK')";
      const name = 'expertmesh-check-' + uid();
      try {
        const check = await cli(this.args(name, images[runtime]!, runtime), probe);
        if (check.exitCode || !check.stdout.includes('EXPERTMESH_SANDBOX_OK'))
          throw Error('执行隔离检查未通过');
      } finally {
        await cli(['rm', '-f', name], '', AbortSignal.timeout(5000)).catch(() => {});
      }
    }
    this.store.put('settings', { id: 'sandbox', ...this.settings(), images });
    return this.status();
  }
  async run(
    taskId: string,
    assistantId: string,
    projectId: string,
    body: unknown,
    signal: AbortSignal,
    runId: string = uid(),
  ) {
    const input = codeSchema.parse(body),
      settings = this.settings();
    if (!settings.enabled || !settings.images[input.runtime])
      throw Error('请先准备并启用代码执行环境');
    const status = await this.status();
    signal.throwIfAborted();
    if (!status.ready) throw Error(status.message);
    const old = this.store.get<SandboxRun>('sandbox_runs', runId);
    if (old) {
      if (old.status === 'completed' || old.status === 'failed') return old;
      throw Error('上次执行未确认完成，请检查记录后重新发起任务');
    }
    const dir = mkdtempSync(resolve(tmpdir(), 'expertmesh-sandbox-'));
    const run: SandboxRun = {
      id: runId,
      taskId,
      runtime: input.runtime,
      image: settings.images[input.runtime]!,
      status: 'running',
      exitCode: null,
      stdout: '',
      stderr: '',
      startedAt: now(),
      workspaceFiles: [],
    };
    const combined = AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutSeconds * 1000)]);
    try {
      let snapshot: string | undefined;
      if (input.workspace_id) {
        snapshot = join(dir, 'input');
        mkdirSync(snapshot);
        const workspaces = new Workspaces(this.store);
        let bytes = 0;
        const listing = workspaces.files(input.workspace_id, assistantId, projectId);
        if (listing.truncated) throw Error('工作区文件过多，请连接更小的目录后执行');
        for (const file of listing.files) {
          combined.throwIfAborted();
          const f = workspaces.read(input.workspace_id, file.path, assistantId, projectId);
          bytes += f.size;
          if (bytes > 20 * 1024 * 1024) throw Error('工作区快照超过 20 MB，请缩小目录范围');
          const target = resolve(snapshot, ...file.path.split('/'));
          mkdirSync(resolve(target, '..'), { recursive: true });
          writeFileSync(target, f.content, { mode: 0o444 });
          run.workspaceFiles.push({ workspaceId: input.workspace_id, path: f.path, hash: f.hash });
        }
      }
      this.store.put('sandbox_runs', run);
      const result = await cli(
        this.args('expertmesh-' + runId, run.image, input.runtime, snapshot),
        input.code,
        combined,
      );
      Object.assign(run, result, { status: result.exitCode === 0 ? 'completed' : 'failed' });
      return run;
    } catch (e) {
      run.status = 'interrupted';
      const partial = e as { stdout?: string; stderr?: string };
      run.stdout = partial?.stdout || '';
      const reason =
        !signal.aborted && combined.aborted
          ? '代码执行超时'
          : e instanceof Error
            ? e.message
            : '执行失败';
      run.stderr = [partial?.stderr, reason].filter(Boolean).join('\n');
      throw e;
    } finally {
      await cli(['rm', '-f', 'expertmesh-' + runId], '', AbortSignal.timeout(5000)).catch(() => {});
      run.endedAt = now();
      this.store.put('sandbox_runs', run);
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
