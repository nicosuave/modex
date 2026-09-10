// Pure pixel transform: callers supply decoded, unpremultiplied RGBA pixels.
export function parseAccent(value) {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) {
    throw new TypeError('Accent must be an opaque #RGB or #RRGGBB color');
  }
  let hex = value.slice(1);
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function hsl([r, g, b]) {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const l = (max + min) / 2;
  if (!d) return [0, 0, l];
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, d / (1 - Math.abs(2 * l - 1)), l];
}

function rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  const parts = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h * 6) % 6];
  return parts.map((v) => Math.round((v + m) * 255));
}

/** Tint chromatic artwork while keeping neutral pixels and alpha byte-exact.
 * The source is the stock colored Codex icon, not an arbitrary photograph.
 * Always regenerate from the original pixels, never from a previous tint.
 */
export function tintIcon(pixels, accent) {
  if (!(pixels instanceof Uint8Array) || pixels.length % 4)
    throw new TypeError('Expected RGBA bytes');
  const [h, s, targetLightness] = hsl(parseAccent(accent));
  const output = new Uint8Array(pixels);
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const source = [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) => v / 255);
    const [, sourceSaturation, lightness] = hsl(source);
    const chroma = Math.max(...source) - Math.min(...source);
    if (!chroma) continue;
    // Reduce tint influence near neutral highlights/shadows; retain the relief.
    const weight = Math.min(1, chroma / 0.25);
    const mapped =
      lightness <= 0.5
        ? lightness * 2 * targetLightness
        : targetLightness + (lightness - 0.5) * 2 * (1 - targetLightness);
    const shifted = lightness + (mapped - lightness) * weight;
    const tinted = rgb(h, sourceSaturation * s, shifted);
    for (let c = 0; c < 3; c++) output[i + c] = tinted[c];
  }
  return output;
}

/** Accept Codex's resolved chrome-theme seed, including user overrides.
 * Variant describes the supplied stock source icon, not inferred theme identity.
 */
export function tintThemeIcon(pixels, { accent, surface }, variant = 'dark') {
  if (!['dark', 'light'].includes(variant))
    throw new TypeError('Expected dark or light source variant');
  const background = parseAccent(surface);
  const output = tintIcon(pixels, accent);
  const anchor = variant === 'dark' ? 0.12 : 0.96;
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const values = [pixels[i], pixels[i + 1], pixels[i + 2]].map((v) => v / 255);
    const chroma = Math.max(...values) - Math.min(...values);
    // Stock tile is neutral; colored center and its pale glyph stay on accent path.
    const neutralWeight = Math.max(0, 1 - chroma / 0.035);
    if (!neutralWeight) continue;
    const level = values.reduce((a, b) => a + b, 0) / 3;
    for (let c = 0; c < 3; c++) {
      const mapped =
        level <= anchor
          ? (background[c] * level) / anchor
          : background[c] + ((1 - background[c]) * (level - anchor)) / (1 - anchor);
      output[i + c] = Math.round(
        output[i + c] * (1 - neutralWeight) + 255 * mapped * neutralWeight,
      );
    }
  }
  return output;
}
