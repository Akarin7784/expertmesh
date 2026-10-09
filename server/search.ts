import { load } from 'cheerio';
import { secureFetch } from './security';
import type { SearchSettings } from '../shared/types';
export interface SearchConfig extends SearchSettings {
  id: string;
  encryptedKey: string;
}
export const defaultSearch: SearchSettings = {
  provider: 'tavily',
  baseUrl: 'https://api.tavily.com',
  hasKey: false,
  allowLocal: false,
  enabled: false,
};
export function publicSearch(config?: SearchConfig): SearchSettings {
  if (!config) return defaultSearch;
  const { provider, baseUrl, allowLocal, enabled, encryptedKey } = config;
  return { provider, baseUrl, allowLocal, enabled, hasKey: !!encryptedKey };
}
export function publicUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 4000) return;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    url.hash = '';
    return url.toString();
  } catch {
    return;
  }
}
export async function limitedText(response: Response, max = 2_000_000): Promise<string> {
  if (Number(response.headers.get('content-length')) > max) {
    await response.body?.cancel();
    throw Error('网页内容过大');
  }
  if (!response.body) throw Error('服务没有返回内容');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let total = 0,
    text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        return text;
      }
      total += value.byteLength;
      if (total > max) throw Error('网页内容过大');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  content: string;
}
export async function searchWeb(
  config: SearchConfig,
  key: string,
  query: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  if (!config.enabled) throw Error('联网搜索未启用');
  const url = new URL(config.baseUrl.replace(/\/$/, '') + '/search');
  const options: RequestInit = {
    method: 'POST',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  };
  if (config.provider === 'tavily') {
    options.headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    options.body = JSON.stringify({
      query,
      search_depth: 'basic',
      max_results: 6,
      include_answer: false,
      include_raw_content: false,
    });
  } else {
    options.headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    };
    options.body = new URLSearchParams({
      q: query,
      format: 'json',
      categories: 'general',
      safesearch: '1',
    }).toString();
  }
  const response = await secureFetch(url.toString(), options, config.allowLocal);
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      response.status === 401
        ? '搜索服务认证失败，请检查搜索密钥'
        : response.status === 403
          ? '搜索被拒绝，请检查密钥或 SearXNG 的 JSON 格式配置'
          : response.status === 429
            ? '搜索服务限流，请稍后继续'
            : `搜索服务返回 HTTP ${response.status}`,
    );
  }
  let body: any;
  try {
    body = JSON.parse(await limitedText(response));
  } catch {
    throw Error('搜索服务没有返回有效 JSON，请检查服务地址');
  }
  if (!Array.isArray(body.results)) throw Error('搜索服务响应格式不正确');
  const seen = new Set<string>();
  return body.results
    .slice(0, 30)
    .flatMap((item: any) => {
      if (!item || typeof item !== 'object') return [];
      const url = publicUrl(item.url);
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [
        {
          url,
          title: typeof item.title === 'string' ? item.title.slice(0, 400) : new URL(url).hostname,
          snippet: typeof item.content === 'string' ? load(item.content).text().slice(0, 6000) : '',
          content: '',
        },
      ];
    })
    .slice(0, 6);
}
export function extractPage(text: string, type: string) {
  let title = '',
    content = text;
  if (!/text\/plain/.test(type)) {
    const $ = load(text);
    title = $('title').first().text().trim();
    $('script,style,noscript,svg,nav,footer,header,form,iframe').remove();
    const main = $('article').first().length
      ? $('article').first()
      : $('main').first().length
        ? $('main').first()
        : $('body');
    main.find('p,div,section,h1,h2,h3,li,br').each((_i, el) => {
      $(el).append('\n');
    });
    content = main
      .text()
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  }
  if (!content.trim()) throw Error('网页没有可读取的正文，可能需要登录或 JavaScript');
  return {
    title: title.slice(0, 400),
    content: content.slice(0, 30000),
    truncated: content.length > 30000,
  };
}
export async function readWebpage(
  raw: string,
  signal: AbortSignal,
): Promise<{ title: string; content: string; url: string; truncated: boolean }> {
  let url = publicUrl(raw);
  if (!url) throw Error('网页地址无效');
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
  for (let hop = 0; hop < 4; hop++) {
    // Never send search/API credentials to result websites. Private destinations stay blocked.
    const response = await secureFetch(
      url,
      {
        headers: {
          Accept: 'text/html,text/plain;q=0.9',
          'User-Agent': 'ExpertMesh/0.1 (web reader)',
        },
        signal: requestSignal,
        redirect: 'manual',
      },
      false,
    );
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw Error('网页重定向没有地址');
      url = publicUrl(new URL(location, url).toString());
      if (!url) throw Error('网页重定向地址无效');
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(`网页读取失败（HTTP ${response.status}），可使用搜索摘要或其他来源`);
    }
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml|text\/plain/.test(type)) {
      await response.body?.cancel();
      throw Error('目前只能读取 HTML 或纯文本网页');
    }
    return { ...extractPage(await limitedText(response), type), url };
  }
  throw Error('网页重定向次数过多');
}
