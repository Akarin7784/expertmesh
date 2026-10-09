import { z } from 'zod';
import { Store } from './db';
import type { BudgetLimits, BudgetState } from '../shared/types';

export const budgetSchema = z
  .object({
    modelCalls: z.number().int().min(1).max(200).default(24),
    toolCalls: z.number().int().min(1).max(500).default(80),
    tokens: z.number().int().min(100).max(2_000_000).default(200_000),
    contextChars: z.number().int().min(1000).max(1_000_000).default(160_000),
    activeSeconds: z.number().int().min(5).max(7200).default(600),
    sandboxRuns: z.number().int().min(0).max(100).default(8),
  })
  .strict();
export const defaultBudget = () => budgetSchema.parse({});
export class BudgetExceeded extends Error {}
export class Budgets {
  constructor(private store: Store) {}
  create(id: string, limits: BudgetLimits) {
    return this.store.put<BudgetState>('budgets', {
      id,
      limits,
      modelCalls: 0,
      toolCalls: 0,
      knownTokens: 0,
      unknownUsage: 0,
      elapsedMs: 0,
      sandboxRuns: 0,
    });
  }
  get(id: string) {
    return this.store.get<BudgetState>('budgets', id);
  }
  save(row: BudgetState) {
    this.store.put('budgets', row);
    const task = this.store.get<any>('tasks', row.id);
    if (task) this.store.put('tasks', { ...task, budget: row });
    return row;
  }
  stop(row: BudgetState, reason: string): never {
    this.save({ ...row, stoppedReason: reason });
    throw new BudgetExceeded(reason);
  }
  check(id: string) {
    const row = this.get(id);
    if (!row) return;
    if (row.elapsedMs >= row.limits.activeSeconds * 1000) this.stop(row, '已达到任务执行时间预算');
    if (row.knownTokens >= row.limits.tokens) this.stop(row, '已达到已报告 token 预算');
  }
  reserve(id: string, kind: 'modelCalls' | 'toolCalls' | 'sandboxRuns', contextChars = 0) {
    this.check(id);
    const row = this.get(id);
    if (!row) return;
    if (contextChars > row.limits.contextChars) this.stop(row, '模型上下文超过字符预算');
    if (row[kind] >= row.limits[kind])
      this.stop(
        row,
        `已达到${{ modelCalls: '模型调用', toolCalls: '工具调用', sandboxRuns: '代码执行' }[kind]}预算`,
      );
    this.save({ ...row, [kind]: row[kind] + 1, stoppedReason: undefined });
  }
  usage(id: string, tokens: number | undefined) {
    const row = this.get(id);
    if (row)
      this.save({
        ...row,
        knownTokens: row.knownTokens + (tokens ?? 0),
        unknownUsage: row.unknownUsage + (tokens === undefined ? 1 : 0),
      });
  }
  clock(id: string) {
    const controller = new AbortController();
    let last = performance.now();
    const tick = () => {
      const at = performance.now(),
        row = this.get(id);
      if (row) this.save({ ...row, elapsedMs: row.elapsedMs + Math.max(0, Math.round(at - last)) });
      last = at;
      try {
        this.check(id);
      } catch (e) {
        controller.abort(e);
      }
    };
    tick();
    const interval = setInterval(tick, 250);
    return {
      signal: controller.signal,
      stop: () => {
        clearInterval(interval);
        tick();
      },
    };
  }
  change(id: string, limits: BudgetLimits) {
    const row = this.get(id);
    if (!row) throw Error('任务预算不存在');
    if (
      limits.modelCalls < row.modelCalls ||
      limits.toolCalls < row.toolCalls ||
      limits.sandboxRuns < row.sandboxRuns ||
      limits.tokens < row.knownTokens ||
      limits.activeSeconds * 1000 < row.elapsedMs
    )
      throw Error('新预算不能小于已经使用的额度');
    return this.save({ ...row, limits, stoppedReason: undefined });
  }
}
