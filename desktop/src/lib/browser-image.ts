import type { ImageFormat } from './editor-types.ts';

export interface ImageDimensions { width: number; height: number; format: ImageFormat }
export interface ImageSettings {
  crop: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  format: ImageFormat;
  brightness: number;
  contrast: number;
  quality?: number;
}
export interface SourceImage extends ImageDimensions {
  name: string;
  drawable: CanvasImageSource;
  dispose: () => void;
}

export const IMAGE_LIMITS = { fileBytes: 20 * 1024 * 1024, headerBytes: 256 * 1024, sourceDimension: 8192, pixels: 16 * 1024 * 1024, outputDimension: 4096, previewDimension: 1024 } as const;

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function sourceBounds(dimensions: ImageDimensions): ImageDimensions {
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > IMAGE_LIMITS.sourceDimension || height > IMAGE_LIMITS.sourceDimension || width * height > IMAGE_LIMITS.pixels) {
    throw new Error('Choose an image up to 8,192 pixels per side and 16 megapixels.');
  }
  return dimensions;
}

/** Detect raster dimensions before decoding. No SVG or arbitrary browser image URL is accepted. */
export function sniffImageHeader(bytes: Uint8Array): ImageDimensions {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) && ascii(bytes, 12, 4) === 'IHDR') {
    return sourceBounds({ width: view.getUint32(16), height: view.getUint32(20), format: 'png' });
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = ascii(bytes, offset, 4);
      const size = view.getUint32(offset + 4, true);
      const payload = offset + 8;
      const available = Math.min(size, bytes.length - payload);
      if (kind === 'VP8X' && available >= 10) {
        const width = 1 + bytes[payload + 4] + (bytes[payload + 5] << 8) + (bytes[payload + 6] << 16);
        const height = 1 + bytes[payload + 7] + (bytes[payload + 8] << 8) + (bytes[payload + 9] << 16);
        return sourceBounds({ width, height, format: 'webp' });
      }
      if (kind === 'VP8L' && available >= 5 && bytes[payload] === 0x2f) {
        const bits = view.getUint32(payload + 1, true);
        return sourceBounds({ width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff), format: 'webp' });
      }
      if (kind === 'VP8 ' && available >= 10 && bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) {
        return sourceBounds({ width: view.getUint16(payload + 6, true) & 0x3fff, height: view.getUint16(payload + 8, true) & 0x3fff, format: 'webp' });
      }
      const next = payload + size + (size % 2);
      if (next <= offset || next > bytes.length) break;
      offset = next;
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && size >= 8) {
        return sourceBounds({ width: view.getUint16(offset + 5), height: view.getUint16(offset + 3), format: 'jpeg' });
      }
      offset += size;
    }
  }
  throw new Error('Choose a supported PNG, JPEG, or WebP still image with a readable header within 256 KiB. SVG and unknown formats are not supported.');
}

export function validateImageSettings(settings: ImageSettings, source: Pick<ImageDimensions, 'width' | 'height'>): ImageSettings {
  const { crop } = settings;
  const values = [crop.x, crop.y, crop.width, crop.height, settings.width, settings.height];
  if (values.some((value) => !Number.isSafeInteger(value))) throw new Error('Crop and output dimensions must be whole pixel values.');
  if (crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > source.width || crop.y + crop.height > source.height) throw new Error('Keep the crop rectangle inside the original image.');
  if (settings.width < 1 || settings.height < 1 || settings.width > IMAGE_LIMITS.outputDimension || settings.height > IMAGE_LIMITS.outputDimension || settings.width * settings.height > IMAGE_LIMITS.pixels) throw new Error('Output dimensions must be 1–4,096 pixels per side and at most 16 megapixels.');
  if (!['png', 'webp', 'jpeg'].includes(settings.format)) throw new Error('Choose PNG, WebP, or JPEG output.');
  if (![settings.brightness, settings.contrast].every((value) => Number.isFinite(value) && value >= 0 && value <= 200)) throw new Error('Brightness and contrast must be between 0% and 200%.');
  if (settings.quality !== undefined && (!Number.isFinite(settings.quality) || settings.quality < 0.1 || settings.quality > 1)) throw new Error('Image quality must be between 10% and 100%.');
  return { ...settings, crop: { ...crop }, quality: settings.quality ?? 0.9 };
}

/** Same portable pixel transform is used for the preview and exported image. */
export function adjustPixels(pixels: Uint8ClampedArray, brightness: number, contrast: number): void {
  if (pixels.length % 4 !== 0 || ![brightness, contrast].every((value) => Number.isFinite(value) && value >= 0 && value <= 200)) throw new Error('Invalid image pixel adjustments.');
  const light = brightness / 100;
  const spread = contrast / 100;
  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) pixels[index + channel] = ((pixels[index + channel] - 128) * spread + 128) * light;
  }
}

function decodeBitmap(file: File): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => { finished = true; reject(new Error('Image decoding timed out after 8 seconds.')); }, 8000);
    createImageBitmap(file).then((bitmap) => {
      if (finished) { bitmap.close(); return; }
      finished = true; clearTimeout(timeout); resolve(bitmap);
    }, () => {
      if (finished) return;
      finished = true; clearTimeout(timeout); reject(new Error('This image is damaged or unsupported by the browser decoder.'));
    });
  });
}

export async function loadSourceImage(file: File): Promise<SourceImage> {
  if (file.size === 0 || file.size > IMAGE_LIMITS.fileBytes) throw new Error('Choose an image larger than 0 bytes and no larger than 20 MiB.');
  const header = sniffImageHeader(new Uint8Array(await file.slice(0, IMAGE_LIMITS.headerBytes).arrayBuffer()));
  if (typeof createImageBitmap === 'function') {
    const bitmap = await decodeBitmap(file);
    try { sourceBounds({ ...header, width: bitmap.width, height: bitmap.height }); }
    catch (reason) { bitmap.close(); throw reason; }
    return { ...header, name: file.name, width: bitmap.width, height: bitmap.height, drawable: bitmap, dispose: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Image decoding timed out after 8 seconds.')); }, 8000);
      const cleanup = () => { clearTimeout(timeout); image.onload = null; image.onerror = null; };
      image.onload = () => { cleanup(); resolve(); };
      image.onerror = () => { cleanup(); reject(new Error('This image is damaged or unsupported by the browser decoder.')); };
      image.src = url;
    });
    sourceBounds({ ...header, width: image.naturalWidth, height: image.naturalHeight });
    return { ...header, name: file.name, width: image.naturalWidth, height: image.naturalHeight, drawable: image, dispose: () => { image.removeAttribute('src'); URL.revokeObjectURL(url); } };
  } catch (reason) { image.removeAttribute('src'); URL.revokeObjectURL(url); throw reason; }
}

export function renderImageCanvas(source: SourceImage, input: ImageSettings, canvas: HTMLCanvasElement, preview = false): void {
  const settings = validateImageSettings(input, source);
  const scale = preview ? Math.min(1, IMAGE_LIMITS.previewDimension / Math.max(settings.width, settings.height)) : 1;
  canvas.width = Math.max(1, Math.round(settings.width * scale));
  canvas.height = Math.max(1, Math.round(settings.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser does not provide a 2D canvas context.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source.drawable, settings.crop.x, settings.crop.y, settings.crop.width, settings.crop.height, 0, 0, canvas.width, canvas.height);
  if (settings.brightness !== 100 || settings.contrast !== 100) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    adjustPixels(pixels.data, settings.brightness, settings.contrast);
    context.putImageData(pixels, 0, 0);
  }
  if (settings.format === 'jpeg') {
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-over';
  }
}

export async function encodeImage(source: SourceImage, settings: ImageSettings): Promise<Blob> {
  const canvas = document.createElement('canvas');
  try {
    renderImageCanvas(source, settings, canvas);
    const mime = `image/${settings.format}`;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) reject(new Error('The browser could not encode this image. Try a smaller output size.'));
        else if (result.type !== mime) reject(new Error(`This browser cannot export ${settings.format.toUpperCase()}. Choose another format.`));
        else resolve(result);
      }, mime, settings.quality ?? 0.9);
    });
    return blob;
  } finally { canvas.width = 1; canvas.height = 1; }
}
