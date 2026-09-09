#!/usr/bin/env bun
import {prepareMain} from '../../lib/prepare-mod.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {compatibilityFor,selectMods,legacyMarkers} from './compatibility.mjs';
import {transform,validateInputs} from './build-mod.mjs';
export const HELP=`Usage: bun mods/combined/prepare-mod.mjs --output /absolute/new/Modex.app [options]
  --source APP          Stock app (default /Applications/ChatGPT.app)
  --identity-from APP   Preserve installed mod bundle ID and signing requirement
  --backup ZIP          Explicitly validate/reuse an original-app backup
  --check               Read-only validation; no packaging
  --help                Show help
Builds the selected mods into one signed app, outside Applications.
The default selection is Model Spread and Theme Icon.
Never overwrites, installs, launches, or quits an app. New installs default to
local.codex.model-spread; updates should pass --identity-from the installed app.
`;
export function main(args=process.argv.slice(2),{mods,explicitSelection=false}={}) {
  const selectedMods=selectMods(mods),manifest=compatibilityFor(selectedMods);
  return prepareMain(args,{modDirectory:import.meta.dirname,overlayAtRoot:true,help:HELP,manifest,selectedMods,explicitSelection,legacyMarkers,
    buildOverlay:async(input,output)=>{
      const bundles=Object.fromEntries(Object.keys(manifest.files).map(name=>[name,fs.readFileSync(path.join(input,name),'utf8')]));
      validateInputs(bundles,selectedMods);
      const transforms=[];
      const patched=await transform(bundles,selectedMods,{onStage:records=>transforms.push(...records)});
      for(const [name,content]of Object.entries(patched)) {
        const target=path.join(output,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);
      }
      return transforms;
    },
  });
}
if(import.meta.main)main().catch(error=>{console.error(error.stderr?.toString()||error.message);process.exitCode=1;});
