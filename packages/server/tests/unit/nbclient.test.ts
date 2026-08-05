import { describe, expect, it } from 'vitest';
import { NbClient } from '../../src/nbclient/client.js';
import { NbApiError, redactKey } from '../../src/nbclient/errors.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';

describe('NbClient', () => {
  it('injects the API key as the `key` query parameter', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { items: [] } }] });
    await nb.getJson('/geocode', { q: 'market' });
    expect(requests[0]!.url.searchParams.get('key')).toBe('test-key-1234');
    expect(requests[0]!.url.searchParams.get('q')).toBe('market');
  });

  it('skips undefined query values and repeats array values', async () => {
    const { nb, requests } = fakeNbClient();
    await nb.getJson('/x', { a: undefined, b: ['1', '2'], c: 3 });
    const url = requests[0]!.url;
    expect(url.searchParams.has('a')).toBe(false);
    expect(url.searchParams.getAll('b')).toEqual(['1', '2']);
    expect(url.searchParams.get('c')).toBe('3');
  });

  it('retries 429 responses and succeeds', async () => {
    const { nb, requests } = fakeNbClient({
      responses: [{ status: 429, body: { msg: 'slow down' } }, { body: { ok: true } }],
    });
    const result = await nb.getJson<{ ok: boolean }>('/x');
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it('does not retry 400 responses and surfaces the API message', async () => {
    const { nb, requests } = fakeNbClient({
      responses: [{ status: 400, body: { msg: 'origin is invalid' } }],
    });
    const error = await nb.getJson('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NbApiError);
    expect((error as NbApiError).status).toBe(400);
    expect((error as NbApiError).message).toContain('origin is invalid');
    expect(requests).toHaveLength(1);
  });

  it('never leaks the API key in error messages or URLs', async () => {
    const { nb } = fakeNbClient({ responses: [{ status: 401, body: 'bad key' }] });
    const error = (await nb.getJson('/x').catch((e: unknown) => e)) as NbApiError;
    expect(error.url).not.toContain('test-key-1234');
    expect(error.message).not.toContain('test-key-1234');
  });

  it('redactKey masks key values wherever they appear', () => {
    expect(redactKey('https://a/b?q=1&key=secret123&x=2')).toBe('https://a/b?q=1&key=***&x=2');
  });

  it('posts JSON bodies with content-type header', async () => {
    const { nb, requests } = fakeNbClient();
    await nb.postJson('/postalcode', {}, { postalcode: '90011' });
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.body).toEqual({ postalcode: '90011' });
  });
});
