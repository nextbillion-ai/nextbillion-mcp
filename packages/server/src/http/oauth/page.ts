/** Minimal, dependency-free HTML for the sign-in page. All interpolated values are escaped. */

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLE = `
  body { font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; background: #f6f7f9; margin: 0; }
  main { max-width: 34rem; margin: 6vh auto; background: #fff; border: 1px solid #e3e5e8; border-radius: 12px; padding: 2rem; }
  h1 { font-size: 1.35rem; margin: 0 0 0.5rem; }
  p { margin: 0.5rem 0; }
  .muted { color: #5c6470; font-size: 0.92rem; }
  .app { background: #f0f3ff; border-radius: 8px; padding: 0.75rem 1rem; margin: 1rem 0; }
  label { display: block; font-weight: 600; margin-top: 1rem; }
  input[type=password] { width: 100%; box-sizing: border-box; font: inherit; padding: 0.6rem 0.7rem; border: 1px solid #c8ccd2; border-radius: 8px; margin-top: 0.35rem; }
  button { font: inherit; font-weight: 600; margin-top: 1.25rem; padding: 0.65rem 1.2rem; border: 0; border-radius: 8px; background: #1f5eff; color: #fff; cursor: pointer; }
  .error { background: #fff1f0; color: #a8071a; border: 1px solid #ffccc7; border-radius: 8px; padding: 0.6rem 0.9rem; margin-top: 1rem; }
  code { background: #f0f1f3; padding: 0.1rem 0.3rem; border-radius: 4px; }
`;

export interface SignInPageOptions {
  /** Host of the application asking for access (what the user can trust). */
  appHost: string;
  appName?: string;
  /** Host the browser will be sent back to after sign-in. */
  redirectHost: string;
  redirectIsLoopback: boolean;
  /** Sealed authorization request, round-tripped through the form. */
  requestToken: string;
  error?: string;
}

export function renderSignInPage(o: SignInPageOptions): string {
  const app = o.appName
    ? `${escapeHtml(o.appName)} (${escapeHtml(o.appHost)})`
    : escapeHtml(o.appHost);
  const loopbackNote = o.redirectIsLoopback
    ? `<p class="muted">The redirect goes to an application on your own computer (<code>${escapeHtml(o.redirectHost)}</code>). Continue only if you started this sign-in yourself.</p>`
    : `<p class="muted">After sign-in your browser returns to <code>${escapeHtml(o.redirectHost)}</code>.</p>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Connect NextBillion.ai</title><style>${STYLE}</style></head>
<body><main>
<h1>Connect NextBillion.ai</h1>
<div class="app">Application asking for access: <strong>${app}</strong></div>
${loopbackNote}
<p>Paste your NextBillion.ai API key. It is sealed into the token handed back to the application and <strong>never stored</strong> by this server; an invalid key shows up as an error on the first request. Revoke access at any time by resetting the key in the <a href="https://console.nextbillion.ai" rel="noopener">console</a>.</p>
${o.error ? `<div class="error">${escapeHtml(o.error)}</div>` : ''}
<form method="post" action="" autocomplete="off">
<input type="hidden" name="request" value="${escapeHtml(o.requestToken)}">
<label for="api_key">API key</label>
<input id="api_key" name="api_key" type="password" required minlength="16" maxlength="128" autocomplete="off" spellcheck="false" autofocus>
<button type="submit">Connect</button>
</form>
<p class="muted">Don't have a key? Get one at <a href="https://console.nextbillion.ai" rel="noopener">console.nextbillion.ai</a> or email support@nextbillion.ai.</p>
</main></body></html>`;
}

export function renderErrorPage(title: string, detail: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>
<p class="muted">Close this window and start the connection again from your application.</p></main></body></html>`;
}
