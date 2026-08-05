import * as z from 'zod/v4';
import {
  BoundingBoxSchema,
  CoordinateSchema,
  CountryCodesSchema,
  summarizePlaces,
  toLatLng,
  ViewSchema,
} from '../shared/geo.js';
import { READ_ONLY, textResult, type NbTool } from '../types.js';

const Schema = z.object({
  coordinate: CoordinateSchema.describe('The location to reverse geocode'),
  country_codes: CountryCodesSchema.optional(),
  bounding_box: BoundingBoxSchema.optional().describe('Hard-limit results to this bounding box'),
  language: z.string().optional().describe('Result language as a BCP 47 tag, e.g. "en-US"'),
  view: ViewSchema.optional(),
});

export const geocodeReverse: NbTool<typeof Schema> = {
  name: 'geocode_reverse',
  title: 'Reverse Geocode',
  description:
    'Find the nearest address for a geographic coordinate. Returns the full postal address, ' +
    'the matched position, and a bounding box.',
  inputSchema: Schema,
  annotations: READ_ONLY,
  async run(args, nb) {
    const inFilter = args.country_codes
      ? `countryCode:${args.country_codes.map((c) => c.toUpperCase()).join(',')}`
      : args.bounding_box
        ? `bbox:${args.bounding_box.west},${args.bounding_box.south},${args.bounding_box.east},${args.bounding_box.north}`
        : undefined;
    const response = await nb.getJson<Record<string, unknown>>('/revgeocode', {
      at: toLatLng(args.coordinate),
      in: inFilter,
      lang: args.language,
      view: args.view,
    });
    return textResult(summarizePlaces(response, 'address'), response);
  },
};
