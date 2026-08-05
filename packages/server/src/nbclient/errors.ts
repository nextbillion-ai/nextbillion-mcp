/** Replace the API key value in any URL or message so it never leaks into tool results or logs. */
export function redactKey(text: string): string {
  return text.replace(/([?&]key=)[^&\s'"]+/gi, '$1***');
}

const STATUS_HINTS: Record<number, string> = {
  400: 'Input validation failed — a parameter is missing, malformed, or has an invalid value.',
  401: 'API key is missing or invalid.',
  403: 'API key is valid but has no access to this service or geographic region.',
  404: 'Endpoint not found.',
  413: 'Request URL or body is too large.',
  414: 'Request URL is too long (max 8192 bytes) — use an encoded polyline or fewer points.',
  422: 'The request is valid but no result could be produced (e.g. unroutable coordinates or no matching places).',
  429: 'Rate limit or usage quota exceeded. Retry later or batch requests.',
  500: 'NextBillion API internal error.',
};

export class NbApiError extends Error {
  readonly status: number | undefined;
  readonly url: string;
  readonly body: unknown;

  constructor(options: { status?: number; url: string; body?: unknown; message?: string }) {
    const hint = options.status !== undefined ? STATUS_HINTS[options.status] : undefined;
    const parts = [
      options.status !== undefined
        ? `NextBillion API error (HTTP ${options.status})`
        : 'NextBillion API request failed',
      options.message,
      hint,
    ].filter(Boolean);
    super(redactKey(parts.join(': ')));
    this.name = 'NbApiError';
    this.status = options.status;
    this.url = redactKey(options.url);
    this.body = options.body;
  }
}
