import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const here = import.meta.dirname;
export function replaceOnce(source, anchor, value) {
  if (source.split(anchor).length !== 2)
    throw new Error(`Expected exactly one Theme Icon anchor: ${anchor.slice(0, 100)}`);
  return source.replace(anchor, value);
}
export async function transform(bundles) {
  const output = { ...bundles };
  const find = (prefix) => {
    const names = Object.keys(bundles).filter((n) => n.startsWith(prefix));
    if (names.length !== 1) throw new Error(`Expected one ${prefix}`);
    return names[0];
  };
  const main = find('.vite/build/main-'),
    initial = find('webview/assets/app-initial-'),
    settings = find('webview/assets/general-settings-');
  const patch = (name, anchor, value) => (output[name] = replaceOnce(output[name], anchor, value));
  output[initial] =
    'import * as ThemeIconRuntime from "./theme-icon-runtime.mjs";' + output[initial];
  patch(
    initial,
    'let b=s===`light`?_:y,x=b.fonts.codeFace',
    'let b=s===`light`?_:y;ThemeIconRuntime.useTheme(u6,{theme:b,appearance:s,id:aO(s===`light`?xv.lightCodeThemeId:xv.darkCodeThemeId),read:Jx,write:Yx,listen:W1t,bridge:H});let x=b.fonts.codeFace',
  );
  output[settings] =
    'import {Settings as ThemeIconSettings} from "./theme-icon-runtime.mjs";' + output[settings];
  patch(
    settings,
    ',T}function Ro(e){',
    ',(0,$.jsxs)($.Fragment,{children:[T,(0,$.jsx)(ThemeIconSettings,{React:$o,Row:K,Dropdown:he,DropdownButton:Ue,Menu:z,CheckIcon:xn,previews:d,enabled:a===`codex-system`,onEnable:()=>U(t,it.dockIconPreference,`codex-system`)})]})}function Ro(e){',
  );
  output[main] = 'const ThemeIconMain=require("./theme-icon-main.cjs");' + output[main];
  patch(
    main,
    'I=e=>{if(e===`app-default`&&t!==a.i.Dev)',
    'I=e=>{if(ThemeIconMain.apply(e))return;if(e===`app-default`&&t!==a.i.Dev)',
  );
  patch(
    main,
    '};if(g){L();let e=()=>{let e=A();e===`codex-system`&&I(e)};',
    '};ThemeIconMain.configure(l,process.resourcesPath,()=>I(A()));if(g){L();let e=()=>{let e=A();e===`codex-system`&&I(e)};',
  );
  patch(
    main,
    'case`persisted-atom-sync-request`:this.sendPersistedAtomState(e,t.responsePriority);',
    'case`modex-theme-icon`:if(this.getBrowserOwnerWebContentsForOrigin(e)===e&&(l.BrowserWindow.getFocusedWindow()==null||l.BrowserWindow.getFocusedWindow()?.webContents===e))ThemeIconMain.update(t);break;case`persisted-atom-sync-request`:this.sendPersistedAtomState(e,t.responsePriority);',
  );
  for (const file of ['runtime', 'state', 'render', 'tint', 'palette']) {
    let content = fs.readFileSync(path.join(here, `${file}.mjs`), 'utf8');
    for (const dependency of ['runtime', 'state', 'render', 'tint', 'palette'])
      content = content.replaceAll(`'./${dependency}.mjs'`, `'./theme-icon-${dependency}.mjs'`);
    output[`webview/assets/theme-icon-${file}.mjs`] = content;
  }
  const build = await Bun.build({
    entrypoints: [path.join(here, 'main.mjs')],
    target: 'node',
    format: 'cjs',
    minify: false,
    write: false,
  });
  if (!build.success) throw new AggregateError(build.logs, 'Could not bundle native icon adapter');
  output['.vite/build/theme-icon-main.cjs'] = await build.outputs[0].text();
  return output;
}
if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: bun build-mod.mjs INPUT_DIRECTORY OVERLAY_ROOT');
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'compatibility.json'), 'utf8'));
  const bundles = {};
  for (const [name, hash] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(input, name));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error(`Unsupported bundle: ${name}`);
    bundles[name] = bytes.toString();
  }
  const patched = await transform(bundles);
  for (const [name, content] of Object.entries(patched)) {
    const destination = path.join(output, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  console.log(`Theme Icon: wrote ${Object.keys(patched).length} overlay files`);
}
