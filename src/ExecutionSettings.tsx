import { useEffect, useRef, useState } from 'react';
import type {
  Assistant,
  Project,
  BudgetLimits,
  Workspace,
  WorkspaceGrant,
  SandboxSettings,
  SandboxRun,
} from '../shared/types';
import { api, post, put, remove } from './api';
import { Select } from './Select';

export const budgetLabels: Record<keyof BudgetLimits, string> = {
  modelCalls: '模型调用次数',
  toolCalls: '工具调用次数',
  tokens: '已报告 token 上限',
  contextChars: '单次上下文字符',
  activeSeconds: '执行时间（秒）',
  sandboxRuns: '代码执行次数',
};
export function BudgetFields({
  value,
  onChange,
}: {
  value: BudgetLimits;
  onChange: (value: BudgetLimits) => void;
}) {
  return (
    <div className="budget-fields">
      {(Object.keys(budgetLabels) as (keyof BudgetLimits)[]).map((key) => (
        <label key={key}>
          {budgetLabels[key]}
          <input
            type="number"
            required
            min={
              {
                modelCalls: 1,
                toolCalls: 1,
                tokens: 100,
                contextChars: 1000,
                activeSeconds: 5,
                sandboxRuns: 0,
              }[key]
            }
            max={
              {
                modelCalls: 200,
                toolCalls: 500,
                tokens: 2000000,
                contextChars: 1000000,
                activeSeconds: 7200,
                sandboxRuns: 100,
              }[key]
            }
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
          />
        </label>
      ))}
    </div>
  );
}
export function ExecutionSettings({
  assistants,
  projects,
}: {
  assistants: Assistant[];
  projects: Project[];
}) {
  const [budget, setBudget] = useState<BudgetLimits>(),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [grants, setGrants] = useState<WorkspaceGrant[]>([]),
    [assistant, setAssistant] = useState('general'),
    [project, setProject] = useState(''),
    [name, setName] = useState(''),
    [path, setPath] = useState(''),
    [sandbox, setSandbox] = useState<{
      ready: boolean;
      message: string;
      settings: SandboxSettings;
    }>(),
    [run, setRun] = useState<SandboxRun>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const generation = useRef(0);
  const [files, setFiles] = useState<{ id: string; paths: string[]; truncated: boolean }>();
  const load = async () => {
    const version = ++generation.current;
    const [b, w, g, s] = await Promise.all([
      api<BudgetLimits>('/settings/budget'),
      api<Workspace[]>('/workspaces'),
      api<WorkspaceGrant[]>(
        `/workspace-grants?assistantId=${encodeURIComponent(assistant)}&projectId=${encodeURIComponent(project)}`,
      ),
      api<{ ready: boolean; message: string; settings: SandboxSettings }>('/sandbox'),
    ]);
    if (version !== generation.current) return;
    setBudget(b);
    setWorkspaces(w);
    setGrants(g);
    setSandbox(s);
  };
  useEffect(() => {
    setGrants([]);
    setFiles(undefined);
    load().catch((e) => setError(e.message));
    return () => {
      generation.current++;
    };
  }, [assistant, project]);
  const work = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="execution-settings">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="tool-notice">
          {notice}
        </p>
      )}
      <section>
        <h2>任务预算</h2>
        <p className="hint">主助手与协作助手共用额度。暂停后可调整，恢复不会清零。</p>
        {budget && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void work(() => put('/settings/budget', budget), '新任务预算已保存');
            }}
          >
            <BudgetFields value={budget} onChange={setBudget} />
            <p className="hint">
              token 依赖服务返回用量，单次响应可能超过阈值；费用尚不作预算保证。
            </p>
            <button className="primary" disabled={busy}>
              保存默认预算
            </button>
          </form>
        )}
      </section>
      <section>
        <h2>本地工作区</h2>
        <p className="hint">只读连接目录，按助手和空间授权。不会修改原项目。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void work(async () => {
              await post('/workspaces', { name, path });
              setName('');
              setPath('');
            }, '目录已连接，请为助手授权');
          }}
          className="workspace-form"
        >
          <label>
            目录名称
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </label>
          <label>
            本地目录路径
            <input
              required
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="例如 C:\\Projects\\my-app"
            />
          </label>
          <button className="secondary" disabled={busy}>
            连接目录
          </button>
          {window.expertmeshDesktop && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const selected = await window.expertmeshDesktop!.chooseDirectory();
                  if (selected) setPath(selected);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              选择目录
            </button>
          )}
        </form>
        <div className="tool-scope">
          <label>
            授权助手
            <Select
              aria-label="工作区授权助手"
              disabled={busy}
              value={assistant}
              onChange={(e) => setAssistant(e.target.value)}
            >
              {assistants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            使用空间
            <Select
              aria-label="工作区使用空间"
              disabled={busy}
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">个人空间</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {workspaces.map((w) => (
          <div key={w.id} className="workspace-row">
            <div>
              <h3>{w.name}</h3>
              <p className="hint">{w.path}</p>
            </div>
            <div className="actions">
              <button
                disabled={busy || !grants.some((g) => g.workspaceId === w.id)}
                onClick={() =>
                  void work(async () => {
                    const listing = await api<{ files: { path: string }[]; truncated: boolean }>(
                      `/workspaces/${w.id}/files?assistantId=${encodeURIComponent(assistant)}&projectId=${encodeURIComponent(project)}`,
                    );
                    setFiles({
                      id: w.id,
                      paths: listing.files.map((f) => f.path),
                      truncated: listing.truncated,
                    });
                  }, '已读取可用文件列表')
                }
              >
                查看文件
              </button>
              <label className="check-label">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={grants.some((g) => g.workspaceId === w.id)}
                  onChange={(e) => {
                    const enabled = e.target.checked,
                      previous = grants;
                    setGrants(
                      enabled
                        ? [
                            ...grants,
                            {
                              id: 'pending-' + w.id,
                              workspaceId: w.id,
                              assistantId: assistant,
                              projectId: project,
                            },
                          ]
                        : grants.filter((g) => g.workspaceId !== w.id),
                    );
                    void work(async () => {
                      try {
                        await put('/workspace-grants', {
                          workspaceId: w.id,
                          assistantId: assistant,
                          projectId: project,
                          enabled,
                        });
                      } catch (error) {
                        setGrants(previous);
                        throw error;
                      }
                    }, '目录授权已更新');
                  }}
                />
                允许读取
              </label>
              <button
                disabled={busy}
                onClick={() => void work(() => remove('/workspaces/' + w.id), '目录连接已移除')}
              >
                移除连接
              </button>
            </div>
            {files?.id === w.id && (
              <details open>
                <summary>
                  可读取文件 · {files.paths.length} 份{files.truncated ? '（列表已截断）' : ''}
                </summary>
                <pre>{files.paths.join('\n') || '目录中没有支持的文本文件'}</pre>
              </details>
            )}
          </div>
        ))}
        {!workspaces.length && <p className="hint">尚未连接本地目录</p>}
      </section>
      <section>
        <h2>代码沙箱</h2>
        <p className="hint">在独立环境运行 Python 与 JavaScript，返回真实输出和退出码。</p>
        <p role="status" className="hint">
          {sandbox?.message || '正在检查环境…'}
        </p>
        <div className="actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void work(() => post('/sandbox/prepare'), '环境已准备并通过检查')}
          >
            {busy ? '处理中…' : '准备并检查环境'}
          </button>
          <button disabled={busy} onClick={() => void work(async () => {}, '环境状态已刷新')}>
            刷新状态
          </button>
        </div>
        <p className="hint">首次准备下载运行镜像。执行时禁用网络，工作区为只读文本快照。</p>
        {sandbox && (
          <div className="sandbox-options">
            <label className="check-label">
              <input
                type="checkbox"
                checked={sandbox.settings.enabled}
                disabled={
                  busy || !sandbox.settings.images.python || !sandbox.settings.images.javascript
                }
                onChange={(e) =>
                  void work(
                    () =>
                      put('/sandbox', {
                        enabled: e.target.checked,
                        timeoutSeconds: sandbox.settings.timeoutSeconds,
                      }),
                    '代码执行设置已保存',
                  )
                }
              />
              允许助手运行代码
            </label>
            <label>
              单次执行时间（秒）
              <input
                type="number"
                min={1}
                max={120}
                value={sandbox.settings.timeoutSeconds}
                onChange={(e) =>
                  setSandbox({
                    ...sandbox,
                    settings: { ...sandbox.settings, timeoutSeconds: Number(e.target.value) },
                  })
                }
                onBlur={() =>
                  void work(
                    () =>
                      put('/sandbox', {
                        enabled: sandbox.settings.enabled,
                        timeoutSeconds: sandbox.settings.timeoutSeconds,
                      }),
                    '执行时限已保存',
                  )
                }
              />
            </label>
          </div>
        )}
        <div className="actions">
          {(['python', 'javascript'] as const).map((runtime) => (
            <button
              key={runtime}
              disabled={busy || !sandbox?.settings.enabled}
              onClick={() =>
                void work(async () => {
                  setRun(await post<SandboxRun>('/sandbox/test', { runtime }));
                }, '环境测试完成')
              }
            >
              测试 {runtime === 'python' ? 'Python' : 'JavaScript'}
            </button>
          ))}
        </div>
        {run && (
          <details open>
            <summary>测试结果 · 退出码 {run.exitCode ?? '未知'}</summary>
            <pre>{run.stdout || run.stderr}</pre>
          </details>
        )}
      </section>
    </div>
  );
}
