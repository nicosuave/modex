#!/usr/bin/env bun
import {selectMods,defaultMods} from './mods/combined/compatibility.mjs';
import path from 'node:path';
import os from 'node:os';

export const HELP=`Usage: bun run modex <verify|prepare|status|dev> [options]

  --mods LIST                    Complete selection (default: model-spread,theme-icon)
  --source APP                   Supported stock app (default /Applications/ChatGPT.app)
  --dev-root DIRECTORY           Verify/prepare with explicit external development modules
  --help                         Show help

prepare options:
  --output APP                   Required new absolute staging path outside Applications
  --identity-from APP            Installed app to preserve identity and check enabled mods
  --backup ZIP                   Explicitly verify/reuse an original-app backup
  --check                        Read-only preparation checks

status options:
  --app APP                      Installed app (default ~/Applications/Modex.app)
  --json                         Include full receipt and per-file verification as JSON

dev options:
  --output DIRECTORY             Required absolute dedicated module-output directory
  --mods LIST                    Modules to build (default: model-spread,theme-icon)
  --watch                        Rebuild module output when source changes

Development modules are used only by an app explicitly prepared with --dev-root.
Icon pixel changes reload live; editor/slot changes require a window reload or
restart. Hook changes require packaging again. No app is automatically reloaded.

Explicit --mods selects the complete intended set, including intentional removals.
Available mods: model-spread, theme-icon, task-panes, custom-cli.
Choose any one or combine them with a comma-separated --mods list.
Without it, updates reject dropping any mod recorded in the installed app.
Selected mods are composed in a fixed order. Preparation records the selected set in
the signed app; it never installs, launches, overwrites, or quits an app.
`;
export function parseArgs(args) {
  if(args.length===1&&args[0]==='--help')return {help:true};
  const [command,...rest]=args;
  if(!['verify','prepare','status','dev'].includes(command))throw Error('Expected verify, prepare, status or dev; use --help for usage');
  const result={command,mods:[...defaultMods],explicitSelection:false,args:[],help:false};
  const seen=new Set();
  for(let i=0;i<rest.length;i++) {
    const flag=rest[i];
    if(seen.has(flag))throw Error(`Repeated ${flag}`);
    seen.add(flag);
    if(flag==='--help'){result.help=true;continue;}
    if(flag==='--check'&&command==='prepare'){result.args.push(flag);continue;}
    if((flag==='--json'&&command==='status')||(flag==='--watch'&&command==='dev')){result.args.push(flag);continue;}
    const valueFlags={verify:['--source','--mods','--dev-root'],prepare:['--source','--mods','--output','--backup','--identity-from','--dev-root'],status:['--app'],dev:['--output','--mods']}[command];
    if(!valueFlags.includes(flag)||!rest[i+1]||rest[i+1].startsWith('--'))throw Error(`Unknown or incomplete argument: ${flag}`);
    const value=rest[++i];
    if(flag==='--mods') {
      result.mods=selectMods(value.split(','));result.explicitSelection=true;
    }else result.args.push(flag,value);
  }
  return result;
}
export async function main(args=process.argv.slice(2)) {
  const options=parseArgs(args);
  if(options.help)return console.log(HELP);
  if(options.command==='status') {
    const {readStatus}=await import('./lib/status.mjs');
    const {legacyMarkers}=await import('./mods/combined/compatibility.mjs');
    const appIndex=options.args.indexOf('--app');
    const app=appIndex<0?path.join(os.homedir(),'Applications','Modex.app'):options.args[appIndex+1];
    const status=readStatus(app,{legacyMarkers});
    if(options.args.includes('--json'))console.log(JSON.stringify(status,null,2));
    else {
      const receipt=status.metadata?.receipt;
      console.log(`App: ${status.appPath}\nMods: ${status.mods.join(', ')||'unknown'}\nReceipt: ${status.receiptStatus}`);
      if(receipt) {
        console.log(`Stock: ${receipt.source.version} (${receipt.source.build})\nStock ASAR: ${receipt.source.asarHash}\nModex revision: ${receipt.build.revision??'unavailable'}${receipt.build.dirty?' (uncommitted changes)':''}\nModex source: ${receipt.build.sourceHash}\nRecorded files: ${status.files.length}\nDevelopment: ${receipt.development?.root??'disabled; self-contained build'}`);
        for(const file of status.files.filter(file=>file.status!=='match'))console.log(`${file.status}: ${file.path}`);
        if(status.development) {
          console.log(`External modules on disk: ${status.development.status}`);
          if(status.development.error)console.log(status.development.error);
          for(const module of status.development.modules??[])if(module.changedSincePackaging)console.log(`Updated since packaging: ${module.id}`);
          console.log('External module status does not establish which revision a running window has loaded.');
        }
      }else console.log('Legacy build: no source revision or transform hashes recorded.');
      console.log('Receipt checks cover recorded files, not the app signature or external development modules.');
    }
    if(status.receiptStatus==='mismatch'||(status.development&&status.development.status!=='ready'))process.exitCode=1;
    return status;
  }
  if(options.command==='dev') {
    const outputIndex=options.args.indexOf('--output');
    if(outputIndex<0)throw Error('dev requires --output with an absolute dedicated directory');
    const output=options.args[outputIndex+1];
    const {buildDevelopment,watchDevelopment}=await import('./mods/development/build.mjs');
    const manifest=await buildDevelopment(output,options.mods);
    console.log(JSON.stringify({developmentRoot:output,...manifest},null,2));
    if(options.args.includes('--watch')) {
      const stop=watchDevelopment(output,options.mods);
      const close=()=>{stop();process.removeListener('SIGINT',close);process.removeListener('SIGTERM',close);};
      process.on('SIGINT',close);process.on('SIGTERM',close);
      console.log('Watching mod source. Icon pixels reload live; renderer changes require a window reload or restart.');
    }
    return manifest;
  }
  const entry=await import(`./mods/combined/${options.command}-mod.mjs`);
  return entry.main(options.args,{mods:options.mods,explicitSelection:options.explicitSelection});
}
if(import.meta.main)main().catch(error=>{console.error(error.stderr?.toString()||error.message);process.exitCode=1;});
