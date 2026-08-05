import * as z from 'zod/v4';
import { CoordinateSchema, toLatLng } from '../shared/geo.js';
import { READ_ONLY, textResult, ToolInputError, type NbTool } from '../types.js';

const Schema = z.object({
  origin: CoordinateSchema.describe('Starting point of the reachability analysis'),
  contours_minutes: z
    .array(z.number().int().min(1).max(40))
    .max(4)
    .optional()
    .describe('Travel times in minutes, one contour each (max 4 values, increasing, max 40)'),
  contours_meters: z
    .array(z.number().int().min(1).max(60_000))
    .max(4)
    .optional()
    .describe('Travel distances in meters, one contour each (max 4 values, increasing, max 60000)'),
  mode: z
    .enum(['car', 'truck', 'motorcycle', 'bike', 'walk'])
    .optional()
    .describe('Travel mode (default car)'),
  polygons: z
    .boolean()
    .optional()
    .describe('Return contours as GeoJSON Polygons instead of LineStrings'),
  denoise: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Remove contours smaller than this fraction of the largest (default 1: largest only)',
    ),
  departure_time: z
    .number()
    .int()
    .optional()
    .describe('Departure as a UNIX timestamp in seconds, for typical-traffic analysis'),
});

export const isochrone: NbTool<typeof Schema> = {
  name: 'isochrone',
  title: 'Isochrone',
  description:
    'Calculate the area reachable from a point within given travel time(s) or distance(s). ' +
    'Returns a GeoJSON FeatureCollection of contours. Note: contour geometry coordinates are ' +
    'GeoJSON [longitude, latitude] order.',
  inputSchema: Schema,
  annotations: READ_ONLY,
  async run(args, nb) {
    if (!args.contours_minutes?.length && !args.contours_meters?.length) {
      throw new ToolInputError('Provide `contours_minutes` or `contours_meters`.');
    }
    if (args.contours_minutes?.length && args.contours_meters?.length) {
      throw new ToolInputError('Provide either `contours_minutes` or `contours_meters`, not both.');
    }
    const response = await nb.getJson<Record<string, unknown>>('/isochrone/json', {
      coordinates: toLatLng(args.origin),
      contours_minutes: args.contours_minutes?.join(','),
      contours_meters: args.contours_meters?.join(','),
      mode: args.mode,
      polygons: args.polygons,
      denoise: args.denoise,
      departure_time: args.departure_time,
    });
    const features = (response as { features?: unknown[] }).features ?? [];
    const metric = args.contours_minutes?.length ? 'minutes' : 'meters';
    const values = (args.contours_minutes ?? args.contours_meters ?? []).join(', ');
    return textResult(
      `Computed ${features.length} isochrone contour(s) for ${values} ${metric} from ` +
        `(${args.origin.latitude}, ${args.origin.longitude}). GeoJSON is in structured content.`,
      response,
    );
  },
};
