import { tintIcon, tintThemeIcon } from './tint.mjs';
export function sourceVariant(variant, appearance) {
  return variant === 'dark' || variant === 'light' ? variant : appearance;
}
export function renderPixels(pixels, palette, variant, appearance) {
  if (
    !['theme', 'dark', 'light', 'original'].includes(variant) ||
    !['dark', 'light'].includes(appearance)
  )
    throw new TypeError('Invalid icon variant');
  if (variant === 'original') return new Uint8Array(pixels);
  return variant === 'theme'
    ? tintThemeIcon(pixels, palette, appearance)
    : tintIcon(pixels, palette.accent);
}
