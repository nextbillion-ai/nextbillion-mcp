#!/usr/bin/env node
import { createRequire } from 'node:module';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadConfig, loadHttpConfig, resolveImageDir } from './config.js';
import { buildServer, SERVER_NAME } from './core/server.js';
import { createHttpApp } from './http/app.js';
import { startHttpServer } from './http/node-server.js';
import { KeyRing } from './http/oauth/crypto.js';
import { probeApiKey } from './http/oauth/probe.js';
import { logError, logInfo } from './log.js';
import { NbClient } from './nbclient/client.js';

declare const __NBMCP_VERSION__: string | undefined;

/**
 * The version is injected by esbuild at build time so the bundled file is fully
 * standalone (it is also shipped inside the Claude Code plugin, where no package.json
 * sits next to it). Under tsx/vitest the define is absent and package.json is read.
 */
const pkg: { version: string } =
  typeof __NBMCP_VERSION__ === 'string'
    ? { version: __NBMCP_VERSION__ }
    : (createRequire(import.meta.url)('../package.json') as { version: string });

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    console.log(pkg.version);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      `${SERVER_NAME} ${pkg.version} — MCP server for NextBillion.ai location APIs\n\n` +
        'Runs as an MCP stdio server; configure it in your MCP client, not by hand.\n' +
        'With --http it serves Streamable HTTP instead (hosted mode): callers authenticate per\n' +
        'request with `Authorization: Bearer <API key>`; NBAI_API_KEY is ignored.\n\n' +
        'Environment variables (stdio mode):\n' +
        '  NBAI_API_KEY      (required) NextBillion.ai API key\n' +
        '  NBAI_BASE_URL     (optional) API base URL, default https://api.nextbillion.io\n' +
        '  NBAI_TIMEOUT_MS   (optional) per-request timeout, default 30000\n' +
        '  NBAI_IMAGE_DIR    (optional) also save rendered maps to this absolute directory, or\n' +
        '                    "tmp" for the OS temp dir; unset = nothing is written to disk\n' +
        '  NBAI_DOCS_INDEX   (optional) path to an alternative documentation index file\n' +
        'Environment variables (--http mode):\n' +
        '  PORT              (optional) TCP port, default 8080\n' +
        '  NBAI_PUBLIC_URL   (optional) URL users enter, default https://mcp.nextbillion.io\n' +
        '  NBAI_ISSUER_URL   (optional) OAuth issuer, default = NBAI_PUBLIC_URL\n' +
        '  NBAI_TOKEN_KEY    (required in production) 32-byte base64 key(s) that seal tokens;\n' +
        '                    comma-separated, current first, to rotate\n' +
        '  NBAI_BASE_URL, NBAI_TIMEOUT_MS as above\n',
    );
    return;
  }

  if (args.includes('--http')) {
    void serveHttp();
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logError(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const nb = new NbClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
  });

  const imageDir = resolveImageDir();
  if (imageDir.warning) logError(imageDir.warning);
  else if (imageDir.dir) logInfo(`rendered map images will also be saved to ${imageDir.dir}`);

  const handle = serveStdio(() => buildServer(nb, pkg.version));
  logInfo(`${SERVER_NAME} ${pkg.version} listening on stdio`);

  const shutdown = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Hosted mode: one process serves many callers over Streamable HTTP. Every request carries
 * its own credentials, so the server-wide key and the image-saving option do not apply.
 */
async function serveHttp(): Promise<void> {
  let config;
  try {
    config = loadHttpConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logError(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (process.env.NBAI_API_KEY) {
    logError('NBAI_API_KEY is ignored in --http mode: callers send their own key per request');
  }
  if (process.env.NBAI_IMAGE_DIR) {
    logError('NBAI_IMAGE_DIR is ignored in --http mode: a hosted server writes nothing to disk');
    delete process.env.NBAI_IMAGE_DIR;
  }

  let keys;
  try {
    keys = KeyRing.fromEnv(process.env.NBAI_TOKEN_KEY);
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (keys.ephemeral) {
    logError(
      'NBAI_TOKEN_KEY is not set: using a random key, so tokens will not survive a restart and ' +
        'other instances cannot read them. Set a 32-byte base64 key for any real deployment.',
    );
  }

  const app = createHttpApp({
    version: pkg.version,
    publicUrl: config.publicUrl,
    issuerUrl: config.issuerUrl,
    nbClientFactory: (apiKey) =>
      new NbClient({ apiKey, baseUrl: config.baseUrl, timeoutMs: config.timeoutMs }),
    oauth: {
      keyRing: keys.ring,
      probeApiKey: (apiKey) => probeApiKey(config.baseUrl, apiKey),
    },
  });
  const server = await startHttpServer(app, config.port);
  logInfo(
    `${SERVER_NAME} ${pkg.version} listening on http://0.0.0.0:${config.port}${config.publicUrl.pathname || '/'} (public URL ${config.publicUrl.href})`,
  );

  const shutdown = () => {
    server.close();
    void app.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
