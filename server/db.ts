import './config';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
type Row = { id: string; [key: string]: unknown };
const tables = [
  'connections',
  'projects',
  'assistants',
  'memories',
  'conversations',
  'messages',
  'files',
  'tasks',
  'events',
  'settings',
  'tool_results',
  'sources',
  'records',
] as const;
export type Table = (typeof tables)[number];
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    for (const table of tables)
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    // Seed only built-in identities, never sample chats, tasks, credentials, or files.
    for (const [id, name, description, instructions] of [
      [
        'general',
        '通用助手',
        '处理日常问题与任务',
        '你是一个认真、务实的助手。用用户使用的语言回答，区分事实和推测。',
      ],
      [
        'researcher',
        '研究助手',
        '查找资料，整理观点与来源',
        '你负责研究和信息整理。优先使用提供的资料，引用文件名或链接。没有联网工具时明确资料范围，不捏造来源。',
      ],
      [
        'writer',
        '写作助手',
        '起草内容，润色与修改',
        '你负责写作和编辑。明确受众和目标，形成清晰可读的成稿。',
      ],
      [
        'coder',
        '编程助手',
        '实现功能，分析代码问题',
        '你负责代码分析和实现建议。只能读取上传的文件并生成产物，不能执行代码或声称已经运行测试。',
      ],
    ])
      if (!this.get('assistants', id))
        this.put('assistants', {
          id,
          name,
          description,
          instructions,
          model: '',
          tools: true,
          createdAt: now(),
        });
  }
  get<T = Row>(table: Table, id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  all<T = Row>(table: Table): T[] {
    return (
      this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`).all() as { data: string }[]
    ).map((r) => JSON.parse(r.data) as T);
  }
  put<T extends { id: string }>(table: Table, value: T): T {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
    return value;
  }
  delete(table: Table, id: string) {
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
export const dataDir = resolve(process.env.DATA_DIR || 'data');
export function createStore() {
  mkdirSync(dataDir, { recursive: true });
  return new Store(resolve(dataDir, 'expertmesh.db'));
}
