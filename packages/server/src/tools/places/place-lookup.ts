import * as z from 'zod/v4';
import { summarizePlaces, ViewSchema } from '../shared/geo.js';
import { READ_ONLY, textResult, type NbTool } from '../types.js';

const Schema = z.object({
  id: z.string().min(1).describe('Unique place id, as returned by the other place/geocoding tools'),
  view: ViewSchema.optional(),
});

export const placeLookup: NbTool<typeof Schema> = {
  name: 'place_lookup',
  title: 'Place Lookup',
  description:
    'Fetch the full details (address, position, access points, categories, contacts) of a place ' +
    'by its unique id. Ids come from the results of place_search, geocode_forward, autosuggest, ' +
    'autocomplete, or search_along_route.',
  inputSchema: Schema,
  annotations: READ_ONLY,
  async run(args, nb) {
    const response = await nb.getJson<Record<string, unknown>>('/lookup', {
      id: args.id,
      view: args.view,
    });
    return textResult(summarizePlaces(response, 'place'), response);
  },
};
