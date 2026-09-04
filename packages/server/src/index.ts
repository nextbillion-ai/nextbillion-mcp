#!/usr/bin/env node
import { createRequire } from 'node:module';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadConfig } from './config.js';
import { buildServer, SERVER_NAME } from './core/server.js';
import { logError, logInfo } from './log.js';
import { NbClient } from './nbclient/client.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    console.log(pkg.version);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      `${SERVER_NAME} ${pkg.version} — MCP server for NextBillion.ai location APIs\n\n` +
        'Runs as an MCP stdio server; configure it in your MCP client, not by hand.\n\n' +
        'Environment variables:\n' +
        '  NBAI_API_KEY      (required) NextBillion.ai API key\n' +
        '  NBAI_BASE_URL     (optional) API base URL, default https://api.nextbillion.io\n' +
        '  NBAI_TIMEOUT_MS   (optional) per-request timeout, default 30000\n' +
        '  NBAI_IMAGE_DIR    (optional) directory for saved map images, default <tmp>/nextbillion-mcp\n',
    );
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

  const handle = serveStdio(() => buildServer(nb, pkg.version));
  logInfo(`${SERVER_NAME} ${pkg.version} listening on stdio`);

  const shutdown = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
