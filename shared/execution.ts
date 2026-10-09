import type { ExecutionRecord } from './types';
export function summarizeExecution(taskId: string, records: ExecutionRecord[]) {
  const models = records.filter((r) => r.kind === 'model');
  const spans = records.filter((r) => r.kind === 'execution' && r.taskId === taskId);
  return {
    models: models.length,
    tools: records.filter((r) => r.kind === 'tool' && !r.cached).length,
    cached: records.filter((r) => r.kind === 'tool' && r.cached).length,
    tokens: models.reduce((n, r) => n + (r.usage ? r.usage.input + r.usage.output : 0), 0),
    unknownUsage: models.filter((r) => !r.usage).length,
    partialUsage: models.some((r) => r.usage && r.status !== 'succeeded'),
    durationMs: spans.reduce(
      (n, r) =>
        n +
        (r.durationMs ??
          (r.status === 'running' ? Math.max(0, Date.now() - Date.parse(r.startedAt)) : 0)),
      0,
    ),
    unknownDuration: spans.some((r) => r.durationMs === null && r.status !== 'running'),
  };
}
