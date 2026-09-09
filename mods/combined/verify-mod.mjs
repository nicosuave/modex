#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {inspectCompatibility} from '../../lib/prepare-mod.mjs';
import {entryFor} from '../../lib/asar.mjs';
import {compatibilityFor,selectMods,componentManifests} from './compatibility.mjs';
import {transform} from './build-mod.mjs';
import {verifyRepair,repairOverlay} from '../app-tools-auth/patch.mjs';
export async function main(args=process.argv.slice(2),{mods}={}) {
  const options={};
  for(let i=0;i<args.length;i+=2) {
    if(!['--source','--dev-root'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||Object.hasOwn(options,args[i]))throw Error('Usage: bun run modex verify [--mods LIST] [--source APP] [--dev-root DIRECTORY]');
    options[args[i]]=args[i+1];
  }
  const selected=selectMods(mods),compatibility=compatibilityFor(selected);
  console.log(`Selected mods: ${selected.join(', ')}`);
  const source=options['--source']??'/Applications/ChatGPT.app';
  verifyRepair(source);
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',source],{stdio:'pipe'});
  const {archive,bundles}=inspectCompatibility(source,compatibility);
  const originals=Object.fromEntries([...bundles].map(([name,bytes])=>[name,bytes.toString()]));
  const build=async()=>{
    const output=await transform(originals,selected);
    if(!options['--dev-root'])return output;
    const replacements=new Map(Object.entries(output).map(([name,content])=>[name,Buffer.from(content)]));
    repairOverlay(source,replacements);
    const {applyDevelopment,readDevelopmentProtocol}=await import('../development/patch.mjs');
    await applyDevelopment(replacements,options['--dev-root'],selected,readDevelopmentProtocol(source));
    return Object.fromEntries([...replacements].map(([name,bytes])=>[name,bytes.toString()]));
  };
  const first=await build(),second=await build();
  if(JSON.stringify(first)!==JSON.stringify(second))throw Error('Nondeterministic mod transformation');
  const virtual={};
  if(options['--dev-root']) {
    const {inspectDevelopmentForBuild}=await import('../development/patch.mjs');
    const {rendererSource}=await import('../development/main.mjs');
    const {rendererModules}=await import('../development/contract.mjs');
    const {readModule}=await import('../development/validation.mjs');
    const manifest=inspectDevelopmentForBuild(options['--dev-root'],selected,source);
    for(const id of Object.keys(rendererModules))if(manifest.modules[id]) {
      virtual[`webview/assets/modex-development-${id}.mjs`]=rendererSource(id,readModule(options['--dev-root'],manifest,id));
    }
  }
  const parser=new Bun.Transpiler({loader:'js'});
  for(const [name,content]of Object.entries({...first,...virtual})) {
    parser.transformSync(content);
    for(const item of parser.scan(content).imports) {
      if(!item.path.startsWith('.'))continue;
      // This verified stock Sentry helper catches failed resolution and uses its
      // alternative preload path. It is not an import introduced by the mod.
      if(name==='.vite/build/window-all-closed-KNH8jchn.js'&&item.kind==='require-resolve'&&item.path==='../../preload/default.js')continue;
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),item.path));
      if(!Object.hasOwn(first,target)&&!Object.hasOwn(virtual,target)&&!entryFor(archive,target))throw Error(`Missing import ${item.path} in ${name}`);
    }
  }
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'modex-verify-'));
  try {
    for(const [name,bytes]of bundles) {
      const target=path.join(temporary,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
    }
    const env={...process.env,APP_TOOLS_AUTH_SOURCE:source};
    // Only fixtures for this verified source/selection may activate integration tests.
    delete env.MODEL_SPREAD_BUNDLES;delete env.THEME_ICON_BUNDLES;delete env.COMBINED_BUNDLES;delete env.TASK_PANES_BUNDLES;delete env.CUSTOM_CLI_BUNDLES;delete env.CUSTOM_CLI_EXECUTABLE;
    if(selected.includes('model-spread')) {
      const spread=path.join(temporary,'model-spread');fs.mkdirSync(spread);
      for(const name of Object.keys(componentManifests['model-spread'].files))fs.writeFileSync(path.join(spread,name),bundles.get(`webview/assets/${name}`));
      env.MODEL_SPREAD_BUNDLES=spread;
    }
    if(selected.includes('theme-icon'))env.THEME_ICON_BUNDLES=temporary;
    if(selected.includes('model-spread')&&selected.includes('theme-icon'))env.COMBINED_BUNDLES=temporary;
    if(selected.includes('task-panes'))env.TASK_PANES_BUNDLES=temporary;
    if(selected.includes('custom-cli')){env.CUSTOM_CLI_BUNDLES=temporary;env.CUSTOM_CLI_EXECUTABLE=path.resolve(source,'Contents/Resources/codex');}
    const suites=['lib','modex.test.mjs','mods/combined','mods/app-tools-auth','mods/development',...selected.map(id=>`mods/${id}`)];
    const result=spawnSync(process.execPath,['test',...suites],{cwd:path.resolve(import.meta.dirname,'../..'),env,stdio:'inherit'});
    if(result.error)throw result.error;if(result.status!==0)throw Error('Mod verification tests failed');
  }finally {fs.rmSync(temporary,{recursive:true,force:true});}
  console.log(JSON.stringify({verified:true,mods:selected,version:compatibility.version,build:compatibility.build,deterministic:true,syntaxAndImports:true,overlayFiles:Object.keys(first).length,tests:'passed with selected stock bundle suites',launched:false},null,2));
}
if(import.meta.main)main().catch(error=>{console.error(error.stderr?.toString()||error.message);process.exitCode=1;});
