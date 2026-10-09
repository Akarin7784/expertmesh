import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchWeb,
  extractPage,
  limitedText,
  publicUrl,
  readWebpage,
  type SearchConfig,
} from '../server/search';
import { mockProvider } from './mock-provider';
test('Tavily and SearXNG normalize results and do not expose credentials', async () => {
  const mock = await mockProvider();
  try {
    const config: SearchConfig = {
      id: 'search',
      provider: 'tavily',
      baseUrl: mock.url.replace('/v1', ''),
      allowLocal: true,
      enabled: true,
      hasKey: true,
      encryptedKey: 'opaque',
    };
    const results = await searchWeb(config, 'search-secret', '资料', new AbortController().signal);
    assert.equal(results.length, 1);
    assert.equal(results[0].url, 'https://example.com/research');
    assert.ok(!JSON.stringify(results).includes('search-secret'));
    assert.equal(mock.requests[0].authorization, 'Bearer search-secret');
    assert.equal(mock.requests[0].search.search_depth, 'basic');
    const other = await searchWeb(
      { ...config, provider: 'searxng' },
      '',
      '资料',
      new AbortController().signal,
    );
    assert.equal(other.length, 1);
    assert.equal(mock.requests[1].search.format, 'json');
    assert.equal(mock.requests[1].search.q, '资料');
    assert.deepEqual(
      await searchWeb(config, 'search-secret', 'empty', new AbortController().signal),
      [],
    );
    await assert.rejects(
      searchWeb({ ...config, enabled: false }, 'secret', 'x', new AbortController().signal),
      /未启用/,
    );
    const c = new AbortController();
    c.abort();
    await assert.rejects(searchWeb(config, 'secret', 'x', c.signal));
  } finally {
    await mock.close();
  }
});
test('web reader strips executable content and bounds size, URLs and local access', async () => {
  const result = extractPage(
    '<html><title>标题</title><nav>导航</nav><article><h1>正文</h1><p>有依据的内容</p><script>steal()</script><style>bad</style></article><footer>广告</footer></html>',
    'text/html',
  );
  assert.equal(result.title, '标题');
  assert.match(result.content, /正文\n/);
  assert.ok(!/steal|导航|广告|bad/.test(result.content));
  assert.equal(extractPage('x'.repeat(40000), 'text/plain').content.length, 30000);
  assert.equal(extractPage('x'.repeat(40000), 'text/plain').truncated, true);
  assert.equal(publicUrl('javascript:alert(1)'), undefined);
  assert.equal(publicUrl('https://user:password@example.com'), undefined);
  await assert.rejects(readWebpage('https://127.0.0.1', new AbortController().signal), /本地|内网/);
  await assert.rejects(limitedText(new Response('x'.repeat(100)), 20), /过大/);
});
