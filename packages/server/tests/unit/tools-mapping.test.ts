import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../../src/tools/index.js';
import { geocodeForward, placeSearch } from '../../src/tools/places/text-search.js';
import { geocodeBatch } from '../../src/tools/places/geocode-batch.js';
import { geocodeReverse } from '../../src/tools/places/geocode-reverse.js';
import { postcodeLookup } from '../../src/tools/places/postcode-lookup.js';
import { directions } from '../../src/tools/routing/directions.js';
import { distanceMatrix } from '../../src/tools/routing/distance-matrix.js';
import { isochrone } from '../../src/tools/routing/isochrone.js';
import { searchAlongRoute } from '../../src/tools/routing/search-along-route.js';
import { staticMapImage } from '../../src/tools/maps/static-map-image.js';
import { staticRouteMap } from '../../src/tools/maps/static-route-map.js';
import { textResult, ToolInputError } from '../../src/tools/types.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';

const PNG = { body: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' };

describe('tool registry', () => {
  it('exposes exactly the 15 Phase 1 tools, sorted by name', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual([
      'autocomplete',
      'autosuggest',
      'directions',
      'distance_matrix',
      'geocode_batch',
      'geocode_forward',
      'geocode_reverse',
      'geocode_structured',
      'isochrone',
      'place_lookup',
      'place_search',
      'postcode_lookup',
      'search_along_route',
      'static_map_image',
      'static_route_map',
    ]);
  });

  it('marks every tool read-only', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
    }
  });
});

describe('result formatting', () => {
  it('mirrors the full structured response into the text block', () => {
    const response = { items: [{ id: 'x', access: [{ lat: 1, lng: 2 }] }] };
    const result = textResult('1 match found', response);
    const text = (result.content[0] as { text: string }).text;
    expect(text.startsWith('1 match found')).toBe(true);
    expect(text).toContain(JSON.stringify(response));
    expect(result.structuredContent).toBe(response);
  });

  it('leaves summary-only results untouched when there is no structured content', () => {
    const result = textResult('nothing to report');
    expect((result.content[0] as { text: string }).text).toBe('nothing to report');
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('places parameter mapping', () => {
  it('geocode_forward maps query, near and country filter', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { items: [] } }] });
    await geocodeForward.run(
      { query: 'market', near: { latitude: 40.7, longitude: -74.04 }, country_codes: ['usa'] },
      nb,
    );
    const url = requests[0]!.url;
    expect(url.pathname).toBe('/geocode');
    expect(url.searchParams.get('q')).toBe('market');
    expect(url.searchParams.get('at')).toBe('40.7,-74.04');
    expect(url.searchParams.get('in')).toBe('countryCode:USA');
  });

  it('geocode_forward joins the types filter as a comma list', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { items: [] } }] });
    await geocodeForward.run(
      { query: '600 Golden Gate Ave', types: ['addressBlock', 'street'] },
      nb,
    );
    expect(requests[0]!.url.searchParams.get('types')).toBe('addressBlock,street');
  });

  it('place_search uses the /discover endpoint', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { items: [] } }] });
    await placeSearch.run({ query: 'gas' }, nb);
    expect(requests[0]!.url.pathname).toBe('/discover');
  });

  it('near + radius_m becomes an in=circle filter without `at`', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { items: [] } }] });
    await placeSearch.run(
      { query: 'gas', near: { latitude: 1.3, longitude: 103.8 }, radius_m: 5000 },
      nb,
    );
    const url = requests[0]!.url;
    expect(url.searchParams.get('in')).toBe('circle:1.3,103.8;r=5000');
    expect(url.searchParams.has('at')).toBe(false);
  });

  it('rejects combining two geographic filters', async () => {
    const { nb } = fakeNbClient();
    const result = await geocodeForward
      .run(
        {
          query: 'x',
          country_codes: ['USA'],
          bounding_box: { west: -1, south: -1, east: 1, north: 1 },
        },
        nb,
      )
      .catch((e: unknown) => e);
    expect(result).toBeInstanceOf(ToolInputError);
  });

  it('geocode_reverse maps the coordinate to `at`', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { items: [] } }] });
    await geocodeReverse.run({ coordinate: { latitude: 36.16, longitude: -115.15 } }, nb);
    const url = requests[0]!.url;
    expect(url.pathname).toBe('/revgeocode');
    expect(url.searchParams.get('at')).toBe('36.16,-115.15');
  });

  it('geocode_batch posts an array body and summarizes per query', async () => {
    const { nb, requests } = fakeNbClient({
      responses: [
        {
          body: [
            { items: [{ title: 'A', position: { lat: 1, lng: 2 }, address: { label: 'A st' } }] },
            { items: [] },
          ],
        },
      ],
    });
    const result = await geocodeBatch.run(
      { queries: [{ query: 'a', limit: 1 }, { query: 'b' }] },
      nb,
    );
    expect(requests[0]!.url.pathname).toBe('/geocode/batch');
    expect(requests[0]!.body).toEqual([{ q: 'a', limit: 1 }, { q: 'b' }]);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('no match');
  });

  it('geocode_batch maps per-query types', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: [{ items: [] }] }] });
    await geocodeBatch.run({ queries: [{ query: 'a', types: ['houseNumber'] }] }, nb);
    expect(requests[0]!.body).toEqual([{ q: 'a', types: 'houseNumber' }]);
  });

  it('postcode_lookup validates its exclusive inputs', async () => {
    const { nb } = fakeNbClient();
    await expect(postcodeLookup.run({ postal_code: '90011' }, nb)).rejects.toBeInstanceOf(
      ToolInputError,
    );
    await expect(postcodeLookup.run({}, nb)).rejects.toBeInstanceOf(ToolInputError);
  });

  it('postcode_lookup maps coordinate lookups to the `at` body field', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { places: [] } }] });
    await postcodeLookup.run({ coordinate: { latitude: 34.0, longitude: -118.27 } }, nb);
    expect(requests[0]!.body).toEqual({ at: { lat: 34.0, lng: -118.27 } });
  });
});

describe('routing parameter mapping', () => {
  it('directions defaults to flexible via POST with polyline geometry', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { routes: [] } }] });
    await directions.run(
      {
        origin: { latitude: 34.06, longitude: -118.29 },
        destination: { latitude: 34.0, longitude: -118.27 },
      },
      nb,
    );
    const request = requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.url.pathname).toBe('/directions/json');
    expect(request.url.searchParams.get('option')).toBe('flexible');
    expect(request.body).toMatchObject({
      origin: '34.06,-118.29',
      destination: '34,-118.27',
      geometry: 'polyline',
    });
  });

  it('directions service=fast omits option and rejects walk mode', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { routes: [] } }] });
    await directions.run(
      {
        origin: { latitude: 1, longitude: 2 },
        destination: { latitude: 3, longitude: 4 },
        service: 'fast',
        avoid: ['toll', 'ferry'],
      },
      nb,
    );
    expect(requests[0]!.url.searchParams.has('option')).toBe(false);
    expect(requests[0]!.body).toMatchObject({ avoid: 'toll|ferry' });

    await expect(
      directions.run(
        {
          origin: { latitude: 1, longitude: 2 },
          destination: { latitude: 3, longitude: 4 },
          service: 'fast',
          mode: 'walk',
        },
        nb,
      ),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it('directions and distance_matrix pass honor_restrictions through', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { routes: [] } }] });
    await directions.run(
      {
        origin: { latitude: 1, longitude: 2 },
        destination: { latitude: 3, longitude: 4 },
        honor_restrictions: true,
      },
      nb,
    );
    expect(requests[0]!.body).toMatchObject({ honor_restrictions: true });

    const matrix = fakeNbClient({ responses: [{ body: { rows: [] } }] });
    await distanceMatrix.run(
      {
        origins: [{ latitude: 1, longitude: 2 }],
        destinations: [{ latitude: 3, longitude: 4 }],
        service: 'flexible',
        honor_restrictions: true,
      },
      matrix.nb,
    );
    expect(matrix.requests[0]!.body).toMatchObject({ honor_restrictions: true });
  });

  it('directions summarizes distance and duration', async () => {
    const { nb } = fakeNbClient({
      responses: [{ body: { routes: [{ distance: 10430.4, duration: 1047.2, geometry: 'abc' }] } }],
    });
    const result = await directions.run(
      { origin: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 } },
      nb,
    );
    expect((result.content[0] as { text: string }).text).toContain('10.4 km');
    expect((result.content[0] as { text: string }).text).toContain('17 min');
  });

  it('distance_matrix defaults to fast and joins coordinate lists', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { rows: [] } }] });
    await distanceMatrix.run(
      {
        origins: [
          { latitude: 1, longitude: 2 },
          { latitude: 3, longitude: 4 },
        ],
        destinations: [{ latitude: 5, longitude: 6 }],
      },
      nb,
    );
    expect(requests[0]!.url.searchParams.has('option')).toBe(false);
    expect(requests[0]!.body).toMatchObject({ origins: '1,2|3,4', destinations: '5,6' });
  });

  it('distance_matrix rejects flexible matrices above 50x50', async () => {
    const { nb } = fakeNbClient();
    const many = Array.from({ length: 51 }, (_, i) => ({ latitude: i / 10, longitude: 1 }));
    await expect(
      distanceMatrix.run(
        { origins: many, destinations: [{ latitude: 1, longitude: 1 }], service: 'flexible' },
        nb,
      ),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it('isochrone requires exactly one contour type', async () => {
    const { nb } = fakeNbClient();
    const origin = { latitude: 34.05, longitude: -118.25 };
    await expect(isochrone.run({ origin }, nb)).rejects.toBeInstanceOf(ToolInputError);
    await expect(
      isochrone.run({ origin, contours_minutes: [5], contours_meters: [1000] }, nb),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it('isochrone serializes contours as comma-separated values', async () => {
    const { nb, requests } = fakeNbClient({
      responses: [{ body: { type: 'FeatureCollection', features: [] } }],
    });
    await isochrone.run(
      { origin: { latitude: 34.05, longitude: -118.25 }, contours_minutes: [5, 10] },
      nb,
    );
    const url = requests[0]!.url;
    expect(url.pathname).toBe('/isochrone/json');
    expect(url.searchParams.get('coordinates')).toBe('34.05,-118.25');
    expect(url.searchParams.get('contours_minutes')).toBe('5,10');
  });

  it('search_along_route posts route points and query', async () => {
    const { nb, requests } = fakeNbClient({ responses: [{ body: { items: [] } }] });
    await searchAlongRoute.run(
      {
        route_points: [
          { latitude: 34.04, longitude: -118.25 },
          { latitude: 34.03, longitude: -118.2 },
        ],
        query: 'Gas Station',
        max_detour_seconds: 600,
      },
      nb,
    );
    const request = requests[0]!;
    expect(request.url.pathname).toBe('/orbis/alongroute');
    expect(request.body).toEqual({
      route: { points: '34.04,-118.25|34.03,-118.2' },
      q: 'Gas Station',
      max_detour_time: 600,
    });
  });
});

describe('static map parameter mapping', () => {
  it('static_map_image builds the center path and lng,lat markers', async () => {
    const { nb, requests } = fakeNbClient({ responses: [PNG] });
    const result = await staticMapImage.run(
      {
        center: { latitude: 33.93, longitude: -118.12 },
        zoom: 9,
        markers: [{ latitude: 33.93, longitude: -118.12, color: 'red' }],
      },
      nb,
    );
    const url = requests[0]!.url;
    expect(url.pathname).toBe('/maps/streets/static/33.93,-118.12,9/512x512.png');
    // the center-based endpoint parses markers longitude-first (verified live 2026-08-31)
    expect(url.searchParams.get('markers')).toBe('-118.12,33.93,red');
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('static_route_map sends markers latitude-first (auto endpoint quirk)', async () => {
    const { nb, requests } = fakeNbClient({ responses: [PNG] });
    await staticRouteMap.run(
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
    const url = requests[0]!.url;
    // Regression for the auto-fit variant parsing markers lat-first — the opposite of
    // the documented order honored by the center-based endpoint (live-verified 2026-08-31;
    // lng-first markers here rendered in the wrong hemisphere at world zoom).
    expect(url.searchParams.get('markers')).toBe('37.7749,-122.4194|34.0522,-118.2437,red');
    expect(url.searchParams.get('path')).toBe(
      'stroke:blue|width:4|fill:none|37.7749,-122.4194|34.0522,-118.2437',
    );
  });

  it('static_route_map uses auto-fit with an encoded polyline path', async () => {
    const { nb, requests } = fakeNbClient({ responses: [PNG] });
    await staticRouteMap.run({ encoded_polyline: 'abc}def', retina: true }, nb);
    const url = requests[0]!.url;
    expect(url.pathname).toBe('/maps/streets/static/auto/512x512@2x.png');
    expect(url.searchParams.get('path')).toBe('stroke:blue|width:4|fill:none|enc:abc}def');
  });

  it('static_route_map requires exactly one geometry input', async () => {
    const { nb } = fakeNbClient();
    await expect(staticRouteMap.run({}, nb)).rejects.toBeInstanceOf(ToolInputError);
    await expect(
      staticRouteMap.run(
        {
          encoded_polyline: 'x',
          route_points: [
            { latitude: 1, longitude: 2 },
            { latitude: 3, longitude: 4 },
          ],
        },
        nb,
      ),
    ).rejects.toBeInstanceOf(ToolInputError);
  });
});
