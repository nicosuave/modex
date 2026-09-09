import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

function validateIdentity({teamId, bundleId}) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? '')) throw new Error('A fixed 10-character signing teamId is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(bundleId ?? '')) throw new Error('A fixed bundleId is required');
}

export function inspectNativePrerequisites() {
  if (process.platform !== 'darwin') throw new Error('App Tools native authorization requires macOS');
  if (!['arm64', 'x64'].includes(process.arch)) throw new Error(`Unsupported native architecture: ${process.arch}`);
  const compiler = execFileSync('/usr/bin/xcrun', ['--find', 'clang++'], {encoding: 'utf8'}).trim();
  const sdk = execFileSync('/usr/bin/xcrun', ['--show-sdk-path'], {encoding: 'utf8'}).trim();
  const include = ['/opt/homebrew/include/node', '/usr/local/include/node']
    .find(directory => fs.existsSync(path.join(directory, 'node_api.h')));
  if (!include) throw new Error('Node-API development headers are required in /opt/homebrew/include/node or /usr/local/include/node');
  return {compiler, sdk, include, architecture: process.arch};
}

export const checkNativeBuild = inspectNativePrerequisites;

// The host identity is compiled into the addon. Runtime environment variables and
// callers cannot expand it; packaging signs this output with the retained identity.
export function buildNative({output, teamId, bundleId}) {
  validateIdentity({teamId, bundleId});
  if (!path.isAbsolute(output ?? '')) throw new Error('Native output must be an absolute path');
  if (fs.existsSync(output)) throw new Error(`Native output already exists: ${output}`);
  const prerequisites = inspectNativePrerequisites();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-app-tools-native-'));
  try {
    const binary = path.join(scratch, 'app-tools-auth.node');
    execFileSync(prerequisites.compiler, [
      '-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', '-fvisibility=hidden',
      '-shared', '-undefined', 'dynamic_lookup', '-isysroot', prerequisites.sdk,
      '-arch', prerequisites.architecture === 'x64' ? 'x86_64' : 'arm64',
      '-I', prerequisites.include, '-DNAPI_VERSION=8',
      `-DMODEX_HOST_TEAM_ID=${JSON.stringify(teamId)}`,
      `-DMODEX_HOST_BUNDLE_ID=${JSON.stringify(bundleId)}`,
      path.join(import.meta.dirname, 'native/authorizer.cc'),
      '-framework', 'Foundation', '-framework', 'Security', '-lbsm', '-o', binary,
    ], {stdio: 'pipe'});
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.copyFileSync(binary, output, fs.constants.COPYFILE_EXCL);
    return {output, teamId, bundleId, architecture: prerequisites.architecture};
  } finally {
    fs.rmSync(scratch, {recursive: true, force: true});
  }
}
