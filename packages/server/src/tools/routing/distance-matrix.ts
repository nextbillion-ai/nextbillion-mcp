import * as z from 'zod/v4';
import { CoordinateSchema, toLatLngList } from '../shared/geo.js';
import { READ_ONLY, textResult, ToolInputError, type NbTool } from '../types.js';

const Schema = z.object({
  origins: z.array(CoordinateSchema).min(1).max(1000).describe('Start points (matrix rows)'),
  destinations: z.array(CoordinateSchema).min(1).max(1000).describe('End points (matrix columns)'),
  mode: z
    .enum(['car', 'truck', 'motorcycle', 'bike', 'walk'])
    .optional()
    .describe('Travel mode (default car). Modes other than car/truck require service=flexible'),
  service: z
    .enum(['fast', 'flexible'])
    .optional()
    .describe(
      'API variant: "fast" (default) supports up to 1000x1000 points; "flexible" adds ' +
        'departure_time, route_type, truck options and more modes but is limited to 50x50 points ' +
        'within a ~8000 km area',
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
      'Departure as a UNIX timestamp in seconds, for typical-traffic results (flexible only)',
    ),
  avoid: z
    .array(z.enum(['toll', 'highway', 'ferry', 'none']))
    .optional()
    .describe('Road features to avoid'),
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

export const distanceMatrix: NbTool<typeof Schema> = {
  name: 'distance_matrix',
  title: 'Distance Matrix',
  description:
    'Compute travel distances (meters) and durations (seconds) for every origin→destination ' +
    'pair in one call (one-to-many or many-to-many). Far more efficient than repeated ' +
    'directions calls — always prefer this for multiple pairs. Response has one row per origin ' +
    'with one element per destination, in input order.',
  inputSchema: Schema,
  annotations: READ_ONLY,
  async run(args, nb) {
    const service = args.service ?? 'fast';
    if (service === 'fast' && args.mode && args.mode !== 'car' && args.mode !== 'truck') {
      throw new ToolInputError(`mode=${args.mode} requires service=flexible.`);
    }
    if (service === 'flexible' && (args.origins.length > 50 || args.destinations.length > 50)) {
      throw new ToolInputError(
        'service=flexible is limited to 50 origins x 50 destinations; use service=fast for larger matrices.',
      );
    }
    const response = await nb.postJson<Record<string, unknown>>(
      '/distancematrix/json',
      service === 'flexible' ? { option: 'flexible' } : {},
      {
        origins: toLatLngList(args.origins),
        destinations: toLatLngList(args.destinations),
        mode: args.mode,
        route_type: args.route_type,
        departure_time: args.departure_time,
        avoid: args.avoid?.length ? args.avoid.join('|') : undefined,
        truck_size: args.truck_size_cm
          ? `${args.truck_size_cm.height},${args.truck_size_cm.width},${args.truck_size_cm.length}`
          : undefined,
        truck_weight: args.truck_weight_kg,
      },
    );
    const rows = (response as { rows?: Array<{ elements?: unknown[] }> }).rows ?? [];
    return textResult(
      `Computed a ${args.origins.length}x${args.destinations.length} matrix ` +
        `(${rows.length} rows returned). Durations are seconds, distances are meters; ` +
        'full matrix is in structured content.',
      response,
    );
  },
};
