/**
 * Geodesic buffers without JSTS: circles and capsules built from geographiclib
 * `Direct` points, merged with polyclip. Outward polygon buffers are the union of the
 * polygon with the buffer of its rings; inward (negative) buffers are the difference.
 * MultiPolygon results fall out naturally, so a shape that splits does not throw.
 */
import { destination, distance, inverse } from './measure.js';
import { polygonOp } from './polygon-ops.js';
import type { MultiPolygonCoords, Position, Ring } from './types.js';

/** A geodesic circle (closed ring) around `centre`. */
export function circle(centre: Position, radiusMeters: number, steps: number): Ring {
  const ring: Ring = [];
  for (let i = 0; i < steps; i += 1) {
    ring.push(destination(centre, (360 * i) / steps, radiusMeters));
  }
  ring.push(ring[0]!);
  return ring;
}

/** Buffer of one segment: a capsule = rectangle offset on both sides + two half circles. */
function segmentCapsule(a: Position, b: Position, radius: number, steps: number): Ring {
  const half = Math.max(4, Math.round(steps / 2));
  const ab = bearing(a, b);
  const ba = bearing(b, a);
  const ring: Ring = [];
  // Right side of a→b, then the cap around b, left side back, then the cap around a.
  ring.push(destination(a, ab + 90, radius));
  ring.push(destination(b, ab + 90, radius));
  for (let i = 1; i < half; i += 1) ring.push(destination(b, ab + 90 - (180 * i) / half, radius));
  ring.push(destination(b, ab - 90, radius));
  ring.push(destination(a, ba + 90, radius));
  for (let i = 1; i < half; i += 1) ring.push(destination(a, ba + 90 - (180 * i) / half, radius));
  ring.push(ring[0]!);
  return ring;
}

function bearing(a: Position, b: Position): number {
  return inverse(a, b).initialBearing;
}

export function bufferPoint(p: Position, radius: number, steps: number): MultiPolygonCoords {
  return [[circle(p, radius, steps)]];
}

export function bufferLine(line: Position[], radius: number, steps: number): MultiPolygonCoords {
  const pieces: MultiPolygonCoords[] = [];
  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i]!;
    const b = line[i + 1]!;
    if (distance(a, b) < 1e-6) continue;
    pieces.push([[segmentCapsule(a, b, radius, steps)]]);
  }
  if (pieces.length === 0) return bufferPoint(line[0]!, radius, steps);
  return pieces.length === 1 ? pieces[0]! : polygonOp('union', pieces);
}

export function bufferArea(
  polygons: MultiPolygonCoords,
  distanceMeters: number,
  steps: number,
): MultiPolygonCoords {
  const radius = Math.abs(distanceMeters);
  if (radius < 1e-6) return polygons;
  const ringBuffers: MultiPolygonCoords[] = [];
  for (const poly of polygons)
    for (const ring of poly) ringBuffers.push(bufferLine(ring, radius, steps));
  const edgeZone = ringBuffers.length === 1 ? ringBuffers[0]! : polygonOp('union', ringBuffers);
  return distanceMeters > 0
    ? polygonOp('union', [polygons, edgeZone])
    : polygonOp('difference', [polygons, edgeZone]);
}
