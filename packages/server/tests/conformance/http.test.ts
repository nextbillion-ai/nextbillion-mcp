import { randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpApp } from '../../src/http/app.js';
import type { FetchApp } from '../../src/http/node-server.js';
import { KeyRing } from '../../src/http/oauth/crypto.js';
import { fakeNbClient, type RecordedRequest } from '../helpers/fake-fetch.js';

/**
 * Protocol-level tests for the hosted mode: a real MCP client speaking Streamable HTTP to
 * the app's fetch handler (no sockets), with the NextBillion API faked. Covers what a host
 * observes: anonymous discovery and documentation tools, the 401 that starts sign-in, and
 * per-request API keys.
 */
const PUBLIC_URL = new URL('https://mcp.test');
const KEY = 'abcdef0123456789ABCDEF0123456789';

function makeApp(): { app: FetchApp; keysUsed: string[]; requests: () => RecordedRequest[] } {
  const keysUsed: string[] = [];
  const fakes: Array<{ requests: RecordedRequest[] }> = [];
  const app = createHttpApp({
    version: '0.0.0-test',
    publicUrl: PUBLIC_URL,
    issuerUrl: PUBLIC_URL,
    // Called once per authenticated request: the server is rebuilt for every HTTP exchange.
    nbClientFactory: (apiKey) => {
      keysUsed.push(apiKey);
      const fake = fakeNbClient({
        responses: [{ body: { items: [{ id: 'abc', title: 'Empire State Building' }] } }],
        apiKey,
      });
      fakes.push(fake);
      return fake.nb;
    },
  });
  return { app, keysUsed, requests: () => fakes.flatMap((f) => f.requests) };
}

function connect(app: FetchApp, authorization?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(PUBLIC_URL, {
    fetch: (input, init) => app.fetch(new Request(input, init)),
    requestInit: authorization ? { headers: { authorization } } : undefined,
  });
  const client = new Client({ name: 'http-conformance', version: '0.0.0' });
  return client.connect(transport).then(() => client);
}

const open: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('hosted HTTP mode', () => {
  it('answers liveness and serves the protected resource metadata', async () => {
    const { app } = makeApp();
    open.push(app);
    const health = await app.fetch(new Request('https://mcp.test/healthz'));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', version: '0.0.0-test' });

    const prm = await app.fetch(
      new Request('https://mcp.test/.well-known/oauth-protected-resource'),
    );
    expect(prm.status).toBe(200);
    expect(prm.headers.get('access-control-allow-origin')).toBe('*');
    expect(await prm.json()).toMatchObject({
      resource: 'https://mcp.test',
      authorization_servers: ['https://mcp.test'],
      bearer_methods_supported: ['header'],
      scopes_supported: ['nextbillion.api'],
    });

    const missing = await app.fetch(new Request('https://mcp.test/nope'));
    expect(missing.status).toBe(404);
  });

  it('serves domain-verification tokens as plain text under /.well-known', async () => {
    const app = createHttpApp({
      version: '0.0.0-test',
      publicUrl: PUBLIC_URL,
      issuerUrl: PUBLIC_URL,
      nbClientFactory: () => fakeNbClient({ responses: [], apiKey: KEY }).nb,
      verificationTokens: { 'openai-apps-challenge': 'tok-123', 'empty-one': '' },
    });
    open.push(app);
    const ok = await app.fetch(new Request('https://mcp.test/.well-known/openai-apps-challenge'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await ok.text()).toBe('tok-123');
    // Exactly the token: no JSON wrapping, no trailing newline.
    const post = await app.fetch(
      new Request('https://mcp.test/.well-known/openai-apps-challenge', { method: 'POST' }),
    );
    expect(post.status).toBe(405);
    for (const path of ['/.well-known/empty-one', '/.well-known/unknown', '/.well-known/']) {
      const res = await app.fetch(new Request(`https://mcp.test${path}`));
      expect(res.status, path).toBe(404);
    }
  });

  it('never lets a verification token shadow the OAuth well-known documents', async () => {
    const app = createHttpApp({
      version: '0.0.0-test',
      publicUrl: PUBLIC_URL,
      issuerUrl: PUBLIC_URL,
      nbClientFactory: () => fakeNbClient({ responses: [], apiKey: KEY }).nb,
      oauth: { keyRing: new KeyRing([randomBytes(32)]) },
      verificationTokens: {
        'oauth-authorization-server': 'shadow',
        'oauth-protected-resource': 'shadow',
        'openai-apps-challenge': 'tok-123',
      },
    });
    open.push(app);
    for (const name of ['oauth-authorization-server', 'oauth-protected-resource']) {
      const url = `https://mcp.test/.well-known/${name}`;
      const get = await app.fetch(new Request(url));
      expect(get.status, name).toBe(200);
      expect(get.headers.get('content-type'), name).toContain('application/json');
      expect(await get.json(), name).toMatchObject(
        name === 'oauth-authorization-server'
          ? { issuer: 'https://mcp.test' }
          : { resource: 'https://mcp.test' },
      );
      const options = await app.fetch(new Request(url, { method: 'OPTIONS' }));
      expect(options.status, name).toBe(204);
    }
    const challenge = await app.fetch(
      new Request('https://mcp.test/.well-known/openai-apps-challenge'),
    );
    expect(await challenge.text()).toBe('tok-123');
  });

  it('serves its icon and advertises it in serverInfo', async () => {
    const { app } = makeApp();
    open.push(app);
    const ico = await app.fetch(new Request('https://mcp.test/favicon.ico'));
    expect(ico.status).toBe(200);
    expect(ico.headers.get('content-type')).toBe('image/x-icon');
    expect(ico.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(ico.headers.get('access-control-allow-origin')).toBe('*');
    const icoBytes = new Uint8Array(await ico.arrayBuffer());
    expect(ico.headers.get('content-length')).toBe(String(icoBytes.byteLength));
    // ICO header: reserved 0, type 1, three images (16, 32 and 48 px).
    expect(Array.from(icoBytes.subarray(0, 6))).toEqual([0, 0, 1, 0, 3, 0]);

    const png = await app.fetch(new Request('https://mcp.test/icon.png'));
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    const pngBytes = Buffer.from(await png.arrayBuffer());
    expect(pngBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([pngBytes.readUInt32BE(16), pngBytes.readUInt32BE(20)]).toEqual([192, 192]);

    const head = await app.fetch(new Request('https://mcp.test/favicon.ico', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    const post = await app.fetch(new Request('https://mcp.test/icon.png', { method: 'POST' }));
    expect(post.status).toBe(405);

    const client = await connect(app);
    open.push(client);
    expect(client.getServerVersion()).toMatchObject({
      name: 'nextbillion-mcp',
      title: 'NextBillion.ai',
      version: '0.0.0-test',
      websiteUrl: 'https://nextbillion.ai',
      icons: [
        { src: 'https://mcp.test/icon.png', mimeType: 'image/png', sizes: ['192x192'] },
        { src: 'https://mcp.test/favicon.ico', mimeType: 'image/x-icon' },
      ],
    });
  });

  it('serves an HTML landing page linking the icon to browsers and crawlers', async () => {
    const { app } = makeApp();
    open.push(app);
    // Browsers send text/html; favicon crawlers often send */* or nothing at all.
    for (const accept of ['text/html,application/xhtml+xml,*/*;q=0.8', '*/*', undefined]) {
      const res = await app.fetch(
        new Request('https://mcp.test/', { headers: accept ? { accept } : {} }),
      );
      expect(res.status, String(accept)).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const html = await res.text();
      expect(html).toContain('<link rel="icon" href="https://mcp.test/favicon.ico"');
      expect(html).toContain('href="https://mcp.test/icon.png"');
      expect(html).toContain('0.0.0-test');
      expect(html).toContain('<code>https://mcp.test</code>');
    }
    const head = await app.fetch(new Request('https://mcp.test/', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    // A host opening the event stream still gets the transport's answer.
    const stream = await app.fetch(
      new Request('https://mcp.test/', { headers: { accept: 'text/event-stream' } }),
    );
    expect(stream.status).toBe(405);
  });

  it('keeps the icons at the origin root when the MCP endpoint has a path', async () => {
    const publicUrl = new URL('https://mcp.test/mcp');
    const app = createHttpApp({
      version: '0.0.0-test',
      publicUrl,
      issuerUrl: publicUrl,
      nbClientFactory: () => fakeNbClient({ responses: [], apiKey: KEY }).nb,
    });
    open.push(app);
    expect((await app.fetch(new Request('https://mcp.test/favicon.ico'))).status).toBe(200);
    expect((await app.fetch(new Request('https://mcp.test/mcp/favicon.ico'))).status).toBe(404);
    // The landing page is at the host root as well as at the endpoint, with root icon links.
    for (const url of ['https://mcp.test/', 'https://mcp.test/mcp']) {
      const res = await app.fetch(new Request(url, { headers: { accept: '*/*' } }));
      expect(res.status, url).toBe(200);
      const html = await res.text();
      expect(html).toContain('href="https://mcp.test/favicon.ico"');
      expect(html).toContain('<code>https://mcp.test/mcp</code>');
    }
    expect((await app.fetch(new Request('https://mcp.test/other'))).status).toBe(404);
    const transport = new StreamableHTTPClientTransport(publicUrl, {
      fetch: (input, init) => app.fetch(new Request(input, init)),
    });
    const client = new Client({ name: 'http-conformance', version: '0.0.0' });
    await client.connect(transport);
    open.push(client);
    expect(client.getServerVersion()?.icons?.map((i) => i.src)).toEqual([
      'https://mcp.test/icon.png',
      'https://mcp.test/favicon.ico',
    ]);
  });

  it('lets an anonymous host list tools and use the documentation tools', async () => {
    const { app, keysUsed } = makeApp();
    open.push(app);
    const client = await connect(app);
    open.push(client);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(27);
    const result = await client.callTool({
      name: 'search_documentation',
      arguments: { query: 'truck_weight', api: 'Directions' },
    });
    expect(result.isError).toBeFalsy();
    expect(keysUsed).toEqual([]);
  });

  it('refuses an anonymous API tool call with the 401 that starts sign-in', async () => {
    const { app, keysUsed } = makeApp();
    open.push(app);
    const client = await connect(app);
    open.push(client);
    await expect(
      client.callTool({ name: 'geocode_forward', arguments: { query: 'empire state building' } }),
    ).rejects.toBeDefined();
    expect(keysUsed).toEqual([]);

    // The raw HTTP shape, as a host sees it.
    const response = await app.fetch(
      new Request('https://mcp.test/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'geocode_forward', arguments: { query: 'x' } },
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://mcp.test/.well-known/oauth-protected-resource"',
    );
  });

  it('uses the bearer key for the API call and nothing else', async () => {
    const { app, keysUsed, requests } = makeApp();
    open.push(app);
    const client = await connect(app, `Bearer ${KEY}`);
    open.push(client);
    const result = await client.callTool({
      name: 'geocode_forward',
      arguments: { query: 'empire state building' },
    });
    expect(result.isError).toBeFalsy();
    // One client per request (connect, list, call); every one of them got the caller's key.
    expect(keysUsed.length).toBeGreaterThanOrEqual(1);
    expect(new Set(keysUsed)).toEqual(new Set([KEY]));
    expect(requests()).toHaveLength(1);
    expect(requests()[0]!.url.searchParams.get('key')).toBe(KEY);
  });

  it('refuses a malformed bearer token outright', async () => {
    const { app } = makeApp();
    open.push(app);
    const response = await app.fetch(
      new Request('https://mcp.test/', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ${user_config.nbai_api_key}',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
});
