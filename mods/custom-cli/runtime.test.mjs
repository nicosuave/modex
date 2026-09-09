import {test,expect,afterEach} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateConfiguration,loadConfiguration,applyLaunch} from './runtime.mjs';

const directories=[];
const temporary=()=>{const value=fs.mkdtempSync(path.join(os.tmpdir(),'modex-cli-test-'));directories.push(value);return value;};
afterEach(()=>{for(const directory of directories.splice(0))fs.rmSync(directory,{recursive:true,force:true});});

test('default file is optional; an explicit configuration path is required and absolute',()=>{
  const userData=temporary();
  expect(loadConfiguration({userData,env:{}})).toBeNull();
  for(const explicit of ['', 'relative.json',path.join(userData,'missing.json')])expect(()=>loadConfiguration({userData,env:{MODEX_CUSTOM_CLI_CONFIG:explicit}})).toThrow('Custom CLI:');
  fs.writeFileSync(path.join(userData,'modex-custom-cli.json'),JSON.stringify({configOverrides:['model="example"']}));
  expect(loadConfiguration({userData,env:{}}).configOverrides).toEqual(['model="example"']);
  const external=path.join(userData,'external.json');
  fs.writeFileSync(external,JSON.stringify({configOverrides:['model="external"']}));
  expect(loadConfiguration({userData,env:{MODEX_CUSTOM_CLI_CONFIG:external}}).configOverrides).toEqual(['model="external"']);
});

test('disabled and empty configurations are inactive; executable paths require executable files',()=>{
  expect(validateConfiguration({})).toBeNull();
  expect(validateConfiguration({enabled:true,configOverrides:[]})).toBeNull();
  expect(validateConfiguration({enabled:false,executablePath:'/missing/file',configOverrides:['model="example"']})).toBeNull();
  const executable=path.join(temporary(),'cli with spaces');
  fs.writeFileSync(executable,'#!/bin/sh\nexit 0\n',{mode:0o600});
  expect(()=>validateConfiguration({executablePath:executable})).toThrow('executable file');
  fs.chmodSync(executable,0o700);
  expect(validateConfiguration({executablePath:executable}).executablePath).toBe(executable);
  expect(()=>validateConfiguration({executablePath:path.dirname(executable)})).toThrow('executable file');
});

test('schema errors and filesystem failures never include configuration contents',()=>{
  const secret='private-setting-value';
  for(const value of [null,[],{[secret]:true},{enabled:secret},{executablePath:secret},{configOverrides:secret},{configOverrides:[secret]},{configOverrides:[' =value']},{configOverrides:['key=\0value']}]) {
    let error;try {validateConfiguration(value);}catch(caught){error=caught;}
    expect(error).toBeInstanceOf(Error);expect(error.message).not.toContain(secret);
  }
  const userData=temporary(),file=path.join(userData,'modex-custom-cli.json');
  fs.writeFileSync(file,'{"'+secret+'":');
  expect(()=>loadConfiguration({userData,env:{}})).toThrow('configuration file must contain valid JSON');
  const broken={readFileSync(){throw Error(secret);}};
  expect(()=>loadConfiguration({userData,env:{},fileSystem:broken})).toThrow('cannot read configuration file');
});

test('TOML values retain exact bytes and argv boundaries; local overrides follow stock overrides',()=>{
  const values=['model="value with spaces"','model_providers.example.base_url="https://example.invalid?a=b"','features.example=true'];
  const config=validateConfiguration({configOverrides:values});
  const launch={executablePath:'/bin/codex',args:['app-server','--analytics-default-enabled','-c','model="stock"'],env:{KEEP:'yes'},cwd:'/workspace'};
  const modified=applyLaunch(launch,{kind:'local'},config);
  expect(modified.args).toEqual([...launch.args,...values.flatMap(value=>['-c',value])]);
  expect(modified.env).toBe(launch.env);expect(modified.cwd).toBe(launch.cwd);
  expect(applyLaunch(launch,{kind:'local'},null)).toBe(launch);
  for(const kind of ['ssh','wsl','remote-control','cloud','websocket'])expect(applyLaunch(launch,{kind},config)).toBe(launch);
  for(const transport of [{spawnCommand:'wsl.exe'},{spawnArgs:['-d','distribution']}]) {
    const delegated={...launch,...transport};
    expect(applyLaunch(delegated,{kind:'local'},config)).toBe(delegated);
  }
  expect(applyLaunch(null,{kind:'local'},config)).toBeNull();
});

test('initialization uses final app userData once and aligns the stock native CLI environment',async()=>{
  const runtime=await import(`./runtime.mjs?test=${crypto.randomUUID()}`);
  const userData=temporary(),executable=path.join(userData,'custom cli');
  fs.writeFileSync(executable,'#!/bin/sh\nexit 0\n',{mode:0o700});
  const file=path.join(userData,'modex-custom-cli.json');
  fs.writeFileSync(file,JSON.stringify({executablePath:executable,configOverrides:['model="example"']}));
  const env={CODEX_CLI_PATH:'/original/cli',OTHER:'retained'};
  let calls=0;
  const app={getPath(name){expect(name).toBe('userData');calls++;return userData;}};
  runtime.initialize(app,env);
  expect(env).toEqual({CODEX_CLI_PATH:executable,OTHER:'retained'});expect(runtime.isActive()).toBe(true);
  fs.writeFileSync(file,JSON.stringify({enabled:false}));
  runtime.initialize(app,env);expect(calls).toBe(1);expect(runtime.isActive()).toBe(true);
  for(const config of [{enabled:false},{}]) {
    const fresh=await import(`./runtime.mjs?test=${crypto.randomUUID()}`);
    fs.writeFileSync(file,JSON.stringify(config));
    const untouched={CODEX_CLI_PATH:'/existing'};
    fresh.initialize(app,untouched);expect(untouched).toEqual({CODEX_CLI_PATH:'/existing'});expect(fresh.isActive()).toBe(false);
  }
});

test.skipIf(!process.env.CUSTOM_CLI_EXECUTABLE)('bundled app-server reads the custom override after app-supplied settings',async()=>{
  const config=validateConfiguration({configOverrides:['model="modex-override-check"']});
  const launch=applyLaunch({executablePath:process.env.CUSTOM_CLI_EXECUTABLE,args:['app-server','--stdio','-c','model="stock-check"'],env:{...process.env,CODEX_HOME:temporary()}},{kind:'local'},config);
  const child=Bun.spawn([launch.executablePath,...launch.args],{env:launch.env,stdin:'pipe',stdout:'pipe',stderr:'ignore'});
  let buffer='',sequence=0;
  const pending=new Map();
  const reading=(async()=>{for await(const chunk of child.stdout){buffer+=new TextDecoder().decode(chunk);let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}pending.get(message.id)?.(message);}}})();
  function request(method,params){const id=++sequence;return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('App-server request timed out'));},10000);
    pending.set(id,message=>{clearTimeout(timer);pending.delete(id);message.error?reject(Error('App-server rejected request')):resolve(message.result);});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });}
  try {
    await request('initialize',{clientInfo:{name:'modex_custom_cli_test',version:'1'},capabilities:{experimentalApi:true}});
    child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
    const result=await request('config/read',{});
    expect(result.config.model).toBe('modex-override-check');
  }finally{child.kill();await child.exited;await reading;}
},15000);
