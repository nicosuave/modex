import {main as prepare} from '../combined/prepare-mod.mjs';
export const main=(args=process.argv.slice(2))=>prepare(args,{mods:['custom-cli'],explicitSelection:true});
if(import.meta.main)main().catch(error=>{console.error(error.message);process.exitCode=1;});
