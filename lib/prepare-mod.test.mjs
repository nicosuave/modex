import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {compatibilityEntryPath,compatibilityResourcePath,inspectCompatibility} from './prepare-mod.mjs';

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(fn) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'modex-compatibility-test-'));
  try {
    const source=path.join(directory,'Test.app'),resources=path.join(source,'Contents/Resources');
    fs.mkdirSync(resources,{recursive:true});
    const bundle=Buffer.from('export const fixture=true;');
    const header={files:{webview:{files:{assets:{files:{'app.js':{size:bundle.length,offset:'0'}}}}},'.vite':{files:{build:{files:{'main.js':{size:bundle.length,offset:'0'}}}}}}};
    const json=Buffer.from(JSON.stringify(header));
    const payloadSize=Math.ceil((json.length+4)/4)*4;
    const prefix=Buffer.alloc(16);
    prefix.writeUInt32LE(4,0);
    prefix.writeUInt32LE(payloadSize+4,4);
    prefix.writeUInt32LE(payloadSize,8);
    prefix.writeUInt32LE(json.length,12);
    fs.writeFileSync(path.join(resources,'app.asar'),Buffer.concat([prefix,json,Buffer.alloc(payloadSize-4-json.length),bundle]));
    fs.writeFileSync(path.join(source,'Contents/Info.plist'),JSON.stringify({CFBundleShortVersionString:'1',CFBundleVersion:'2',ElectronAsarIntegrity:{'Resources/app.asar':{hash:digest(json)}}}));
    const icon=Buffer.from([137,80,78,71,1,2,3]);
    fs.writeFileSync(path.join(resources,'icon.png'),icon);
    const manifest={version:'1',build:'2',files:{'app.js':digest(bundle),'.vite/build/main.js':digest(bundle)},resources:{'icon.png':digest(icon)}};
    fn({source,resources,manifest,directory,bundle});
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
}

test('compatibility paths preserve nested paths, map legacy bundles, and accept non-JS resources',()=>{
  assert.equal(compatibilityEntryPath('app.js'),'webview/assets/app.js');
  assert.equal(compatibilityEntryPath('.vite/build/main.js'),'.vite/build/main.js');
  assert.equal(compatibilityEntryPath('webview/assets/app.js'),'webview/assets/app.js');
  assert.equal(compatibilityResourcePath('icons/icon.png'),'icons/icon.png');
  assert.throws(()=>compatibilityEntryPath('icon.png'),/Invalid compatibility/);
  for(const name of ['', '../app.js','/app.js','a/../app.js','a//app.js','a/./app.js','a\\app.js','a\0.js']) {
    assert.throws(()=>compatibilityEntryPath(name),/Invalid compatibility/);
    assert.throws(()=>compatibilityResourcePath(name),/Invalid compatibility/);
  }
});

test('compatibility validates exact resources and preserves manifest bundle keys',()=>fixture(({source,manifest,bundle})=>{
  const {bundles}=inspectCompatibility(source,manifest);
  assert.deepEqual([...bundles.keys()],['app.js','.vite/build/main.js']);
  assert.deepEqual(bundles.get('.vite/build/main.js'),bundle);
  const legacy={...manifest};
  delete legacy.resources;
  assert.equal(inspectCompatibility(source,legacy).bundles.size,2);
}));

test('changed resource bytes fail compatibility without modifying them',()=>fixture(({source,resources,manifest})=>{
  const filename=path.join(resources,'icon.png');
  fs.writeFileSync(filename,'changed icon');
  assert.throws(()=>inspectCompatibility(source,manifest),/Unsupported resource icon.png/);
  assert.equal(fs.readFileSync(filename,'utf8'),'changed icon');
}));

test('resource traversal and escaping symlinks fail compatibility',()=>fixture(({source,resources,manifest,directory})=>{
  assert.throws(()=>inspectCompatibility(source,{...manifest,resources:{'../Info.plist':'invalid'}}),/Invalid compatibility/);
  const outside=path.join(directory,'outside.png');
  fs.writeFileSync(outside,'external icon');
  fs.symlinkSync(outside,path.join(resources,'linked.png'));
  assert.throws(()=>inspectCompatibility(source,{...manifest,resources:{'linked.png':digest('external icon')}}),/escapes app resources/);
}));
