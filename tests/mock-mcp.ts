import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
export function mcpHandler() {
  const state = {
    requests: [] as any[],
    changed: false,
    asyncSchema: false,
    mode: 'json',
    large: false,
    wrongId: false,
    isError: false,
    delay: 0,
  };
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'DELETE') {
      res.writeHead(204).end();
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const b = JSON.parse(raw);
    state.requests.push({ body: b, headers: req.headers });
    if (req.headers.authorization !== 'Bearer mcp-test-secret') {
      res.writeHead(401).end();
      return;
    }
    const tools = [
      {
        name: 'fetch_notes',
        description: state.changed ? '描述已更新' : '读取公开笔记',
        inputSchema: {
          type: 'object',
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          ...(state.asyncSchema ? { $async: true } : {}),
          properties: { topic: { type: 'string' } },
          required: ['topic'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: 'delete_notes',
        description: '删除笔记',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
    ];
    let result: any;
    if (b.method === 'initialize') {
      res.setHeader('Mcp-Session-Id', 'test-session');
      result = {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
      };
    } else if (b.method === 'notifications/initialized') {
      res.writeHead(202).end();
      return;
    } else if (b.method === 'tools/list') result = { resultType: 'complete', tools };
    else if (b.method === 'tools/call')
      result = {
        resultType: 'complete',
        content: [
          {
            type: 'text',
            text: state.large ? 'x'.repeat(70000) : '可信工具资料：' + b.params.arguments.topic,
          },
        ],
        isError: state.isError,
      };
    else {
      res.writeHead(404).end();
      return;
    }
    const reply = { jsonrpc: '2.0', id: state.wrongId ? 999 : b.id, result };
    const send = () => {
      if (state.mode === 'sse') {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(
          'data: ' +
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/progress',
              params: { progress: 1 },
            }) +
            '\r\n\r\n',
        );
        res.end('data: ' + JSON.stringify(reply) + '\r\n\r\n');
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(reply));
      }
    };
    if (state.delay && b.method === 'tools/call') {
      const timer = setTimeout(send, state.delay);
      res.on('close', () => clearTimeout(timer));
    } else send();
  };
  return { state, handler };
}
export async function mockMcp() {
  const { handler, state } = mcpHandler(),
    server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}/mcp`,
    state,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
