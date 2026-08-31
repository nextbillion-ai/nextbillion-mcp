import * as z from 'zod/v4';
import { CoordinateSchema } from '../shared/geo.js';
import { READ_ONLY, type NbTool } from '../types.js';
import {
  fetchImageResult,
  markerParam,
  StaticImageShape,
  staticImagePath,
} from './static-shared.js';

const Schema = z.object({
  center: CoordinateSchema.describe('Center of the map view'),
  zoom: z
    .number()
    .min(0)
    .max(22)
    .describe('Zoom level (0 = world, ~10 = city, ~15 = streets; fractional values allowed)'),
  markers: z
    .array(CoordinateSchema.extend({ color: z.string().optional() }))
    .optional()
    .describe('Markers to draw, each with optional color (e.g. "red", "#0000ff")'),
  ...StaticImageShape,
});

export const staticMapImage: NbTool<typeof Schema> = {
  name: 'static_map_image',
  title: 'Static Map Image',
  description:
    'Render a static map image centered on a location, with optional markers. Returns the image ' +
    'directly. To draw a route on a map use static_route_map instead.',
  inputSchema: Schema,
  annotations: READ_ONLY,
  async run(args, nb) {
    const position = `${args.center.latitude},${args.center.longitude},${args.zoom}`;
    return fetchImageResult(
      nb,
      staticImagePath(position, args),
      { markers: args.markers?.length ? markerParam(args.markers, 'lng-first') : undefined },
      `Map centered at (${args.center.latitude}, ${args.center.longitude}), zoom ${args.zoom}` +
        (args.markers?.length ? `, ${args.markers.length} marker(s).` : '.'),
      args,
    );
  },
};
