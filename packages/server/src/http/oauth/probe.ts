/**
 * Optional check of an API key at sign-in against a gateway endpoint that only
 * authenticates (no SKU, no billing, no forwarding): the gateway answers 204 for a valid key,
 * 401 for an unknown one and 403 when the key's IP allowlist or origin restrictions reject
 * the caller. The URL comes from NBAI_KEY_CHECK_URL; without it, sign-in accepts any
 * well-formed key and the first tool call surfaces an invalid key as a clear error instead.
 *
 * Why not an ordinary API call: every documented endpoint is billed and gated by the
 * customer's SKUs, so a probe would cost money and fail for customers without that SKU.
 */
export type ApiKeyProbeResult = 'valid' | 'invalid' | 'restricted' | 'unavailable';

export async function probeApiKey(
  checkUrl: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<ApiKeyProbeResult> {
  const url = new URL(checkUrl);
  url.searchParams.set('key', apiKey);
  try {
    const response = await fetchFn(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 401) return 'invalid';
    if (response.status === 403) return 'restricted';
    if (response.status >= 500) return 'unavailable';
    return 'valid';
  } catch {
    return 'unavailable';
  }
}
