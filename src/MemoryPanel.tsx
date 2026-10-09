import { useCallback, useEffect, useState } from 'react';
import type { Memory, MemorySource } from '../shared/types';
import { api, post, put, remove } from './api';
import { Select } from './Select';
const labels = {
  active: '已生效',
  candidate: '待确认',
  revoked: '已撤销',
  stale: '来源失效或已过期',
};
export function MemoryPanel({
  assistantId,
  projectId,
  onSource,
}: {
  assistantId: string;
  projectId: string;
  onSource: (source: MemorySource) => void;
}) {
  const [rows, setRows] = useState<Memory[]>([]),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('current'),
    [draft, setDraft] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Memory | null>(null),
    [content, setContent] = useState(''),
    [reason, setReason] = useState(''),
    [expiry, setExpiry] = useState('');
  const load = useCallback(
    async () =>
      setRows(
        await api<Memory[]>(
          `/memories?assistantId=${encodeURIComponent(assistantId)}&projectId=${encodeURIComponent(projectId)}`,
        ),
      ),
    [assistantId, projectId],
  );
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const visible = rows.filter(
    (m) =>
      (filter === 'all' ||
        (filter === 'current' && ['active', 'candidate', 'stale'].includes(m.status!)) ||
        m.status === filter) &&
      m.content.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="memory-panel">
      <div className="memory-toolbar">
        <input
          aria-label="查找记忆"
          placeholder="查找记忆"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select aria-label="记忆状态" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="current">当前记忆</option>
          <option value="candidate">待确认</option>
          <option value="all">全部记录</option>
        </Select>
        <button type="button" disabled={busy} onClick={() => void act(load)}>
          刷新
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="memory-list">
        {visible.map((m) => (
          <article className="memory-entry" key={m.id}>
            <div className="memory-heading">
              <span className={'review-badge ' + (m.status === 'active' ? 'adopted' : '')}>
                {labels[m.status || 'active']}
              </span>
              <small>版本 {m.revision}</small>
            </div>
            <p>{m.content}</p>
            {m.invalidationReason && <p className="hint">{m.invalidationReason}</p>}
            <details>
              <summary>为什么记住与来源</summary>
              <p className="muted">{m.reason}</p>
              {m.expiresAt && (
                <p className="muted">有效至 {new Date(m.expiresAt).toLocaleString('zh-CN')}</p>
              )}
              {m.sources?.map((s, index) => (
                <div className="memory-source" key={index}>
                  <strong>{s.title}</strong>
                  {s.excerpt && <blockquote>{s.excerpt}</blockquote>}
                  {s.type === 'web' && s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      查看网页
                    </a>
                  ) : ['message', 'file'].includes(s.type) ? (
                    <button type="button" className="text-button" onClick={() => onSource(s)}>
                      查看原文
                    </button>
                  ) : null}
                </div>
              ))}
            </details>
            <div className="actions">
              {m.status === 'candidate' && (
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      post(`/memories/${m.id}/confirm`, {
                        revision: m.revision,
                        reason: '用户核对来源后确认',
                      }),
                    )
                  }
                >
                  确认记住
                </button>
              )}
              {m.status !== 'revoked' && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(m);
                      setContent(m.content);
                      setReason('');
                      setExpiry('');
                    }}
                  >
                    更正
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        post(`/memories/${m.id}/revoke`, {
                          revision: m.revision,
                          reason: '用户撤销，不再用于后续任务',
                        }),
                      )
                    }
                  >
                    {m.status === 'candidate' ? '不记住' : '撤销'}
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(() => remove('/memories/' + m.id))}
              >
                删除记录
              </button>
            </div>
            {editing?.id === m.id && (
              <div className="memory-correction">
                <label>
                  更正后的内容
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </label>
                <label>
                  更正原因
                  <input
                    maxLength={2000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label>
                  有效至（可选）
                  <input
                    type="datetime-local"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </label>
                <p className="hint">更正作为你的新声明保存，旧版本留在修改历史中。</p>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !content.trim() || !reason.trim()}
                    onClick={() =>
                      void act(async () => {
                        await put('/memories/' + m.id, {
                          revision: m.revision,
                          content,
                          reason,
                          sources: [{ type: 'manual' }],
                          ...(expiry ? { expiresAt: new Date(expiry).toISOString() } : {}),
                        });
                        setEditing(null);
                      })
                    }
                  >
                    保存更正
                  </button>
                  <button type="button" onClick={() => setEditing(null)}>
                    取消更正
                  </button>
                </div>
              </div>
            )}
            {m.history && m.history.length > 1 && (
              <details className="memory-history">
                <summary>修改历史 · {m.history.length} 个版本</summary>
                {[...m.history].reverse().map((h) => (
                  <div key={h.revision}>
                    <small>
                      版本 {h.revision} · {labels[h.status]} ·{' '}
                      {new Date(h.changedAt).toLocaleString('zh-CN')}
                    </small>
                    <p>{h.content}</p>
                    <small>{h.reason}</small>
                    <details>
                      <summary>当时的来源</summary>
                      {h.sources.map((source, index) => (
                        <div className="memory-source" key={index}>
                          <strong>{source.title}</strong>
                          {source.excerpt && <blockquote>{source.excerpt}</blockquote>}
                        </div>
                      ))}
                    </details>
                  </div>
                ))}
              </details>
            )}
          </article>
        ))}
      </div>
      {!visible.length && <p className="muted">暂无符合条件的记忆</p>}
      <label>
        新增记忆
        <textarea
          rows={2}
          maxLength={4000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="例如：回答时先给结论"
        />
      </label>
      <button
        type="button"
        disabled={busy || !draft.trim()}
        onClick={() =>
          void act(async () => {
            await post('/memories', {
              assistantId,
              projectId,
              content: draft,
              reason: '用户在助手设置中明确保存',
              sources: [{ type: 'manual' }],
            });
            setDraft('');
          })
        }
      >
        保存记忆
      </button>
    </section>
  );
}
export function MemoryCapture({
  assistantId,
  projectId,
  messageId,
  original,
  onSaved,
}: {
  assistantId: string;
  projectId: string;
  messageId: string;
  original: string;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(original.slice(0, 4000)),
    [excerpt, setExcerpt] = useState(original.slice(0, 2000)),
    [reason, setReason] = useState(''),
    [expiry, setExpiry] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await post('/memories', {
            assistantId,
            projectId,
            content,
            reason,
            sources: [{ type: 'message', id: messageId, excerpt }],
            ...(expiry ? { expiresAt: new Date(expiry).toISOString() } : {}),
          });
          onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        要记住的内容
        <textarea
          rows={3}
          required
          maxLength={4000}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </label>
      <label>
        来源摘录
        <textarea
          rows={3}
          required
          maxLength={4000}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
        />
      </label>
      <label>
        为什么记住
        <input
          required
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例如：这是我的长期写作偏好"
        />
      </label>
      <label>
        有效至（可选）
        <input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="primary" disabled={busy}>
          确认记住
        </button>
      </div>
    </form>
  );
}
