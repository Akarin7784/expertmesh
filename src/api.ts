import type {
  ExecutionRecord,
  Bootstrap,
  Conversation,
  FileRecord,
  Message,
  Task,
  TaskEvent,
  WebSource,
} from '../shared/types';
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '请求失败');
  return data as T;
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const remove = (path: string) => api(path, { method: 'DELETE' });
export type Thread = {
  memoryCandidates?: number;
  memoryReviews?: { assistantId: string; count: number }[];
  sources: Omit<WebSource, 'content'>[];
  conversation: Conversation;
  messages: Message[];
  tasks: Task[];
  records: ExecutionRecord[];
  events: TaskEvent[];
  files: FileRecord[];
};
export const bootstrap = () => api<Bootstrap>('/bootstrap');
