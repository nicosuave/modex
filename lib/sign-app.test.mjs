import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {signApp,signingIdentity,designatedRequirement,validateAppIdentity} from './sign-app.mjs';
const appName='Example Mod',bundleID='local.codex.example-mod';
function command(args) {return execFileSync('/usr/bin/plutil',args,{encoding:'utf8'});}
function fixture(root,name,version) {
 const app=path.join(root,name);
 fs.mkdirSync(path.join(app,'Contents/MacOS'),{recursive:true});
 fs.mkdirSync(path.join(app,'Contents/Resources'));
 fs.copyFileSync('/usr/bin/true',path.join(app,'Contents/MacOS/ChatGPT'));
 fs.writeFileSync(path.join(app,'Contents/Resources/icon.icns'),'fixture-icon-'+version);
 fs.writeFileSync(path.join(app,'Contents/Info.plist'),JSON.stringify({CFBundleIdentifier:'com.openai.codex',CFBundleName:'ChatGPT',CFBundleExecutable:'ChatGPT',CFBundlePackageType:'APPL',CFBundleVersion:String(version),CFBundleIconFile:'icon.icns',LSEnvironment:{MallocNanoZone:'0'}}));
 command(['-convert','xml1',path.join(app,'Contents/Info.plist')]);
 const ent=path.join(root,'ent.plist');fs.writeFileSync(ent,JSON.stringify({'com.apple.security.cs.allow-jit':true}));command(['-convert','xml1',ent]);
 execFileSync('/usr/bin/codesign',['--force','--sign','-','--entitlements',ent,app],{stdio:'pipe'});
 return app;
}
test('different app builds retain the same certificate requirement, normal profile and native icon',{skip:!(process.env.CODEX_MODS_SIGN_IDENTITY??process.env.MODEL_SPREAD_SIGN_IDENTITY),timeout:60000},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'single-app-sign-'));
 try {
  const first=fixture(root,'First.app',1),second=fixture(root,'Second.app',2),home=path.join(root,"User's home");
  const source=fixture(root,'Original.app',1),originalInfo=fs.readFileSync(path.join(source,'Contents/Info.plist'));
  const one=signApp(first,{home,original:source,appName,bundleID}),two=signApp(second,{home,original:source,appName,bundleID});
  assert.equal(one.requirement,two.requirement);
  assert.equal(designatedRequirement(first),designatedRequirement(second));
  assert.ok(!one.requirement.includes('cdhash'));
  const cdhash=app=>{const r=spawnSync('/usr/bin/codesign',['-d','--verbose=4',app],{encoding:'utf8'});assert.equal(r.status,0);return (r.stdout+r.stderr).match(/\nCDHash=([^\n]+)/)?.[1];};
  assert.ok(cdhash(first));assert.notEqual(cdhash(first),cdhash(second));
  for(const app of [first,second]) {
   const info=JSON.parse(command(['-convert','json','-o','-',path.join(app,'Contents/Info.plist')]));
   assert.equal(info.CFBundleIdentifier,bundleID);
   assert.equal(info.CFBundleName,appName);
   assert.equal(info.CFBundleDisplayName,appName);
   assert.equal(info.CFBundleExecutable,'ChatGPT');
   assert.equal(info.CFBundleIconFile,'icon.icns');
   assert.equal(info.LSEnvironment.MallocNanoZone,'0');
   assert.equal(info.LSEnvironment.CODEX_HOME,path.join(home,'.codex'));
   assert.equal(info.LSEnvironment.CODEX_ELECTRON_USER_DATA_PATH,path.join(home,'Library/Application Support/Codex'));
   execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app]);
  }
  assert.throws(()=>signApp(source,{original:source,appName,bundleID}),/original/);
  assert.deepEqual(fs.readFileSync(path.join(source,'Contents/Info.plist')),originalInfo);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown or ad-hoc signing identities fail without fallback',{skip:process.platform!=='darwin'},()=>{
 assert.throws(()=>signingIdentity('-'),/ad-hoc signing is not allowed/);
 assert.throws(()=>signingIdentity('missing certificate'),/Select exactly one/);
});

test('mods require their own explicit stable app identity',()=>{
 assert.doesNotThrow(()=>validateAppIdentity('Another Mod','local.codex.another-mod'));
 for(const [name,id]of [['',bundleID],['bad/name',bundleID],[appName,'com.openai.codex'],[appName,undefined]])assert.throws(()=>validateAppIdentity(name,id));
});
