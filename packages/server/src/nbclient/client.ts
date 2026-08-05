import { NbApiError, redactKey } from './errors.js';

export type QueryValue = string | number | boolean | undefined;
/** Arrays produce repeated query parameters (e.g. several `path=` entries). */
export type Query = Record<string, QueryValue | QueryValue[]>;

export interface NbClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Max retries for 429/5xx/network failures on idempotent requests. */
  maxRetries?: number;
  /** Injectable for tests. Defaults to a real delay. */
  sleepFn?: (ms: number) => Promise<void>;
}

export interface BinaryResponse {
  data: Uint8Array;
  contentType: string;
}

const RETRIABLE_STATUSES = new Set([429, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Single HTTP client shared by every tool: injects the API key, applies timeouts,
 * retries transient failures with backoff, and normalizes errors. All NextBillion
 * endpoints authenticate via the `key` query parameter.
 */
export class NbClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: NbClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.nextbillion.io').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleepFn = options.sleepFn ?? sleep;
  }

  buildUrl(path: string, query: Query = {}): string {
    const url = new URL(this.baseUrl + path);
    url.searchParams.set('key', this.apiKey);
    for (const [name, value] of Object.entries(query)) {
      for (const entry of Array.isArray(value) ? value : [value]) {
        if (entry !== undefined) url.searchParams.append(name, String(entry));
      }
    }
    return url.toString();
  }

  async getJson<T = unknown>(path: string, query: Query = {}): Promise<T> {
    const response = await this.request('GET', this.buildUrl(path, query));
    return this.parseJson<T>(response);
  }

  async postJson<T = unknown>(path: string, query: Query, body: unknown): Promise<T> {
    const response = await this.request('POST', this.buildUrl(path, query), body);
    return this.parseJson<T>(response);
  }

  async getBinary(path: string, query: Query = {}): Promise<BinaryResponse> {
    const response = await this.request('GET', this.buildUrl(path, query));
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  private async request(method: 'GET' | 'POST', url: string, body?: unknown): Promise<Response> {
    // POST bodies here are all idempotent queries (search/matrix/geocode), so retrying is safe.
    let lastError: NbApiError | undefined;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method,
          headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
        lastError = new NbApiError({
          url,
          message: timedOut
            ? `Request timed out after ${this.timeoutMs} ms`
            : `Network error: ${error instanceof Error ? error.message : String(error)}`,
        });
        if (attempt < this.maxRetries && !timedOut) {
          await this.sleepFn(this.backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      if (response.ok) return response;

      const errorBody = await response.text().catch(() => '');
      lastError = new NbApiError({
        status: response.status,
        url,
        body: errorBody,
        message: extractApiMessage(errorBody),
      });
      if (RETRIABLE_STATUSES.has(response.status) && attempt < this.maxRetries) {
        await this.sleepFn(this.backoffMs(attempt));
        continue;
      }
      throw lastError;
    }
  }

  private backoffMs(attempt: number): number {
    return 300 * 2 ** attempt + Math.floor(Math.random() * 100);
  }

  private async parseJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new NbApiError({
        status: response.status,
        url: response.url ?? '',
        body: text,
        message: `Expected JSON response but got: ${redactKey(text.slice(0, 200))}`,
      });
    }
  }
}

/** NextBillion error bodies vary: some use {status, msg}, others {code, message}. */
function extractApiMessage(bodyText: string): string | undefined {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const message = parsed.msg ?? parsed.message ?? parsed.error;
    return typeof message === 'string' && message.length > 0 ? message : undefined;
  } catch {
    return bodyText.length > 0 && bodyText.length <= 300 ? bodyText : undefined;
  }
}
