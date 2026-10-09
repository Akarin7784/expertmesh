import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, sse, toolResult, type Request } from '../server/providers';
import { providers } from '../shared/types';
const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\r\n\r\n`;
const request = (provider: Request['connection']['provider']): Request => ({
  connection: {
    id: 'c',
    provider,
    name: 'test',
    baseUrl: providers.find((p) => p.id === provider)!.baseUrl,
    models: [],
    hasKey: true,
    allowLocal: true,
    createdAt: '',
  },
  key: 'test-key',
  model: 'test-model',
  system: 'test',
  history: [],
  tools: [],
  signal: new AbortController().signal,
});
const fixture = (text: string) =>
  (async () =>
    new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch;

test('provider usage preserves cumulative totals, cache hits and missing counters', async () => {
  const cases = [
    [
      'openai',
      frame({ type: 'response.output_text.delta', delta: 'ok' }) +
        frame({
          type: 'response.completed',
          response: {
            output: [],
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              input_tokens_details: { cached_tokens: 40 },
            },
          },
        }),
      { input: 100, output: 20, cachedInput: 40 },
    ],
    [
      'anthropic',
      [
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 50,
              output_tokens: 1,
              cache_creation_input_tokens: 10,
              cache_read_input_tokens: 40,
            },
          },
        },
        { type: 'message_delta', usage: { output_tokens: 15 } },
        { type: 'message_delta', usage: { output_tokens: 20 } },
        { type: 'message_stop' },
      ]
        .map(frame)
        .join(''),
      { input: 100, output: 20, cachedInput: 40 },
    ],
    [
      'gemini',
      frame({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 15,
          thoughtsTokenCount: 5,
          cachedContentTokenCount: 40,
        },
      }),
      { input: 100, output: 20, cachedInput: 40 },
    ],
    [
      'compatible',
      frame({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }) +
        frame({
          choices: [],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 40 },
          },
        }) +
        'data: [DONE]\n\n',
      { input: 100, output: 20, cachedInput: 40 },
    ],
    [
      'ollama',
      JSON.stringify({
        message: { content: 'ok' },
        done: true,
        prompt_eval_count: 100,
        eval_count: 20,
      }) + '\n',
      { input: 100, output: 20 },
    ],
  ] as const;
  for (const [provider, stream, expected] of cases) {
    const r = request(provider),
      observed: unknown[] = [];
    r.onUsage = (u) => observed.push(u);
    const turn = await generate(r, fixture(stream));
    assert.deepEqual(turn.usage, expected, provider);
    assert.deepEqual(observed.at(-1), expected, provider);
  }
  const missing = await generate(
    request('gemini'),
    fixture(
      frame({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 100 },
      }),
    ),
  );
  assert.equal(missing.usage, undefined);
});

test('SSE handles UTF-8 split across byte chunks, CRLF and final frame', async () => {
  const bytes = new TextEncoder().encode(frame({ text: '你好' }) + 'data: {"last":true}'),
    parts = [bytes.slice(0, 22), bytes.slice(22, 23), bytes.slice(23)];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      parts.forEach((p) => c.enqueue(p));
      c.close();
    },
  });
  const values = [];
  for await (const value of sse(body)) values.push(value);
  assert.deepEqual(values, [{ text: '你好' }, { last: true }]);
});
test('OpenAI retains reasoning output and call IDs for stateless continuation', async () => {
  let out = '';
  const r = request('openai');
  r.onText = (t) => (out += t);
  const output = [
    { type: 'reasoning', encrypted_content: 'opaque' },
    { type: 'function_call', call_id: 'call-o', name: 'read_file', arguments: '{"file_id":"x"}' },
  ];
  const result = await generate(
    r,
    fixture(
      frame({ type: 'response.output_text.delta', delta: '好' }) +
        frame({ type: 'response.completed', response: { output } }),
    ),
  );
  assert.equal(out, '好');
  assert.equal(result.calls[0].id, 'call-o');
  assert.equal(result.history[0].encrypted_content, 'opaque');
  assert.equal(toolResult('openai', result.calls[0], 'ok').call_id, 'call-o');
});
test('Anthropic assembles streamed tool arguments and signed blocks', async () => {
  const result = await generate(
    request('anthropic'),
    fixture(
      [
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'hidden' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'signed' },
        },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'a-call', name: 'read_file', input: {} },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"file_' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: 'id":"f"}' },
        },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' },
      ]
        .map(frame)
        .join(''),
    ),
  );
  assert.equal(result.text, '');
  assert.deepEqual(JSON.parse(result.calls[0].arguments), { file_id: 'f' });
  assert.equal(result.history[0].content[0].signature, 'signed');
});
test('Gemini retains thought signatures and native function response IDs', async () => {
  const r = request('gemini');
  r.tools = [
    {
      name: 'list_files',
      description: 'files',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];
  const response = fixture(
    frame({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { id: 'g-call', name: 'list_files', args: {} },
                thoughtSignature: 'sig',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    }),
  );
  const result = await generate(r, async (url, options) => {
    const body = JSON.parse(options!.body as string);
    assert.equal(
      body.tools[0].functionDeclarations[0].parametersJsonSchema.additionalProperties,
      false,
    );
    assert.equal(body.tools[0].functionDeclarations[0].parameters, undefined);
    return response(url, options);
  });
  assert.equal(result.history[0].parts[0].thoughtSignature, 'sig');
  assert.equal(toolResult('gemini', result.calls[0], '[]').parts[0].functionResponse.id, 'g-call');
});
test('compatible adapter retains reasoning_content and fragmented function arguments', async () => {
  const result = await generate(
    request('deepseek'),
    fixture(
      [
        {
          choices: [
            {
              delta: {
                reasoning_content: 'hidden',
                tool_calls: [
                  {
                    index: 0,
                    id: 'd-call',
                    function: { name: 'read_file', arguments: '{"file_id":' },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: '"f"}' } }] },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]
        .map(frame)
        .join(''),
    ),
  );
  assert.equal(result.history[0].reasoning_content, 'hidden');
  assert.deepEqual(JSON.parse(result.calls[0].arguments), { file_id: 'f' });
});
test('Ollama parses NDJSON tool calls without exposing thinking', async () => {
  const result = await generate(
    request('ollama'),
    fixture(
      [
        { message: { thinking: 'hidden', content: '答复' } },
        {
          message: { tool_calls: [{ function: { name: 'list_files', arguments: {} } }] },
          done: true,
        },
      ]
        .map((x) => JSON.stringify(x) + '\n')
        .join(''),
    ),
  );
  assert.equal(result.text, '答复');
  assert.equal(result.calls[0].name, 'list_files');
  assert.equal(result.history[0].thinking, 'hidden');
});
test('truncated and in-stream error responses never count as completed', async () => {
  await assert.rejects(
    generate(
      request('compatible'),
      fixture(frame({ choices: [{ delta: { content: 'partial' } }] })),
    ),
    /提前断开/,
  );
  await assert.rejects(
    generate(request('openai'), fixture(frame({ type: 'response.failed' }))),
    /生成失败/,
  );
  await assert.rejects(
    generate(request('anthropic'), fixture(frame({ type: 'error', error: { message: 'key' } }))),
    /生成失败/,
  );
});
