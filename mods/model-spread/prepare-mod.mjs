#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {signingIdentity,validateAppIdentity} from '../../lib/sign-app.mjs';
import {readArchive,readEntry} from '../../lib/asar.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const mod=JSON.parse(fs.readFileSync(path.join(here,'mod.json'),'utf8'));
export const HELP=`Usage: bun prepare-mod.mjs --output /absolute/path/Modex.app [options]

  --source /Applications/ChatGPT.app   Original app (default shown)
  --output /absolute/path/Name.app    Required NEW second copy outside Applications
  --backup /absolute/path/file.zip   Reuse only after full ZIP CRC and source ASAR/
                                    Info.plist fingerprint verification; create if absent
  --check                           Read-only compatibility and existing-backup checks
  --help                            Show this help

One command: verify the stock app and exact supported bundle hashes, create and
verify a full original-app ZIP, extract the five required bundles to temporary
scratch space, build the overlay, and package/sign a NEW second app copy.
The signed app launches directly from the Dock; no separate launcher is created.
The default backup is beside --output, named Original-<version>-<build>.zip.
An existing default backup requires an explicit --backup path to reuse it.

Never overwrites a second copy or backup, modifies the original app, copies your
profile/authentication data, launches an app, or changes Electron fuses. Unknown
app updates stop before creating a backup or output; the compatibility manifest
and bundle transformations must be reviewed for each new app version.

The second copy uses your installed Developer ID Application certificate and a stable
local.codex.model-spread identity. It is not vendor-signed or notarized. Vendor keychain,
app-group and push identity entitlements are removed by package-app.mjs; existing
authentication and macOS permissions are not guaranteed. This command does not
switch your running app. Review the packaged result before choosing to launch it.
`;

export function parseArgs(args) {
  const options={source:'/Applications/ChatGPT.app'};
  for(let index=0;index<args.length;index++) {
    const flag=args[index];
    if(['--help','--check'].includes(flag)) options[flag.slice(2)]=true;
    else if(['--source','--output','--backup'].includes(flag)&&args[index+1]&&!args[index+1].startsWith('--')) {
      const key=flag.slice(2);
      if(Object.hasOwn(options,key)&&key!=='source')throw Error(`Repeated ${flag}`);
      options[key]=args[++index];
    } else throw Error(`Unknown or incomplete argument: ${flag}`);
  }
  return options;
}
function contained(parent,child) {
  const relative=path.relative(parent,child);
  return relative==='' || relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);
}
function realTarget(filename) {
  if(fs.existsSync(filename))return fs.realpathSync(filename);
  return path.join(realTarget(path.dirname(filename)),path.basename(filename));
}
function command(executable,args) {
  return execFileSync(executable,args,{encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
}
async function run(executable,args,{hash=false,inherit=false}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{stdio:['ignore',inherit?'inherit':'pipe','pipe']});
    const digest=hash?crypto.createHash('sha256'):null;
    let error='',output='';
    child.stdout?.on('data',data=>{if(digest)digest.update(data);else if(output.length<32768)output+=data.toString();});
    child.stderr.on('data',data=>{if(error.length<32768)error+=data.toString();});
    child.on('error',reject);
    child.on('close',code=>{if(code===0)resolve(digest?digest.digest('hex'):output);else reject(Error(`${path.basename(executable)} exited ${code}: ${error||output}`));});
  });
}
export async function hashFile(filename) {
  const digest=crypto.createHash('sha256');
  for await(const bytes of fs.createReadStream(filename))digest.update(bytes);
  return digest.digest('hex');
}
export function inspectCompatibility(source,manifest) {
  const archive=readArchive(path.join(source,'Contents/Resources/app.asar'));
  const info=JSON.parse(command('/usr/bin/plutil',['-convert','json','-o','-',path.join(source,'Contents/Info.plist')]));
  if(info.CFBundleShortVersionString!==manifest.version||info.CFBundleVersion!==manifest.build)throw Error(`Unsupported app ${info.CFBundleShortVersionString} (${info.CFBundleVersion}); supported ${manifest.version} (${manifest.build}). Original app unchanged.`);
  if(info.ElectronAsarIntegrity?.['Resources/app.asar']?.hash!==archive.headerHash)throw Error('Source ASAR header does not match Info.plist integrity');
  const bundles=new Map();
  for(const [name,expected]of Object.entries(manifest.files)) {
    if(path.basename(name)!==name||!name.endsWith('.js'))throw Error(`Invalid compatibility filename: ${name}`);
    const bytes=readEntry(archive,`webview/assets/${name}`);
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw Error(`Unsupported bundle ${name}; original app unchanged`);
    bundles.set(name,bytes);
  }
  return {info,archive,bundles};
}
export async function verifyBackup(backup,source) {
  if(!fs.statSync(backup).isFile())throw Error('Backup must be a regular ZIP file');
  // CRC checks the entire ZIP, including the executable/framework payloads.
  await run('/usr/bin/unzip',['-tq',backup]);
  const entries=command('/usr/bin/unzip',['-Z1',backup]).split('\n').filter(Boolean);
  const archives=entries.filter(name=>/^[^/]+\.app\/Contents\/Resources\/app\.asar$/.test(name));
  if(archives.length!==1)throw Error('Backup must contain exactly one top-level app ASAR');
  const root=archives[0].split('/')[0];
  if(/[\[*?]/.test(root))throw Error('Backup app name contains unsupported ZIP pattern characters');
  const infoEntry=`${root}/Contents/Info.plist`;
  if(entries.filter(name=>name===infoEntry).length!==1)throw Error('Backup has missing or duplicate app Info.plist');
  const [sourceAsarHash,backupAsarHash,sourceInfoHash,backupInfoHash]=await Promise.all([
    hashFile(path.join(source,'Contents/Resources/app.asar')),
    run('/usr/bin/unzip',['-p',backup,archives[0]],{hash:true}),
    hashFile(path.join(source,'Contents/Info.plist')),
    run('/usr/bin/unzip',['-p',backup,infoEntry],{hash:true}),
  ]);
  if(sourceAsarHash!==backupAsarHash||sourceInfoHash!==backupInfoHash)throw Error('Existing backup fingerprints do not match this source app; choose a new --backup path');
  return {zipCRCVerified:true,sourceAsarHash,sourceInfoHash,backupAppRoot:root};
}

export async function main(args=process.argv.slice(2)) {
  const options=parseArgs(args);
  if(options.help)return console.log(HELP);
  if(!process.versions.bun)throw Error('Run this helper with Bun: bun prepare-mod.mjs --output /absolute/path/Name.app');
  if(process.platform!=='darwin')throw Error('Preparing the signed app copy requires macOS');
  if(!options.output||!path.isAbsolute(options.output)||!options.output.endsWith('.app'))throw Error('--output must be a NEW absolute .app path');
  const source=fs.realpathSync(options.source),output=realTarget(options.output);
  if(fs.existsSync(output))throw Error(`Output already exists: ${output}`);
  if(contained(source,output)||contained(output,source))throw Error('Output must be separate from the original app');
  if(contained('/Applications',output)||contained(path.join(os.homedir(),'Applications'),output))throw Error('Output must be outside Applications');
  validateAppIdentity(mod.appName,mod.bundleId);
  const signer=signingIdentity();
  const manifest=JSON.parse(fs.readFileSync(path.join(here,'compatibility.json'),'utf8'));
  const {info,archive,bundles}=inspectCompatibility(source,manifest);
  command('/usr/bin/codesign',['--verify','--deep','--strict',source]);
  const backupArgument=options.backup??path.join(path.dirname(output),`Original-${info.CFBundleShortVersionString}-${info.CFBundleVersion}.zip`);
  if(!path.isAbsolute(backupArgument)||!backupArgument.endsWith('.zip'))throw Error('--backup must be an absolute .zip path');
  const backup=realTarget(backupArgument);
  if(contained(source,backup)||contained(output,backup))throw Error('Backup must be outside the original and second app');
  if(fs.existsSync(backup)&&!options.backup)throw Error(`Default backup already exists; explicitly pass --backup ${backup} to validate and reuse it`);
  let evidence=null;
  if(fs.existsSync(backup)) {
    console.log('Verifying existing backup ZIP and source fingerprints…');
    evidence=await verifyBackup(backup,source);
  }
  if(options.check) {
    console.log(JSON.stringify({checkOnly:true,source,output,signer:signer.name,backup,version:info.CFBundleShortVersionString,build:info.CFBundleVersion,sourceHeaderHash:archive.headerHash,compatibleBundles:bundles.size,backupExists:!!evidence,wouldCreateBackup:!evidence,...evidence,launched:false},null,2));
    return;
  }
  if(!evidence) {
    fs.mkdirSync(path.dirname(backup),{recursive:true});
    const directory=fs.mkdtempSync(path.join(path.dirname(backup),'.model-spread-backup-'));
    try {
      const temporary=path.join(directory,'original.zip');
      console.log('Creating full original-app ZIP backup…');
      await run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',source,temporary]);
      evidence=await verifyBackup(temporary,source);
      // Publishing with a hard link fails if a backup appeared concurrently.
      fs.linkSync(temporary,backup);
    } finally {fs.rmSync(directory,{recursive:true,force:true});}
  }
  console.log('Backup verified. Building and signing the separate app copy…');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'model-spread-prepare-'));
  try {
    const input=path.join(temporary,'bundles'),overlay=path.join(temporary,'overlay/webview/assets');
    fs.mkdirSync(input);
    for(const [name,bytes]of bundles)fs.writeFileSync(path.join(input,name),bytes);
    await run(process.execPath,[path.join(here,'build-mod.mjs'),input,overlay],{inherit:true});
    if(await hashFile(path.join(source,'Contents/Resources/app.asar'))!==evidence.sourceAsarHash)throw Error('Original app changed during preparation; rerun against its new version');
    await run(process.execPath,[path.join(here,'../../lib/package-app.mjs'),'--source',source,'--overlay',path.join(temporary,'overlay'),'--output',output,'--app-name',mod.appName,'--bundle-id',mod.bundleId],{inherit:true});
    if(await hashFile(path.join(source,'Contents/Resources/app.asar'))!==evidence.sourceAsarHash)throw Error('Original app changed during packaging; staged copy needs review');

    console.log(JSON.stringify({source,output,signer:signer.name,backup,...evidence,secondCopyCreated:true,originalModified:false,launched:false},null,2));
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error.stderr?.toString()||error.message);process.exitCode=1;});
}
