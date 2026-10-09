import { useEffect, useState } from 'react';
import { put, api } from './api';
import { BudgetFields } from './ExecutionSettings';
import type { BudgetLimits, SandboxRun, ExecutionRecord, Task } from '../shared/types';
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
  const [limits, setLimits] = useState<BudgetLimits>(),
    [budgetError, setBudgetError] = useState(''),
    [budgetNote, setBudgetNote] = useState(''),
    [runs, setRuns] = useState<SandboxRun[]>([]),
    [runsOpen, setRunsOpen] = useState(false),
    [runsError, setRunsError] = useState('');
  useEffect(() => {
    if (!runsOpen) return;
    let current = true;
    api<SandboxRun[]>('/tasks/' + task.id + '/sandbox-runs')
      .then((value) => {
        if (current) {
          setRuns(value);
          setRunsError('');
        }
      })
      .catch((error) => {
        if (current) setRunsError(error.message);
      });
    return () => {
      current = false;
    };
  }, [runsOpen, task.id, task.updatedAt]);
  return (
    <>
      {task.budget && (
        <details className="task-budget">
          <summary>
            任务预算 · 模型 {task.budget.modelCalls}/{task.budget.limits.modelCalls} · 工具{' '}
            {task.budget.toolCalls}/{task.budget.limits.toolCalls}
          </summary>
          <p>
            {task.budget.knownTokens.toLocaleString()} 已报告 tokens /{' '}
            {task.budget.limits.tokens.toLocaleString()} · {task.budget.unknownUsage} 次用量未知 ·{' '}
            {(task.budget.elapsedMs / 1000).toFixed(1)} 秒 / {task.budget.limits.activeSeconds} 秒 ·
            代码执行 {task.budget.sandboxRuns}/{task.budget.limits.sandboxRuns}
          </p>
          <p className="hint">
            主任务与协作共用预算；未报告用量不记为零。已提供记忆不等于模型实际采用。
          </p>
          {task.budget.stoppedReason && <p>{task.budget.stoppedReason}</p>}
          {['paused', 'failed'].includes(task.status) && !task.parentId && (
            <>
              <button onClick={() => setLimits(task.budget!.limits)}>调整预算</button>
              {limits && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBudgetError('');
                    try {
                      await put('/tasks/' + task.id + '/budget', limits);
                      setLimits(undefined);
                      setBudgetNote('预算已更新，可以继续任务');
                    } catch (e) {
                      setBudgetError((e as Error).message);
                    }
                  }}
                >
                  <BudgetFields value={limits} onChange={setLimits} />
                  <button>保存任务预算</button>
                </form>
              )}
            </>
          )}
          {budgetError && (
            <p role="alert" className="error">
              {budgetError}
            </p>
          )}
          {budgetNote && <p role="status">{budgetNote}</p>}
        </details>
      )}
      <details className="sandbox-result" onToggle={(e) => setRunsOpen(e.currentTarget.open)}>
        <summary>代码执行结果</summary>
        {runsError ? (
          <p role="alert" className="error">
            {runsError}
          </p>
        ) : runs.length ? (
          runs.map((r) => (
            <div key={r.id}>
              <strong>
                {r.runtime} · {r.status} · 退出码 {r.exitCode ?? '未知'}
              </strong>
              <pre>
                {r.stdout}
                {r.stderr}
              </pre>
              <small>{r.workspaceFiles.length} 份只读快照文件</small>
            </div>
          ))
        ) : (
          <p className="hint">此任务尚未执行代码</p>
        )}
      </details>
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
                  <strong>
                    {r.kind === 'model' ? r.modelId : r.displayName || names[r.name] || r.name}
                  </strong>
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
                {r.memories && (
                  <details>
                    <summary>已提供记忆 · {r.memories.length} 条</summary>
                    {r.memories.map((m, i) => (
                      <p key={i}>
                        {m.method === 'context' ? '上下文提供' : '工具检索'} · 版本 {m.revision} ·{' '}
                        {m.content}
                        <br />
                        <small>
                          {m.sourceTitles.join('、')} · 记忆 {m.memoryId}
                        </small>
                      </p>
                    ))}
                    <p className="hint">记录提供的版本与来源，不证明模型实际引用或采用。</p>
                  </details>
                )}
                {r.error && <p className="error">{r.error}</p>}
              </li>
            ))}
        </ol>
        {!rows.length && <p className="muted">此任务尚无执行记录</p>}
      </details>
    </>
  );
}
