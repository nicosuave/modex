import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { patchThemeProvider, patchThemeSettings, patchThemeMain } from './source-hooks.mjs';
const here = import.meta.dirname;
export async function transform(bundles) {
  const output = { ...bundles };
  const find = (prefix) => {
    const names = Object.keys(bundles).filter((n) => n.startsWith(prefix));
    if (names.length !== 1) throw new Error(`Expected one ${prefix}`);
    return names[0];
  };
  const main = find('.vite/build/main-'),
    initial = find('webview/assets/app-initial-'),
    settings = find('webview/assets/general-settings-');
  output[initial] = patchThemeProvider(output[initial]);
  output[settings] = patchThemeSettings(output[settings]);
  output[main] = patchThemeMain(output[main]);
  for (const file of ['runtime', 'state', 'render', 'tint', 'palette']) {
    let content = fs.readFileSync(path.join(here, `${file}.mjs`), 'utf8');
    for (const dependency of ['runtime', 'state', 'render', 'tint', 'palette'])
      content = content.replaceAll(`'./${dependency}.mjs'`, `'./theme-icon-${dependency}.mjs'`);
    output[`webview/assets/theme-icon-${file}.mjs`] = content;
  }
  const build = await Bun.build({
    entrypoints: [path.join(here, 'main.mjs')],
    target: 'node',
    format: 'cjs',
    minify: false,
    write: false,
  });
  if (!build.success) throw new AggregateError(build.logs, 'Could not bundle native icon adapter');
  output['.vite/build/theme-icon-main.cjs'] = await build.outputs[0].text();
  return output;
}
if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: bun build-mod.mjs INPUT_DIRECTORY OVERLAY_ROOT');
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'compatibility.json'), 'utf8'));
  const bundles = {};
  for (const [name, hash] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(input, name));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error(`Unsupported bundle: ${name}`);
    bundles[name] = bytes.toString();
  }
  const patched = await transform(bundles);
  for (const [name, content] of Object.entries(patched)) {
    const destination = path.join(output, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  console.log(`Theme Icon: wrote ${Object.keys(patched).length} overlay files`);
}
