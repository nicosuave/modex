import { fileURLToPath } from 'node:url';
export const MAIN = '.vite/build/main-Bkkz0ENj.js';
export const SOURCE = '.vite/build/src-B6LqG3ek.js';
export const CONNECT = 't=await aU(this.options,e);if(!t)';
export const DAEMON = 'process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON===`1`&&';
export function replaceOnce(source, anchor, replacement) {
  if (typeof source !== 'string' || source.split(anchor).length !== 2)
    throw Error('Expected exactly one Custom CLI anchor');
  return source.replace(anchor, replacement);
}
export async function transform(bundles) {
  const output = { ...bundles };
  if (
    output[MAIN]?.includes('./modex-custom-cli.cjs') ||
    output[SOURCE]?.includes('./modex-custom-cli.cjs')
  )
    throw Error('Custom CLI already applied');
  if (typeof output[MAIN] !== 'string') throw Error('Missing Custom CLI main bundle');
  output[MAIN] =
    'require("./modex-custom-cli.cjs").initialize(require("electron").app);' + output[MAIN];
  output[SOURCE] =
    'const ModexCustomCli=require("./modex-custom-cli.cjs");' +
    replaceOnce(
      replaceOnce(
        output[SOURCE],
        CONNECT,
        't=ModexCustomCli.applyLaunch(await aU(this.options,e),this.options.hostConfig);if(!t)',
      ),
      DAEMON,
      '!ModexCustomCli.isActive()&&' + DAEMON,
    );
  const build = await Bun.build({
    entrypoints: [fileURLToPath(new URL('./runtime.mjs', import.meta.url))],
    target: 'node',
    format: 'cjs',
    write: false,
    minify: false,
  });
  if (!build.success) throw new AggregateError(build.logs, 'Could not bundle Custom CLI adapter');
  output['.vite/build/modex-custom-cli.cjs'] = await build.outputs[0].text();
  return output;
}
