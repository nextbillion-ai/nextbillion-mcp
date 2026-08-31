import * as z from 'zod/v4';
import { CoordinateSchema } from '../shared/geo.js';
import { READ_ONLY, ToolInputError, type NbTool } from '../types.js';
import {
  fetchImageResult,
  markerParam,
  StaticImageShape,
  staticImagePath,
} from './static-shared.js';

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
    // Path coordinates are `lat,lng`; `enc:` consumes the rest of the parameter value.
    const geometry = args.encoded_polyline
      ? `enc:${args.encoded_polyline}`
      : args.route_points!.map((p) => `${p.latitude},${p.longitude}`).join('|');
    const path = `${styleSegments.join('|')}|${geometry}`;
    return fetchImageResult(
      nb,
      staticImagePath('auto', args),
      {
        path,
        // The auto-fit endpoint parses markers lat-first, unlike the center-based
        // endpoint (see markerParam) — verified live 2026-08-31.
        markers: args.markers?.length ? markerParam(args.markers, 'lat-first') : undefined,
        padding: args.padding !== undefined ? String(args.padding) : undefined,
      },
      `Route map rendered${args.markers?.length ? ` with ${args.markers.length} marker(s)` : ''}.`,
      args,
    );
  },
};
