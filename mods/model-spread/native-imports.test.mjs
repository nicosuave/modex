import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readArchive, readEntry, entryFor } from '../../lib/asar.mjs';
import { transform } from './build-mod.mjs';
import { archiveModules } from '../../lib/source-modules.mjs';

const archives = (
  process.env.MODEL_SPREAD_REGRESSION_ARCHIVES ??
  (process.env.APP_TOOLS_AUTH_SOURCE
    ? path.join(process.env.APP_TOOLS_AUTH_SOURCE, 'Contents/Resources/app.asar')
    : '')
)
  .split(path.delimiter)
  .filter(Boolean);
if (!archives.length)
  test(
    'native adapter imports link against reviewed stock exports',
    {
      skip: 'Set MODEL_SPREAD_REGRESSION_ARCHIVES to verify native export contracts',
    },
    () => {},
  );

for (const filename of archives) {
  test(
    `native adapter imports link against stock exports: ${filename}`,
    { timeout: 120000 },
    () => {
      const archive = readArchive(filename);
      const names = Object.keys(entryFor(archive, 'webview/assets').files);
      const originals = Object.fromEntries(
        names
          .filter((name) =>
            /^(app-initial-|app-primary-|agent-settings-|codex-micro-settings-|codex-micro-bridge-).*\.js$/.test(
              name,
            ),
          )
          .map((name) => [name, readEntry(archive, `webview/assets/${name}`).toString()]),
      );
      const patched = transform(originals, { sourceModules: archiveModules(archive) });
      const transpiler = new Bun.Transpiler({ loader: 'js' });
      const load = (name) =>
        patched[name] ?? readEntry(archive, `webview/assets/${name}`).toString();
      const exportCache = new Map();
      const exportsFor = (name) => {
        if (!exportCache.has(name))
          exportCache.set(name, new Set(transpiler.scan(load(name)).exports));
        return exportCache.get(name);
      };
      for (const name of ['model-spread-storage.mjs', 'model-spread-native.mjs']) {
        const source = patched[name];
        for (const match of source.matchAll(
          /import\s+(\{[^}]*\}|[\w$]+)\s+from\s+['"]\.\/([^'"]+)['"]/g,
        )) {
          const exports = exportsFor(match[2]);
          const imports = match[1].startsWith('{')
            ? match[1]
                .slice(1, -1)
                .split(',')
                .map((item) => item.trim().split(/\s+as\s+/)[0])
                .filter(Boolean)
            : ['default'];
          for (const imported of imports)
            assert.ok(exports.has(imported), `${name}: ${match[2]} exports ${imported}`);
        }
      }
    },
  );
}
