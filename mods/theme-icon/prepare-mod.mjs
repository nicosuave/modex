#!/usr/bin/env bun
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareMain} from '../../lib/prepare-mod.mjs';
export {hashFile,parseArgs,inspectCompatibility,verifyBackup} from '../../lib/prepare-mod.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export const HELP=`Usage: bun prepare-mod.mjs --output /absolute/path/Modex.app [options]

  --source /Applications/ChatGPT.app   Original app (default shown)
  --output /absolute/path/Name.app    Required NEW second copy outside Applications
  --backup /absolute/path/file.zip   Reuse only after full ZIP CRC and source ASAR/
                                    Info.plist fingerprint verification; create if absent
  --check                           Read-only compatibility and existing-backup checks
  --help                            Show this help

One command: verify the stock app and exact supported bundle hashes, create and
verify a full original-app ZIP, extract the required bundles to temporary
scratch space, build the overlay, and package/sign a NEW second app copy.
The signed app launches directly from the Dock; no separate launcher is created.
The default backup is beside --output, named Original-<version>-<build>.zip.
An existing default backup requires an explicit --backup path to reuse it.

Never overwrites a second copy or backup, modifies the original app, copies your
profile/authentication data, launches an app, or changes Electron fuses. Unknown
app updates stop before creating a backup or output; the compatibility manifest
and bundle transformations must be reviewed for each new app version.

The second copy uses your installed Developer ID Application certificate and a stable
local.codex.theme-icon identity. It is not vendor-signed or notarized. Vendor keychain,
app-group and push identity entitlements are removed by package-app.mjs; existing
authentication and macOS permissions are not guaranteed. This command does not
switch your running app. Review the packaged result before choosing to launch it.
`;

export function main(args=process.argv.slice(2)) {
  return prepareMain(args,{modDirectory:here,overlayAtRoot:true,help:HELP});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.stderr?.toString()||error.message);process.exitCode=1;});
}
