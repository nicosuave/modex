import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

export const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

/** A stage records intermediate hashes, so shared-file composition remains traceable. */
export function recordChanges(mod,name,before,after) {
  const input=before instanceof Map?before:new Map(Object.entries(before));
  const output=after instanceof Map?after:new Map(Object.entries(after));
  return [...output].filter(([filename,bytes])=>filename!=='modex.json'&&(!input.has(filename)||sha256(input.get(filename))!==sha256(bytes)))
    .sort(([a],[b])=>a.localeCompare(b)).map(([filename,bytes])=>({mod,name,path:filename,
      beforeHash:input.has(filename)?sha256(input.get(filename)):null,afterHash:sha256(bytes)}));
}

/** Content identity includes uncommitted source; the Git revision alone is insufficient. */
export function buildIdentity(root=path.resolve(import.meta.dirname,'..')) {
  let revision=null,dirty=null,files;
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try {
    revision=git(['rev-parse','HEAD']).trim();
    dirty=git(['status','--porcelain','--untracked-files=normal']).trim().length>0;
    files=git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
  } catch {
    // Source ZIPs have no Git identity; hash the same source directories explicitly.
    files=[];
    const visit=relative=>{
      for(const item of fs.readdirSync(path.join(root,relative),{withFileTypes:true})) {
        const name=path.posix.join(relative,item.name);
        if(item.isDirectory())visit(name);else if(item.isFile())files.push(name);
      }
    };
    for(const directory of ['lib','mods'])visit(directory);
    for(const name of ['modex.mjs','package.json','bun.lock'])if(fs.existsSync(path.join(root,name)))files.push(name);
  }
  const digest=crypto.createHash('sha256');
  // Only application/build sources: never vendor bundles, local profiles or output trees.
  const selected=[...new Set(files)].filter(name=>/^(?:lib\/|mods\/|modex\.mjs$|package\.json$|bun\.lock$)/.test(name)
    && /\.(?:mjs|cjs|js|json|cpp|h|lock)$/.test(name)&&!name.split('/').some(part=>['node_modules','bundles','overlay','dist','work'].includes(part))).sort();
  for(const name of selected) {
    const filename=path.join(root,name);
    if(!fs.existsSync(filename)){digest.update(name+'\0deleted\0');continue;}
    if(!fs.lstatSync(filename).isFile())throw Error(`Build source must be a regular file: ${name}`);
    digest.update(name+'\0').update(fs.readFileSync(filename)).update('\0');
  }
  return {revision,dirty,sourceHash:digest.digest('hex')};
}
