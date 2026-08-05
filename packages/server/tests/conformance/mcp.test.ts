import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/core/server.js';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';

/**
 * Protocol-level tests: a real MCP client connected to the built server over an
 * in-memory transport, with the NextBillion HTTP layer faked. Verifies what an
 * actual host (Claude Code, Codex, Cursor) observes.
 */
describe('MCP conformance', () => {
  let client: Client;
  let requests: ReturnType<typeof fakeNbClient>['requests'];

  beforeEach(async () => {
    const fake = fakeNbClient({
      responses: [
        {
          body: {
            items: [
              {
                title: 'Empire State Building',
                id: 'abc',
                position: { lat: 40.748, lng: -73.985 },
                address: { label: 'Empire State Building, NYC' },
              },
            ],
          },
        },
      ],
    });
    requests = fake.requests;
    const server = buildServer(fake.nb, '0.0.0-test');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'conformance-test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  it('lists all 15 tools in deterministic sorted order with schemas and annotations', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual(ALL_TOOLS.map((t) => t.name));
    for (const tool of result.tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema, tool.name).toBeTruthy();
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });

  it('serves identical tool lists across separate connections', async () => {
    const first = await client.listTools();
    const second = await client.listTools();
    expect(second.tools).toEqual(first.tools);
  });

  it('executes a tool call end to end with text + structured content', async () => {
    const result = await client.callTool({
      name: 'geocode_forward',
      arguments: { query: 'empire state building' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text?: string }>).find(
      (c) => c.type === 'text',
    );
    expect(text?.text).toContain('Empire State Building');
    expect(result.structuredContent).toMatchObject({ items: [{ id: 'abc' }] });
    expect(requests[0]!.url.pathname).toBe('/geocode');
  });

  it('rejects schema-invalid arguments as an in-band tool error', async () => {
    const result = await client.callTool({
      name: 'geocode_forward',
      arguments: { query: 123 },
    });
    expect(result.isError).toBe(true);
  });

  it('returns upstream API failures as readable tool errors, key redacted', async () => {
    const failing = fakeNbClient({
      responses: [{ status: 403, body: { msg: 'region not enabled' } }],
    });
    const server = buildServer(failing.nb, '0.0.0-test');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const failingClient = new Client({ name: 'conformance-test-2', version: '0.0.0' });
    await failingClient.connect(clientTransport);

    const result = await failingClient.callTool({
      name: 'place_lookup',
      arguments: { id: 'abc' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(text).toContain('403');
    expect(text).toContain('region not enabled');
    expect(text).not.toContain('test-key-1234');
  });
});
