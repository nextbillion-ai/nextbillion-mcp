import * as z from 'zod/v4';
import type { NbClient } from '../../nbclient/client.js';
import type { Coordinate } from '../shared/geo.js';
import type { ToolResult } from '../types.js';

export const StaticImageShape = {
  width: z
    .number()
    .int()
    .min(16)
    .max(2048)
    .optional()
    .describe('Image width in pixels (default 512)'),
  height: z
    .number()
    .int()
    .min(16)
    .max(2048)
    .optional()
    .describe('Image height in pixels (default 512)'),
  style: z
    .string()
    .optional()
    .describe('Map style id: "streets", "light", "dark", or "hybrid" (default streets)'),
  format: z.enum(['png', 'jpg', 'webp']).optional().describe('Image format (default png)'),
  retina: z.boolean().optional().describe('Render at @2x resolution for high-DPI displays'),
};

export interface StaticImageArgs {
  width?: number;
  height?: number;
  style?: string;
  format?: 'png' | 'jpg' | 'webp';
  retina?: boolean;
}

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/** Build the `/maps/{style}/static/{position}/{size}.{format}` path. */
export function staticImagePath(positionSegment: string, args: StaticImageArgs): string {
  const style = args.style ?? 'streets';
  const size = `${args.width ?? 512}x${args.height ?? 512}${args.retina ? '@2x' : ''}`;
  const format = args.format ?? 'png';
  return `/maps/${encodeURIComponent(style)}/static/${positionSegment}/${size}.${format}`;
}

/**
 * The `markers` query parameter uses `longitude,latitude` order — the one NextBillion
 * parameter with flipped coordinates (paths and centers are `lat,lng`).
 */
export function markerParam(markers: Array<Coordinate & { color?: string }>): string {
  return markers
    .map((m) => `${m.longitude},${m.latitude}${m.color ? `,${m.color}` : ''}`)
    .join('|');
}

export async function fetchImageResult(
  nb: NbClient,
  path: string,
  query: Record<string, string | undefined>,
  caption: string,
  args: StaticImageArgs,
): Promise<ToolResult> {
  const image = await nb.getBinary(path, query);
  const mimeType = image.contentType.startsWith('image/')
    ? image.contentType
    : MIME_TYPES[args.format ?? 'png']!;
  return {
    content: [
      { type: 'image', data: Buffer.from(image.data).toString('base64'), mimeType },
      { type: 'text', text: caption },
    ],
  };
}
