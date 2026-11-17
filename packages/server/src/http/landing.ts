/**
 * The page a browser or crawler gets at the server root. The MCP endpoint is not a web page,
 * but connector directories and favicon services open the root URL and look for
 * `<link rel="icon">`, so it must be real HTML with the icon links rather than text or a 405.
 */

import { escapeHtml } from './oauth/page.js';

export const DOCS_URL = 'https://github.com/nextbillion-ai/nextbillion-mcp#readme';
const WEBSITE_URL = 'https://nextbillion.ai';

const STYLE = `
  body { font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; background: #f6f7f9; margin: 0; }
  main { max-width: 34rem; margin: 6vh auto; background: #fff; border: 1px solid #e3e5e8; border-radius: 12px; padding: 2rem; }
  h1 { font-size: 1.35rem; margin: 0 0 0.5rem; }
  p { margin: 0.5rem 0; }
  .muted { color: #5c6470; font-size: 0.92rem; }
  code { background: #f0f1f3; padding: 0.1rem 0.3rem; border-radius: 4px; }
`;

export interface LandingPageOptions {
  version: string;
  /** The MCP endpoint URL (what to paste into a host). */
  resource: string;
  /** Origin the icon routes live on (`/favicon.ico`, `/icon.png` are always at the root). */
  origin: string;
}

export function renderLandingPage(o: LandingPageOptions): string {
  const resource = escapeHtml(o.resource);
  const origin = escapeHtml(o.origin);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="${origin}/favicon.ico" sizes="16x16 32x32 48x48"><link rel="icon" type="image/png" sizes="192x192" href="${origin}/icon.png"><link rel="apple-touch-icon" href="${origin}/icon.png">
<title>NextBillion.ai MCP server</title><style>${STYLE}</style></head>
<body><main>
<h1>NextBillion.ai MCP server</h1>
<p class="muted">nextbillion-mcp ${escapeHtml(o.version)}</p>
<p>This is an MCP server endpoint, not a web page. Add <code>${resource}</code> to your MCP host (Claude, Claude Code, Cursor, Codex).</p>
<p><a href="${DOCS_URL}">Documentation</a> · <a href="${WEBSITE_URL}">NextBillion.ai</a></p>
</main></body></html>
`;
}

/** 200 HTML for GET/HEAD; the caller decides when a request is a browser rather than a host. */
export function landingPage(request: Request, o: LandingPageOptions): Response {
  const html = renderLandingPage(o);
  return new Response(request.method === 'HEAD' ? null : html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(Buffer.byteLength(html)),
      'cache-control': 'public, max-age=3600',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'",
      'x-content-type-options': 'nosniff',
    },
  });
}
