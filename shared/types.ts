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
export interface Bootstrap {
  search: SearchSettings;
  connections: Connection[];
  projects: Project[];
  assistants: Assistant[];
  conversations: Conversation[];
  tasks: Task[];
  files: FileRecord[];
  defaultModel: string;
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
