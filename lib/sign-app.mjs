#!/usr/bin/env bun
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
function command(executable,args) {return execFileSync(executable,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
export function signingIdentity(requested=process.env.CODEX_MODS_SIGN_IDENTITY??process.env.MODEL_SPREAD_SIGN_IDENTITY) {
  const available=command('/usr/bin/security',['find-identity','-v','-p','codesigning']);
  const identities=[...available.matchAll(/\b([A-F0-9]{40}) "(Developer ID Application: [^"]+)"/g)].map(([,hash,name])=>({hash,name}));
  const matches=requested?identities.filter(x=>x.name===requested||x.hash===requested):identities;
  if(matches.length!==1)throw Error('Select exactly one installed Developer ID Application certificate with CODEX_MODS_SIGN_IDENTITY; ad-hoc signing is not allowed');
  return matches[0];
}
export function designatedRequirement(app) {
  const result=spawnSync('/usr/bin/codesign',['-d','-r-',app],{encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr||'Cannot read designated requirement');
  const text=result.stdout+'\n'+result.stderr;
  const requirement=text.match(/designated => ([^\n]+)/)?.[1];
  if(!requirement||requirement.includes('cdhash')||!requirement.includes('anchor apple generic'))throw Error('App lacks a stable certificate-based designated requirement');
  return requirement;
}
export function validateAppIdentity(appName,bundleID) {
  if(typeof appName!=='string'||!appName.trim()||appName!==appName.trim()||/[\x00-\x1f/]/.test(appName))throw Error('A nonempty app name without path separators is required');
  if(typeof bundleID!=='string'||!/^local\.codex\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(bundleID))throw Error('Use a unique stable bundle ID under local.codex, separate from the stock app');
}
export function signApp(app,{appName,bundleID,identity,home=os.homedir(),original='/Applications/ChatGPT.app'}={}) {
  validateAppIdentity(appName,bundleID);
  const target=fs.realpathSync(app);
  if(target===fs.realpathSync(original))throw Error('Refusing to modify the original app');
  const signer=signingIdentity(identity);
  const plist=path.join(target,'Contents/Info.plist');
  const info=JSON.parse(command('/usr/bin/plutil',['-convert','json','-o','-',plist]));
  if(info.CFBundleIdentifier!=='com.openai.codex'&&info.CFBundleIdentifier!==bundleID)throw Error('Expected a staged stock Codex app or the same mod identity');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'codex-mod-sign-'));
  try {
    const entitlements=path.join(temporary,'entitlements.plist');
    const xml=command('/usr/bin/codesign',['-d','--entitlements',':-',target]);
    if(!xml.includes('<plist'))throw Error('App entitlements missing');
    fs.writeFileSync(entitlements,xml.slice(xml.indexOf('<?xml')>=0?xml.indexOf('<?xml'):xml.indexOf('<plist')));
    const values=JSON.parse(command('/usr/bin/plutil',['-convert','json','-o','-',entitlements]));
    const removedEntitlements=[];
    for(const key of Object.keys(values))if(key==='keychain-access-groups'||key==='com.apple.security.application-groups'||key==='com.apple.application-identifier'||key.startsWith('com.apple.developer.')){removedEntitlements.push(key);delete values[key];}
    // Vendor-signed nested frameworks remain intact and require cross-team loading.
    values['com.apple.security.cs.disable-library-validation']=true;
    fs.writeFileSync(entitlements,JSON.stringify(values));
    command('/usr/bin/plutil',['-convert','xml1',entitlements]);
    command('/usr/bin/plutil',['-replace','CFBundleIdentifier','-string',bundleID,plist]);
    command('/usr/bin/plutil',['-replace','CFBundleName','-string',appName,plist]);
    command('/usr/bin/plutil',['-replace','CFBundleDisplayName','-string',appName,plist]);
    command('/usr/bin/plutil',['-replace','LSEnvironment','-json',JSON.stringify({...info.LSEnvironment,CODEX_HOME:path.join(home,'.codex'),CODEX_ELECTRON_USER_DATA_PATH:path.join(home,'Library/Application Support/Codex')}),plist]);
    command('/usr/bin/codesign',['--force','--sign',signer.hash,'--options','runtime','--entitlements',entitlements,target]);
    command('/usr/bin/codesign',['--verify','--deep','--strict',target]);
    const requirement=designatedRequirement(target);
    if(!requirement.includes(`identifier "${bundleID}"`))throw Error('Unexpected signed app identity');
    return {app:target,identity:signer.name,bundleID,requirement,removedEntitlements,addedEntitlements:['com.apple.security.cs.disable-library-validation']};
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
if(import.meta.main){try{const [app,appName,bundleID]=process.argv.slice(2);if(!app)throw Error('Usage: bun lib/sign-app.mjs /path/to/staged/Mod.app "Mod Name" local.codex.mod-name');console.log(JSON.stringify(signApp(app,{appName,bundleID}),null,2));}catch(error){console.error(error.stderr?.toString()||error.message);process.exitCode=1;}}
