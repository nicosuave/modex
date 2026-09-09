import {test, expect} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {transform, mainPath} from './patch.mjs';
import {readArchive, readEntry} from '../../lib/asar.mjs';
const {wrap} = createRequire(import.meta.url)('./runtime.cjs');
const socket = {_handle: {fd: 42}};
const denied = {authorized: false, reason: 'untrusted-code-signing-identity'};
const fixture = process.env.APP_TOOLS_AUTH_SOURCE && path.join(process.env.APP_TOOLS_AUTH_SOURCE, 'Contents/Resources/app.asar');

test('stock authorization is authoritative except for the specific identity restriction', () => {
  for (const verdict of [{authorized: true}, {authorized: false, reason: 'missing-code-signing-identity'}, {authorized: false, reason: 'missing-socket-file-descriptor'}]) {
    expect(wrap(() => verdict, {authorizeSocketPeer: () => {throw Error('must not call');}})(socket)).toBe(verdict);
  }
});
test('fallback consumes socket fd and fails closed on malformed input or native failure', () => {
  expect(wrap(() => denied, {authorizeSocketPeer: fd => ({authorized: fd === 42})})(socket).authorized).toBe(true);
  for (const value of [undefined, {}, {authorized: false}, {authorized: 1}]) {
    expect(wrap(() => denied, {authorizeSocketPeer: () => value})(socket).authorized).toBe(false);
  }
  expect(wrap(() => denied, {authorizeSocketPeer: () => {throw Error('failed');}})(socket).authorized).toBe(false);
  expect(wrap(() => denied, {authorizeSocketPeer: () => ({authorized: true})})({}).authorized).toBe(false);
});
test('transform rejects missing, duplicate and already-patched authorization call sites', () => {
  const input = 'async function mie({callTool:e,listTools:t,pipePath:n,socketPeerAuthorizer:r=Tf()}){}';
  expect(() => transform('')).toThrow();
  expect(() => transform(input + input)).toThrow();
  expect(() => transform(transform(input))).toThrow();
});
test.skipIf(!fixture || !fs.existsSync(fixture))('real main default authorizer loads the scoped adapter and preserves injected authorizers', () => {
  const input = readEntry(readArchive(fixture), mainPath).toString();
  const output = transform(input);
  const signature = output.match(/async function mie\(\{callTool:e,listTools:t,pipePath:n,socketPeerAuthorizer:r=.*?\}\)/)[0];
  const instantiate = new Function('process', 'require', 'Tf', `return (${signature}{return r;});`);
  let nativeCalls = 0;
  const native = {authorizeSocketPeer: () => {nativeCalls++;return {authorized: true};}};
  const requireMock = name => name === './modex-app-tools-auth.cjs' ? {wrap} : name === 'node:path' ? {join: (...parts) => parts.join('/')} : native;
  const factory = instantiate({platform: 'darwin', resourcesPath: '/test'}, requireMock, () => () => denied);
  return factory({}).then(authorize => {
    expect(authorize(socket).authorized).toBe(true);
    expect(nativeCalls).toBe(1);
    return factory({socketPeerAuthorizer: 'injected'}).then(value => expect(value).toBe('injected'));
  });
});
