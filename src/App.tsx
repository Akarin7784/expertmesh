import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  CirclePause,
  Copy,
  Download,
  FileText,
  Files,
  Folder,
  Globe,
  ListChecks,
  LoaderCircle,
  Menu,
  Paperclip,
  Play,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  Assistant,
  Bootstrap,
  Connection,
  Conversation,
  FileRecord,
  Memory,
  Model,
  Project,
  Task,
  TaskEvent,
  SearchSettings,
} from '../shared/types';
import { providers } from '../shared/types';
import { api, bootstrap, post, put, remove, type Thread } from './api';
import { Logo } from './Logo';

type Page = 'chat' | 'tasks' | 'projects' | 'assistants' | 'files' | 'settings';
type Modal =
  | { kind: 'connection'; value?: Connection }
  | { kind: 'project'; value?: Project }
  | { kind: 'assistant'; value?: Assistant }
  | { kind: 'confirm'; title: string; description: string; action: () => Promise<unknown> }
  | null;
const empty: Bootstrap = {
  search: {
    provider: 'tavily',
    baseUrl: 'https://api.tavily.com',
    hasKey: false,
    allowLocal: false,
    enabled: false,
  },
  connections: [],
  projects: [],
  assistants: [],
  conversations: [],
  tasks: [],
  files: [],
  defaultModel: '',
};
const labels: Record<string, string> = {
  queued: '准备中',
  running: '进行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消',
};
const date = (s: string) =>
  new Date(s).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
const modelKey = (connection: string, model: string) => `${connection}::${model}`;
function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="dialog"
    >
      <div className="dialog-title">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ConnectionEditor({
  value,
  onSave,
  onClose,
}: {
  value?: Connection;
  onSave: (body: unknown, id?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState(value?.provider || 'openai'),
    [name, setName] = useState(value?.name || 'OpenAI'),
    [baseUrl, setBase] = useState(value?.baseUrl || providers[0].baseUrl),
    [key, setKey] = useState(''),
    [models, setModels] = useState<Model[]>(value?.models || [{ id: '', name: '', tools: true }]),
    [local, setLocal] = useState(value?.allowLocal || false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog title={value ? '编辑模型服务' : '添加模型服务'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setSaving(true);
          try {
            await onSave(
              {
                provider,
                name,
                baseUrl,
                apiKey: key,
                allowLocal: local,
                models: models.map((m) => ({
                  ...m,
                  name: m.name.trim() || m.id.trim(),
                  id: m.id.trim(),
                })),
              },
              value?.id,
            );
            setKey('');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          服务商
          <select
            aria-label="服务商"
            value={provider}
            disabled={!!value}
            onChange={(e) => {
              const p = providers.find((p) => p.id === e.target.value)!;
              setProvider(p.id);
              setName(p.name);
              setBase(p.baseUrl);
              setLocal(p.id === 'ollama');
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          连接名称
          <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          API Key {value?.hasKey && <span className="muted">（留空保留已有密钥）</span>}
          <input
            type="password"
            autoComplete="new-password"
            required={provider !== 'ollama' && !value?.hasKey}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={provider === 'ollama' ? '可选' : '填写你的 API Key'}
          />
        </label>
        <label>
          服务地址
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBase(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className="check-label">
          <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
          允许本地或内网服务
        </label>
        <div className="field-heading">
          <span>模型</span>
          <button
            type="button"
            className="text-button"
            onClick={() => setModels([...models, { id: '', name: '', tools: true }])}
          >
            <Plus size={14} />
            添加
          </button>
        </div>
        {models.map((m, i) => (
          <div className="model-row" key={i}>
            <input
              aria-label={`模型 ID ${i + 1}`}
              placeholder="模型 ID"
              required
              value={m.id}
              maxLength={200}
              onChange={(e) =>
                setModels(models.map((x, n) => (n === i ? { ...x, id: e.target.value } : x)))
              }
            />
            <input
              aria-label={`模型显示名称 ${i + 1}`}
              placeholder="显示名称（可选）"
              value={m.name}
              maxLength={200}
              onChange={(e) =>
                setModels(models.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))
              }
            />
            <label className="check-label">
              <input
                type="checkbox"
                checked={m.tools}
                onChange={(e) =>
                  setModels(models.map((x, n) => (n === i ? { ...x, tools: e.target.checked } : x)))
                }
              />
              工具调用
            </label>
            {models.length > 1 && (
              <button
                type="button"
                className="icon-button"
                aria-label="移除模型"
                onClick={() => setModels(models.filter((_, n) => n !== i))}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        <p className="hint">填写服务商提供的模型 ID。工具调用能力需与模型匹配。</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={saving}>
            {saving ? '保存中…' : '保存连接'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function ProjectEditor({
  value,
  onSave,
  onClose,
}: {
  value?: Project;
  onSave: (body: unknown, id?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(value?.name || ''),
    [instructions, setInstructions] = useState(value?.instructions || ''),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  return (
    <Dialog title={value ? '编辑项目' : '新建项目'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await onSave({ name, instructions }, value?.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          项目名称
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="例如：产品研究"
          />
        </label>
        <label>
          项目说明
          <textarea
            rows={5}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={12000}
            placeholder="目标、背景，以及希望助手遵循的要求"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={saving}>
            保存项目
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function ModelPicker({
  data,
  value,
  onChange,
  id = 'model-select',
}: {
  data: Bootstrap;
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  return (
    <select id={id} aria-label="选择模型" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        选择模型
      </option>
      {data.connections.map((c) => (
        <optgroup label={c.name} key={c.id}>
          {c.models.map((m) => (
            <option key={m.id} value={modelKey(c.id, m.id)}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
function AssistantEditor({
  value,
  data,
  projectId,
  onSave,
  onClose,
  onError,
}: {
  value?: Assistant;
  data: Bootstrap;
  projectId: string;
  onSave: (body: unknown, id?: string) => Promise<void>;
  onClose: () => void;
  onError: (error: string) => void;
}) {
  const [name, setName] = useState(value?.name || ''),
    [description, setDescription] = useState(value?.description || ''),
    [instructions, setInstructions] = useState(value?.instructions || ''),
    [model, setModel] = useState(value?.model || ''),
    [tools, setTools] = useState(value?.tools ?? true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [memories, setMemories] = useState<Memory[]>([]),
    [memory, setMemory] = useState('');
  useEffect(() => {
    if (value)
      api<Memory[]>(
        `/memories?assistantId=${encodeURIComponent(value.id)}&projectId=${encodeURIComponent(projectId)}`,
      )
        .then(setMemories)
        .catch((e) => onError(e.message));
  }, [value?.id, projectId]);
  return (
    <Dialog title={value ? '编辑助手' : '创建助手'} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await onSave({ name, description, instructions, model, tools }, value?.id);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          名称
          <input value={name} required maxLength={200} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          用途
          <input
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          工作要求
          <textarea
            rows={5}
            value={instructions}
            required
            maxLength={12000}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="说明这个助手如何帮助你"
          />
        </label>
        <label>
          默认模型
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">跟随对话选择</option>
            {data.connections.map((c) => (
              <optgroup key={c.id} label={c.name}>
                {c.models.map((m) => (
                  <option key={m.id} value={modelKey(c.id, m.id)}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="check-label">
          <input type="checkbox" checked={tools} onChange={(e) => setTools(e.target.checked)} />
          允许读取资料、生成文件与助手协作
        </label>
        {value && (
          <details>
            <summary>
              记住我的偏好 · {data.projects.find((p) => p.id === projectId)?.name || '个人空间'}
            </summary>
            <div className="memory-list">
              {memories.map((m) => (
                <div className="memory-row" key={m.id}>
                  <span>{m.content}</span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="删除偏好"
                    onClick={async () => {
                      try {
                        await remove('/memories/' + m.id);
                        setMemories(memories.filter((x) => x.id !== m.id));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
            <label>
              新增偏好
              <textarea
                rows={2}
                value={memory}
                maxLength={4000}
                onChange={(e) => setMemory(e.target.value)}
                placeholder="例如：回答时先给结论"
              />
            </label>
            <button
              type="button"
              disabled={!memory.trim() || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const m = await post<Memory>('/memories', {
                    assistantId: value.id,
                    projectId,
                    content: memory,
                  });
                  setMemories([...memories, m]);
                  setMemory('');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              保存偏好
            </button>
          </details>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={saving}>
            保存助手
          </button>
        </div>
      </form>
    </Dialog>
  );
}
function SearchSettingsPanel({
  value,
  onSave,
  onError,
}: {
  value: SearchSettings;
  onSave: () => Promise<unknown>;
  onError: (error: unknown) => void;
}) {
  const [provider, setProvider] = useState(value.provider),
    [baseUrl, setBase] = useState(value.baseUrl),
    [key, setKey] = useState(''),
    [local, setLocal] = useState(value.allowLocal),
    [enabled, setEnabled] = useState(value.enabled),
    [saving, setSaving] = useState(false),
    [testing, setTesting] = useState(false),
    [query, setQuery] = useState(''),
    [results, setResults] = useState<{ title: string; url: string; snippet: string }[] | null>(
      null,
    ),
    [status, setStatus] = useState('');
  useEffect(() => {
    setProvider(value.provider);
    setBase(value.baseUrl);
    setLocal(value.allowLocal);
    setEnabled(value.enabled);
  }, [JSON.stringify(value)]);
  return (
    <section className="settings-section search-settings">
      <div className="setting-row">
        <h2>联网搜索</h2>
        <span className="hint">{value.enabled ? '已启用' : '未配置'}</span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setStatus('');
          try {
            await put('/settings/search', {
              provider,
              baseUrl,
              apiKey: key,
              allowLocal: local,
              enabled,
            });
            setKey('');
            setResults(null);
            await onSave();
            setStatus('搜索设置已保存');
          } catch (e) {
            onError(e);
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          搜索服务
          <select
            aria-label="搜索服务"
            value={provider}
            onChange={(e) => {
              const p = e.target.value as SearchSettings['provider'];
              setProvider(p);
              setBase(p === 'tavily' ? 'https://api.tavily.com' : 'http://localhost:8080');
              setLocal(p === 'searxng');
              setKey('');
              setResults(null);
            }}
          >
            <option value="tavily">Tavily</option>
            <option value="searxng">SearXNG</option>
          </select>
        </label>
        <label>
          搜索服务地址
          <input type="url" required value={baseUrl} onChange={(e) => setBase(e.target.value)} />
        </label>
        <label>
          搜索 API Key
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              provider === 'searxng'
                ? '可选'
                : value.hasKey && provider === value.provider
                  ? '留空保留已有密钥'
                  : '填写 Tavily API Key'
            }
          />
        </label>
        <div className="search-options">
          <label className="check-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用联网搜索
          </label>
          <label className="check-label">
            <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
            允许本地搜索服务
          </label>
        </div>
        <div className="actions">
          <button className="primary" disabled={saving}>
            {saving ? '保存中…' : '保存搜索设置'}
          </button>
          <span className="hint" role="status">
            {status}
          </span>
        </div>
      </form>
      <details>
        <summary>测试搜索</summary>
        <div className="search-test">
          <input
            aria-label="测试搜索词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={500}
            placeholder="输入一个搜索词"
          />
          <button
            disabled={testing || !query.trim() || !value.enabled}
            onClick={async () => {
              setTesting(true);
              setResults(null);
              try {
                const r = await post<{
                  results: { title: string; url: string; snippet: string }[];
                }>('/settings/search/test', { query });
                setResults(r.results);
                setStatus(r.results.length ? '搜索成功' : '搜索完成，暂无结果');
              } catch (e) {
                onError(e);
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? '搜索中…' : '测试搜索'}
          </button>
        </div>
        {results && (
          <div className="search-preview">
            {results.map((r) => (
              <div key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
                <p>{r.snippet}</p>
              </div>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}

function TaskCard({
  task,
  children,
  events,
  files,
  onControl,
  onOpen,
  onFile,
}: {
  task: Task;
  children: Task[];
  events: TaskEvent[];
  files: FileRecord[];
  onControl: (id: string, action: string) => void;
  onOpen?: () => void;
  onFile: (id: string) => void;
}) {
  return (
    <section className="task-card">
      <div className="task-heading">
        <div>
          <h3>{task.title}</h3>
          <span className={'status status-' + task.status}>
            {['running', 'queued'].includes(task.status) && (
              <LoaderCircle className="spin" size={13} />
            )}{' '}
            {labels[task.status]}
          </span>
        </div>
        <div className="actions">
          {onOpen && <button onClick={onOpen}>打开对话</button>}
          {['queued', 'running'].includes(task.status) && (
            <button aria-label="暂停任务" onClick={() => onControl(task.id, 'pause')}>
              <CirclePause size={15} />
              暂停
            </button>
          )}
          {['paused', 'failed'].includes(task.status) && (
            <button onClick={() => onControl(task.id, 'resume')}>
              <Play size={14} />
              继续
            </button>
          )}
          {['queued', 'running', 'paused', 'failed'].includes(task.status) && (
            <button aria-label="取消任务" onClick={() => onControl(task.id, 'cancel')}>
              <Square size={12} />
              结束
            </button>
          )}
        </div>
      </div>
      {task.error && <p className="error">{task.error}</p>}
      {files.length > 0 && (
        <div className="artifact-list">
          {files.map((f) => (
            <button key={f.id} className="file-chip" onClick={() => onFile(f.id)}>
              <FileText size={16} />
              {f.name}
            </button>
          ))}
        </div>
      )}
      {(children.length > 0 || events.length > 0) && (
        <details>
          <summary>
            {children.length > 0 ? `协作与活动 · ${children.length} 位助手` : '查看活动'}
          </summary>
          {children.map((c) => (
            <div key={c.id} className="collaborator">
              <Users size={14} />
              <span>{c.title}</span>
              <span className="muted">{labels[c.status]}</span>
            </div>
          ))}
          <ol className="timeline">
            {events.slice(-8).map((e) => (
              <li key={e.id}>{e.text}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

export default function App() {
  const [data, setData] = useState<Bootstrap>(empty),
    [loaded, setLoaded] = useState(false),
    [page, setPage] = useState<Page>('chat'),
    [conversationId, setConversation] = useState(''),
    [thread, setThread] = useState<Thread | null>(null),
    [projectId, setProject] = useState(''),
    [assistantId, setAssistant] = useState('general'),
    [model, setModel] = useState(''),
    [mode, setMode] = useState<'chat' | 'task'>('chat'),
    [web, setWeb] = useState(false),
    [draft, setDraft] = useState(''),
    [editTarget, setEditTarget] = useState<{ conversationId: string; messageId: string } | null>(
      null,
    ),
    [attached, setAttached] = useState<string[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [modal, setModal] = useState<Modal>(null),
    [preview, setPreview] = useState<FileRecord | null>(null),
    [sending, setSending] = useState(false),
    [uploading, setUploading] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [filter, setFilter] = useState('all'),
    [taskDetails, setTaskDetails] = useState<
      Record<string, { children: Task[]; events: TaskEvent[]; files: FileRecord[] }>
    >({}),
    [testing, setTesting] = useState(''),
    [discovered, setDiscovered] = useState<Record<string, string[]>>({}),
    [theme, setTheme] = useState(() => localStorage.getItem('em-theme') || 'system');
  const input = useRef<HTMLInputElement>(null),
    end = useRef<HTMLDivElement>(null),
    draftRef = useRef<HTMLTextAreaElement>(null),
    currentId = useRef(conversationId);
  currentId.current = conversationId;
  const showError = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const refresh = useCallback(async () => {
    const value = await bootstrap();
    setData(value);
    setLoaded(true);
    return value;
  }, []);
  useEffect(() => {
    refresh().catch(showError);
  }, [refresh]);
  useEffect(() => {
    if (!data.search.enabled) setWeb(false);
  }, [data.search.enabled]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('em-theme', theme);
  }, [theme]);
  useEffect(() => {
    const choices = data.connections.flatMap((c) => c.models.map((m) => modelKey(c.id, m.id)));
    if (!choices.includes(model))
      setModel(choices.includes(data.defaultModel) ? data.defaultModel : choices[0] || '');
  }, [data.connections, data.defaultModel, model]);
  useEffect(() => {
    if (!conversationId) {
      setThread(null);
      return;
    }
    let live = true;
    const load = async () => {
      try {
        const t = await api<Thread>('/conversations/' + conversationId);
        if (live && currentId.current === conversationId) {
          setThread(t);
          setProject(t.conversation.projectId);
          setAssistant(t.conversation.assistantId);
        }
      } catch (e) {
        if (live) showError(e);
      }
    };
    void load();
    const timer = setInterval(load, 900);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [conversationId]);
  useEffect(() => {
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (page !== 'tasks') return;
    let live = true;
    const load = async () => {
      try {
        const values = await Promise.all(
          data.tasks.map((t) =>
            api<{ children: Task[]; events: TaskEvent[]; files: FileRecord[] }>('/tasks/' + t.id),
          ),
        );
        if (live) setTaskDetails(Object.fromEntries(data.tasks.map((t, i) => [t.id, values[i]])));
      } catch (e) {
        if (live) showError(e);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [page, data.tasks]);
  useEffect(() => {
    if (thread?.messages.length && page === 'chat')
      end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [thread?.messages.length, page]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 5000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const navigate = (p: Page) => {
    setPage(p);
    setSidebar(false);
    setError('');
    setFilter('all');
  };
  const newChat = (project = projectId, assistant = assistantId) => {
    setEditTarget(null);
    setMode('chat');
    setConversation('');
    setThread(null);
    setPage('chat');
    setProject(project);
    setAssistant(assistant);
    setDraft('');
    setAttached([]);
    setSidebar(false);
    setError('');
    const a = data.assistants.find((a) => a.id === assistant);
    if (a?.model) setModel(a.model);
  };
  const openChat = (id: string) => {
    setEditTarget(null);
    setThread(null);
    setConversation(id);
    navigate('chat');
    setDraft('');
    setAttached([]);
  };
  const openFile = async (id: string) => {
    try {
      setPreview(await api<FileRecord>('/files/' + id));
    } catch (e) {
      showError(e);
    }
  };
  const confirm = (title: string, description: string, action: () => Promise<unknown>) =>
    setModal({ kind: 'confirm', title, description, action });
  const activeTask = thread?.tasks.find(
    (t) => !t.parentId && ['queued', 'running', 'paused'].includes(t.status),
  );
  const waiting = activeTask && ['queued', 'running'].includes(activeTask.status);
  const control = async (id: string, action: string) => {
    try {
      setError('');
      await post('/tasks/' + id + '/' + action);
      await refresh();
      if (conversationId) setThread(await api<Thread>('/conversations/' + conversationId));
    } catch (e) {
      showError(e);
    }
  };
  const send = async (override?: {
    content: string;
    fileIds: string[];
    target: { conversationId: string; messageId: string };
    mode: 'chat' | 'task';
  }) => {
    const text = override?.content ?? draft,
      target = override?.target ?? editTarget;
    if (sending || !text.trim()) return;
    if (!model) {
      setModal({ kind: 'connection' });
      return;
    }
    if (activeTask) {
      setError('请先继续或结束当前任务');
      return;
    }
    setSending(true);
    setError('');
    try {
      let id = conversationId;
      if (target) {
        const c = await post<Conversation>('/conversations/' + target.conversationId + '/fork', {
          beforeMessageId: target.messageId,
        });
        id = c.id;
        setConversation(id);
        setThread(null);
        setEditTarget(null);
      }
      if (!id) {
        const c = await post<Conversation>('/conversations', { projectId, assistantId });
        id = c.id;
        setConversation(id);
      }
      const [connectionId, modelId] = model.split('::');
      await post('/conversations/' + id + '/messages', {
        content: text,
        connectionId,
        modelId,
        mode: override?.mode ?? mode,
        fileIds: override?.fileIds ?? attached,
        web,
      });
      setDraft('');
      setAttached([]);
      setThread(await api<Thread>('/conversations/' + id));
      await refresh();
    } catch (e) {
      showError(e);
    } finally {
      setSending(false);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      [...files].forEach((f) => body.append('files', f));
      body.append('projectId', projectId);
      const result = await api<FileRecord[]>('/files', { method: 'POST', body });
      setAttached([...new Set([...attached, ...result.map((f) => f.id)])].slice(0, 10));
      setNotice(`已上传 ${result.length} 个文件`);
      await refresh();
    } catch (e) {
      showError(e);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  };
  const editQuestion = (messageId: string) => {
    if (!thread || activeTask) return;
    const m = thread.messages.find((m) => m.id === messageId && m.role === 'user');
    if (!m) return;
    setEditTarget({ conversationId: thread.conversation.id, messageId: m.id });
    setMode(thread.tasks.find((t) => t.id === m.taskId)?.mode || 'chat');
    setDraft(m.content);
    setAttached(m.fileIds.filter((id) => data.files.some((f) => f.id === id)));
    setNotice('发送后会保留原对话，并创建新的回答版本');
    draftRef.current?.focus();
  };
  const save = async (path: string, body: unknown, id?: string) => {
    if (id) await put(path + '/' + id, body);
    else await post(path, body);
    setModal(null);
    await refresh();
    setNotice('已保存');
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('已复制');
    } catch {
      setError('无法访问剪贴板，请手动选择文本复制');
    }
  };
  const project = data.projects.find((p) => p.id === projectId),
    assistant = data.assistants.find((a) => a.id === assistantId);
  const composer = (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={draftRef}
          aria-label="发送消息"
          placeholder={waiting ? '你可以在任务完成后继续追问' : '有什么我可以帮你完成？'}
          value={draft}
          maxLength={16000}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {attached.length > 0 && (
          <div className="attachments">
            {attached.map((id) => (
              <span className="file-chip" key={id}>
                <FileText size={14} />
                {data.files.find((f) => f.id === id)?.name || '文件'}
                <button
                  className="icon-button"
                  aria-label="移除附件"
                  onClick={() => setAttached(attached.filter((x) => x !== id))}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-tools">
          <button
            className="icon-button"
            aria-label="添加附件"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            {uploading ? <LoaderCircle className="spin" size={18} /> : <Paperclip size={18} />}
          </button>
          <select
            aria-label="工作模式"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'chat' | 'task')}
          >
            <option value="chat">对话</option>
            <option value="task">执行任务</option>
          </select>
          <button
            className={'web-toggle ' + (web ? 'is-on' : '')}
            aria-label="联网搜索"
            aria-pressed={web}
            onClick={() => {
              if (!data.search.enabled) {
                navigate('settings');
                setNotice('先配置搜索服务，再开启联网');
                return;
              }
              setWeb(!web);
            }}
          >
            <Globe size={15} />
            <span>联网</span>
          </button>
          {data.connections.length > 0 ? (
            <ModelPicker data={data} value={model} onChange={setModel} />
          ) : (
            <button className="connect-model" onClick={() => setModal({ kind: 'connection' })}>
              连接模型
              <ChevronDown size={13} />
            </button>
          )}
          {waiting ? (
            <button
              className="send"
              aria-label="停止生成"
              onClick={() => control(activeTask!.id, 'pause')}
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              className="send"
              aria-label="发送"
              disabled={!draft.trim() || sending || uploading || !!activeTask}
              onClick={() => void send()}
            >
              {sending ? <LoaderCircle className="spin" size={18} /> : <ArrowUp size={19} />}
            </button>
          )}
        </div>
      </div>
      <div className="composer-caption">
        {project?.name}
        {project ? ' · ' : ''}
        {assistant?.name && assistant.id !== 'general' ? assistant.name + ' · ' : ''}Enter
        发送，Shift + Enter 换行
      </div>
    </div>
  );
  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (sidebar ? 'is-open' : '')}>
        <div className="brand">
          <Logo />
          ExpertMesh
          <button
            className="mobile-close icon-button"
            aria-label="关闭导航"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button className="new-chat" onClick={() => newChat('', 'general')}>
          <SquarePen size={17} />
          新对话
        </button>
        <nav>
          {(
            [
              { id: 'tasks', name: '任务', icon: ListChecks },
              { id: 'projects', name: '项目', icon: Folder },
              { id: 'assistants', name: '助手', icon: Users },
              { id: 'files', name: '文件', icon: Files },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={page === n.id ? 'active' : ''}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={17} />
              {n.name}
            </button>
          ))}
        </nav>
        <div className="recent-label">最近对话</div>
        <div className="recent-chats">
          {data.conversations.slice(0, 16).map((c) => (
            <div className="recent-item" key={c.id}>
              <button
                className={conversationId === c.id && page === 'chat' ? 'active' : ''}
                onClick={() => openChat(c.id)}
              >
                <span>{c.title}</span>
              </button>
              <button
                className="icon-button"
                aria-label={`删除对话 ${c.title}`}
                onClick={() =>
                  confirm('删除对话？', '对话记录将被删除，已生成文件会保留。', async () => {
                    await remove('/conversations/' + c.id);
                    if (conversationId === c.id) newChat('', 'general');
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!data.conversations.length && <p className="hint sidebar-hint">你的对话会保存在这里</p>}
        </div>
        <div className="sidebar-bottom">
          <button
            className={page === 'settings' ? 'active' : ''}
            onClick={() => navigate('settings')}
          >
            <Settings size={17} />
            设置
          </button>
          <span className="version">开源 Agent · v0.1</span>
        </div>
      </aside>
      {sidebar && (
        <button className="sidebar-scrim" aria-label="收起导航" onClick={() => setSidebar(false)} />
      )}
      <main>
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            onClick={() => setSidebar(true)}
            aria-label="打开导航"
          >
            <Menu size={19} />
          </button>
          <span>
            {page === 'chat'
              ? thread?.conversation.title || project?.name || '新对话'
              : {
                  tasks: '任务',
                  projects: '项目',
                  assistants: '助手',
                  files: '文件',
                  settings: '设置',
                }[page]}
          </span>
          <span className="space-name">{project?.name || '个人空间'}</span>
          {page === 'chat' && projectId && (
            <button className="text-button leave-project" onClick={() => newChat('', 'general')}>
              返回个人空间
            </button>
          )}
        </header>
        {error && (
          <div className="notice error-banner" role="alert">
            <span>{error}</span>
            <button className="icon-button" onClick={() => setError('')} aria-label="关闭提示">
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice success-banner" role="status">
            <Check size={16} />
            {notice}
          </div>
        )}
        <div className={'content ' + (page === 'chat' ? 'chat-content' : '')}>
          {!loaded ? (
            <div className="empty-state">
              <LoaderCircle className="spin" size={24} />
              <p>正在打开工作空间…</p>
              {error && <button onClick={() => refresh().catch(showError)}>重新连接</button>}
            </div>
          ) : (
            <>
              {page === 'chat' &&
                (!thread?.messages.length ? (
                  <div className="welcome">
                    <Logo className="welcome-mark" />
                    <h1>今天，我们一起完成什么？</h1>
                    {composer}
                    <div className="quick-actions">
                      {[
                        {
                          name: '研究',
                          icon: Search,
                          prompt: '帮我研究这个主题，整理主要观点与来源：',
                        },
                        { name: '写作', icon: SquarePen, prompt: '帮我写一份清晰的项目介绍：' },
                        {
                          name: '文件',
                          icon: FileText,
                          prompt: '总结上传资料中的关键信息，并生成一份摘要。',
                        },
                        {
                          name: '编程',
                          icon: SlidersHorizontal,
                          prompt: '请分析上传的代码，并给出改进方案与修改后的文件。',
                        },
                      ].map((q) => (
                        <button
                          key={q.name}
                          onClick={() => {
                            setDraft(q.prompt);
                            draftRef.current?.focus();
                          }}
                        >
                          <q.icon size={15} />
                          {q.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="thread">
                    <div className="messages">
                      {thread.messages.map((m) => (
                        <article key={m.id} className={'message ' + m.role}>
                          {m.role === 'user' ? (
                            <>
                              <div className="user-bubble">{m.content}</div>
                              <div className="user-actions">
                                <button
                                  className="icon-button"
                                  aria-label="编辑并重发问题"
                                  disabled={!!activeTask}
                                  onClick={() => editQuestion(m.id)}
                                >
                                  <SquarePen size={14} />
                                </button>
                              </div>
                              {m.fileIds.length > 0 && (
                                <div className="message-files">
                                  {m.fileIds.map((id) => (
                                    <button
                                      key={id}
                                      className="file-chip"
                                      onClick={() => openFile(id)}
                                    >
                                      <FileText size={14} />
                                      {data.files.find((f) => f.id === id)?.name || '附件'}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="answer-brand">
                                <Logo />
                                {data.assistants.find(
                                  (a) => a.id === thread.conversation.assistantId,
                                )?.name || 'ExpertMesh'}
                              </div>
                              {m.content ? (
                                <Markdown text={m.content} />
                              ) : (
                                <p className="thinking">
                                  <LoaderCircle
                                    className={
                                      ['running', 'queued'].includes(m.status) ? 'spin' : ''
                                    }
                                    size={16}
                                  />
                                  {labels[m.status] || '正在准备'}
                                </p>
                              )}
                              {m.content && (
                                <div className="answer-actions">
                                  <button
                                    className="icon-button"
                                    aria-label="复制回答"
                                    onClick={() => copy(m.content)}
                                  >
                                    <Copy size={14} />
                                  </button>
                                  {m.status === 'completed' && m.taskId && (
                                    <button
                                      className="text-button"
                                      disabled={!!activeTask}
                                      onClick={() => {
                                        const question = thread.messages.find(
                                          (q) => q.taskId === m.taskId && q.role === 'user',
                                        );
                                        if (question)
                                          void send({
                                            content: question.content,
                                            fileIds: question.fileIds.filter((id) =>
                                              data.files.some((f) => f.id === id),
                                            ),
                                            target: {
                                              conversationId: thread.conversation.id,
                                              messageId: question.id,
                                            },
                                            mode:
                                              thread.tasks.find((t) => t.id === m.taskId)?.mode ||
                                              'chat',
                                          });
                                      }}
                                    >
                                      重新生成
                                    </button>
                                  )}
                                  {m.status !== 'completed' && (
                                    <span className="hint">{labels[m.status]}</span>
                                  )}
                                </div>
                              )}
                              {thread.sources.some(
                                (source) =>
                                  source.taskId === m.taskId ||
                                  thread.tasks.some(
                                    (t) => t.id === source.taskId && t.parentId === m.taskId,
                                  ),
                              ) && (
                                <details className="web-sources">
                                  <summary>
                                    网页来源 ·{' '}
                                    {
                                      thread.sources.filter(
                                        (source) =>
                                          source.taskId === m.taskId ||
                                          thread.tasks.some(
                                            (t) =>
                                              t.id === source.taskId && t.parentId === m.taskId,
                                          ),
                                      ).length
                                    }
                                  </summary>
                                  <div className="source-list">
                                    {thread.sources
                                      .filter(
                                        (source) =>
                                          source.taskId === m.taskId ||
                                          thread.tasks.some(
                                            (t) =>
                                              t.id === source.taskId && t.parentId === m.taskId,
                                          ),
                                      )
                                      .map((source) => (
                                        <a
                                          href={source.url}
                                          key={source.id}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          <Globe size={15} />
                                          <span>
                                            <strong>{source.title}</strong>
                                            <small>
                                              {new URL(source.url).hostname} ·{' '}
                                              {source.read ? '已读取正文' : '搜索摘要'}
                                            </small>
                                          </span>
                                        </a>
                                      ))}
                                  </div>
                                </details>
                              )}
                              {thread.tasks
                                .filter(
                                  (t) =>
                                    t.id === m.taskId &&
                                    !t.parentId &&
                                    (t.mode === 'task' || t.status !== 'completed'),
                                )
                                .map((t) => (
                                  <TaskCard
                                    key={t.id}
                                    task={t}
                                    children={thread.tasks.filter((c) => c.parentId === t.id)}
                                    events={thread.events.filter((e) => e.taskId === t.id)}
                                    files={thread.files.filter((f) => f.taskId === t.id)}
                                    onControl={control}
                                    onFile={openFile}
                                  />
                                ))}
                              {m.status === 'completed' &&
                                thread.tasks.find((t) => t.id === m.taskId)?.mode === 'chat' &&
                                m.fileIds.length > 0 && (
                                  <div className="artifact-list">
                                    {m.fileIds.map((id) => (
                                      <button
                                        className="file-chip"
                                        key={id}
                                        onClick={() => openFile(id)}
                                      >
                                        <FileText size={16} />
                                        {data.files.find((f) => f.id === id)?.name || '生成文件'}
                                      </button>
                                    ))}
                                  </div>
                                )}
                            </>
                          )}
                        </article>
                      ))}
                    </div>
                    <div ref={end} />
                    {composer}
                  </div>
                ))}
              {page === 'tasks' && (
                <div className="page-inner">
                  <div className="page-heading">
                    <h1>任务</h1>
                    <button
                      className="primary"
                      onClick={() => {
                        newChat();
                        setMode('task');
                      }}
                    >
                      新建任务
                      <Plus size={15} />
                    </button>
                  </div>
                  <div className="tabs" aria-label="任务筛选">
                    {[
                      ['all', '全部'],
                      ['active', '进行中'],
                      ['completed', '已完成'],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        aria-pressed={filter === id}
                        className={filter === id ? 'selected' : ''}
                        onClick={() => setFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {data.tasks
                    .filter(
                      (t) =>
                        filter === 'all' ||
                        (filter === 'completed'
                          ? t.status === 'completed'
                          : ['running', 'queued', 'paused', 'failed'].includes(t.status)),
                    )
                    .map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        children={taskDetails[t.id]?.children || []}
                        events={taskDetails[t.id]?.events || []}
                        files={taskDetails[t.id]?.files || []}
                        onControl={control}
                        onOpen={() => openChat(t.conversationId)}
                        onFile={openFile}
                      />
                    ))}
                  {!data.tasks.length && (
                    <div className="empty-state">
                      <ListChecks size={30} />
                      <h3>把一件事交给 Agent</h3>
                      <p>创建任务，跟进进展，在这里查看结果。</p>
                    </div>
                  )}
                </div>
              )}
              {page === 'projects' && (
                <div className="page-inner">
                  <div className="page-heading">
                    <h1>项目</h1>
                    <button className="primary" onClick={() => setModal({ kind: 'project' })}>
                      <Plus size={16} />
                      新建项目
                    </button>
                  </div>
                  <div className="cards-grid">
                    {data.projects.map((p) => (
                      <section className="project-card" key={p.id}>
                        <Folder size={23} />
                        <h3>{p.name}</h3>
                        <p className="muted">{p.instructions || '将资料与相关对话放在一起'}</p>
                        <div className="project-count">
                          {data.files.filter((f) => f.projectId === p.id).length} 个文件 ·{' '}
                          {data.conversations.filter((c) => c.projectId === p.id).length} 个对话
                        </div>
                        <div className="actions">
                          <button onClick={() => newChat(p.id, 'general')}>开始对话</button>
                          <button
                            onClick={() => {
                              setProject(p.id);
                              setPage('files');
                            }}
                          >
                            查看资料
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`编辑项目 ${p.name}`}
                            onClick={() => setModal({ kind: 'project', value: p })}
                          >
                            <SlidersHorizontal size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`删除项目 ${p.name}`}
                            onClick={() =>
                              confirm(
                                '删除项目？',
                                '对话和文件会保留在个人空间，此项目的助手偏好会删除。',
                                async () => {
                                  await remove('/projects/' + p.id);
                                  if (projectId === p.id) setProject('');
                                },
                              )
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </section>
                    ))}
                  </div>
                  {!data.projects.length && (
                    <div className="empty-state">
                      <Folder size={30} />
                      <h3>为长期工作创建一个项目</h3>
                      <p>加入背景资料，让相关对话和结果有处可寻。</p>
                    </div>
                  )}
                </div>
              )}
              {page === 'assistants' && (
                <div className="page-inner">
                  <div className="page-heading">
                    <h1>你的助手</h1>
                    <button className="primary" onClick={() => setModal({ kind: 'assistant' })}>
                      <Plus size={16} />
                      创建助手
                    </button>
                  </div>
                  <div className="cards-grid">
                    {data.assistants.map((a) => (
                      <section className="assistant-card" key={a.id}>
                        <div className="assistant-avatar">{a.name.slice(0, 1)}</div>
                        <h3>{a.name}</h3>
                        <p className="muted">{a.description}</p>
                        <div className="actions">
                          <button onClick={() => newChat(projectId, a.id)}>开始对话</button>
                          <button
                            className="icon-button"
                            aria-label={`编辑助手 ${a.name}`}
                            onClick={() => setModal({ kind: 'assistant', value: a })}
                          >
                            <SlidersHorizontal size={16} />
                          </button>
                          {!['general', 'researcher', 'writer', 'coder'].includes(a.id) && (
                            <button
                              className="icon-button"
                              aria-label={`删除助手 ${a.name}`}
                              onClick={() =>
                                confirm(
                                  '删除助手？',
                                  '已有对话和结果会保留，助手的偏好会删除。',
                                  () => remove('/assistants/' + a.id),
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              )}
              {page === 'files' && (
                <div className="page-inner">
                  <div className="page-heading">
                    <h1>文件</h1>
                    <button
                      className="primary"
                      disabled={uploading}
                      onClick={() => input.current?.click()}
                    >
                      <Plus size={16} />
                      上传文件
                    </button>
                  </div>
                  <div className="file-filter">
                    <select
                      aria-label="文件所属项目"
                      value={projectId}
                      onChange={(e) => setProject(e.target.value)}
                    >
                      <option value="">全部文件</option>
                      {data.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <span className="hint">文本、Markdown、CSV 与代码 · 每个文件最大 2 MB</span>
                  </div>
                  <div className="file-list">
                    {data.files
                      .filter((f) => !projectId || f.projectId === projectId)
                      .map((f) => (
                        <div className="file-row" key={f.id}>
                          <FileText size={21} />
                          <button className="file-name" onClick={() => openFile(f.id)}>
                            <strong>{f.name}</strong>
                            <span className="hint">
                              {f.kind === 'artifact' ? '生成结果' : '上传资料'} ·{' '}
                              {Math.max(1, Math.round(f.size / 1024))} KB · {date(f.createdAt)}
                            </span>
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`引用文件 ${f.name}`}
                            onClick={() => {
                              setProject(f.projectId);
                              newChat(f.projectId);
                              setAttached([f.id]);
                              setNotice('文件已加入新对话');
                            }}
                          >
                            <Paperclip size={16} />
                          </button>
                          <a
                            className="icon-button"
                            aria-label={`下载文件 ${f.name}`}
                            href={'/api/files/' + f.id + '/download'}
                          >
                            <Download size={16} />
                          </a>
                          <button
                            className="icon-button"
                            aria-label={`删除文件 ${f.name}`}
                            onClick={() =>
                              confirm('删除文件？', '文件删除后将不再用于后续请求。', () =>
                                remove('/files/' + f.id),
                              )
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                  </div>
                  {!data.files.length && (
                    <div className="empty-state">
                      <Files size={30} />
                      <h3>资料和结果，都在这里</h3>
                      <p>上传资料开始工作，或查看 Agent 生成的文件。</p>
                    </div>
                  )}
                </div>
              )}
              {page === 'settings' && (
                <div className="page-inner settings-page">
                  <div className="page-heading">
                    <h1>模型与服务商</h1>
                    <button className="primary" onClick={() => setModal({ kind: 'connection' })}>
                      <Plus size={16} />
                      添加服务
                    </button>
                  </div>
                  {data.connections.length > 0 && (
                    <label className="default-model">
                      默认模型
                      <ModelPicker
                        data={data}
                        value={data.defaultModel || model}
                        onChange={async (value) => {
                          try {
                            await put('/settings/default-model', { value });
                            setModel(value);
                            await refresh();
                            setNotice('默认模型已更新');
                          } catch (e) {
                            showError(e);
                          }
                        }}
                        id="default-model"
                      />
                    </label>
                  )}
                  {data.connections.map((c) => (
                    <section className="connection-card" key={c.id}>
                      <div className="connection-heading">
                        <div className="provider-avatar">{c.name[0]}</div>
                        <div className="grow">
                          <h3>{c.name}</h3>
                          <p className="hint">
                            {providers.find((p) => p.id === c.provider)?.name} · {c.models.length}{' '}
                            个模型 {c.hasKey ? '· 密钥已保存' : ''}
                          </p>
                        </div>
                        <div className="actions">
                          <button
                            disabled={!!testing}
                            onClick={async () => {
                              setTesting(c.id);
                              try {
                                const result = await post<{ models: string[] }>(
                                  '/connections/' + c.id + '/test',
                                );
                                setDiscovered({ ...discovered, [c.id]: result.models });
                                setNotice('连接成功，已获取模型列表');
                              } catch (e) {
                                showError(e);
                              } finally {
                                setTesting('');
                              }
                            }}
                          >
                            {testing === c.id ? '测试中…' : '测试连接'}
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`编辑服务 ${c.name}`}
                            onClick={() => setModal({ kind: 'connection', value: c })}
                          >
                            <SlidersHorizontal size={16} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`删除服务 ${c.name}`}
                            onClick={() =>
                              confirm(
                                '移除模型服务？',
                                '已有对话与文件会保留，此服务将不再出现在模型选择中。',
                                () => remove('/connections/' + c.id),
                              )
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="model-tags">
                        {c.models.map((m) => (
                          <span key={m.id}>{m.name}</span>
                        ))}
                      </div>
                      {discovered[c.id] && (
                        <details>
                          <summary>可用模型 · {discovered[c.id].length}</summary>
                          <p className="model-discovery">{discovered[c.id].join('、')}</p>
                        </details>
                      )}
                    </section>
                  ))}
                  {!data.connections.length && (
                    <div className="empty-state">
                      <Sparkles size={30} />
                      <h3>连接你喜欢的模型</h3>
                      <p>使用自己的 API Key，或连接本地 Ollama。</p>
                      <button onClick={() => setModal({ kind: 'connection' })}>
                        添加第一个服务
                      </button>
                    </div>
                  )}
                  <section className="settings-section">
                    <h2>工具</h2>
                    <div className="setting-row">
                      <span>资料读取与文件生成</span>
                      <span className="hint">可在助手配置中启用</span>
                    </div>
                    <div className="setting-row">
                      <span>代码执行与 MCP</span>
                      <span className="hint">尚未接入</span>
                    </div>
                  </section>
                  <SearchSettingsPanel value={data.search} onSave={refresh} onError={showError} />
                  <section className="settings-section">
                    <h2>外观</h2>
                    <div className="setting-row">
                      <label htmlFor="theme">显示模式</label>
                      <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
                        <option value="system">跟随系统</option>
                        <option value="light">浅色</option>
                        <option value="dark">深色</option>
                      </select>
                    </div>
                  </section>
                  <section className="settings-section">
                    <h2>数据</h2>
                    <div className="setting-row">
                      <span>导出对话、项目与文件</span>
                      <a className="secondary" href="/api/export">
                        <Download size={15} />
                        导出数据
                      </a>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.go,.rs,.sql,.log,.sh,.toml"
        onChange={(e) => void upload(e.target.files)}
        aria-label="上传资料"
      />
      {modal?.kind === 'connection' && (
        <ConnectionEditor
          value={modal.value}
          onClose={() => setModal(null)}
          onSave={(body, id) => save('/connections', body, id)}
        />
      )}
      {modal?.kind === 'project' && (
        <ProjectEditor
          value={modal.value}
          onClose={() => setModal(null)}
          onSave={(body, id) => save('/projects', body, id)}
        />
      )}
      {modal?.kind === 'assistant' && (
        <AssistantEditor
          value={modal.value}
          data={data}
          projectId={projectId}
          onError={setError}
          onClose={() => setModal(null)}
          onSave={(body, id) => save('/assistants', body, id)}
        />
      )}
      {modal?.kind === 'confirm' && (
        <Dialog title={modal.title} onClose={() => setModal(null)}>
          <p>{modal.description}</p>
          <div className="dialog-actions">
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="primary"
              onClick={async () => {
                try {
                  await modal.action();
                  setModal(null);
                  await refresh();
                  setNotice('已删除');
                } catch (e) {
                  showError(e);
                  setModal(null);
                }
              }}
            >
              确认删除
            </button>
          </div>
        </Dialog>
      )}
      {preview && (
        <Dialog title={preview.name} onClose={() => setPreview(null)}>
          <div className="preview-toolbar">
            <span className="hint">{preview.kind === 'artifact' ? '生成结果' : '上传资料'}</span>
            <div className="actions">
              <button onClick={() => copy(preview.content)}>
                <Copy size={15} />
                复制
              </button>
              <a className="secondary" href={'/api/files/' + preview.id + '/download'}>
                <Download size={15} />
                下载
              </a>
              <button
                onClick={() => {
                  newChat(preview.projectId);
                  setAttached([preview.id]);
                  setPreview(null);
                }}
              >
                继续处理
              </button>
            </div>
          </div>
          <div className="file-preview">
            {/\.(md|markdown)$/i.test(preview.name) ? (
              <Markdown text={preview.content} />
            ) : (
              <pre>{preview.content}</pre>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
