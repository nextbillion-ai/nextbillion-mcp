export interface ServerConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
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
