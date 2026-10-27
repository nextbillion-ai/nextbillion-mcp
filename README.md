# nextbillion-mcp

MCP server exposing [NextBillion.ai](https://nextbillion.ai) location APIs as tools for AI
agents: geocoding, place search, routing, distance matrices, isochrones, and static maps.

Implements the [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
(stateless core) via the official TypeScript SDK v2; older-protocol clients are served through the
SDK's built-in legacy negotiation.

## Quick start

Get an API key from [console.nextbillion.ai](https://console.nextbillion.ai) or by emailing
support@nextbillion.ai, and export it as `NBAI_API_KEY` in your shell profile.

**Claude Desktop extension:** download `nextbillion-mcp-<version>.mcpb` from the
[latest release](https://github.com/nextbillion-ai/nextbillion-mcp/releases/latest), open it
(or Settings → Extensions → Advanced settings → Install Extension…), and paste your API key when
prompted. The server is bundled, so no Node.js install is needed. Details in
[`distributions/claude-desktop/README.md`](distributions/claude-desktop/README.md).

**Claude Code plugin** (this repository doubles as a plugin marketplace):

```bash
claude plugin marketplace add nextbillion-ai/nextbillion-mcp
claude plugin install nextbillion-mcp@nextbillion
```

**Any MCP client** — snippets for Claude Code, Cursor, and Codex are in
[`distributions/manual/README.md`](distributions/manual/README.md). The short version:

```bash
NBAI_API_KEY=<your key> npm_config_audit=false npx -y nextbillion-mcp
```

(The Claude Code plugin runs a bundled copy of the server directly — no npx, no network at
startup. For npx-based setups, `npm_config_audit=false` skips npm's post-install audit call,
which hangs on some networks; see `distributions/manual/README.md`.)

## Tools

| Tool                        | NextBillion API                                             |
| --------------------------- | ----------------------------------------------------------- |
| `autocomplete`              | Autocomplete (prefix address completion)                    |
| `autosuggest`               | Autosuggest (typo-tolerant suggestions)                     |
| `directions`                | Directions (fast + flexible)                                |
| `distance_matrix`           | Distance Matrix (fast + flexible, synchronous)              |
| `geocode_batch`             | Batch Geocode (up to 100 queries per call)                  |
| `geocode_forward`           | Forward Geocode                                             |
| `geocode_reverse`           | Reverse Geocode                                             |
| `geocode_structured`        | Structured Geocode                                          |
| `isochrone`                 | Isochrone                                                   |
| `place_browse`              | Browse (places by category near a location)                 |
| `place_lookup`              | Place Lookup                                                |
| `place_search`              | Discover (POI search)                                       |
| `postcode_lookup`           | Geocode Postcode                                            |
| `search_along_route`        | Search Along Route                                          |
| `static_map_image`          | Static Images                                               |
| `static_route_map`          | Static Images (route/path overlay)                          |
| `search_documentation`      | Documentation search (bundled index of docs.nextbillion.ai) |
| `get_documentation`         | Documentation page by `doc_id`                              |
| `list_documentation_topics` | Documentation categories, APIs and pages                    |

Tool inputs always use explicit `{latitude, longitude}` objects; the server handles the
underlying API's coordinate-order conventions internally.

### Documentation tools

Four tools answer questions about the APIs and SDKs from the official documentation: `search_documentation` returns ranked excerpts with a `source_url` to cite and the name of the tool that performs the operation, `get_documentation` returns one page or one section, `get_api_parameters` returns the request parameters of a REST endpoint as structured records (units only when the docs state them), and `list_documentation_topics` lists what is covered. The hosted server builds its index from the documentation repository at start and rebuilds it whenever the repository's `main` branch changes, so documentation updates reach it within minutes; the local package carries a snapshot built at release time (see `packages/server/docs/README.md`). Pages that exist on the site but not in the docs repository (solutions, apps, help, the Web Maps SDK v1) are not covered.

## Hosted mode

The same server can run as a remote MCP server over Streamable HTTP, so hosts connect to a
URL instead of launching a local process:

```bash
PORT=8080 NBAI_PUBLIC_URL=https://mcp.nextbillion.io nextbillion-mcp --http
```

- The MCP endpoint is the root of `NBAI_PUBLIC_URL` (the URL users enter in their host; it is
  also the OAuth `resource`). `GET /healthz` answers liveness and
  `/.well-known/oauth-protected-resource` is served for OAuth discovery.
- **Credentials travel with each request.** There is no server-wide key: `NBAI_API_KEY` is
  ignored, and every API call uses the key of the caller. Developers and CI send it directly:

  ```bash
  claude mcp add --transport http nextbillion https://mcp.nextbillion.io \
    --header "Authorization: Bearer $NBAI_API_KEY"
  ```

- **Lazy authentication.** Without credentials a host can still connect, list tools and use
  the four documentation tools. The first call to an API tool is answered with HTTP 401 and a
  `WWW-Authenticate: Bearer resource_metadata=…` challenge, which makes Claude open its
  sign-in flow.
- **Sign-in.** The server is its own OAuth 2.1 authorization server (`/oauth/*`). The sign-in
  page asks for the user's NextBillion.ai API key once, checks it with the API, and seals it
  into the tokens it issues (AES-256-GCM, key in `NBAI_TOKEN_KEY`; generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). Nothing is
  stored server-side; revoke by resetting the key in the console. Claude identifies itself with
  its Client ID Metadata Document; other hosts can use dynamic registration.
- `NBAI_IMAGE_DIR` is ignored: a hosted server writes nothing to disk. Map images are returned
  inline only.
- Stateless: the SDK builds one server instance per request and the API client for it is
  created from that request's key. Nothing about a caller is retained between requests.
- Container: `docker build -t nextbillion-mcp .` then
  `docker run -p 8080:8080 -e NBAI_PUBLIC_URL=https://mcp.nextbillion.io -e NBAI_TOKEN_KEY=… nextbillion-mcp`.

## Privacy Policy

`nextbillion-mcp` is a local MCP server: it runs on your own machine, is started by your
MCP client, and communicates only with the NextBillion.ai API. NextBillion.ai's privacy
policy applies to the API service: https://nextbillion.ai/privacy.

**What is collected and sent.** When your AI client calls one of the API tools, the server
sends that tool call's arguments (for example addresses, place names, coordinates, route
and map parameters) to `api.nextbillion.io` over HTTPS, authenticated with your API key, and
returns the API's response to your client unchanged. The server does not collect or
transmit anything else: no conversation content beyond the tool arguments, no files, no
device or usage information. The server does not query your client's memory, chat history
or files.

**Hosted mode (mcp.nextbillion.io).** When you use the hosted server instead of a local one,
your API key is sent to it once at sign-in, checked against the NextBillion.ai API, and
returned to your MCP host sealed inside encrypted tokens. On every tool call the server
decrypts the token in memory, calls `api.nextbillion.io` with your key, and returns the
response; it keeps no database, writes nothing to disk, and logs only method, path, status
and duration (never headers, bodies, keys or tokens). Calls to the API come from the
server's fixed address (published in the release notes) rather than from your machine, which
matters only if your key has an IP allowlist. Revoke the hosted server's access at any time
by resetting the key in the console.

**Documentation tools.** The four documentation tools (`search_documentation`,
`get_documentation`, `get_api_parameters` and `list_documentation_topics`) run fully
offline: they answer from the documentation index bundled with the package and send
nothing anywhere, not even to NextBillion.ai.

**Telemetry.** None. The server contains no analytics, crash reporting or update checks;
its only network destination is the NextBillion.ai API (configurable via `NBAI_BASE_URL`).

**API key handling.** The key is read from the `NBAI_API_KEY` environment variable
supplied by your client configuration, kept in memory for the life of the process, sent
only to the NextBillion.ai API, and redacted from error messages and logs. It is never
written to disk by the server.

**Local storage.** Nothing is stored locally by default. If you set `NBAI_IMAGE_DIR`, the
two map tools additionally save each rendered map image to that directory so that
terminal clients can open it; those files are yours to keep or delete, and the server
never overwrites existing files. Diagnostics go to the process's standard error stream,
which your client may capture in its own logs.

**Third-party sharing and retention.** The server shares data with no one other than
NextBillion.ai. How NextBillion.ai uses and retains API request data is described in its
privacy policy at https://nextbillion.ai/privacy.

**Contact.** Privacy or support questions: support@nextbillion.ai.

## Repository layout

- `packages/server/` — **protocol layer**: the MCP server published to npm as `nextbillion-mcp`.
  - `src/core/` — server assembly (spec compliance, error mapping)
  - `src/tools/` — one file per tool, grouped by product (places / routing / maps)
  - `src/nbclient/` — shared NextBillion HTTP client (auth, timeout, retry, key redaction)
  - `src/transports/` — (stdio is served via the SDK entry; HTTP transport lands here later)
- `distributions/` — **distribution layer**: zero-logic install packaging per client
  (Claude Desktop extension, Claude Code plugin, Codex plugin bundle, Cursor snippet, manual
  configuration).
- `deploy/` — placeholder for the future hosted (Streamable HTTP) deployment.

## Development

```bash
npm install
npm run typecheck
npm test          # unit + protocol conformance (no network, no key needed)
npm run build     # bundles the server into a single zero-dependency dist/index.js
NBAI_API_KEY=<key> npm run test:e2e   # live-API smoke tests
```

Test a local build interactively with the MCP Inspector:

```bash
NBAI_API_KEY=<key> npx @modelcontextprotocol/inspector node packages/server/dist/index.js
```
