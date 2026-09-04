# nextbillion-mcp

MCP server exposing [NextBillion.ai](https://nextbillion.ai) location APIs as tools for AI
agents: geocoding, place search, routing, distance matrices, isochrones, and static maps.

Implements the [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
(stateless core) via the official TypeScript SDK v2; older-protocol clients are served through the
SDK's built-in legacy negotiation.

## Quick start

Get an API key at [console.nextbillion.ai](https://console.nextbillion.ai) and export it as
`NBAI_API_KEY` in your shell profile.

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

| Tool                 | NextBillion API                                |
| -------------------- | ---------------------------------------------- |
| `autocomplete`       | Autocomplete (prefix address completion)       |
| `autosuggest`        | Autosuggest (typo-tolerant suggestions)        |
| `directions`         | Directions (fast + flexible)                   |
| `distance_matrix`    | Distance Matrix (fast + flexible, synchronous) |
| `geocode_batch`      | Batch Geocode (up to 100 queries per call)     |
| `geocode_forward`    | Forward Geocode                                |
| `geocode_reverse`    | Reverse Geocode                                |
| `geocode_structured` | Structured Geocode                             |
| `isochrone`          | Isochrone                                      |
| `place_lookup`       | Place Lookup                                   |
| `place_search`       | Discover (POI search)                          |
| `postcode_lookup`    | Geocode Postcode                               |
| `search_along_route` | Search Along Route                             |
| `static_map_image`   | Static Images                                  |
| `static_route_map`   | Static Images (route/path overlay)             |

Tool inputs always use explicit `{latitude, longitude}` objects; the server handles the
underlying API's coordinate-order conventions internally.

## Repository layout

- `packages/server/` — **protocol layer**: the MCP server published to npm as `nextbillion-mcp`.
  - `src/core/` — server assembly (spec compliance, error mapping)
  - `src/tools/` — one file per tool, grouped by product (places / routing / maps)
  - `src/nbclient/` — shared NextBillion HTTP client (auth, timeout, retry, key redaction)
  - `src/transports/` — (stdio is served via the SDK entry; HTTP transport lands here later)
- `distributions/` — **distribution layer**: zero-logic install packaging per client
  (Claude Code plugin, Codex plugin bundle, Cursor snippet, manual configuration).
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
