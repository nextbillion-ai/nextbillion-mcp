import * as z from 'zod/v4';
import { placesFilterQuery, PlacesFilterShape, summarizePlaces } from '../shared/geo.js';
import { READ_ONLY, textResult, type NbTool } from '../types.js';

const TextSearchSchema = z.object({
  query: z.string().min(1).describe('Free-text search query'),
  ...PlacesFilterShape,
});

/**
 * geocode_forward, place_search, autosuggest and autocomplete share the exact same
 * request surface (`q` + geographic filters) against different endpoints; only the
 * ranking/matching behavior differs.
 */
function textSearchTool(options: {
  name: string;
  title: string;
  description: string;
  path: string;
  noun: string;
}): NbTool<typeof TextSearchSchema> {
  return {
    name: options.name,
    title: options.title,
    description: options.description,
    inputSchema: TextSearchSchema,
    annotations: READ_ONLY,
    async run(args, nb) {
      const response = await nb.getJson<Record<string, unknown>>(options.path, {
        q: args.query,
        ...placesFilterQuery(args),
      });
      return textResult(summarizePlaces(response, options.noun), response);
    },
  };
}

export const geocodeForward = textSearchTool({
  name: 'geocode_forward',
  title: 'Forward Geocode',
  description:
    'Convert a free-text address, place name, locality, or administrative area into geographic ' +
    'coordinates and a complete postal address. Tolerates incomplete or partly incorrect queries. ' +
    'Provide `near`, `country_codes`, or `bounding_box` for more relevant results. ' +
    'For many addresses at once use geocode_batch; for POI/business search use place_search.',
  path: '/geocode',
  noun: 'match',
});

export const placeSearch = textSearchTool({
  name: 'place_search',
  title: 'Search Places',
  description:
    'Search for places, points of interest, and businesses with a free-text query (e.g. ' +
    '"gas station", "coffee near the station"), ranked by relevance. Provide `near`, ' +
    '`country_codes`, or `bounding_box` to anchor the search. For plain address-to-coordinates ' +
    'conversion use geocode_forward instead.',
  path: '/discover',
  noun: 'place',
});

export const autosuggest = textSearchTool({
  name: 'autosuggest',
  title: 'Autosuggest',
  description:
    'Suggest address and place candidates from an incomplete or misspelled query (typo-tolerant, ' +
    'e.g. "aqaurium" still matches aquariums). Intended for search-as-you-type experiences. ' +
    'For prefix completion of valid addresses use autocomplete.',
  path: '/autosuggest',
  noun: 'suggestion',
});

export const autocomplete = textSearchTool({
  name: 'autocomplete',
  title: 'Autocomplete',
  description:
    'Complete valid street addresses and administrative areas from a partial query prefix ' +
    '(e.g. "stat" → "State Capitol…"). For typo-tolerant fuzzy suggestions use autosuggest.',
  path: '/autocomplete',
  noun: 'completion',
});
