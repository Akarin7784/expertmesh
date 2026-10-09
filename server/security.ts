import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { dataDir } from './db';

export class Vault {
  key: Buffer;
  constructor(dir = dataDir) {
    const path = resolve(dir, 'secret.key');
    if (process.env.EXPERTMESH_SECRET_KEY)
      this.key = Buffer.from(process.env.EXPERTMESH_SECRET_KEY, 'base64');
    else if (existsSync(path)) this.key = readFileSync(path);
    else {
      this.key = randomBytes(32);
      writeFileSync(path, this.key, { mode: 0o600, flag: 'wx' });
    }
    if (this.key.length !== 32) throw Error('EXPERTMESH_SECRET_KEY 必须是 32 字节的 base64 值');
  }
  encrypt(secret: string) {
    if (!secret) return '';
    const iv = randomBytes(12),
      c = createCipheriv('aes-256-gcm', this.key, iv);
    const bytes = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), bytes]).toString('base64');
  }
  decrypt(value: string) {
    if (!value) return '';
    const b = Buffer.from(value, 'base64'),
      c = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    c.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString('utf8');
  }
}
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (a.includes(':')) {
    if (a.startsWith('::ffff:')) {
      const tail = a.slice(7);
      if (tail.includes('.')) return isPrivateAddress(tail);
      const parts = tail.split(':');
      const n = parseInt(parts[0] || '0', 16) * 65536 + parseInt(parts[1] || '0', 16);
      return isPrivateAddress(`${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`);
    }
    return (
      a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('ff')
    );
  }
  const [x, y] = a.split('.').map(Number);
  return (
    x === 0 ||
    x === 10 ||
    x === 127 ||
    (x === 169 && y === 254) ||
    (x === 172 && y >= 16 && y <= 31) ||
    (x === 192 && y === 168) ||
    (x === 100 && y >= 64 && y <= 127) ||
    x >= 224
  );
}
export async function validateEndpoint(raw: string, allowLocal: boolean) {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error('服务地址必须是没有凭证、查询参数的 HTTP(S) 地址');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length) throw Error('无法解析服务地址');
  if (!allowLocal && addresses.some((x) => isPrivateAddress(x.address)))
    throw Error('本地或内网地址需要启用“允许本地服务”');
  if (url.protocol === 'http:' && !allowLocal) throw Error('远程服务必须使用 HTTPS');
  return url.toString().replace(/\/$/, '');
}

// Pin the validated DNS result to this request to prevent DNS rebinding.
export async function secureFetch(
  raw: string,
  options: RequestInit,
  allowLocal: boolean,
): Promise<Response> {
  const url = new URL(raw),
    host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw Error('服务地址无效');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  if (!addresses.length || (!allowLocal && addresses.some((a) => isPrivateAddress(a.address))))
    throw Error('服务地址解析到了本地或内网，需要显式允许本地服务');
  if (url.protocol === 'http:' && !allowLocal) throw Error('远程服务必须使用 HTTPS');
  const agent = new Agent({
    connect: {
      lookup: (_hostname, opts, callback) => {
        if (opts.all) callback(null, addresses as any);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    },
  });
  try {
    const res = await undiciFetch(url, {
      ...options,
      redirect: options.redirect === 'manual' ? 'manual' : 'error',
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1]);
    if (!res.body) {
      void agent.close();
      return new Response(null, {
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers),
      });
    }
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            void agent.close();
          } else controller.enqueue(value);
        } catch (e) {
          controller.error(e);
          void agent.close();
        }
      },
      async cancel() {
        await reader.cancel();
        void agent.close();
      },
    });
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers),
    });
  } catch (e) {
    void agent.close();
    throw e;
  }
}
