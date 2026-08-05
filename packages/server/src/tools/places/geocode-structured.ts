import * as z from 'zod/v4';
import { CoordinateSchema, summarizePlaces, toLatLng, ViewSchema } from '../shared/geo.js';
import { READ_ONLY, textResult, ToolInputError, type NbTool } from '../types.js';

const Schema = z.object({
  country_code: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'ISO 3166-1 alpha-3 code, e.g. USA')
    .describe('Country of the address (required, ISO 3166-1 alpha-3, e.g. "USA")'),
  state: z.string().optional(),
  county: z.string().optional(),
  city: z.string().optional(),
  suburb: z.string().optional(),
  neighborhood: z.string().optional(),
  street: z.string().optional(),
  house_number: z.string().optional(),
  postal_code: z.string().optional(),
  near: CoordinateSchema.optional().describe('Search-context center for ranking'),
  limit: z.number().int().min(1).max(100).optional().describe('Maximum results (default 10)'),
  view: ViewSchema.optional(),
});

export const geocodeStructured: NbTool<typeof Schema> = {
  name: 'geocode_structured',
  title: 'Structured Geocode',
  description:
    'Geocode an address given as separate structured fields (country, state, city, street, ' +
    'house number, postal code) instead of one free-text string. Searches addresses and ' +
    'administrative areas only — no POIs. Use when the address components are already known ' +
    'and precision matters; otherwise use geocode_forward.',
  inputSchema: Schema,
  annotations: READ_ONLY,
  async run(args, nb) {
    const hasComponent =
      args.state ??
      args.county ??
      args.city ??
      args.suburb ??
      args.neighborhood ??
      args.street ??
      args.house_number ??
      args.postal_code;
    if (!hasComponent) {
      throw new ToolInputError(
        'Provide at least one address component besides country_code (state, city, street, postal_code, …).',
      );
    }
    const response = await nb.getJson<Record<string, unknown>>('/geocode/structured', {
      countryCode: args.country_code.toUpperCase(),
      state: args.state,
      county: args.county,
      city: args.city,
      suburb: args.suburb,
      neighborhood: args.neighborhood,
      street: args.street,
      houseNumber: args.house_number,
      postalCode: args.postal_code,
      at: args.near ? toLatLng(args.near) : undefined,
      limit: args.limit,
      view: args.view,
    });
    return textResult(summarizePlaces(response, 'match'), response);
  },
};
