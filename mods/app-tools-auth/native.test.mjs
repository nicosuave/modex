import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {buildNative} from './build-native.mjs';

const require = createRequire(import.meta.url);
const suite = process.platform === 'darwin' ? describe : describe.skip;
suite('native socket authorizer', () => {
  let scratch, addon;
  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-native-test-'));
    const output = path.join(scratch, 'authorizer.node');
    buildNative({output, teamId: 'ABCDE12345', bundleId: 'local.modex.authorizer-test'});
    addon = require(output);
  });
  afterAll(() => fs.rmSync(scratch, {recursive: true, force: true}));

  test('rejects malformed descriptors without coercion', () => {
    for (const value of [undefined, null, '1', -1, 0.5, NaN, Infinity, 2 ** 32, {}, 1n]) {
      expect(addon.authorizeSocketPeer(value)).toEqual({authorized: false, reason: 'invalid-descriptor'});
    }
    expect(addon.authorizeSocketPeer(0, 1)).toEqual({authorized: false, reason: 'invalid-descriptor'});
  });

  test('rejects real file descriptors that are not peer sockets', () => {
    const fd = fs.openSync(path.join(scratch, 'plain-file'), 'w');
    try {
      expect(addon.authorizeSocketPeer(fd)).toEqual({authorized: false, reason: 'peer-token-unavailable'});
    } finally { fs.closeSync(fd); }
    expect(addon.authorizeSocketPeer(fd)).toEqual({authorized: false, reason: 'peer-token-unavailable'});
  });

  test('rejects a real connected client signed outside the vendor identity', async () => {
    const socketPath = path.join(scratch, 'peer.sock');
    const server = net.createServer();
    await new Promise(resolve => server.listen(socketPath, resolve));
    let child, socket;
    try {
      const connection = new Promise(resolve => server.once('connection', resolve));
      child = spawn(process.execPath, ['-e', `require('node:net').connect(${JSON.stringify(socketPath)}).on('error',()=>process.exit(1));`], {stdio: 'ignore'});
      socket = await connection;
      expect(addon.authorizeSocketPeer(socket._handle.fd)).toEqual({authorized: false, reason: 'peer-signature-invalid'});
    } finally {
      socket?.destroy();
      child?.kill();
      await new Promise(resolve => server.close(resolve));
    }
  });

  test('requires fixed safe build identities and preserves existing outputs', () => {
    const output = path.join(scratch, 'authorizer.node');
    expect(() => buildNative({output, teamId: 'ABCDE12345', bundleId: 'local.modex.authorizer-test'})).toThrow('already exists');
    expect(() => buildNative({output, teamId: '*', bundleId: 'local.modex.authorizer-test'})).toThrow('teamId');
    expect(() => buildNative({output, teamId: 'ABCDE12345', bundleId: 'x" or true'})).toThrow('bundleId');
  });
});
