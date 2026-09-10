import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { readArchive, readEntry } from '../../lib/asar.mjs';
import { tintThemeIcon } from './tint.mjs';

const [
  resources = '/Applications/ChatGPT.app/Contents/Resources',
  destination = 'work/codex-theme-preview',
] = process.argv.slice(2);
const archive = readArchive(path.join(resources, 'app.asar'));
const assets = Object.keys(archive.header.files.webview.files.assets.files);
const initialFiles = assets.filter((file) => /^app-initial-[a-f0-9]+\.js$/.test(file));
if (initialFiles.length !== 1) throw new Error('Expected one initial renderer bundle');
const initial = readEntry(archive, `webview/assets/${initialFiles[0]}`).toString();
const themes = ['gruvbox-dark-medium', 'dracula', 'nord'].map((name) => {
  const registration = initial.indexOf('id:`' + name + '`');
  if (registration < 0) throw new Error(`Missing theme registration: ${name}`);
  const importStart = initial.indexOf('import(`./', registration) + 'import(`./'.length;
  const registeredFile = initial.slice(importStart, initial.indexOf('`)', importStart));
  const matches = assets.filter(
    (file) => new RegExp(`^${name}-[a-f0-9]+\\.js$`).test(file) && file === registeredFile,
  );
  if (matches.length !== 1) throw new Error(`Expected one theme bundle for ${name}`);
  const source = readEntry(archive, `webview/assets/${matches[0]}`).toString();
  const marker = 'JSON.parse(`';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Unsupported theme encoding: ${name}`);
  // These installed bundles embed literal JSON; do not execute vendor modules.
  const json = source.slice(start + marker.length, source.indexOf('`)', start));
  const theme = JSON.parse(json);
  const colors = theme.colors;
  const seed = {
    surface: colors['editor.background'],
    ink: colors['editor.foreground'],
    accent: colors['activityBarBadge.background'],
    ...theme.chromeTheme,
  };
  // This preview exercises the first successful candidates in Codex's seed
  // resolver for these three inspected bundles. Runtime will pass resolved seed.
  if (!seed.surface || !seed.ink || !seed.accent) throw new Error(`Missing palette: ${name}`);
  return { name, ...seed };
});
fs.mkdirSync(destination, { recursive: true });
const source = PNG.sync.read(fs.readFileSync(path.join(resources, 'icon-codex-dark-color.png')));
const size = 320,
  gap = 16;
const sheet = new PNG({ width: themes.length * (size + gap) + gap, height: size + gap * 2 });
sheet.data.fill(0);
for (const [index, theme] of themes.entries()) {
  const data = tintThemeIcon(source.data, theme, 'dark');
  const icon = new PNG({ width: source.width, height: source.height });
  icon.data = Buffer.from(data);
  fs.writeFileSync(path.join(destination, `${theme.name}.png`), PNG.sync.write(icon));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const from =
        (Math.floor((y * source.height) / size) * source.width +
          Math.floor((x * source.width) / size)) *
        4;
      const to = ((gap + y) * sheet.width + gap + index * (size + gap) + x) * 4;
      sheet.data.set(data.subarray(from, from + 4), to);
    }
}
fs.writeFileSync(path.join(destination, 'palettes.json'), JSON.stringify(themes, null, 2));
fs.writeFileSync(path.join(destination, 'preview.png'), PNG.sync.write(sheet));
console.log(JSON.stringify(themes, null, 2));
console.log(path.resolve(destination, 'preview.png'));
