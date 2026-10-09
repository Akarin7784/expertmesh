import type { ExecutionRecord, Task } from '../shared/types';
import { summarizeExecution } from '../shared/execution';
const names: Record<string, string> = {
  list_files: '查看资料',
  read_file: '阅读资料',
  search_files: '查找资料',
  write_artifact: '生成文件',
  delegate_task: '安排协作',
  review_task: '验收结果',
  search_web: '联网搜索',
  read_webpage: '阅读网页',
};
const statuses = { running: '进行中', succeeded: '已完成', failed: '失败', interrupted: '已中断' };
const elapsed = (ms: number) => (ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`);
export function ExecutionDetails({
  task,
  children,
  records,
}: {
  task: Task;
  children: Task[];
  records: ExecutionRecord[];
}) {
  const ids = new Set([task.id, ...children.map((c) => c.id)]),
    rows = records.filter((r) => ids.has(r.taskId)),
    summary = summarizeExecution(task.id, rows);
  return (
    <>
      {children.length > 0 && (
        <details className="contract-details">
          <summary>协作要求与验收 · {children.length} 位助手</summary>
          {children.map((c) => (
            <article className="contract-item" key={c.id}>
              <h4>
                {c.title}
                <span className={'review-badge ' + (c.review?.decision || 'pending')}>
                  {c.review ? (c.review.decision === 'adopted' ? '已采用' : '已退回') : '待验收'}
                </span>
              </h4>
              {c.contract ? (
                <>
                  <dl>
                    <dt>输入</dt>
                    <dd>{c.contract.input}</dd>
                    <dt>交付</dt>
                    <dd>{c.contract.deliverable}</dd>
                    <dt>资料范围</dt>
                    <dd>{c.contract.fileIds.length} 份指定资料</dd>
                    {c.contract.dependencies.length > 0 && (
                      <>
                        <dt>依赖</dt>
                        <dd>
                          {c.contract.dependencies
                            .map((id) => children.find((x) => x.id === id)?.title || id)
                            .join('、')}
                        </dd>
                      </>
                    )}
                  </dl>
                  <ol>
                    {c.contract.criteria.map((criterion, index) => {
                      const check = c.review?.checks.find((x) => x.index === index);
                      return (
                        <li key={index}>
                          {criterion}
                          {check && (
                            <small>
                              {check.passed ? '通过' : '未通过'} · {check.evidence}
                            </small>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  {c.review && <p className="review-reason">{c.review.reason}</p>}
                </>
              ) : (
                <p className="muted">早期任务未保存协作要求</p>
              )}
            </article>
          ))}
        </details>
      )}
      <details className="execution-details">
        <summary>
          执行记录 · {summary.models} 次模型调用 · {elapsed(summary.durationMs)}
          {summary.unknownDuration ? '（部分耗时未知）' : ''}
        </summary>
        <div className="execution-metrics">
          <span>{summary.tools} 次工具执行</span>
          <span>{summary.cached} 次结果复用</span>
          <span>
            {summary.tokens.toLocaleString()} 已知 tokens
            {summary.unknownUsage ? ` · ${summary.unknownUsage} 次用量未返回` : ''}
            {summary.partialUsage ? ' · 含中断前用量' : ''}
          </span>
          <span>费用未提供</span>
        </div>
        <ol className="execution-list">
          {rows
            .filter((r) => r.kind !== 'execution')
            .map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.kind === 'model' ? r.modelId : names[r.name] || r.name}</strong>
                  <span>
                    {r.cached ? '结果复用 · ' : ''}
                    {statuses[r.status]}
                  </span>
                </div>
                <small>
                  {r.taskId === task.id ? '主助手' : children.find((c) => c.id === r.taskId)?.title}{' '}
                  · {r.provider} · {r.durationMs === null ? '耗时未确定' : elapsed(r.durationMs)}
                  {r.usage
                    ? ` · 输入 ${r.usage.input} / 输出 ${r.usage.output}${r.usage.cachedInput !== undefined ? ` / 缓存命中 ${r.usage.cachedInput}` : ''}`
                    : r.kind === 'model'
                      ? ' · 用量未返回'
                      : ''}
                </small>
                {r.error && <p className="error">{r.error}</p>}
              </li>
            ))}
        </ol>
        {!rows.length && <p className="muted">此任务尚无执行记录</p>}
      </details>
    </>
  );
}
