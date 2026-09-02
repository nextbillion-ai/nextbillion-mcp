# Changelog

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
