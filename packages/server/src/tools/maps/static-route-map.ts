import * as z from 'zod/v4';
import { CoordinateSchema } from '../shared/geo.js';
import { READ_ONLY, ToolInputError, type NbTool } from '../types.js';
import {
  fetchImageResult,
  markerParam,
  StaticImageShape,
  staticImagePath,
} from './static-shared.js';
import { decodePolyline, fitPolylineToBudget } from './polyline.js';

const Schema = z.object({
  encoded_polyline: z
    .string()
    .optional()
    .describe(
      'Route geometry as a Google encoded polyline (precision 5) — exactly what the directions ' +
        'tool returns with its default geometry setting',
    ),
  route_points: z
    .array(CoordinateSchema)
    .min(2)
    .optional()
    .describe('Alternative to encoded_polyline: the route as an ordered list of coordinates'),
  markers: z
    .array(CoordinateSchema.extend({ color: z.string().optional() }))
    .optional()
    .describe('Extra markers, e.g. origin and destination, with optional color'),
  stroke_color: z
    .string()
    .optional()
    .describe('Route line color (e.g. "blue", "#ff0000"; default blue)'),
  stroke_width: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Route line width in pixels (default 4)'),
  padding: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Margin around the route as a fraction of image size (default 0.1)'),
  ...StaticImageShape,
});

/** Stay comfortably under the API's documented 8192-byte URL limit. */
const URL_BYTE_BUDGET = 8000;
/** Progressively tighter encoded-polyline budgets tried when the URL is too long. */
const ENCODED_CHAR_BUDGETS = [4000, 3000, 2000, 1200, 600, 200];

export const staticRouteMap: NbTool<typeof Schema> = {
  name: 'static_route_map',
  title: 'Static Route Map',
  description:
    'Render a static map image with a route drawn on it, auto-fitted to show the whole route. ' +
    'Pass the encoded polyline from the directions tool (preferred), or a list of route points. ' +
    'Returns the image directly.',
  inputSchema: Schema,
  annotations: READ_ONLY,
  async run(args, nb) {
    if (!args.encoded_polyline && !args.route_points) {
      throw new ToolInputError('Provide `encoded_polyline` (preferred) or `route_points`.');
    }
    if (args.encoded_polyline && args.route_points) {
      throw new ToolInputError('Provide either `encoded_polyline` or `route_points`, not both.');
    }
    const styleSegments = [
      `stroke:${args.stroke_color ?? 'blue'}`,
      `width:${args.stroke_width ?? 4}`,
      'fill:none',
    ];
    const markers = args.markers?.length ? markerParam(args.markers, 'lat-first') : undefined;
    const padding = args.padding !== undefined ? String(args.padding) : undefined;
    const path = staticImagePath('auto', args);
    const buildQuery = (geometry: string) => ({
      path: `${styleSegments.join('|')}|${geometry}`,
      markers,
      padding,
    });

    // First try the geometry exactly as given. Path coordinates are `lat,lng`;
    // `enc:` consumes the rest of the parameter value.
    let geometry = args.encoded_polyline
      ? `enc:${args.encoded_polyline}`
      : args.route_points!.map((p) => `${p.latitude},${p.longitude}`).join('|');
    let simplificationNote = '';

    // The Static Images API is GET-only with an 8192-byte URL limit; a long route's
    // full-resolution polyline blows past it (~50 kB for 600 km). When that happens,
    // simplify the *display* geometry progressively until the URL fits — the route's
    // distance/duration come from the directions tool and are unaffected.
    if (nb.buildUrl(path, buildQuery(geometry)).length > URL_BYTE_BUDGET) {
      const points = args.encoded_polyline
        ? decodePolyline(args.encoded_polyline)
        : args.route_points!;
      for (const budget of ENCODED_CHAR_BUDGETS) {
        const fitted = fitPolylineToBudget(points, budget);
        geometry = `enc:${fitted.encoded}`;
        if (nb.buildUrl(path, buildQuery(geometry)).length <= URL_BYTE_BUDGET) {
          simplificationNote =
            ` Display geometry simplified from ${fitted.originalPointCount} to ` +
            `${fitted.pointCount} points to fit the map URL limit; distances are unaffected.`;
          break;
        }
      }
    }

    return fetchImageResult(
      nb,
      path,
      buildQuery(geometry),
      `Route map rendered${args.markers?.length ? ` with ${args.markers.length} marker(s)` : ''}.` +
        simplificationNote,
      args,
      'route-map',
    );
  },
};
