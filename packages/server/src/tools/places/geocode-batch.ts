import * as z from 'zod/v4';
import { placesFilterQuery, PlacesFilterShape } from '../shared/geo.js';
import { READ_ONLY, textResult, type NbTool } from '../types.js';

const BatchQuerySchema = z.object({
  query: z.string().min(1).describe('Free-text search query for this entry'),
  ...PlacesFilterShape,
});

const Schema = z.object({
  queries: z
    .array(BatchQuerySchema)
    .min(1)
    .max(100)
    .describe('Up to 100 forward-geocode queries resolved in a single request'),
});

export const geocodeBatch: NbTool<typeof Schema> = {
  name: 'geocode_batch',
  title: 'Batch Geocode',
  description:
    'Forward-geocode up to 100 free-text queries in one request; returns one ranked result set ' +
    'per query, in input order. Strongly prefer this over repeated geocode_forward calls when ' +
    'resolving several addresses — this endpoint has a dedicated (low) rate limit of 60 requests ' +
    'per minute, so batch as much as possible into each call.',
  inputSchema: Schema,
  annotations: READ_ONLY,
  async run(args, nb) {
    const body = args.queries.map((entry) => {
      const filters = placesFilterQuery(entry);
      return {
        q: entry.query,
        at: filters.at,
        in: filters.in,
        limit: filters.limit,
        lang: filters.lang,
      };
    });
    const response = await nb.postJson<unknown>('/geocode/batch', {}, body);
    const resultSets = Array.isArray(response) ? response : [response];
    const lines = resultSets.map((set, index) => {
      const items = (set as { items?: Array<Record<string, unknown>> })?.items ?? [];
      const top = items[0];
      const address = top?.address as Record<string, unknown> | undefined;
      const position = top?.position as Record<string, unknown> | undefined;
      const summary = top
        ? `${(address?.label as string) ?? top.title} (${position?.lat}, ${position?.lng})`
        : 'no match';
      return `${index + 1}. "${args.queries[index]?.query}" → ${summary}${items.length > 1 ? ` [+${items.length - 1} more]` : ''}`;
    });
    return textResult(`Resolved ${resultSets.length} queries:\n${lines.join('\n')}`, {
      results: resultSets,
    });
  },
};
