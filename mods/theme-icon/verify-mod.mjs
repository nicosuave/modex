#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {inspectCompatibility} from '../../lib/prepare-mod.mjs';
import {entryFor} from '../../lib/asar.mjs';
import {transform} from './build-mod.mjs';
import {verifyRepair} from '../app-tools-auth/patch.mjs';
const args=process.argv.slice(2);
try {
  if(args.length && !(args.length===2&&args[0]==='--source'))throw new Error('Usage: bun verify-mod.mjs [--source APP]');
  const source=args[1]??'/Applications/ChatGPT.app';
  verifyRepair(source);
  const manifest=JSON.parse(fs.readFileSync(new URL('./compatibility.json',import.meta.url),'utf8'));
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',source],{stdio:'pipe'});
  const {archive,bundles}=inspectCompatibility(source,manifest);
  const originals=Object.fromEntries([...bundles].map(([name,bytes])=>[name,bytes.toString()]));
  const first=await transform(originals),second=await transform(originals);
  if(JSON.stringify(first)!==JSON.stringify(second))throw new Error('Nondeterministic transformation');
  const parser=new Bun.Transpiler({loader:'js'});
  for(const [name,source]of Object.entries(first)) {
    parser.transformSync(source);
    for(const item of parser.scan(source).imports) {
      if(!item.path.startsWith('.'))continue;
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(name),item.path));
      if(!Object.hasOwn(first,target)&&!entryFor(archive,target))throw new Error(`Missing import ${item.path} in ${name}`);
    }
  }
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'theme-icon-verify-'));
  try {
    for(const[name,bytes]of bundles){const target=path.join(temporary,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
    const result=spawnSync(process.execPath,['test','mods/theme-icon','mods/app-tools-auth','lib/prepare-mod.test.mjs','mods/model-spread/prepare-mod.test.mjs'],{
      cwd:path.resolve(import.meta.dirname,'../..'),env:{...process.env,THEME_ICON_BUNDLES:temporary,APP_TOOLS_AUTH_SOURCE:source},stdio:'inherit',
    });
    if(result.error)throw result.error;if(result.status!==0)throw new Error('Theme Icon tests failed');
  }finally {fs.rmSync(temporary,{recursive:true,force:true});}
  console.log(JSON.stringify({verified:true,version:manifest.version,build:manifest.build,deterministic:true,syntaxAndImports:true,overlayFiles:Object.keys(first).length,launched:false},null,2));
}catch(error){console.error(error.stderr?.toString()||error.message);process.exitCode=1;}
