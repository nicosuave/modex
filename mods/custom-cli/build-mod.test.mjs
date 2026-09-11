import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { transform, MAIN, SOURCE, CONNECT, DAEMON, replaceOnce } from './build-mod.mjs';
import { applyLaunch } from './runtime.mjs';

test('replacement gates reject missing and ambiguous stock anchors', async () => {
  expect(() => replaceOnce('missing', CONNECT, 'replacement')).toThrow('exactly one');
  expect(() => replaceOnce(CONNECT + CONNECT, CONNECT, 'replacement')).toThrow('exactly one');
  await expect(transform({ [MAIN]: 'main', [SOURCE]: CONNECT + DAEMON + DAEMON })).rejects.toThrow(
    'exactly one',
  );
  await expect(transform({ [MAIN]: 'require("./modex-custom-cli.cjs");' })).rejects.toThrow(
    'already applied',
  );
});

test.skipIf(!process.env.CUSTOM_CLI_BUNDLES)(
  'verified stock connection passes final arguments through stock spawn and preserves daemon fallback',
  async () => {
    const manifest = JSON.parse(
      fs.readFileSync(new URL('./compatibility.json', import.meta.url), 'utf8'),
    );
    const inputs = Object.fromEntries(
      Object.entries(manifest.files).map(([file, hash]) => {
        const source = fs.readFileSync(path.join(process.env.CUSTOM_CLI_BUNDLES, file), 'utf8');
        expect(crypto.createHash('sha256').update(source).digest('hex')).toBe(hash);
        return [file, source];
      }),
    );
    const output = await transform(inputs);
    expect(await transform(inputs)).toEqual(output);
    await expect(transform(output)).rejects.toThrow('already applied');
    // Execute the stock native-tool path resolver: this path is separate from
    // app-server launch and must continue observing the same executable override.
    const main = output[MAIN],
      nativeStart = main.indexOf('function Zr('),
      nativeEnd = main.indexOf('var ti=', nativeStart);
    expect(nativeEnd).toBeGreaterThan(nativeStart);
    const runtimeContext = {
      process: {
        env: { CODEX_CLI_PATH: '/custom/cli with spaces' },
        platform: 'darwin',
        cwd: () => '/workspace',
      },
      n: { $n: () => '/modules' },
      p: { default: path },
    };
    vm.createContext(runtimeContext);
    const nativePaths = vm.runInContext(
      `(()=>{${main.slice(nativeStart, nativeEnd)}return Zr;})()`,
      runtimeContext,
    );
    const resolved = nativePaths({
      resourcesPath: '/resources',
      resolveCodexPath: () => '/bundled/codex',
      resolveNodePath: () => '/bundled/node',
      resolveNodeReplPath: () => '/bundled/repl',
      resolvePrimaryRuntimeNodePath: () => null,
    });
    expect(resolved.codexCliPath).toBe('/custom/cli with spaces');
    expect(resolved.codexCliPathSource).toBe('env-override');
    expect(resolved.nodePath).toBe('/bundled/node');
    // Main is imported after bootstrap has finalized userData. Its prepended
    // initialization must execute before stock main-module initialization.
    const events = [],
      app = {};
    vm.runInNewContext(main.slice(0, main.indexOf(';') + 1) + 'events.push("stock");', {
      events,
      require: (id) =>
        id === 'electron'
          ? { app }
          : {
              initialize: (actual) => {
                expect(actual).toBe(app);
                events.push('custom');
              },
            },
    });
    expect(events).toEqual(['custom', 'stock']);
    const source = output[SOURCE];
    const resolveStart = source.indexOf('function dU('),
      resolveEnd = source.indexOf('function fU(', resolveStart);
    const resolveCommand = vm.runInNewContext(
      `(()=>{${source.slice(resolveStart, resolveEnd)}return dU;})()`,
      { AU: () => '/configured/cli', pU: () => ['app-server'] },
    );
    expect(resolveCommand({ hostConfig: { kind: 'local' } })).toEqual({
      executablePath: '/configured/cli',
      args: ['app-server'],
    });
    expect(
      resolveCommand({
        hostConfig: { kind: 'local', codex_cli_command: ['/host/cli', 'app-server', '--stdio'] },
      }),
    ).toEqual({ executablePath: '/host/cli', args: ['app-server', '--stdio'] });
    const connection = source.slice(
      source.indexOf('nU=class') + 3,
      source.indexOf(';async function rU('),
    );
    const start = source.indexOf('spawnProcess(){'),
      end = source.indexOf('onProcessError=e=>', start);
    const spawnMethod = source.slice(start, end);
    expect(connection.startsWith('class')).toBe(true);
    expect(end).toBeGreaterThan(start);
    const launch = {
      executablePath: '/custom/cli with spaces',
      args: ['app-server', '--analytics-default-enabled', '-c', 'model="stock"'],
      env: { UNCHANGED: 'yes' },
      cwd: '/work space',
    };
    for (const kind of ['local', 'ssh', 'wsl'])
      for (const active of [false, true]) {
        const calls = [],
          config = active ? { configOverrides: ['model="custom value"'] } : null;
        const context = {
          ModexCustomCli: {
            applyLaunch: (value, host) => applyLaunch(value, host, config),
            isActive: () => active,
          },
          pV: class {},
          aU: async () => launch,
          i: path,
          Zk: () => '/profile',
          process: { platform: 'darwin', env: { CODEX_APP_SERVER_USE_LOCAL_DAEMON: '1' } },
          oU: () => null,
          rU: async () => true,
          p: { createConnection() {} },
          oH: class {
            connect() {
              return 'daemon';
            }
          },
          UR: { resolve: () => null },
          d: {
            spawn: (...args) => {
              calls.push(args);
              return { pid: 1, on() {} };
            },
          },
          LI: () => null,
          lV: { Open: 1 },
          queueMicrotask: () => {},
        };
        vm.createContext(context);
        const Spawn = vm.runInContext(`(class {${spawnMethod}})`, context);
        context.tU = class {
          constructor(options) {
            this.options = options;
            this.logger = { info() {} };
            this.stdoutMessageReader = { attach() {} };
            Spawn.prototype.spawnProcess.call(this);
          }
        };
        const Connection = vm.runInContext(`(${connection})`, context);
        const result = await new Connection({
          hostConfig: { kind },
          getConfigOverrides: async () => undefined,
        }).connect();
        if (kind === 'local' && !active) {
          expect(result).toBe('daemon');
          expect(calls).toHaveLength(0);
        } else {
          expect(calls).toHaveLength(1);
          expect(calls[0][0]).toBe(launch.executablePath);
          expect(calls[0][1]).toEqual(
            kind === 'local' && active
              ? [...launch.args, '-c', 'model="custom value"']
              : launch.args,
          );
          expect(calls[0][2]).toEqual({
            stdio: ['pipe', 'pipe', 'pipe'],
            env: launch.env,
            cwd: launch.cwd,
          });
        }
      }
  },
);
