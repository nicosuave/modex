#!/usr/bin/env bun
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { inspectCompatibility } from './prepare-mod.mjs';
import { entryFor } from '../../lib/asar.mjs';
import { transform } from './build-mod.mjs';
import { verifyRepair } from '../app-tools-auth/patch.mjs';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log(
    'Usage: bun verify-mod.mjs [--source /path/to/ChatGPT.app]\nChecks signature, hashes, transforms, syntax, relative imports, and tests. Never packages or launches.',
  );
} else {
  try {
    if (args.length !== 0 && !(args.length === 2 && args[0] === '--source'))
      throw Error('Usage: bun verify-mod.mjs [--source /path/to/ChatGPT.app]');
    const source = args[1] ?? '/Applications/ChatGPT.app';
    verifyRepair(source);
    const manifest = JSON.parse(
      fs.readFileSync(new URL('./compatibility.json', import.meta.url), 'utf8'),
    );
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', source], {
      stdio: 'pipe',
    });
    const { archive, bundles } = inspectCompatibility(source, manifest);
    const originals = Object.fromEntries(
      [...bundles].map(([name, bytes]) => [name, bytes.toString('utf8')]),
    );
    const patched = transform(originals);
    if (JSON.stringify(patched) !== JSON.stringify(transform(originals)))
      throw Error('Transform output is not deterministic');
    const parser = new Bun.Transpiler({ loader: 'js' });
    for (const [name, content] of Object.entries(patched)) {
      parser.transformSync(content);
      for (const item of parser.scan(content).imports) {
        if (!item.path.startsWith('.')) continue;
        const target = path.posix.normalize(path.posix.join('webview/assets', item.path));
        const generated =
          target.startsWith('webview/assets/') &&
          Object.hasOwn(patched, target.slice('webview/assets/'.length));
        if (!generated && !entryFor(archive, target))
          throw Error(`Missing import ${item.path} in ${name}`);
      }
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'model-spread-verify-'));
    try {
      for (const [name, bytes] of bundles) fs.writeFileSync(path.join(temporary, name), bytes);
      const result = spawnSync(process.execPath, ['test'], {
        cwd: path.resolve(import.meta.dirname, '../..'),
        env: { ...process.env, MODEL_SPREAD_BUNDLES: temporary, APP_TOOLS_AUTH_SOURCE: source },
        stdio: 'inherit',
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw Error(`Tests failed (${result.status ?? result.signal})`);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    console.log(
      JSON.stringify(
        {
          verified: true,
          version: manifest.version,
          build: manifest.build,
          bundles: bundles.size,
          overlayFiles: Object.keys(patched).length,
          deterministic: true,
          syntaxAndImportPaths: true,
          tests: 'passed with native HOME regression',
          appModified: false,
          launched: false,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  }
}
