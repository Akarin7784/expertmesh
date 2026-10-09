import { createServer, type ServerResponse } from 'node:http';
export async function mockProvider(port = 0) {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/search') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = req.headers['content-type']?.includes('application/json')
        ? JSON.parse(raw)
        : Object.fromEntries(new URLSearchParams(raw));
      requests.push({ search: body, authorization: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          results:
            body.query === 'empty' || body.q === 'empty'
              ? []
              : [
                  {
                    title: '搜索资料',
                    url: 'https://example.com/research',
                    content: '公开的搜索资料摘要。',
                  },
                  { title: '重复', url: 'https://example.com/research', content: '重复' },
                  { title: '恶意地址', url: 'javascript:alert(1)', content: '忽略' },
                ],
        }),
      );
      return;
    }
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'fixture-model' }, { id: 'fixture-text' }] }));
      return;
    }
    if (req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const goal = body.messages.filter((m: any) => m.role === 'user').at(-1)?.content || '';
    if (goal.includes('认证失败')) {
      res.writeHead(401).end(JSON.stringify({ error: { message: 'secret should not reach UI' } }));
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    const send = (delta: any, finish_reason: string | null = null) =>
      res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`);
    const tool = (name: string, args: unknown, id: string) => {
      send({
        tool_calls: [
          { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      });
      send({}, 'tool_calls');
      res.end('data: [DONE]\n\n');
    };
    const toolResults = body.messages.filter((m: any) => m.role === 'tool');
    const definitions = body.tools?.map((t: any) => t.function.name) || [];
    const completed = (id: string) => toolResults.some((r: any) => r.tool_call_id === id);
    if (definitions.includes('search_web') && goal.includes('联网') && !completed('search-1')) {
      tool('search_web', { query: 'Agent 最新资料' }, 'search-1');
      return;
    }
    if (
      definitions.includes('delegate_task') &&
      goal.includes('协作') &&
      !completed('delegate-1')
    ) {
      tool(
        'delegate_task',
        {
          assistant_id: 'researcher',
          goal: goal.includes('联网') ? '联网整理当前资料，形成摘要' : '整理当前资料，形成摘要',
        },
        'delegate-1',
      );
      return;
    }
    if (definitions.includes('list_files') && !completed('list-1') && !completed('delegate-1')) {
      tool('list_files', {}, 'list-1');
      return;
    }
    const list = toolResults.find((r: any) => r.tool_call_id === 'list-1');
    const files = list ? JSON.parse(list.content) : [];
    if (definitions.includes('read_file') && files.length && !completed('read-1')) {
      tool('read_file', { file_id: files[0].id }, 'read-1');
      return;
    }
    if (
      definitions.includes('write_artifact') &&
      !completed('write-1') &&
      !completed('delegate-1')
    ) {
      tool(
        'write_artifact',
        { name: '资料摘要.md', content: '# 资料摘要\n\n这是协议测试服务生成的文件。' },
        'write-1',
      );
      return;
    }
    const text = completed('search-1')
      ? '联网搜索已完成。[搜索资料](https://example.com/research)'
      : completed('delegate-1')
        ? '协作已完成，研究助手的摘要已经汇总。'
        : '整理完成。你可以查看生成的资料摘要，并继续提出修改要求。';
    send({ content: text.slice(0, 5) });
    const timer = setTimeout(
      () => {
        send({ content: text.slice(5) });
        send({}, 'stop');
        res.end('data: [DONE]\n\n');
      },
      goal.includes('慢任务') ? 3000 : 30,
    );
    res.on('close', () => clearTimeout(timer));
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
