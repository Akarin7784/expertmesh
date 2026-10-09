import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExecutionRecord } from '../shared/types';
import { summarizeExecution } from '../shared/execution';
test('execution totals avoid counting nested child spans and distinguish cached/unknown calls', () => {
  const record: ExecutionRecord = {
    id: 'r',
    taskId: 'root',
    kind: 'execution',
    name: 'execute',
    modelId: 'test',
    provider: 'compatible',
    cached: false,
    status: 'succeeded',
    startedAt: '2026-10-09T00:00:00Z',
    durationMs: 2000,
    costUsd: null,
  };
  const summary = summarizeExecution('root', [
    record,
    { ...record, id: 'child-span', taskId: 'child', durationMs: 1000 },
    { ...record, id: 'pause', durationMs: 500, status: 'interrupted' },
    { ...record, id: 'model', kind: 'model', usage: { input: 100, output: 20, cachedInput: 40 } },
    { ...record, id: 'missing', kind: 'model', status: 'failed' },
    { ...record, id: 'tool', kind: 'tool' },
    { ...record, id: 'cached', kind: 'tool', cached: true },
  ]);
  assert.deepEqual(summary, {
    models: 2,
    tools: 1,
    cached: 1,
    tokens: 120,
    unknownUsage: 1,
    partialUsage: false,
    durationMs: 2500,
    unknownDuration: false,
  });
});
