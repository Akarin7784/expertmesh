import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Store } from '../server/db';
import { Vault } from '../server/security';
import { Mcp, modelToolName } from '../server/mcp';
import { mockMcp } from './mock-mcp';
test('MCP HTTP sessions, JSON/SSE, grants, changed descriptors, revocation and bounded results', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mesh-mcp-')),
    store = new Store(resolve(dir, 'db')),
    vault = new Vault(dir),
    mcp = new Mcp(store, vault),
    server = await mockMcp();
  try {
    await assert.rejects(mcp.save({ name: '内网', url: server.url }), /本地/);
    const row = await mcp.save({
      name: '资料',
      url: server.url,
      allowLocal: true,
      apiKey: 'mcp-test-secret',
    });
    assert.ok(!JSON.stringify(mcp.list()).includes('mcp-test-secret'));
    const tested = await mcp.test(row.id);
    assert.equal(tested.status, 'ready');
    assert.equal(tested.tools[1].readOnly, false);
    assert.equal(mcp.available('general', '').length, 0);
    assert.throws(() => mcp.grant(row.id, 'general', '', ['delete_notes']), /只读/);
    mcp.grant(row.id, 'general', '', ['fetch_notes']);
    const name = modelToolName(row.id, 'fetch_notes'),
      signal = new AbortController().signal;
    assert.equal(mcp.available('general', '')[0].name, name);
    assert.equal(mcp.available('researcher', '').length, 0);
    assert.equal(mcp.available('general', 'other').length, 0);
    await assert.rejects(mcp.call('researcher', '', name, { topic: '主题' }, signal), /未获准/);
    await assert.rejects(mcp.call('general', '', name, { topic: 2 }, signal), /参数/);
    const result = JSON.parse(await mcp.call('general', '', name, { topic: '主题' }, signal));
    assert.match(result.text, /可信工具资料/);
    assert.ok(
      server.state.requests.some(
        (r) => r.body.method === 'tools/call' && r.headers['mcp-session-id'] === 'test-session',
      ),
    );
    server.state.mode = 'sse';
    assert.match(await mcp.call('general', '', name, { topic: 'SSE' }, signal), /SSE/);
    server.state.changed = true;
    const calls = () => server.state.requests.filter((r) => r.body.method === 'tools/call').length,
      before = calls();
    await assert.rejects(
      mcp.call('general', '', name, { topic: '定义变了' }, signal),
      /定义已变化/,
    );
    assert.equal(calls(), before);
    await mcp.test(row.id);
    assert.equal(mcp.available('general', '').length, 0);
    mcp.grant(row.id, 'general', '', ['fetch_notes']);
    server.state.large = true;
    await assert.rejects(mcp.call('general', '', name, { topic: '大结果' }, signal), /64 KB/);
    server.state.large = false;
    server.state.isError = true;
    await assert.rejects(mcp.call('general', '', name, { topic: '失败' }, signal), /错误结果/);
    server.state.isError = false;
    server.state.delay = 5000;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(mcp.call('general', '', name, { topic: '取消' }, controller.signal));
    server.state.delay = 0;
    mcp.setEnabled(row.id, false);
    assert.equal(mcp.available('general', '').length, 0);
    mcp.setEnabled(row.id, true);
    mcp.grant(row.id, 'general', '', []);
    assert.equal(mcp.available('general', '').length, 0);
    const modern = await mcp.save({
      name: '无会话',
      url: server.url,
      protocol: '2026-07-28',
      allowLocal: true,
      apiKey: 'mcp-test-secret',
    });
    await mcp.test(modern.id);
    mcp.grant(modern.id, 'general', '', ['fetch_notes']);
    await mcp.call(
      'general',
      '',
      modelToolName(modern.id, 'fetch_notes'),
      { topic: '现代' },
      signal,
    );
    const request = server.state.requests.at(-1);
    assert.equal(request.headers['mcp-protocol-version'], '2026-07-28');
    assert.equal(request.headers['mcp-method'], 'tools/call');
    assert.equal(
      request.body.params._meta['io.modelcontextprotocol/protocolVersion'],
      '2026-07-28',
    );
    server.state.asyncSchema = true;
    const unsupported = await mcp.test(modern.id);
    assert.equal(unsupported.tools[0].readOnly, false);
    assert.throws(() => mcp.grant(modern.id, 'general', '', ['fetch_notes']), /只读/);
    server.state.asyncSchema = false;
    server.state.wrongId = true;
    await assert.rejects(mcp.test(modern.id), /提前结束|不匹配/);
  } finally {
    await server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
