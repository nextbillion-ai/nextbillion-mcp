import * as z from 'zod/v4';
import { CoordinateSchema, toLatLng, toLatLngList } from '../shared/geo.js';
import { READ_ONLY, textResult, ToolInputError, type NbTool } from '../types.js';

const AVOID_VALUES = [
  'toll',
  'highway',
  'ferry',
  'sharp_turn',
  'uturn',
  'service_road',
  'left_turn',
  'right_turn',
  'tunnel',
  'none',
] as const;

const Schema = z.object({
  origin: CoordinateSchema.describe('Route start (must be a routable land location)'),
  destination: CoordinateSchema.describe('Route end (must be a routable land location)'),
  waypoints: z
    .array(CoordinateSchema)
    .max(200)
    .optional()
    .describe('Intermediate stops visited in order (max 200)'),
  mode: z
    .enum(['car', 'truck', 'motorcycle', 'bike', 'walk'])
    .optional()
    .describe('Travel mode (default car). Modes other than car/truck require service=flexible'),
  service: z
    .enum(['flexible', 'fast'])
    .optional()
    .describe(
      'API variant: "flexible" (default) supports all modes, departure_time, route_type, full ' +
        'avoid list and truck options; "fast" is lower latency but limited to car/truck and ' +
        'avoid toll/ferry/highway only',
    ),
  route_type: z
    .enum(['fastest', 'shortest'])
    .optional()
    .describe('Optimization objective (flexible only, default fastest)'),
  departure_time: z
    .number()
    .int()
    .optional()
    .describe(
      'Departure as a UNIX timestamp in seconds, for typical-traffic routing (flexible only)',
    ),
  avoid: z
    .array(z.enum(AVOID_VALUES))
    .optional()
    .describe(
      'Road features to avoid when alternatives exist. Fast service supports only toll/ferry/highway',
    ),
  honor_restrictions: z
    .boolean()
    .optional()
    .describe(
      'When true, enforce restricted-area rules: no route is generated if origin, destination, ' +
        'or a waypoint is inside a restricted area. Default false: route anyway with a warning ' +
        '(flexible service only)',
    ),
  alternatives: z
    .boolean()
    .optional()
    .describe('Return up to 3 alternative routes (only without waypoints)'),
  steps: z.boolean().optional().describe('Include turn-by-turn steps (fast service only)'),
  geometry: z
    .enum(['polyline', 'polyline6'])
    .optional()
    .describe(
      'Route geometry encoding (default polyline, precision 5 — directly usable with static_route_map)',
    ),
  truck_size_cm: z
    .object({ height: z.number(), width: z.number(), length: z.number() })
    .optional()
    .describe('Truck dimensions in cm (flexible + mode=truck only)'),
  truck_weight_kg: z
    .number()
    .int()
    .max(100_000)
    .optional()
    .describe('Truck gross weight in kg (flexible + mode=truck only)'),
});

export const directions: NbTool<typeof Schema> = {
  name: 'directions',
  title: 'Directions',
  description:
    'Calculate a route between two points with optional intermediate waypoints. Returns distance ' +
    '(meters), duration (seconds), and encoded polyline geometry per route; pass the geometry to ' +
    'static_route_map to render it. Traffic-aware.',
  inputSchema: Schema,
  annotations: READ_ONLY,
  async run(args, nb) {
    const service = args.service ?? 'flexible';
    if (service === 'fast' && args.mode && args.mode !== 'car' && args.mode !== 'truck') {
      throw new ToolInputError(`mode=${args.mode} requires service=flexible.`);
    }
    // POST accepts up to 200 waypoints and avoids URL-length limits; params match GET.
    const response = await nb.postJson<Record<string, unknown>>(
      '/directions/json',
      service === 'flexible' ? { option: 'flexible' } : {},
      {
        origin: toLatLng(args.origin),
        destination: toLatLng(args.destination),
        waypoints: args.waypoints?.length ? toLatLngList(args.waypoints) : undefined,
        mode: args.mode,
        route_type: args.route_type,
        departure_time: args.departure_time,
        avoid: args.avoid?.length ? args.avoid.join('|') : undefined,
        honor_restrictions: args.honor_restrictions,
        alternatives: args.alternatives,
        altcount: args.alternatives ? 3 : undefined,
        steps: service === 'fast' ? args.steps : undefined,
        geometry: args.geometry ?? 'polyline',
        truck_size: args.truck_size_cm
          ? `${args.truck_size_cm.height},${args.truck_size_cm.width},${args.truck_size_cm.length}`
          : undefined,
        truck_weight: args.truck_weight_kg,
      },
    );
    const routes = (response as { routes?: Array<Record<string, unknown>> }).routes ?? [];
    const lines = routes.map((route, index) => {
      const km = typeof route.distance === 'number' ? (route.distance / 1000).toFixed(1) : '?';
      const minutes = typeof route.duration === 'number' ? Math.round(route.duration / 60) : '?';
      return `Route ${index + 1}: ${km} km, ~${minutes} min`;
    });
    return textResult(
      lines.length > 0
        ? `${lines.join('\n')}\nGeometry (encoded polyline) is in structured content.`
        : 'No route found.',
      response,
    );
  },
};
