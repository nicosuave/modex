import { PNG } from 'pngjs';
import path from 'node:path';
import { renderPixels, sourceVariant } from './render.mjs';
import { validatePayload } from './state.mjs';
let palette = null,
  refresh = null,
  electron = null,
  resources = null;
let renderer = { renderPixels, sourceVariant };
const originals = new Map(),
  cache = new Map();
export function configure(api, directory, update) {
  electron = api;
  resources = directory;
  refresh = update;
}
// Development reloads replace only pure pixel functions; native ownership and palette stay put.
export function setRenderer(next) {
  if (typeof next?.renderPixels !== 'function' || typeof next?.sourceVariant !== 'function')
    throw Error('Invalid Theme Icon renderer');
  // Validate before swapping: apply() deliberately catches native rendering errors,
  // so asking refresh() to validate would silently accept a broken candidate.
  const sample = new Uint8Array([0, 0, 0, 0, 255, 255, 255, 255]);
  for (const appearance of ['dark', 'light'])
    for (const variant of ['theme', 'dark', 'light', 'original']) {
      if (!['dark', 'light'].includes(next.sourceVariant(variant, appearance)))
        throw Error('Invalid Theme Icon source variant');
      checkedPixels(
        next.renderPixels(sample, { accent: '#336699', surface: '#222222' }, variant, appearance),
        sample.length,
      );
    }
  const candidate = palette && electron ? createImage(palette, next) : null;
  renderer = next;
  cache.clear();
  if (candidate) cache.set(JSON.stringify(palette), candidate);
  refresh?.();
}
export function update(value) {
  const valid = validatePayload(value);
  if (!valid) return false;
  palette = valid;
  refresh?.();
  return true;
}
export function apply(preference) {
  if (preference !== 'codex-system' || !palette || !electron?.app.dock) return false;
  try {
    const key = JSON.stringify(palette);
    let image = cache.get(key);
    if (!image) {
      image = createImage(palette, renderer);
      if (cache.size >= 16) cache.delete(cache.keys().next().value);
      cache.set(key, image);
    }
    electron.app.dock.setIcon(image);
    return true;
  } catch (error) {
    console.error('[Theme Icon]', error);
    return false;
  }
}
function checkedPixels(pixels, length) {
  if (
    (!(pixels instanceof Uint8Array) && !(pixels instanceof Uint8ClampedArray)) ||
    pixels.length !== length
  )
    throw Error('Invalid Theme Icon pixel output');
  return pixels;
}
function createImage(value, implementation) {
  const variant = implementation.sourceVariant(value.variant, value.appearance);
  if (!['dark', 'light'].includes(variant)) throw Error('Invalid Theme Icon source variant');
  if (!originals.has(variant)) {
    const filename = variant === 'dark' ? 'icon-codex-dark-color.png' : 'icon-codex-light.png';
    const original = electron.nativeImage.createFromPath(path.join(resources, filename));
    if (original.isEmpty()) throw new Error('Original Codex icon is missing');
    originals.set(
      variant,
      PNG.sync.read(original.resize({ width: 256, height: 256, quality: 'best' }).toPNG()),
    );
  }
  const source = originals.get(variant);
  const output = new PNG({ width: source.width, height: source.height });
  output.data = Buffer.from(
    checkedPixels(
      implementation.renderPixels(source.data, value, value.variant, value.appearance),
      source.data.length,
    ),
  );
  const image = electron.nativeImage.createFromBuffer(PNG.sync.write(output));
  // Match Codex's native icon crop (one pixel per 128 pixels).
  return image.crop({ x: 2, y: 2, width: 252, height: 252 });
}
