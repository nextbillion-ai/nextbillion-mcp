import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export interface ServerConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface ImageDirResolution {
  /** Directory to save rendered map images to; undefined means nothing is written. */
  dir?: string;
  /** Set when NBAI_IMAGE_DIR was given but unusable; saving is disabled in that case. */
  warning?: string;
}

/**
 * Saving rendered map images to disk is opt-in via NBAI_IMAGE_DIR. When it is unset the
 * server never touches the filesystem: the image is returned inline only, which is all
 * that desktop hosts need. Terminal-based MCP clients such as the Codex CLI cannot display
 * image content, so their configs set the variable; the literal value `tmp` selects
 * `<OS temp dir>/nextbillion-mcp` and keeps those configs portable. Relative paths are
 * rejected because a stdio server's working directory is whatever the host chose.
 */
export function resolveImageDir(env: NodeJS.ProcessEnv = process.env): ImageDirResolution {
  const raw = env.NBAI_IMAGE_DIR?.trim();
  if (!raw) return {};
  if (raw.toLowerCase() === 'tmp') return { dir: join(tmpdir(), 'nextbillion-mcp') };
  if (!isAbsolute(raw)) {
    return {
      warning: `NBAI_IMAGE_DIR must be an absolute path or "tmp", got "${raw}"; map images will not be saved`,
    };
  }
  return { dir: raw };
}

/** Directory for saved map images, or undefined when saving is not enabled. */
export function imageOutputDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return resolveImageDir(env).dir;
}

export const DEFAULT_BASE_URL = 'https://api.nextbillion.io';
export const DEFAULT_TIMEOUT_MS = 30_000;

export class ConfigError extends Error {}

/** Read configuration from environment variables. Throws ConfigError when the API key is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const apiKey = env.NBAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      'NBAI_API_KEY is not set. Get an API key at https://console.nextbillion.ai and ' +
        'expose it to the server, e.g. NBAI_API_KEY=<your key> npx nextbillion-mcp',
    );
  }
  const timeoutMs = env.NBAI_TIMEOUT_MS ? Number(env.NBAI_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`NBAI_TIMEOUT_MS must be a positive number, got: ${env.NBAI_TIMEOUT_MS}`);
  }
  return {
    apiKey,
    baseUrl: (env.NBAI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    timeoutMs,
  };
}

export interface HttpConfig {
  /** TCP port to listen on. Cloud Run sets PORT; default 8080. */
  port: number;
  /**
   * The public URL users enter in their MCP host, e.g. https://mcp.nextbillion.io. It is the
   * OAuth `resource` identifier and the base of the discovery documents, so it must match
   * exactly what users type (scheme, host, path, no trailing slash).
   */
  publicUrl: URL;
  /** OAuth authorization server issuer; defaults to the public URL (the server is its own AS). */
  issuerUrl: URL;
  baseUrl: string;
  timeoutMs: number;
}

/**
 * Configuration for the hosted (Streamable HTTP) mode. There is no server-wide API key:
 * every request carries the caller's credentials, so NBAI_API_KEY is deliberately ignored
 * (a fallback key would bill the operator for anonymous traffic).
 */
export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const port = env.PORT ? Number(env.PORT) : 8080;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`PORT must be a TCP port number, got: ${env.PORT}`);
  }
  const publicUrl = parseHttpsUrl(
    env.NBAI_PUBLIC_URL?.trim() || 'https://mcp.nextbillion.io',
    'NBAI_PUBLIC_URL',
  );
  const issuerUrl = env.NBAI_ISSUER_URL?.trim()
    ? parseHttpsUrl(env.NBAI_ISSUER_URL.trim(), 'NBAI_ISSUER_URL')
    : publicUrl;
  const timeoutMs = env.NBAI_TIMEOUT_MS ? Number(env.NBAI_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`NBAI_TIMEOUT_MS must be a positive number, got: ${env.NBAI_TIMEOUT_MS}`);
  }
  return {
    port,
    publicUrl,
    issuerUrl,
    baseUrl: env.NBAI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    timeoutMs,
  };
}

function parseHttpsUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL, got: ${value}`);
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ConfigError(
      `${name} must use https:// (http:// is allowed for localhost only), got: ${value}`,
    );
  }
  if (url.search || url.hash)
    throw new ConfigError(`${name} must not carry a query or fragment: ${value}`);
  // Normalise: no trailing slash so `resource` compares equal to what hosts send.
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}
