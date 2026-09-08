#!/usr/bin/env bun
import {selectMods,defaultMods} from './mods/combined/compatibility.mjs';

export const HELP=`Usage: bun run modex <verify|prepare> [options]

  --mods model-spread,theme-icon  Selected mods (default: both)
  --source APP                   Supported stock app (default /Applications/ChatGPT.app)
  --help                         Show help

prepare options:
  --output APP                   Required new absolute staging path outside Applications
  --identity-from APP            Installed app to preserve identity and check enabled mods
  --backup ZIP                   Explicitly verify/reuse an original-app backup
  --check                        Read-only preparation checks

Explicit --mods selects the complete intended set, including intentional removals.
Without it, updates reject dropping any mod recorded in the installed app.
Both mods are composed in a fixed order. Preparation records the selected set in
the signed app; it never installs, launches, overwrites, or quits an app.
`;
export function parseArgs(args) {
  if(args.length===1&&args[0]==='--help')return {help:true};
  const [command,...rest]=args;
  if(!['verify','prepare'].includes(command))throw Error('Expected verify or prepare; use --help for usage');
  const result={command,mods:[...defaultMods],explicitSelection:false,args:[],help:false};
  const seen=new Set();
  for(let i=0;i<rest.length;i++) {
    const flag=rest[i];
    if(seen.has(flag))throw Error(`Repeated ${flag}`);
    seen.add(flag);
    if(flag==='--help'){result.help=true;continue;}
    if(flag==='--check'&&command==='prepare'){result.args.push(flag);continue;}
    const valueFlags=command==='verify'?['--source','--mods']:['--source','--mods','--output','--backup','--identity-from'];
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
  const entry=await import(`./mods/combined/${options.command}-mod.mjs`);
  return entry.main(options.args,{mods:options.mods,explicitSelection:options.explicitSelection});
}
if(import.meta.main)main().catch(error=>{console.error(error.stderr?.toString()||error.message);process.exitCode=1;});
