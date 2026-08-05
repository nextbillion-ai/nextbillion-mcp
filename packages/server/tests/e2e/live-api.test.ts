import { describe, expect, it } from 'vitest';
import { NbClient } from '../../src/nbclient/client.js';
import { geocodeForward } from '../../src/tools/places/text-search.js';
import { directions } from '../../src/tools/routing/directions.js';
import { staticMapImage } from '../../src/tools/maps/static-map-image.js';

/**
 * Smoke tests against the live NextBillion API. Only run when NBAI_API_KEY is set
 * (CI provides it as a secret on the nightly schedule). These catch upstream API
 * changes that unit tests with recorded fixtures cannot see.
 */
const apiKey = process.env.NBAI_API_KEY;

describe.skipIf(!apiKey)('live API smoke tests', () => {
  const nb = new NbClient({ apiKey: apiKey ?? '' });

  it('geocodes a landmark', async () => {
    const result = await geocodeForward.run(
      { query: 'Empire State Building', country_codes: ['USA'], limit: 1 },
      nb,
    );
    expect(result.isError).toBeFalsy();
    const items = (result.structuredContent as { items: Array<{ position: { lat: number } }> })
      .items;
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.position.lat).toBeCloseTo(40.748, 1);
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
