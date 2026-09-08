#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {inspectCompatibility} from '../../lib/prepare-mod.mjs';
import {entryFor} from '../../lib/asar.mjs';
import {compatibilityFor,selectMods,componentManifests} from './compatibility.mjs';
import {transform} from './build-mod.mjs';
export async function main(args=process.argv.slice(2),{mods}={}) {
  if(args.length && !(args.length===2&&args[0]==='--source'))throw Error('Usage: bun run modex verify [--mods LIST] [--source APP]');
  const selected=selectMods(mods),compatibility=compatibilityFor(selected);
  console.log(`Selected mods: ${selected.join(', ')}`);
  const source=args[1]??'/Applications/ChatGPT.app';
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',source],{stdio:'pipe'});
  const {archive,bundles}=inspectCompatibility(source,compatibility);
  const originals=Object.fromEntries([...bundles].map(([name,bytes])=>[name,bytes.toString()]));
  const first=await transform(originals,selected),second=await transform(originals,selected);
  if(JSON.stringify(first)!==JSON.stringify(second))throw Error('Nondeterministic mod transformation');
  const parser=new Bun.Transpiler({loader:'js'});
  for(const [name,content]of Object.entries(first)) {
    parser.transformSync(content);
    for(const item of parser.scan(content).imports) {
      if(!item.path.startsWith('.'))continue;
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),item.path));
      if(!Object.hasOwn(first,target)&&!entryFor(archive,target))throw Error(`Missing import ${item.path} in ${name}`);
    }
  }
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'modex-verify-'));
  try {
    for(const [name,bytes]of bundles) {
      const target=path.join(temporary,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
    }
    const env={...process.env};
    // Only fixtures for this verified source/selection may activate integration tests.
    delete env.MODEL_SPREAD_BUNDLES;delete env.THEME_ICON_BUNDLES;delete env.COMBINED_BUNDLES;
    if(selected.includes('model-spread')) {
      const spread=path.join(temporary,'model-spread');fs.mkdirSync(spread);
      for(const name of Object.keys(componentManifests['model-spread'].files))fs.writeFileSync(path.join(spread,name),bundles.get(`webview/assets/${name}`));
      env.MODEL_SPREAD_BUNDLES=spread;
    }
    if(selected.includes('theme-icon'))env.THEME_ICON_BUNDLES=temporary;
    if(selected.length===2)env.COMBINED_BUNDLES=temporary;
    const suites=['lib','modex.test.mjs','mods/combined',...selected.map(id=>`mods/${id}`)];
    const result=spawnSync(process.execPath,['test',...suites],{cwd:path.resolve(import.meta.dirname,'../..'),env,stdio:'inherit'});
    if(result.error)throw result.error;if(result.status!==0)throw Error('Mod verification tests failed');
  }finally {fs.rmSync(temporary,{recursive:true,force:true});}
  console.log(JSON.stringify({verified:true,mods:selected,version:compatibility.version,build:compatibility.build,deterministic:true,syntaxAndImports:true,overlayFiles:Object.keys(first).length,tests:'passed with selected stock bundle suites',launched:false},null,2));
}
if(import.meta.main)main().catch(error=>{console.error(error.stderr?.toString()||error.message);process.exitCode=1;});
