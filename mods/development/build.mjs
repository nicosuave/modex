import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {digest,moduleSets,inspectDevelopment} from './validation.mjs';
const repo=path.resolve(import.meta.dirname,'../..');
const editable=new Set(['mods/model-spread/model-spread.mjs','mods/model-spread/editor.mjs',...['runtime','render','tint','palette'].map(id=>`mods/theme-icon/${id}.mjs`)]);
function validateMods(mods) {
  if(!Array.isArray(mods)||!mods.length||new Set(mods).size!==mods.length)throw new Error('Development mods must be a nonempty list without duplicates');
  for(const id of mods)if(!Object.hasOwn(moduleSets,id))throw new Error(`Development mode unsupported for mod: ${id}`);
}
export function computeHookHash(mods,sourceRoot=repo) {
  validateMods(mods);
  const files=['modex.mjs','package.json','bun.lock'];
  function walk(directory) {
    if(!fs.existsSync(path.join(sourceRoot,directory)))return;
    for(const entry of fs.readdirSync(path.join(sourceRoot,directory),{withFileTypes:true})) {
      const name=`${directory}/${entry.name}`;
      if(entry.isDirectory()){if(!['work','dist','bundles','overlay','vendor','node_modules','generated','.fixtures'].includes(entry.name))walk(name);}
      else if(/\.(js|mjs|cjs|json|cpp|h)$/.test(name)&&!name.includes('.test.')&&!editable.has(name))files.push(name);
    }
  }
  walk('lib');walk('mods/development');walk('mods/combined');walk('mods/app-tools-auth');for(const id of [...mods].sort())walk(`mods/${id}`);
  return digest(files.sort().filter(file=>fs.existsSync(path.join(sourceRoot,file))).map(file=>`${file}\0${digest(fs.readFileSync(path.join(sourceRoot,file)))}`).join('\n'));
}
export function sourceForMods(mods) {
  validateMods(mods);
  let source;
  for(const id of mods) {
    if(!moduleSets[id])throw new Error(`Development mode unsupported for mod: ${id}`);
    const {version,build}=JSON.parse(fs.readFileSync(path.join(repo,'mods',id,'compatibility.json'),'utf8'));
    if(source&&(source.version!==version||source.build!==build))throw new Error('Development source versions differ');
    source={version,build};
  }
  if(!source)throw new Error('Development mode needs at least one mod');
  return source;
}
const entries={'theme-icon-render':'theme-icon/render.mjs','theme-icon-runtime':'theme-icon/runtime.mjs','model-spread':'model-spread/model-spread.mjs','model-spread-editor':'model-spread/editor.mjs'};
async function bundle(file,options={}) {
  const result=await Bun.build({entrypoints:[file],target:'browser',format:'cjs',write:false,minify:false,...options});
  if(!result.success)throw new AggregateError(result.logs,`Could not build ${file}`);
  return result.outputs[0].text();
}
export async function buildDevelopment(output,mods) {
  if(!path.isAbsolute(output))throw new Error('Development output must be absolute');
  validateMods(mods);
  for(let ancestor=path.resolve(output);;ancestor=path.dirname(ancestor)) {
    if(ancestor.split(path.sep).some(part=>part.toLowerCase().endsWith('.app'))||fs.existsSync(ancestor)&&fs.realpathSync(ancestor).split(path.sep).some(part=>part.toLowerCase().endsWith('.app')))throw new Error('Development output cannot be inside an app bundle');
    if(path.dirname(ancestor)===ancestor)break;
  }
  if(fs.existsSync(output)&&fs.readdirSync(output).length) {
    if(!fs.existsSync(path.join(output,'manifest.json')))throw new Error('Development output is a nonempty directory not owned by Modex');
    try{inspectDevelopment(output);}catch(error){throw new Error(`Existing development output is invalid; preserve it and choose a new directory: ${error.message}`);}
  }
  mods=[...mods].sort();
  const source=sourceForMods(mods),hookHash=computeHookHash(mods),contents={};
  for(const id of mods.flatMap(mod=>moduleSets[mod]))contents[id]=await bundle(path.join(repo,'mods',entries[id]),id==='model-spread-editor'?{external:['./model-spread.mjs']}:{});
  const generation=digest(JSON.stringify(contents));
  for(const candidate of [path.join(output,'generations'),path.join(output,'generations',generation)])if(fs.existsSync(candidate)&&fs.lstatSync(candidate).isSymbolicLink())throw new Error('Development generation directories cannot be symlinks');
  fs.mkdirSync(path.join(output,'generations',generation),{recursive:true});
  const modules={};
  for(const [id,content]of Object.entries(contents)) {
    const file=`generations/${generation}/${id}.cjs`,destination=path.join(output,file);
    if(fs.existsSync(destination)){if(digest(fs.readFileSync(destination))!==digest(content))throw new Error('Existing development generation is corrupted');}
    else fs.writeFileSync(destination,content,{flag:'wx'});
    modules[id]={file,hash:digest(content)};
  }
  const manifest={schemaVersion:1,hookHash,mods,source,modules};
  const temporary=path.join(output,`.manifest-${process.pid}-${crypto.randomUUID()}.json`);
  fs.writeFileSync(temporary,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  fs.renameSync(temporary,path.join(output,'manifest.json'));
  return inspectDevelopment(output);
}
export async function buildRuntime() {
  return {'main.cjs':await bundle(path.join(import.meta.dirname,'main.mjs'),{target:'node',external:['electron']})};
}
export function watchDevelopment(output,mods,{intervalMs=750,log=console}={}) {
  let stopped=false,busy=false,last;
  const snapshot=()=>digest([computeHookHash(mods),...[...editable].filter(file=>mods.some(id=>file.startsWith(`mods/${id}/`))).sort().map(file=>digest(fs.readFileSync(path.join(repo,file))))].join('\n'));
  last=snapshot();
  const timer=setInterval(async()=>{
    if(stopped||busy)return;
    busy=true;
    try {
      const next=snapshot();
      if(next!==last){await buildDevelopment(output,mods);last=next;log.info('Development modules published. Hook changes require repackaging; renderer changes require a manual window reload or restart.');}
    }catch(error){log.error(`Development build failed; previous manifest retained: ${error.message}`);}
    finally{busy=false;}
  },intervalMs);
  return ()=>{stopped=true;clearInterval(timer);};
}
