import { createHash } from 'node:crypto';
import {
  constants,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
  lstatSync,
  fstatSync,
  readdirSync,
} from 'node:fs';
import { resolve, relative, isAbsolute, join, extname, sep } from 'node:path';
import { z } from 'zod';
import { Store, uid, now } from './db';
import type { Workspace, WorkspaceGrant } from '../shared/types';

export const workspaceSchema = z
  .object({ name: z.string().trim().min(1).max(200), path: z.string().min(1).max(2000) })
  .strict();
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const forbidden = (part: string) =>
  /^(?:\.git|node_modules|\.env(?:\..*)?|data|\.ssh|\.aws|\.config|secret\.key|credentials.*)$/i.test(
    part,
  ) || /\.(?:pem|key|p12|pfx)$/i.test(part);
const extensions = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.html',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.sql',
  '.sh',
  '.log',
  '.ini',
]);
const identity = (path: string) => {
  const stat = lstatSync(path);
  return `${stat.dev}:${stat.ino}`;
};
export class Workspaces {
  constructor(private store: Store) {}
  list() {
    return this.store.all<Workspace>('workspaces');
  }
  create(input: unknown) {
    const b = workspaceSchema.parse(input);
    if (!isAbsolute(b.path) || b.path.includes(','))
      throw Error('请填写绝对目录路径，路径不能包含逗号');
    const path = realpathSync(b.path);
    if (path.split(/[\\/]/).some(forbidden)) throw Error('不能连接受保护的目录，请选择项目子目录');
    if (!lstatSync(path).isDirectory() || lstatSync(b.path).isSymbolicLink())
      throw Error('请选择真实目录，不支持符号链接');
    if (relative(resolve(path, '..'), path) === '' || path === resolve(path, sep))
      throw Error('不能授权磁盘根目录');
    return this.store.put<Workspace>('workspaces', {
      id: uid(),
      name: b.name,
      path,
      identity: identity(path),
      enabled: true,
      createdAt: now(),
    });
  }
  grants(assistantId: string, projectId: string) {
    return this.store
      .all<WorkspaceGrant>('workspace_grants')
      .filter((g) => g.assistantId === assistantId && g.projectId === projectId);
  }
  grant(workspaceId: string, assistantId: string, projectId: string, enabled: boolean) {
    if (
      !this.store.get('workspaces', workspaceId) ||
      !this.store.get('assistants', assistantId) ||
      (projectId && !this.store.get('projects', projectId))
    )
      throw Error('目录、助手或空间不存在');
    const id = hash(JSON.stringify([workspaceId, assistantId, projectId]));
    if (!enabled) this.store.delete('workspace_grants', id);
    else
      this.store.put<WorkspaceGrant>('workspace_grants', {
        id,
        workspaceId,
        assistantId,
        projectId,
      });
  }
  available(assistantId: string, projectId: string) {
    const ids = new Set(this.grants(assistantId, projectId).map((g) => g.workspaceId));
    return this.list().filter((w) => w.enabled && ids.has(w.id));
  }
  private workspace(id: string, assistantId: string, projectId: string) {
    const w = this.available(assistantId, projectId).find((w) => w.id === id);
    if (!w) throw Error('当前助手在此空间未获准读取目录');
    if (
      realpathSync(w.path) !== w.path ||
      identity(w.path) !== w.identity ||
      lstatSync(w.path).isSymbolicLink()
    )
      throw Error('目录已替换，请重新连接并授权');
    return w;
  }
  private safe(w: Workspace, path: string) {
    if (
      !path ||
      isAbsolute(path) ||
      path.includes('\\') ||
      path.includes(':') ||
      path.includes('\0')
    )
      throw Error('请使用目录内的相对路径');
    const parts = path.split('/');
    if (parts.some((p) => !p || p === '.' || p === '..' || forbidden(p)))
      throw Error('路径超出授权范围或包含受保护内容');
    let target = w.path;
    for (const part of parts) {
      target = join(target, part);
      if (lstatSync(target).isSymbolicLink()) throw Error('不读取符号链接');
    }
    const actual = realpathSync(target),
      rel = relative(w.path, actual);
    if (rel.startsWith('..') || isAbsolute(rel)) throw Error('路径超出授权目录');
    return actual;
  }
  read(id: string, path: string, assistantId: string, projectId: string) {
    const w = this.workspace(id, assistantId, projectId),
      target = this.safe(w, path);
    if (!extensions.has(extname(target).toLowerCase())) throw Error('目前仅支持文本与代码文件');
    const fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024 || stat.nlink > 1)
        throw Error('文件过大、不是普通文件或包含硬链接');
      if (process.platform === 'linux') {
        const live = realpathSync(`/proc/self/fd/${fd}`),
          rel = relative(w.path, live);
        if (rel.startsWith('..') || isAbsolute(rel)) throw Error('文件已移出授权目录');
      }
      const bytes = readFileSync(fd);
      this.workspace(id, assistantId, projectId);
      this.safe(w, path);
      const after = lstatSync(target);
      if (stat.ino !== after.ino || stat.dev !== after.dev || after.size !== stat.size)
        throw Error('读取时文件已变化，请重试');
      if (bytes.includes(0)) throw Error('不读取二进制文件');
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw Error('文件必须为 UTF-8 文本');
      }
      return {
        workspaceId: w.id,
        path,
        content,
        hash: hash(content),
        size: bytes.length,
        sourceId: `${w.id}:${path}`,
      };
    } finally {
      closeSync(fd);
    }
  }
  files(id: string, assistantId: string, projectId: string) {
    const w = this.workspace(id, assistantId, projectId),
      found: { path: string; size: number }[] = [];
    let visited = 0,
      depthTruncated = false;
    const walk = (dir: string, prefix = '', depth = 0) => {
      if (depth > 12) {
        depthTruncated = true;
        return;
      }
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (++visited > 5000 || found.length >= 300) return;
        if (entry.isSymbolicLink() || forbidden(entry.name)) continue;
        const path = prefix + entry.name;
        try {
          const actual = this.safe(w, path),
            stat = lstatSync(actual);
          if (stat.isDirectory()) walk(actual, path + '/', depth + 1);
          else if (
            stat.isFile() &&
            stat.nlink === 1 &&
            stat.size <= 2 * 1024 * 1024 &&
            extensions.has(extname(path).toLowerCase())
          )
            found.push({ path, size: stat.size });
        } catch {}
      }
    };
    walk(w.path);
    return {
      workspaceId: id,
      files: found,
      truncated: depthTruncated || visited > 5000 || found.length >= 300,
    };
  }
  search(id: string, query: string, assistantId: string, projectId: string) {
    if (!query.trim() || query.length > 200) throw Error('检索词必须为 1 至 200 个字符');
    const hits: any[] = [];
    let bytes = 0;
    for (const f of this.files(id, assistantId, projectId).files) {
      bytes += f.size;
      if (bytes > 20 * 1024 * 1024 || hits.length >= 20) break;
      try {
        const result = this.read(id, f.path, assistantId, projectId);
        const at = result.content.toLowerCase().indexOf(query.toLowerCase());
        if (at >= 0)
          hits.push({
            ...result,
            content: undefined,
            line: result.content.slice(0, at).split('\n').length,
            excerpt: result.content.slice(Math.max(0, at - 160), at + 1000),
          });
      } catch {}
    }
    return hits;
  }
}
