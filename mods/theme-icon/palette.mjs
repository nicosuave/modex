import { parseAccent } from './tint.mjs';
const HEX = /^#[\da-f]{6}$/i;
const ROLES = [
  ['accent', 'Accent', (theme) => theme.accent],
  ['ink', 'Foreground', (theme) => theme.ink],
  ['semantic.skill', 'Highlight', (theme) => theme.semanticColors?.skill],
  ['semantic.diffAdded', 'Added', (theme) => theme.semanticColors?.diffAdded],
  ['semantic.diffRemoved', 'Removed', (theme) => theme.semanticColors?.diffRemoved],
];
/** The active theme's resolved colors, including its user overrides.
 * No ANSI scan, syntax-token scan, synthetic hues, or theme-name presets.
 */
export function paletteChoices(theme) {
  const choices = [];
  for (const [id, label, read] of ROLES) {
    const color = read(theme);
    if (!HEX.test(color ?? '')) continue;
    const rgb = parseAccent(color);
    if (
      choices.some(
        (c) => Math.hypot(...parseAccent(c.color).map((v, i) => (v - rgb[i]) * 255)) < 24,
      )
    )
      continue;
    choices.push({ id, label, color: color.toLowerCase() });
  }
  return choices;
}
export function chosenColor(choices, id) {
  return choices.find((c) => c.id === id) ?? choices[0];
}
