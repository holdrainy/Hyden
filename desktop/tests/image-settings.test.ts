import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjustPixels, IMAGE_LIMITS, sniffImageHeader, validateImageSettings } from '../src/lib/browser-image.ts';
import type { ImageSettings } from '../src/lib/browser-image.ts';

function settings(patch: Partial<ImageSettings> = {}): ImageSettings {
  return { crop: { x: 0, y: 0, width: 100, height: 80 }, width: 50, height: 40, format: 'png', brightness: 100, contrast: 100, ...patch };
}

test('image settings validate crop bounds, resize budget, formats and adjustments', () => {
  assert.equal(validateImageSettings(settings(), { width: 100, height: 80 }).quality, 0.9);
  for (const value of [
    settings({ crop: { x: 50, y: 0, width: 60, height: 20 } }),
    settings({ crop: { x: -1, y: 0, width: 20, height: 20 } }),
    settings({ width: Number.NaN }), settings({ height: 0 }), settings({ width: 4097 }),
    settings({ brightness: 201 }), settings({ contrast: -1 }), settings({ quality: 0 }),
    settings({ format: 'svg' as never }),
  ]) assert.throws(() => validateImageSettings(value, { width: 100, height: 80 }));
  const input = settings();
  const validated = validateImageSettings(input, { width: 100, height: 80 });
  validated.crop.x = 5;
  assert.equal(input.crop.x, 0);
});

test('pixel adjustments preserve alpha, clamp channels, and use the same explicit formula', () => {
  const pixels = new Uint8ClampedArray([20, 128, 250, 47, 0, 255, 100, 255]);
  adjustPixels(pixels, 100, 100);
  assert.deepEqual([...pixels], [20, 128, 250, 47, 0, 255, 100, 255]);
  adjustPixels(pixels, 200, 100);
  assert.deepEqual([...pixels], [40, 255, 255, 47, 0, 255, 200, 255]);
  const neutral = new Uint8ClampedArray([10, 100, 240, 0]);
  adjustPixels(neutral, 100, 0);
  assert.deepEqual([...neutral], [128, 128, 128, 0]);
  assert.throws(() => adjustPixels(new Uint8ClampedArray(3), 100, 100));
  assert.throws(() => adjustPixels(pixels, Number.NaN, 100));
});

test('PNG header dimensions are recognized before decode and decompression limits are enforced', () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]); png.set([...Buffer.from('IHDR')], 12);
  const view = new DataView(png.buffer); view.setUint32(16, 120); view.setUint32(20, 60);
  assert.deepEqual(sniffImageHeader(png), { width: 120, height: 60, format: 'png' });
  view.setUint32(16, 8192); view.setUint32(20, 8192);
  assert.throws(() => sniffImageHeader(png), /16 megapixels/);
  view.setUint32(16, 0);
  assert.throws(() => sniffImageHeader(png));
  assert.equal(IMAGE_LIMITS.headerBytes, 256 * 1024);
});

test('JPEG baseline/progressive SOF dimensions and bounded segment traversal are recognized', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc2, 0, 8, 8, 0, 30, 0, 60, 1]);
  assert.deepEqual(sniffImageHeader(jpeg), { width: 60, height: 30, format: 'jpeg' });
  const broken = jpeg.slice(); broken[4] = 0xff; broken[5] = 0xff;
  assert.throws(() => sniffImageHeader(broken), /readable header/);
  assert.throws(() => sniffImageHeader(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 0])));
});

function webp(kind: string, payload: number[]): Uint8Array {
  const bytes = new Uint8Array(20 + payload.length);
  bytes.set(Buffer.from('RIFF'), 0); bytes.set(Buffer.from('WEBP'), 8); bytes.set(Buffer.from(kind), 12);
  new DataView(bytes.buffer).setUint32(16, payload.length, true); bytes.set(payload, 20);
  return bytes;
}

test('WebP extended, lossless and lossy headers expose bounded pixel dimensions', () => {
  assert.deepEqual(sniffImageHeader(webp('VP8X', [0, 0, 0, 0, 99, 0, 0, 49, 0, 0])), { width: 100, height: 50, format: 'webp' });
  const bits = 99 | (49 << 14);
  assert.deepEqual(sniffImageHeader(webp('VP8L', [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255])), { width: 100, height: 50, format: 'webp' });
  assert.deepEqual(sniffImageHeader(webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 100, 0, 50, 0])), { width: 100, height: 50, format: 'webp' });
  assert.throws(() => sniffImageHeader(webp('VP8X', [0, 0, 0])));
});

test('SVG, unknown, truncated, or spoofed headers never reach browser image decoding', () => {
  for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), new Uint8Array(), Buffer.from('not an image'), webp('JUNK', [1, 2, 3])]) assert.throws(() => sniffImageHeader(bytes));
});
