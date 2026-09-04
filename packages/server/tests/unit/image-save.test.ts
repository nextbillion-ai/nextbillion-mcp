import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { staticMapImage } from '../../src/tools/maps/static-map-image.js';
import { fakeNbClient } from '../helpers/fake-fetch.js';

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe('rendered images are also saved locally', () => {
  let dir: string;
  let previous: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nb-mcp-test-'));
    previous = process.env.NBAI_IMAGE_DIR;
    process.env.NBAI_IMAGE_DIR = dir;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.NBAI_IMAGE_DIR;
    else process.env.NBAI_IMAGE_DIR = previous;
  });

  it('writes the PNG to NBAI_IMAGE_DIR and reports the path in the caption', async () => {
    const { nb } = fakeNbClient({ responses: [{ body: PNG_BYTES, contentType: 'image/png' }] });
    const result = await staticMapImage.run(
      { center: { latitude: 1.28, longitude: 103.85 }, zoom: 12 },
      nb,
    );
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^map-\d{8}T\d{6}-[0-9a-f]{8}\.png$/);
    expect(new Uint8Array(readFileSync(join(dir, files[0]!)))).toEqual(PNG_BYTES);

    const caption = (result.content.find((c) => c.type === 'text') as { text: string }).text;
    expect(caption).toContain(`Saved to ${join(dir, files[0]!)}`);
    // inline image is still returned first for clients that can display it
    expect(result.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });
});
