import { describe, expect, it } from 'vitest';
import {
  decodePolyline,
  encodePolyline,
  fitPolylineToBudget,
  simplifyPoints,
} from '../../src/tools/maps/polyline.js';
import { staticRouteMap } from '../../src/tools/maps/static-route-map.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';

const PNG = { body: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' };

/** A long, wiggly synthetic route (SF → LA with per-step jitter) — ~8000 points. */
function longRoute(count = 8000) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push({
      latitude: 37.7749 + (34.0522 - 37.7749) * t + Math.sin(i / 3) * 0.0004,
      longitude: -122.4194 + (-118.2437 + 122.4194) * t + Math.cos(i / 5) * 0.0004,
    });
  }
  return points;
}

describe('polyline codec', () => {
  it('round-trips coordinates at precision 5 (Google reference vector)', () => {
    // Reference example from Google's polyline algorithm documentation.
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const decoded = decodePolyline(encoded);
    expect(decoded).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]);
    expect(encodePolyline(decoded)).toBe(encoded);
  });

  it('simplification keeps endpoints and reduces interior points', () => {
    const points = longRoute(2000);
    const simplified = simplifyPoints(points, 500);
    expect(simplified[0]).toEqual(points[0]);
    expect(simplified.at(-1)).toEqual(points.at(-1));
    expect(simplified.length).toBeLessThan(points.length / 4);
  });

  it('fitPolylineToBudget lands under the requested size', () => {
    const fitted = fitPolylineToBudget(longRoute(), 2000);
    expect(fitted.encoded.length).toBeLessThanOrEqual(2000);
    expect(fitted.simplified).toBe(true);
    expect(fitted.pointCount).toBeGreaterThanOrEqual(2);
  });
});

describe('static_route_map URL-length protection', () => {
  it('auto-simplifies a long encoded polyline so the request URL fits the API limit', async () => {
    const { nb, requests } = fakeNbClient({ responses: [PNG] });
    const full = encodePolyline(longRoute());
    expect(full.length).toBeGreaterThan(20_000);

    const result = await staticRouteMap.run({ encoded_polyline: full }, nb);

    const url = requests[0]!.url.toString();
    expect(url.length).toBeLessThanOrEqual(8192);
    expect(requests[0]!.url.searchParams.get('path')).toMatch(
      /^stroke:blue\|width:4\|fill:none\|enc:/,
    );
    const caption = (result.content.find((c) => c.type === 'text') as { text: string }).text;
    expect(caption).toContain('simplified from');
  });

  it('leaves short geometry untouched', async () => {
    const { nb, requests } = fakeNbClient({ responses: [PNG] });
    const result = await staticRouteMap.run(
      {
        route_points: [
          { latitude: 37.7749, longitude: -122.4194 },
          { latitude: 37.8044, longitude: -122.2712 },
        ],
      },
      nb,
    );
    expect(requests[0]!.url.searchParams.get('path')).toBe(
      'stroke:blue|width:4|fill:none|37.7749,-122.4194|37.8044,-122.2712',
    );
    const caption = (result.content.find((c) => c.type === 'text') as { text: string }).text;
    expect(caption).not.toContain('simplified');
  });
});
