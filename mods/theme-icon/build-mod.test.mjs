import {test} from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {transform,replaceOnce} from './build-mod.mjs';

test('unknown or duplicated patch locations fail closed',()=>{
  assert.throws(()=>replaceOnce('none','needle','replacement'));
  assert.throws(()=>replaceOnce('needle needle','needle','replacement'));
  assert.equal(replaceOnce('x needle y','needle','replacement'),'x replacement y');
});
test.skipIf(!process.env.THEME_ICON_BUNDLES)('stock bundles transform deterministically and reject replay',async()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('./compatibility.json',import.meta.url)));
  const original=Object.fromEntries(Object.keys(manifest.files).map(name=>[name,fs.readFileSync(path.join(process.env.THEME_ICON_BUNDLES,name),'utf8')]));
  const patched=await transform(original);
  assert.deepEqual(patched,await transform(original));
  await assert.rejects(()=>transform(Object.fromEntries(Object.keys(original).map(name=>[name,patched[name]]))));
  const main=patched['.vite/build/theme-icon-main.cjs'];
  assert.ok(main.length>1000);
  // CJS must actually load without renderer globals or native Electron imports.
  const module={exports:{}};
  new Function('module','exports','require',main)(module,module.exports,require);
  assert.equal(typeof module.exports.configure,'function');
  assert.equal(typeof module.exports.apply,'function');
  assert.equal(module.exports.update({appearance:'invalid'}),false);
});
