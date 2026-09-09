import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {buildNative} from './build-native.mjs';
import {signingIdentity as findSigningIdentity} from '../../lib/sign-app.mjs';

// Explicit local integration verifier; all binaries, signatures, profiles, and
// sockets belong to its temporary fixture. No installed app is changed or quit.
export function verifyNative({node, codex, signingIdentity, teamId}) {
  const signer = findSigningIdentity(signingIdentity);
  const signingTeam = signer.name.match(/\(([A-Z0-9]{10})\)$/)?.[1];
  if (!signingTeam || (teamId && teamId !== signingTeam)) throw new Error('Fixture team must match its Developer ID signing identity');
  teamId = signingTeam;
  signingIdentity = signer.hash;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-native-integration-'));
  const bundleId = 'local.modex.authorizer-test';
  const run = (command, args) => execFileSync(command, args, {encoding: 'utf8', timeout: 35000});
  try {
    const host = path.join(scratch, 'fixture-host');
    const vendorNode = path.join(scratch, 'node');
    const vendorCodex = path.join(scratch, 'codex');
    for (const [source, output] of [[node, host], [node, vendorNode], [codex, vendorCodex]]) {
      fs.copyFileSync(source, output, fs.constants.COPYFILE_FICLONE);
      fs.chmodSync(output, 0o755);
    }
    for (const binary of [vendorNode, vendorCodex]) run('/usr/bin/codesign', ['--verify', '--strict', binary]);
    const entitlements = path.join(scratch, 'entitlements.plist');
    fs.writeFileSync(entitlements, '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>');
    run('/usr/bin/codesign', ['--force', '--sign', signingIdentity, '--timestamp=none', '--identifier', bundleId, '--options', 'runtime', '--entitlements', entitlements, host]);
    const addons = {};
    for (const [name, identity] of Object.entries({
      accepted: {teamId, bundleId},
      wrongBundle: {teamId, bundleId: 'local.modex.wrong-host'},
      wrongTeam: {teamId: '0000000000', bundleId},
    })) {
      const output = path.join(scratch, `${name}.node`);
      buildNative({output, ...identity});
      run('/usr/bin/codesign', ['--force', '--sign', signingIdentity, '--timestamp=none', output]);
      addons[name] = output;
    }
    const cases = [
      {name: 'accepted signed vendor chain', addon: 'accepted', expected: {authorized: true, reason: 'authorized'}},
      {name: 'wrong host bundle', addon: 'wrongBundle', expected: {authorized: false, reason: 'host-signature-invalid'}},
      {name: 'wrong host team', addon: 'wrongTeam', expected: {authorized: false, reason: 'host-signature-invalid'}},
      {name: 'wrong peer runtime signature', addon: 'accepted', peerNode: host, expected: {authorized: false, reason: 'peer-signature-invalid'}},
      {name: 'wrong parent identity', addon: 'accepted', mode: 'wrong-parent', expected: {authorized: false, reason: 'parent-signature-invalid'}},
      {name: 'unrelated host ancestor', addon: 'accepted', mode: 'wrong-ancestor', expected: {authorized: false, reason: 'unrelated-host'}},
    ];
    const results = [];
    for (const [index, item] of cases.entries()) {
      const home = path.join(scratch, `home-${index}`);
      fs.mkdirSync(home);
      const options = {...item, addon: addons[item.addon], home, node: vendorNode, codex: vendorCodex, socket: path.join(scratch, `socket-${index}`)};
      const output = run(host, [path.join(import.meta.dirname, 'native/host-fixture.cjs'), JSON.stringify(options)]);
      const result = JSON.parse(output.trim());
      assert.deepEqual(result, item.expected, item.name);
      results.push({name: item.name, ...result});
    }
    return results;
  } finally { fs.rmSync(scratch, {recursive: true, force: true}); }
}

if (import.meta.main) {
  const {values} = parseArgs({options: {
    node: {type: 'string'}, codex: {type: 'string'}, 'signing-identity': {type: 'string'}, 'team-id': {type: 'string'},
  }});
  for (const name of ['node', 'codex', 'signing-identity']) {
    if (!values[name]) throw new Error(`Missing --${name}`);
  }
  console.log(JSON.stringify(verifyNative({node: values.node, codex: values.codex, signingIdentity: values['signing-identity'], teamId: values['team-id']}), null, 2));
}
