import { describe, expect, it } from 'vitest';
import { NbClient } from '../../src/nbclient/client.js';
import { geocodeForward } from '../../src/tools/places/text-search.js';
import { directions } from '../../src/tools/routing/directions.js';
import { staticMapImage } from '../../src/tools/maps/static-map-image.js';
import { staticRouteMap } from '../../src/tools/maps/static-route-map.js';

/**
 * Smoke tests against the live NextBillion API. Only run when NBAI_API_KEY is set
 * (CI provides it as a secret on the nightly schedule). These catch upstream API
 * changes that unit tests with recorded fixtures cannot see.
 */
const apiKey = process.env.NBAI_API_KEY;

describe.skipIf(!apiKey)('live API smoke tests', () => {
  const nb = new NbClient({ apiKey: apiKey ?? '' });

  it('geocodes a street address', async () => {
    // A full street address is deterministic; landmark-name queries are not — the
    // live ranker can put e.g. "Empire, MO" above the Empire State Building even
    // with a proximity bias (upstream ranking quirk, reported to the API team).
    const result = await geocodeForward.run(
      { query: '1600 Pennsylvania Avenue NW, Washington DC', country_codes: ['USA'], limit: 1 },
      nb,
    );
    expect(result.isError).toBeFalsy();
    const items = (result.structuredContent as { items: Array<{ position: { lat: number } }> })
      .items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.position.lat).toBeCloseTo(38.8977, 1);
  });

  it('routes between two Los Angeles points', async () => {
    const result = await directions.run(
      {
        origin: { latitude: 34.06176, longitude: -118.29864 },
        destination: { latitude: 34.00657, longitude: -118.27003 },
      },
      nb,
    );
    expect(result.isError).toBeFalsy();
    const routes = (result.structuredContent as { routes: Array<{ distance: number }> }).routes;
    expect(routes.length).toBeGreaterThan(0);
    expect(routes[0]!.distance).toBeGreaterThan(1000);
  });

  it('renders a route map with markers (auto endpoint marker-order regression)', async () => {
    // Regression for the auto-fit variant parsing markers lat-first: with the wrong
    // order this renders a world-zoom map (~37 kB); a correct SF→LA regional render
    // is substantially larger. Guarding on size keeps the check robust without
    // pixel-level assertions.
    const result = await staticRouteMap.run(
      {
        route_points: [
          { latitude: 37.7749, longitude: -122.4194 },
          { latitude: 34.0522, longitude: -118.2437 },
        ],
        markers: [
          { latitude: 37.7749, longitude: -122.4194 },
          { latitude: 34.0522, longitude: -118.2437, color: 'red' },
        ],
      },
      nb,
    );
    const image = result.content.find((c) => c.type === 'image') as
      { type: 'image'; data: string } | undefined;
    expect(image).toBeTruthy();
    expect(Buffer.from(image!.data, 'base64').length).toBeGreaterThan(45_000);
  });

  it('renders a full-length SF→LA route from the live directions polyline (URL-limit regression)', async () => {
    const route = await directions.run(
      {
        origin: { latitude: 37.7749, longitude: -122.4194 },
        destination: { latitude: 34.0522, longitude: -118.2437 },
      },
      nb,
    );
    const polyline = (route.structuredContent as { routes: Array<{ geometry: string }> }).routes[0]!
      .geometry;
    expect(polyline.length).toBeGreaterThan(8192); // the raw geometry alone exceeds the URL limit

    const result = await staticRouteMap.run(
      {
        encoded_polyline: polyline,
        markers: [
          { latitude: 37.7749, longitude: -122.4194 },
          { latitude: 34.0522, longitude: -118.2437, color: 'red' },
        ],
      },
      nb,
    );
    expect(result.isError).toBeFalsy();
    const image = result.content.find((c) => c.type === 'image') as
      { type: 'image'; data: string } | undefined;
    expect(image).toBeTruthy();
    expect(Buffer.from(image!.data, 'base64').length).toBeGreaterThan(45_000);
    const caption = (result.content.find((c) => c.type === 'text') as { text: string }).text;
    expect(caption).toContain('simplified from');
  });

  it('renders a static map image', async () => {
    const result = await staticMapImage.run(
      { center: { latitude: 1.2839, longitude: 103.8607 }, zoom: 12 },
      nb,
    );
    const image = result.content.find((c) => c.type === 'image') as
      { type: 'image'; data: string; mimeType: string } | undefined;
    expect(image).toBeTruthy();
    expect(image!.data.length).toBeGreaterThan(1000);
  });
});
