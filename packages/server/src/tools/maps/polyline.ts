import type { Coordinate } from '../shared/geo.js';

/**
 * Google encoded polyline codec (precision 5) plus Douglas-Peucker simplification.
 * Used to shrink long route geometries so the static-image GET URL stays within
 * the API's 8192-byte limit: a 600 km route encodes to ~30k characters (~50 kB
 * URL-encoded), far beyond what the endpoint accepts.
 */

const PRECISION = 1e5;

export function decodePolyline(encoded: string): Coordinate[] {
  const points: Coordinate[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    lat += readVarint();
    lng += readVarint();
    points.push({ latitude: lat / PRECISION, longitude: lng / PRECISION });
  }
  return points;

  function readVarint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}

export function encodePolyline(points: Coordinate[]): string {
  let output = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const point of points) {
    const lat = Math.round(point.latitude * PRECISION);
    const lng = Math.round(point.longitude * PRECISION);
    output += encodeValue(lat - prevLat) + encodeValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return output;

  function encodeValue(value: number): string {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = '';
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return chunk + String.fromCharCode(v + 63);
  }
}

/** Douglas-Peucker simplification with the tolerance in approximate meters. */
export function simplifyPoints(points: Coordinate[], toleranceMeters: number): Coordinate[] {
  if (points.length <= 2 || toleranceMeters <= 0) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDistance = 0;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const distance = perpendicularDistanceMeters(points[i]!, points[start]!, points[end]!);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }
    if (maxIndex !== -1 && maxDistance > toleranceMeters) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Planar approximation (equirectangular) — accurate enough for display-level simplification. */
function perpendicularDistanceMeters(p: Coordinate, a: Coordinate, b: Coordinate): number {
  const metersPerDegLat = 111_320;
  const cosLat = Math.cos((a.latitude * Math.PI) / 180);
  const toXY = (c: Coordinate) => ({
    x: c.longitude * metersPerDegLat * cosLat,
    y: c.latitude * metersPerDegLat,
  });
  const P = toXY(p);
  const A = toXY(a);
  const B = toXY(b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(P.x - A.x, P.y - A.y);
  const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / lengthSquared));
  return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
}

export interface FittedGeometry {
  encoded: string;
  originalPointCount: number;
  pointCount: number;
  simplified: boolean;
}

/**
 * Return an encoded polyline whose length is at most `maxEncodedChars`, simplifying
 * with progressively coarser tolerances until it fits (or only endpoints remain).
 */
export function fitPolylineToBudget(points: Coordinate[], maxEncodedChars: number): FittedGeometry {
  let current = points;
  let encoded = encodePolyline(current);
  let tolerance = 5; // meters
  while (encoded.length > maxEncodedChars && current.length > 2) {
    current = simplifyPoints(points, tolerance);
    encoded = encodePolyline(current);
    tolerance *= 2;
  }
  return {
    encoded,
    originalPointCount: points.length,
    pointCount: current.length,
    simplified: current.length < points.length,
  };
}
