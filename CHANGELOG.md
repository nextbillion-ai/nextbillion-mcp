# Changelog

## 0.1.7 — 2026-09-04

- Ship the server as a single self-contained file with zero runtime dependencies (bundled
  with esbuild). Previously `npx nextbillion-mcp` had to resolve and install the MCP SDK
  and zod on first run, which took minutes on some machines and exceeded MCP hosts'
  startup timeouts (Codex CLI: 30 s "connection closed"/"timed out"; Claude Code:
  30000 ms). First start is now a single small tarball download.

## 0.1.6 — 2026-09-04

- Rendered maps (static_map_image, static_route_map) are now also saved to a local file
  and the path is reported in the result text. Terminal-based MCP clients such as the
  Codex CLI cannot display inline image content, leaving users no way to see the map;
  the saved file closes that gap while inline images keep working in desktop clients.
  Location: `NBAI_IMAGE_DIR`, default `<system temp>/nextbillion-mcp/`.

## 0.1.5 — 2026-09-04

- Fix: `static_route_map` failed for long routes because the full-resolution polyline
  exceeded the Static Images API's 8192-byte GET URL limit (a 600 km route encodes to
  ~30k characters). The tool now simplifies the display geometry automatically until the
  URL fits, and says so in the caption; distances/durations come from the directions tool
  and are unaffected.

## 0.1.4 — 2026-09-04

- Tool results now mirror the complete API response as JSON inside the text block,
  after the human-readable summary. Hosts that surface only text content to the model
  (e.g. Claude Desktop) previously could not see fields beyond the summary — such as
  `access` points in geocoding results — even though they were present in
  `structuredContent`. Applies uniformly to all tools.

## 0.1.3 — 2026-09-02

- Add the `types` result filter (houseNumber/addressBlock/street/intersection/place/area)
  to geocode_forward, geocode_batch (per query), and geocode_structured — tracking the
  August API update.
- Add `honor_restrictions` to directions and distance_matrix (restricted-area handling,
  flexible service).

## 0.1.2 — 2026-08-31

- Fix: `static_route_map` markers rendered in the wrong hemisphere with a world-level
  auto-zoom. Root cause (verified against the live API): the Static Images auto-fit
  endpoint parses `markers` latitude-first, the opposite of the documented order that
  the center-based endpoint honors. Markers are now serialized per endpoint variant.
- Add unit + live-API regression tests for the per-endpoint marker order.

## 0.1.1 — 2026-08-05

- License the project under Apache-2.0 (was an UNLICENSED placeholder).
- No functional changes.

## 0.1.0 — 2026-08-05

- Initial release: stdio MCP server implementing the MCP 2026-07-28 specification
  (legacy-era clients served via SDK negotiation).
- 15 read-only tools: forward/reverse/batch/structured geocoding, postcode lookup,
  place search/lookup, autosuggest, autocomplete, directions, distance matrix,
  isochrone, search along route, static map image, static route map.
- Claude Code plugin marketplace served from this repository.
