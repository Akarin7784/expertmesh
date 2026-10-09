import { useCallback, useEffect, useState } from 'react';
import type { Assistant, Project, ToolConnection, ToolGrant } from '../shared/types';
import { api, post, put, remove } from './api';
import { Select } from './Select';
export function ToolSettings({
  assistants,
  projects,
}: {
  assistants: Assistant[];
  projects: Project[];
}) {
  const [connections, setConnections] = useState<ToolConnection[]>([]),
    [assistantId, setAssistant] = useState('general'),
    [projectId, setProject] = useState(''),
    [grants, setGrants] = useState<ToolGrant[]>([]),
    [selected, setSelected] = useState<Record<string, string[]>>({}),
    [confirmed, setConfirmed] = useState<Record<string, boolean>>({}),
    [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [key, setKey] = useState(''),
    [local, setLocal] = useState(false),
    [protocol, setProtocol] = useState<ToolConnection['protocol']>('2025-11-25'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const [rows, permissions] = await Promise.all([
      api<ToolConnection[]>('/tool-connections'),
      api<ToolGrant[]>(
        `/tool-grants?assistantId=${encodeURIComponent(assistantId)}&projectId=${encodeURIComponent(projectId)}`,
      ),
    ]);
    setConnections(rows);
    setGrants(permissions);
    setSelected(
      Object.fromEntries(
        rows.map((row) => [
          row.id,
          permissions
            .find((g) => g.connectionId === row.id)
            ?.tools.filter((g) =>
              row.tools.some((t) => t.name === g.name && t.hash === g.hash && t.readOnly),
            )
            .map((g) => g.name) || [],
        ]),
      ),
    );
    setConfirmed({});
  }, [assistantId, projectId]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const work = async (id: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
      setNotice(success);
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  };
  const edit = (row?: ToolConnection) => {
    setEditing(row?.id || 'new');
    setName(row?.name || '');
    setUrl(row?.url || '');
    setProtocol(row?.protocol || '2025-11-25');
    setKey('');
    setLocal(row?.allowLocal || false);
  };
  return (
    <section className="tool-settings">
      <div className="section-heading">
        <h2>工具连接</h2>
        <button onClick={() => edit()}>添加工具连接</button>
      </div>
      <p className="hint">连接可信的资料服务，再选择助手可用的只读工具。</p>
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
      {editing && (
        <form
          className="tool-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void work(
              'edit',
              async () => {
                const body = { name, url, protocol, allowLocal: local, enabled: true, apiKey: key };
                if (editing === 'new') await post('/tool-connections', body);
                else await put('/tool-connections/' + editing, body);
                setEditing(null);
                setKey('');
              },
              '连接已保存，请测试后授权工具',
            );
          }}
        >
          <label>
            工具连接名称
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            工具服务地址
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
            />
          </label>
          <label>
            访问令牌（可选）
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={editing !== 'new' ? '留空保留当前令牌' : 'Bearer token'}
            />
          </label>
          <label>
            兼容版本
            <Select
              aria-label="工具协议版本"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as ToolConnection['protocol'])}
            >
              <option value="2025-11-25">2025-11-25 · 会话连接</option>
              <option value="2026-07-28">2026-07-28 · 无会话连接</option>
            </Select>
          </label>
          <label className="check-label">
            <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
            允许本地或内网工具服务
          </label>
          <p className="hint">编辑连接后需要重新测试并授权。</p>
          <div className="actions">
            <button className="primary" disabled={!!busy}>
              保存工具连接
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setKey('');
              }}
            >
              取消
            </button>
          </div>
        </form>
      )}
      <div className="tool-scope">
        <label>
          使用助手
          <Select
            aria-label="工具使用助手"
            value={assistantId}
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
            aria-label="工具使用空间"
            value={projectId}
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
      {!connections.length && <p className="muted">尚未连接资料工具</p>}
      {connections.map((c) => (
        <article className="tool-connection" key={c.id}>
          <div className="section-heading">
            <div>
              <h3>{c.name}</h3>
              <small>
                {c.status === 'ready' ? '连接正常' : c.status === 'failed' ? '连接失败' : '待测试'}{' '}
                · {c.enabled ? '已启用' : '已停用'}
              </small>
            </div>
            <div className="actions">
              <button
                disabled={!!busy}
                onClick={() =>
                  void work(c.id, () => post('/tool-connections/' + c.id + '/test'), '连接测试通过')
                }
              >
                {busy === c.id ? '测试中…' : '测试工具连接'}
              </button>
              <button disabled={!!busy} onClick={() => edit(c)}>
                编辑
              </button>
              <button
                disabled={!!busy}
                onClick={() =>
                  void work(
                    c.id,
                    () =>
                      api('/tool-connections/' + c.id, {
                        method: 'PATCH',
                        body: JSON.stringify({ enabled: !c.enabled }),
                      }),
                    c.enabled ? '连接已停用' : '连接已启用',
                  )
                }
              >
                {c.enabled ? '停用' : '启用'}
              </button>
              <button
                disabled={!!busy}
                onClick={() =>
                  void work(c.id, () => remove('/tool-connections/' + c.id), '工具连接已删除')
                }
              >
                删除
              </button>
            </div>
          </div>
          <p className="tool-address">{c.url}</p>
          {c.error && <p className="error">{c.error}</p>}
          {c.tools.length > 0 && (
            <details open>
              <summary>可用工具 · {c.tools.filter((t) => t.readOnly).length} 个只读工具</summary>
              <div className="tool-catalog">
                {c.tools.map((t) => (
                  <label key={t.name} className="tool-option">
                    <input
                      type="checkbox"
                      disabled={!!busy || !t.readOnly || !c.enabled || c.status !== 'ready'}
                      checked={(selected[c.id] || []).includes(t.name)}
                      onChange={(e) =>
                        setSelected({
                          ...selected,
                          [c.id]: e.target.checked
                            ? [...(selected[c.id] || []), t.name]
                            : (selected[c.id] || []).filter((n) => n !== t.name),
                        })
                      }
                    />
                    <span>
                      <strong>{t.name}</strong>
                      <small>{t.blockedReason || t.description}</small>
                    </span>
                  </label>
                ))}
              </div>
              {grants
                .find((g) => g.connectionId === c.id)
                ?.tools.some(
                  (g) => !c.tools.some((t) => t.hash === g.hash && t.name === g.name && t.readOnly),
                ) && <p className="hint">工具定义已变化，原授权不再生效。</p>}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!confirmed[c.id]}
                  onChange={(e) => setConfirmed({ ...confirmed, [c.id]: e.target.checked })}
                />
                我已确认所选工具只读取资料
              </label>
              <p className="hint">服务声明不能保证实际行为，请只授权你信任的工具。</p>
              <button
                className="primary"
                disabled={!!busy || !confirmed[c.id] || c.status !== 'ready'}
                onClick={() =>
                  void work(
                    'grant',
                    () =>
                      put('/tool-grants', {
                        connectionId: c.id,
                        assistantId,
                        projectId,
                        tools: selected[c.id] || [],
                        confirmedReadOnly: true,
                      }),
                    '工具授权已保存',
                  )
                }
              >
                保存工具授权
              </button>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
