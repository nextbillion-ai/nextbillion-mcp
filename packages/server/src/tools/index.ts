import type { NbTool } from './types.js';
import { autocomplete, autosuggest, geocodeForward, placeSearch } from './places/text-search.js';
import { geocodeBatch } from './places/geocode-batch.js';
import { geocodeReverse } from './places/geocode-reverse.js';
import { geocodeStructured } from './places/geocode-structured.js';
import { placeLookup } from './places/place-lookup.js';
import { postcodeLookup } from './places/postcode-lookup.js';
import { directions } from './routing/directions.js';
import { distanceMatrix } from './routing/distance-matrix.js';
import { isochrone } from './routing/isochrone.js';
import { searchAlongRoute } from './routing/search-along-route.js';
import { staticMapImage } from './maps/static-map-image.js';
import { staticRouteMap } from './maps/static-route-map.js';

/**
 * Every tool served by this MCP server, sorted by name. The order is deliberately
 * deterministic: the 2026-07-28 revision requires list results not to vary per
 * connection, and a stable order improves client-side prompt-cache hits.
 */
export const ALL_TOOLS: ReadonlyArray<NbTool> = [
  autocomplete,
  autosuggest,
  directions,
  distanceMatrix,
  geocodeBatch,
  geocodeForward,
  geocodeReverse,
  geocodeStructured,
  isochrone,
  placeLookup,
  placeSearch,
  postcodeLookup,
  searchAlongRoute,
  staticMapImage,
  staticRouteMap,
].sort((a, b) => a.name.localeCompare(b.name));
