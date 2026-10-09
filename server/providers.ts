import { uid } from './db';
import { secureFetch } from './security';
import type { Connection, TokenUsage } from '../shared/types';

export interface CredentialConnection extends Connection {
  encryptedKey: string;
}
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface Call {
  id: string;
  name: string;
  arguments: string;
  nativeId?: string;
}
export interface Turn {
  usage?: TokenUsage;
  text: string;
  calls: Call[];
  history: any[];
}
export interface Request {
  connection: Connection;
  key: string;
  model: string;
  system: string;
  history: any[];
  tools: Tool[];
  signal: AbortSignal;
  onText?: (text: string) => void;
  onUsage?: (usage: TokenUsage) => void;
}
export type Fetcher = typeof fetch;

// Handles split UTF-8, CRLF, multiline SSE data and a final unterminated frame.
export async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  const parse = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return undefined;
    return JSON.parse(data);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const obj = parse(frame);
        if (obj !== undefined) yield obj;
      }
      if (done) {
        if (buffer.trim()) {
          const obj = parse(buffer);
          if (obj !== undefined) yield obj;
        }
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let at;
      while ((at = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line) yield JSON.parse(line);
      }
      if (done) {
        if (buffer.trim()) yield JSON.parse(buffer);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function post(
  r: Request,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  fetcher: Fetcher,
) {
  // Revalidate each request; redirects never carry keys to another origin.
  const target = r.connection.baseUrl.replace(/\/$/, '') + path;
  const options: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.any([r.signal, AbortSignal.timeout(120_000)]),
    redirect: 'error',
  };
  const response =
    fetcher === fetch
      ? await secureFetch(target, options, r.connection.allowLocal)
      : await fetcher(target, options);
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      response.status === 401 || response.status === 403
        ? '服务认证失败，请检查密钥与模型权限'
        : response.status === 429
          ? '模型服务请求过于频繁，请稍后继续'
          : `模型服务返回 HTTP ${response.status}，请检查模型和连接配置`,
    );
  }
  if (!response.body) throw Error('模型服务没有返回内容');
  return response;
}
export function firstHistory(
  provider: Connection['provider'],
  messages: { role: string; content: string }[],
): any[] {
  if (provider === 'gemini')
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  return messages.map((m) => ({ role: m.role, content: m.content }));
}
export function toolResult(provider: Connection['provider'], call: Call, result: string): any {
  if (provider === 'openai')
    return { type: 'function_call_output', call_id: call.id, output: result };
  if (provider === 'anthropic')
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: call.id, content: result }],
    };
  if (provider === 'gemini')
    return {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: call.name,
            ...(call.nativeId ? { id: call.nativeId } : {}),
            response: { result },
          },
        },
      ],
    };
  if (provider === 'ollama') return { role: 'tool', content: result, tool_name: call.name };
  return { role: 'tool', tool_call_id: call.id, content: result };
}
export async function generate(r: Request, fetcher: Fetcher = fetch): Promise<Turn> {
  let usage: TokenUsage | undefined;
  const count = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const report = (input: unknown, output: unknown, cached?: unknown) => {
    if (!count(input) || !count(output)) return;
    usage = { input, output, ...(count(cached) ? { cachedInput: cached } : {}) };
    r.onUsage?.(usage);
  };
  let text = '',
    completed = false;
  const calls: Call[] = [];
  const history = [...r.history];
  const add = (t: string) => {
    text += t;
    r.onText?.(t);
  };
  if (r.connection.provider === 'openai') {
    const res = await post(
      r,
      '/responses',
      {
        model: r.model,
        instructions: r.system,
        input: r.history,
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content'],
        tools: r.tools.map((t) => ({ type: 'function', ...t, strict: false })),
        max_output_tokens: 4096,
      },
      { Authorization: `Bearer ${r.key}` },
      fetcher,
    );
    let output: any[] = [];
    for await (const e of sse(res.body!)) {
      if (e.type === 'response.output_text.delta') add(e.delta);
      if (e.type === 'response.completed') {
        output = e.response.output || [];
        report(
          e.response.usage?.input_tokens,
          e.response.usage?.output_tokens,
          e.response.usage?.input_tokens_details?.cached_tokens,
        );
        completed = true;
      }
      if (['error', 'response.failed', 'response.incomplete'].includes(e.type))
        throw Error(
          e.type === 'response.incomplete'
            ? '模型输出未完成，请缩小目标后重试'
            : '模型服务生成失败，请检查配置后重试',
        );
    }
    history.push(...output);
    for (const item of output)
      if (item.type === 'function_call')
        calls.push({ id: item.call_id, name: item.name, arguments: item.arguments });
  } else if (r.connection.provider === 'anthropic') {
    const res = await post(
      r,
      '/messages',
      {
        model: r.model,
        system: r.system,
        messages: r.history,
        max_tokens: 4096,
        stream: true,
        ...(r.tools.length
          ? {
              tools: r.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
            }
          : {}),
      },
      { 'x-api-key': r.key, 'anthropic-version': '2023-06-01' },
      fetcher,
    );
    const blocks: any[] = [];
    const args: Record<number, string> = {};
    let nativeUsage: any = {};
    for await (const e of sse(res.body!)) {
      if (e.type === 'message_start') nativeUsage = { ...nativeUsage, ...e.message?.usage };
      if (e.type === 'message_delta') nativeUsage = { ...nativeUsage, ...e.usage };
      if (e.type === 'message_start' || e.type === 'message_delta') {
        const input = nativeUsage.input_tokens;
        if (count(input))
          report(
            input +
              (nativeUsage.cache_creation_input_tokens || 0) +
              (nativeUsage.cache_read_input_tokens || 0),
            nativeUsage.output_tokens,
            nativeUsage.cache_read_input_tokens,
          );
      }
      if (e.type === 'content_block_start') {
        blocks[e.index] = e.content_block;
        if (e.content_block.type === 'tool_use') args[e.index] = '';
      }
      if (e.type === 'content_block_delta') {
        if (e.delta.type === 'text_delta') {
          add(e.delta.text);
          blocks[e.index].text = (blocks[e.index].text || '') + e.delta.text;
        }
        if (e.delta.type === 'input_json_delta')
          args[e.index] = (args[e.index] || '') + e.delta.partial_json;
        if (e.delta.type === 'thinking_delta')
          blocks[e.index].thinking = (blocks[e.index].thinking || '') + e.delta.thinking;
        if (e.delta.type === 'signature_delta') blocks[e.index].signature = e.delta.signature;
      }
      if (e.type === 'message_delta' && e.delta?.stop_reason === 'max_tokens')
        throw Error('模型输出达到长度上限，请缩小目标后重试');
      if (e.type === 'message_stop') completed = true;
      if (e.type === 'error') throw Error('模型服务生成失败，请稍后重试');
    }
    for (let i = 0; i < blocks.length; i++)
      if (blocks[i]?.type === 'tool_use') {
        blocks[i].input = args[i] ? JSON.parse(args[i]) : blocks[i].input;
        calls.push({
          id: blocks[i].id,
          name: blocks[i].name,
          arguments: JSON.stringify(blocks[i].input),
        });
      }
    history.push({ role: 'assistant', content: blocks.filter(Boolean) });
  } else if (r.connection.provider === 'gemini') {
    const res = await post(
      r,
      `/models/${encodeURIComponent(r.model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`,
      {
        systemInstruction: { parts: [{ text: r.system }] },
        contents: r.history,
        generationConfig: { maxOutputTokens: 4096 },
        ...(r.tools.length
          ? {
              tools: [
                {
                  functionDeclarations: r.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: t.parameters,
                  })),
                },
              ],
            }
          : {}),
      },
      { 'x-goog-api-key': r.key },
      fetcher,
    );
    const parts: any[] = [];
    for await (const e of sse(res.body!)) {
      if (e.error) throw Error('模型服务生成失败，请检查连接');
      if (e.promptFeedback?.blockReason) throw Error('模型服务未接受这次请求，请调整内容');
      const c = e.candidates?.[0];
      if (e.usageMetadata)
        report(
          e.usageMetadata.promptTokenCount,
          count(e.usageMetadata.candidatesTokenCount)
            ? e.usageMetadata.candidatesTokenCount + (e.usageMetadata.thoughtsTokenCount || 0)
            : undefined,
          e.usageMetadata.cachedContentTokenCount,
        );
      for (const p of c?.content?.parts || []) {
        parts.push(p);
        if (p.text && !p.thought) add(p.text);
        if (p.functionCall)
          calls.push({
            id: p.functionCall.id || uid(),
            nativeId: p.functionCall.id,
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args || {}),
          });
      }
      if (c?.finishReason) {
        if (c.finishReason !== 'STOP') throw Error('模型未完成输出，请调整内容或缩小目标');
        completed = true;
      }
    }
    history.push({ role: 'model', parts });
  } else if (r.connection.provider === 'ollama') {
    const res = await post(
      r,
      '/api/chat',
      {
        model: r.model,
        messages: [{ role: 'system', content: r.system }, ...r.history],
        stream: true,
        ...(r.tools.length
          ? { tools: r.tools.map((t) => ({ type: 'function', function: t })) }
          : {}),
      },
      r.key ? { Authorization: `Bearer ${r.key}` } : {},
      fetcher,
    );
    const toolCalls: any[] = [];
    let thinking = '';
    for await (const e of ndjson(res.body!)) {
      if (e.error) throw Error('本地模型生成失败，请检查模型是否已下载');
      if (e.message?.content) add(e.message.content);
      if (e.message?.thinking) thinking += e.message.thinking;
      for (const c of e.message?.tool_calls || []) {
        toolCalls.push(c);
        calls.push({
          id: uid(),
          name: c.function.name,
          arguments: JSON.stringify(c.function.arguments),
        });
      }
      if (e.done) {
        completed = true;
        report(e.prompt_eval_count, e.eval_count);
      }
    }
    history.push({
      role: 'assistant',
      content: text,
      ...(thinking ? { thinking } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
  } else {
    const res = await post(
      r,
      '/chat/completions',
      {
        model: r.model,
        messages: [{ role: 'system', content: r.system }, ...r.history],
        stream: true,
        stream_options: { include_usage: true },
        ...(r.tools.length
          ? { tools: r.tools.map((t) => ({ type: 'function', function: t })) }
          : {}),
      },
      { Authorization: `Bearer ${r.key}` },
      fetcher,
    );
    const map = new Map<number, { id: string; name: string; args: string }>();
    let reasoning = '';
    for await (const e of sse(res.body!)) {
      if (e.error) throw Error('模型服务生成失败，请检查模型配置');
      if (e.usage)
        report(
          e.usage.prompt_tokens,
          e.usage.completion_tokens,
          e.usage.prompt_tokens_details?.cached_tokens,
        );
      const c = e.choices?.[0],
        d = c?.delta;
      if (d?.content) add(d.content);
      if (d?.reasoning_content) reasoning += d.reasoning_content;
      for (const t of d?.tool_calls || []) {
        const v = map.get(t.index) || { id: '', name: '', args: '' };
        if (t.id) v.id = t.id;
        if (t.function?.name) v.name += t.function.name;
        if (t.function?.arguments) v.args += t.function.arguments;
        map.set(t.index, v);
      }
      if (c?.finish_reason) {
        if (!['stop', 'tool_calls'].includes(c.finish_reason))
          throw Error('模型输出未完成，请缩小目标后重试');
        completed = true;
      }
    }
    const native = [...map.values()].map((c) => ({
      id: c.id || uid(),
      type: 'function',
      function: { name: c.name, arguments: c.args },
    }));
    calls.push(
      ...native.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
    );
    history.push({
      role: 'assistant',
      content: text || null,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(native.length ? { tool_calls: native } : {}),
    });
  }
  if (!completed) throw Error('模型连接提前断开，已收到的内容尚未完成');
  if (!text.trim() && !calls.length) throw Error('模型未返回可用的回答');
  return { text, calls, history, usage };
}
export async function discover(connection: Connection, key: string): Promise<string[]> {
  const p = connection.provider;
  const path = p === 'ollama' ? '/api/tags' : '/models';
  const headers: Record<string, string> =
    p === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : p === 'gemini'
        ? { 'x-goog-api-key': key }
        : key
          ? { Authorization: `Bearer ${key}` }
          : {};
  const res = await secureFetch(
    connection.baseUrl.replace(/\/$/, '') + path,
    { headers, signal: AbortSignal.timeout(15_000), redirect: 'error' },
    connection.allowLocal,
  );
  if (!res.ok) {
    await res.body?.cancel();
    throw Error(`连接测试失败（HTTP ${res.status}），请检查密钥和地址`);
  }
  if (!res.body) throw Error('服务未返回模型列表');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let data: any;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1024 * 1024) throw Error('模型列表响应超过 1 MB 限额');
      chunks.push(value);
    }
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw Error('模型列表响应不是有效 JSON');
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const list =
    p === 'ollama'
      ? data.models?.map((x: any) => x?.name)
      : p === 'gemini'
        ? data.models
            ?.filter(
              (x: any) =>
                typeof x?.name === 'string' &&
                Array.isArray(x.supportedGenerationMethods) &&
                x.supportedGenerationMethods.includes('generateContent'),
            )
            .map((x: any) => x.name.replace(/^models\//, ''))
        : data.data?.map((x: any) => x?.id);
  if (!Array.isArray(list)) throw Error('服务不支持模型列表发现，请手动填写模型 ID');
  return [
    ...new Set<string>(
      list.filter(
        (id: unknown): id is string =>
          typeof id === 'string' &&
          id.length > 0 &&
          id.length <= 200 &&
          !id.includes('::') &&
          !/[\x00-\x1f\x7f]/.test(id) &&
          (!key || !id.includes(key)),
      ),
    ),
  ].slice(0, 200);
}
