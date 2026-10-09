export type Provider =
  'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'qwen' | 'glm' | 'ollama' | 'compatible';
export type Status = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export interface Model {
  id: string;
  name: string;
  tools: boolean;
}
export interface Connection {
  id: string;
  provider: Provider;
  name: string;
  baseUrl: string;
  models: Model[];
  hasKey: boolean;
  allowLocal: boolean;
  createdAt: string;
}
export interface Project {
  id: string;
  name: string;
  instructions: string;
  createdAt: string;
}
export interface Assistant {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  tools: boolean;
  createdAt: string;
}
export interface Memory {
  id: string;
  assistantId: string;
  projectId: string;
  content: string;
  createdAt: string;
  status?: MemoryStatus;
  revision?: number;
  reason?: string;
  sources?: MemorySource[];
  expiresAt?: string;
  updatedAt?: string;
  history?: MemoryRevision[];
  invalidationReason?: string;
}
export type MemoryStatus = 'candidate' | 'active' | 'revoked' | 'stale';
export interface MemorySource {
  type: 'manual' | 'message' | 'file' | 'web' | 'workspace' | 'legacy';
  id: string;
  title: string;
  excerpt: string;
  hash: string;
  conversationId?: string;
  url?: string;
}
export interface MemoryRevision {
  revision: number;
  content: string;
  status: MemoryStatus;
  reason: string;
  sources: MemorySource[];
  expiresAt?: string;
  changedAt: string;
  action: 'created' | 'confirmed' | 'corrected' | 'revoked' | 'invalidated';
}
export interface Conversation {
  id: string;
  title: string;
  projectId: string;
  assistantId: string;
  createdAt: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  fileIds: string[];
  taskId: string;
  status: string;
  createdAt: string;
}
export interface FileRecord {
  id: string;
  name: string;
  content: string;
  projectId: string;
  conversationId: string;
  taskId: string;
  kind: 'upload' | 'artifact';
  size: number;
  createdAt: string;
}
export interface TaskEvent {
  id: string;
  taskId: string;
  type: string;
  text: string;
  createdAt: string;
}
export interface Task {
  budget?: BudgetState;
  contract?: TaskContract;
  review?: TaskReview;
  id: string;
  parentId: string;
  conversationId: string;
  assistantId: string;
  projectId: string;
  title: string;
  mode: 'chat' | 'task';
  status: Status;
  connectionId: string;
  modelId: string;
  modelName: string;
  result: string;
  error: string;
  round: number;
  createdAt: string;
  updatedAt: string;
}
export interface TaskContract {
  version: 1;
  goal: string;
  input: string;
  fileIds: string[];
  deliverable: string;
  criteria: string[];
  dependencies: string[];
}
export interface TaskReview {
  decision: 'adopted' | 'rejected';
  reason: string;
  checks: { index: number; passed: boolean; evidence: string }[];
  reviewedAt: string;
}
export interface TokenUsage {
  input: number;
  output: number;
  cachedInput?: number;
}
export interface ExecutionRecord {
  id: string;
  taskId: string;
  kind: 'execution' | 'model' | 'tool';
  name: string;
  modelId: string;
  provider: Provider;
  callId?: string;
  displayName?: string;
  memories?: MemoryExposure[];
  cached: boolean;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted';
  startedAt: string;
  endedAt?: string;
  durationMs: number | null;
  usage?: TokenUsage;
  costUsd: number | null;
  error?: string;
}
export interface Bootstrap {
  toolConnections?: ToolConnection[];
  search: SearchSettings;
  connections: Connection[];
  projects: Project[];
  assistants: Assistant[];
  conversations: Conversation[];
  tasks: Task[];
  files: FileRecord[];
  defaultModel: string;
}
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  hash: string;
  readOnly: boolean;
  blockedReason?: string;
}
export interface ToolConnection {
  id: string;
  name: string;
  url: string;
  protocol: '2025-11-25' | '2026-07-28';
  allowLocal: boolean;
  enabled: boolean;
  hasKey: boolean;
  status: 'untested' | 'ready' | 'failed';
  tools: McpTool[];
  testedAt?: string;
  error?: string;
}
export interface ToolGrant {
  id: string;
  connectionId: string;
  assistantId: string;
  projectId: string;
  tools: { name: string; hash: string }[];
}
export interface SearchSettings {
  provider: 'tavily' | 'searxng';
  baseUrl: string;
  hasKey: boolean;
  allowLocal: boolean;
  enabled: boolean;
}
export interface WebSource {
  id: string;
  taskId: string;
  conversationId: string;
  title: string;
  url: string;
  snippet: string;
  content: string;
  query: string;
  fetchedAt: string;
  read: boolean;
  truncated?: boolean;
}
export const providers: { id: Provider; name: string; baseUrl: string }[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'qwen', name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'glm', name: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434' },
  { id: 'compatible', name: '自定义兼容服务', baseUrl: '' },
];

export interface BudgetLimits {
  modelCalls: number;
  toolCalls: number;
  tokens: number;
  contextChars: number;
  activeSeconds: number;
  sandboxRuns: number;
}
export interface BudgetState {
  id: string;
  limits: BudgetLimits;
  modelCalls: number;
  toolCalls: number;
  knownTokens: number;
  unknownUsage: number;
  elapsedMs: number;
  sandboxRuns: number;
  stoppedReason?: string;
}
export interface MemoryExposure {
  memoryId: string;
  revision: number;
  content: string;
  sourceTitles: string[];
  method: 'context' | 'search';
}
export interface Workspace {
  id: string;
  name: string;
  path: string;
  identity: string;
  enabled: boolean;
  createdAt: string;
}
export interface WorkspaceGrant {
  id: string;
  workspaceId: string;
  assistantId: string;
  projectId: string;
}
export interface SandboxSettings {
  enabled: boolean;
  timeoutSeconds: number;
  images: { python?: string; javascript?: string };
}
export interface SandboxRun {
  id: string;
  taskId: string;
  runtime: 'python' | 'javascript';
  image: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  endedAt?: string;
  workspaceFiles: { workspaceId: string; path: string; hash: string }[];
}
