/**
 * Checks that an API key is accepted by the NextBillion.ai API before a token is issued for
 * it. The probe is a request the API rejects *after* authentication (a geocode with no
 * query): an invalid key gets HTTP 401 from the gateway, a valid one gets a 400 validation
 * error, and nothing is billed because nothing is served. Network trouble is reported as
 * `unavailable` so the sign-in page can ask the user to retry instead of refusing a good key.
 */
export type ApiKeyProbeResult = 'valid' | 'invalid' | 'unavailable';

export async function probeApiKey(
  baseUrl: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<ApiKeyProbeResult> {
  const url = new URL('/h/geocode', baseUrl.replace(/\/+$/, '') + '/');
  url.searchParams.set('key', apiKey);
  try {
    const response = await fetchFn(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 401 || response.status === 403) return 'invalid';
    if (response.status >= 500) return 'unavailable';
    return 'valid';
  } catch {
    return 'unavailable';
  }
}
