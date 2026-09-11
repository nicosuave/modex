import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { transform, mainPath } from './patch.mjs';
import { readArchive, readEntry } from '../../lib/asar.mjs';
import { resolveBundlePaths } from '../../lib/current-source.mjs';
const { wrap } = createRequire(import.meta.url)('./runtime.cjs');
const socket = { _handle: { fd: 42 } };
const denied = { authorized: false, reason: 'untrusted-code-signing-identity' };
const fixture =
  process.env.APP_TOOLS_AUTH_SOURCE &&
  path.join(process.env.APP_TOOLS_AUTH_SOURCE, 'Contents/Resources/app.asar');

test('stock authorization is authoritative except for the specific identity restriction', () => {
  for (const verdict of [
    { authorized: true },
    { authorized: false, reason: 'missing-code-signing-identity' },
    { authorized: false, reason: 'missing-socket-file-descriptor' },
    { authorized: false, reason: 'missing-package-build-flavor' },
    { authorized: false, reason: 'unknown-future-rejection' },
  ]) {
    expect(
      wrap(() => verdict, {
        authorizeSocketPeer: () => {
          throw Error('must not call');
        },
      })(socket),
    ).toBe(verdict);
  }
});
test('fallback consumes socket fd and fails closed on malformed input or native failure', () => {
  expect(
    wrap(() => denied, { authorizeSocketPeer: (fd) => ({ authorized: fd === 42 }) })(socket)
      .authorized,
  ).toBe(true);
  for (const value of [undefined, {}, { authorized: false }, { authorized: 1 }]) {
    expect(wrap(() => denied, { authorizeSocketPeer: () => value })(socket).authorized).toBe(false);
  }
  expect(
    wrap(() => denied, {
      authorizeSocketPeer: () => {
        throw Error('failed');
      },
    })(socket).authorized,
  ).toBe(false);
  expect(
    wrap(() => denied, { authorizeSocketPeer: () => ({ authorized: true }) })({}).authorized,
  ).toBe(false);
});
test('transform rejects missing, duplicate and already-patched authorization call sites', () => {
  const input =
    'async function Cae({callTool:e,listTools:t,pipePath:n,socketPeerAuthorizer:r=gd()}){}';
  expect(() => transform('')).toThrow();
  expect(() => transform(input + input)).toThrow();
  expect(() =>
    transform(input + input.replace('Cae', 'another').replace('gd()', 'otherFactory()')),
  ).toThrow();
  expect(() => transform(transform(input))).toThrow();
  for (const changed of [
    input.replace('gd()', 'gd(options)'),
    input.replace('gd()', 'await gd()'),
    input.replace('pipePath:n,', ''),
    input.replace('socketPeerAuthorizer:', 'peerAuthorizer:'),
    input.replace('r=gd()', 'r=gd(),extra:x'),
  ]) {
    expect(() => transform(changed)).toThrow();
  }
});

test('formatting changes preserve the parameter contract', () => {
  const input =
    'async function renamed ( { callTool : invoke, listTools : list, pipePath : pipe, socketPeerAuthorizer : authorize = factory ( ) } ) { return authorize; }';
  const output = transform(input);
  expect(output).toContain('.wrap(factory(),');
  new Bun.Transpiler({ loader: 'js' }).transformSync(output);
});

for (const [name, authorizer, factoryName] of [
  ['mie', 'r', 'Tf'],
  ['Cae', 'r', 'gd'],
  ['renamedEntrypoint', '$authorize', '_renamedFactory'],
]) {
  test(`parameter contract survives alpha renaming: ${name}`, async () => {
    const input = `async function ${name}({callTool:invoke,listTools:enumerate,pipePath:address,socketPeerAuthorizer:${authorizer}=${factoryName}()}){return ${authorizer};}`;
    const sibling = `async function untouched({services:svc,pipePath:address,socketPeerAuthorizer:auth=${factoryName}()}){return auth;}`;
    const output = transform(input + sibling);
    expect(output.endsWith(sibling)).toBe(true);
    expect(output).toBe(transform(input + sibling));
    new Bun.Transpiler({ loader: 'js' }).transformSync(output);
    const instantiate = new Function(
      'process',
      'require',
      factoryName,
      `${output};return ${name};`,
    );
    const stock = () => denied;
    let nativeCalls = 0;
    const native = {
      authorizeSocketPeer: (fd) => {
        nativeCalls++;
        return { authorized: fd === 42 };
      },
    };
    const requireMock = (module) =>
      module === './modex-app-tools-auth.cjs'
        ? { wrap }
        : module === 'node:path'
          ? { join: (...parts) => parts.join('/') }
          : native;
    const darwin = instantiate(
      { platform: 'darwin', resourcesPath: '/test' },
      requireMock,
      () => stock,
    );
    expect((await darwin({}))(socket).authorized).toBe(true);
    expect(nativeCalls).toBe(1);
    expect(await darwin({ socketPeerAuthorizer: stock })).toBe(stock);
    const linux = instantiate(
      { platform: 'linux' },
      () => {
        throw Error('unexpected require');
      },
      () => stock,
    );
    expect(await linux({})).toBe(stock);
  });
}

// Optional historical archive proves the same transform handles the prior bundle;
// this does not add that version to the packaging compatibility manifest.
const previousArchive = process.env.APP_TOOLS_AUTH_PREVIOUS_ARCHIVE;
test.skipIf(!previousArchive)(
  'same transform accepts the previous real bundle without minifier-specific edits',
  () => {
    const archive = readArchive(previousArchive);
    const names = Object.keys(archive.header.files['.vite'].files.build.files).filter((name) =>
      /^main-.*\.js$/.test(name),
    );
    expect(names).toHaveLength(1);
    const input = readEntry(archive, `.vite/build/${names[0]}`).toString();
    const output = transform(input);
    expect(output).not.toBe(input);
    expect(output).toBe(transform(input));
    new Bun.Transpiler({ loader: 'js' }).transformSync(output);
    expect(
      output.replace(
        /process\.platform===`darwin`\?require\(`\.\/modex-app-tools-auth\.cjs`\)\.wrap\((\w+\(\)),require\(require\(`node:path`\)\.join\(process\.resourcesPath,`native`,`modex-app-tools-auth\.node`\)\)\):\1/,
        '$1',
      ),
    ).toBe(input);
  },
);
test.skipIf(!fixture || !fs.existsSync(fixture))(
  'real main default authorizer loads the scoped adapter and preserves injected authorizers',
  async () => {
    const archive = readArchive(fixture);
    const input = readEntry(
      archive,
      resolveBundlePaths(archive, [mainPath]).get(mainPath),
    ).toString();
    const output = transform(input);
    // Both other users of the stock factory must remain outside this repair.
    for (const signature of [
      'async function Soe({services:e,pipePath:t=fs(),socketPeerAuthorizer:n=gd()})',
      'async function Uve({apiImpl:e,nativePipeDirectory:t,maxOutgoingFrameBytes:n=Vve,pipePath:r,socketPeerAuthorizer:i=gd()})',
    ]) {
      expect(input.includes(signature)).toBe(true);
      expect(output.includes(signature)).toBe(true);
    }
    const signature = output.match(
      /async function Cae\(\{callTool:e,listTools:t,pipePath:n,socketPeerAuthorizer:r=.*?\}\)/,
    )[0];
    const instantiate = new Function(
      'process',
      'require',
      'gd',
      `return (${signature}{return r;});`,
    );
    let nativeCalls = 0;
    const native = {
      authorizeSocketPeer: () => {
        nativeCalls++;
        return { authorized: true };
      },
    };
    const requireMock = (name) =>
      name === './modex-app-tools-auth.cjs'
        ? { wrap }
        : name === 'node:path'
          ? { join: (...parts) => parts.join('/') }
          : native;
    const factory = instantiate(
      { platform: 'darwin', resourcesPath: '/test' },
      requireMock,
      () => () => denied,
    );
    const authorize = await factory({});
    expect(authorize(socket).authorized).toBe(true);
    expect(nativeCalls).toBe(1);
    expect(await factory({ socketPeerAuthorizer: 'injected' })).toBe('injected');

    const stock = () => ({ authorized: true });
    const nonDarwin = instantiate(
      { platform: 'linux' },
      () => {
        throw Error('must not load native adapter');
      },
      () => stock,
    );
    expect(await nonDarwin({})).toBe(stock);
  },
);
