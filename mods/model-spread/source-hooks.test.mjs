import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readArchive, readEntry } from '../../lib/asar.mjs';
import {
  patchUsageBanners,
  patchSelectionMode,
  patchExperimentExposure,
  patchMicroDispatch,
} from './source-hooks.mjs';

// Readable fixtures model the native contracts, with deliberately unrelated names.
// Real bundled owners are also exercised by the native adapter tests and the
// optional archive regression below; these fixtures always run in CI.
const usage = `function render(props){let {canShowUsageBanners:enabled,hostId:host,imageGenerationLimit:image,modelName:model,lowerPriorityContent:fallback,showModelLimit:limited,showUpsell:upsell,showWorkspaceUsageLimit:workspace}=props,unused=host;
if(!enabled)return fallback;let kind=classify({hasImageGenerationLimit:image!=null,showModelLimit:limited,showUpsell:upsell,showWorkspaceUsageLimit:workspace});return {kind,image};}`;
const selection = 'mode=lookup(choices,model,effort)==null?`model`:preference??`default`';
const exposure = '{skipExperimentExposure:restricted||mode===`model`||ultra||special}';
test('usage matching rejects another function or block reusing the captured names', () => {
  const declaration = usage.slice(0, usage.indexOf('if(!enabled)'));
  const guard =
    'if(!enabled)return fallback;let kind=classify({hasImageGenerationLimit:image!=null,other:true});return kind;';
  const unrelated = `function unrelated(enabled,image,fallback){${guard}}`;
  for (const source of [
    `${declaration}return fallback;} ${unrelated}`,
    `${declaration}{let enabled=true,image=null,fallback='nested';${guard}}}`,
    `${declaration}function nested(enabled,image,fallback){${guard}}return fallback;}`,
  ])
    assert.throws(() => patchUsageBanners(source), /Compatibility check failed/);

  const patched = patchUsageBanners(usage + unrelated);
  const functions = new Function('classify', `${patched};return {render,unrelated};`)(
    () => 'stock',
  );
  assert.equal(functions.unrelated(true, null, 'fallback'), 'stock');
  assert.equal(
    functions.render({
      canShowUsageBanners: true,
      imageGenerationLimit: null,
      lowerPriorityContent: 'fallback',
    }),
    'fallback',
  );
});
test('usage owner keeps image-query hooks before suppressing usage notices', () => {
  const withQuery = usage.replace(
    'if(!enabled)',
    'query({enabled:enabled&&image!=null});if(!enabled)',
  );
  const calls = [];
  const render = new Function(
    'query',
    'classify',
    `${patchUsageBanners(withQuery)};return render;`,
  )(
    (options) => calls.push(options),
    () => 'image',
  );
  const fallback = {};
  assert.equal(
    render({
      canShowUsageBanners: true,
      lowerPriorityContent: fallback,
      imageGenerationLimit: null,
    }),
    fallback,
  );
  assert.deepEqual(calls, [{ enabled: false }]);
  assert.equal(
    render({ canShowUsageBanners: true, lowerPriorityContent: fallback, imageGenerationLimit: {} })
      .kind,
    'image',
  );
  assert.deepEqual(calls, [{ enabled: false }, { enabled: true }]);
  assert.throws(
    () => patchUsageBanners(usage.replace('if(!enabled)', ' '.repeat(6001) + 'if(!enabled)')),
    /Compatibility check failed/,
  );
});
const micro =
  'let composer=findComposer();if(composer==null||activation().getActivationTarget(composer.root,composer.composerId,`reasoning`)==null)return;dispatch(direction===`ArrowUp`?`composer.decreaseReasoningEffort`:`composer.increaseReasoningEffort`,`codex_micro_encoder`)';
const renamed = (source) =>
  source.replace(
    /`[^`]*`|'[^']*'|"[^"]*"|\b(enabled|image|fallback|kind|classify|mode|lookup|choices|model|effort|preference|restricted|ultra|special|composer|findComposer|activation|dispatch|direction)\b/g,
    (token, name) => (name ? `$${name}_renamed` : token),
  );

for (const rename of [false, true]) {
  const adapt = (source) => (rename ? renamed(source) : source);
  const binding = (name) => (rename ? `$${name}_renamed` : name);
  test(`usage hook preserves fallback and image limits after renaming=${rename}`, () => {
    const render = new Function(
      binding('classify'),
      `${patchUsageBanners(adapt(usage))};return render;`,
    )(({ hasImageGenerationLimit }) => (hasImageGenerationLimit ? 'image' : 'usage'));
    const fallback = { child: 'native fallback' };
    for (const canShowUsageBanners of [false, true]) {
      for (const imageGenerationLimit of [null, { resetAt: 123 }]) {
        const result = render({
          canShowUsageBanners,
          imageGenerationLimit,
          lowerPriorityContent: fallback,
        });
        if (canShowUsageBanners && imageGenerationLimit != null) {
          // Alpha-renaming also renames the shorthand property in this fixture.
          assert.equal(result[binding('kind')], 'image');
          assert.equal(result[binding('image')], imageGenerationLimit);
        } else assert.equal(result, fallback);
      }
    }
  });

  test(`selection and experiment hooks preserve native/default cases after renaming=${rename}`, () => {
    let slots = null;
    const mod = { store: () => ({ get: () => ({ slots }) }) };
    const select = new Function(
      'ModelSpreadMod',
      binding('lookup'),
      binding('choices'),
      binding('model'),
      binding('effort'),
      binding('preference'),
      `let ${patchSelectionMode(adapt(selection))};return ${binding('mode')};`,
    );
    for (const custom of [false, true]) {
      slots = custom ? [] : null;
      for (const matches of [false, true]) {
        for (const preference of [undefined, 'default', 'model']) {
          const actual = select(mod, () => (matches ? {} : null), [], 'astra', 'high', preference);
          const expected =
            custom && preference !== 'model'
              ? 'default'
              : !matches
                ? 'model'
                : (preference ?? 'default');
          assert.equal(actual, expected);
        }
      }
      const expose = new Function(
        'ModelSpreadMod',
        binding('restricted'),
        binding('mode'),
        binding('ultra'),
        binding('special'),
        `return (${patchExperimentExposure(adapt(exposure))}).skipExperimentExposure;`,
      );
      for (const restricted of [false, true])
        for (const mode of ['default', 'model'])
          for (const ultra of [false, true])
            for (const special of [false, true])
              assert.equal(
                expose(mod, restricted, mode, ultra, special),
                custom || restricted || mode === 'model' || ultra || special,
              );
    }
  });

  test(`Micro dispatch preserves guards and reasoning-only commands after renaming=${rename}`, () => {
    const run = new Function(
      'ModelSpreadMod',
      'CustomEvent',
      binding('findComposer'),
      binding('activation'),
      binding('dispatch'),
      binding('direction'),
      patchMicroDispatch(adapt(micro)),
    );
    const events = [],
      commands = [];
    const composer = {
      root: { dispatchEvent: (event) => events.push(event.detail.direction) },
      composerId: 'native',
    };
    for (const custom of [false, true]) {
      for (const direction of ['ArrowUp', 'ArrowDown']) {
        for (const present of [false, true]) {
          for (const active of [false, true]) {
            const before = events.length + commands.length;
            run(
              { microEnabled: () => custom, EVENT: 'spread' },
              CustomEvent,
              () => (present ? composer : null),
              () => ({
                getActivationTarget: (root, id, mode) => {
                  assert.equal(root, composer.root);
                  assert.equal(id, 'native');
                  assert.equal(mode, 'reasoning');
                  return active ? {} : null;
                },
              }),
              (...args) => commands.push(args),
              direction,
            );
            assert.equal(events.length + commands.length - before, present && active ? 1 : 0);
          }
        }
      }
    }
    assert.deepEqual(events, [-1, 1]);
    assert.deepEqual(commands, [
      ['composer.decreaseReasoningEffort', 'codex_micro_encoder'],
      ['composer.increaseReasoningEffort', 'codex_micro_encoder'],
    ]);
  });
}

for (const [patch, source, changed] of [
  [
    patchUsageBanners,
    usage,
    usage.replace('hasImageGenerationLimit:image', 'hasImageGenerationLimit:other'),
  ],
  [
    patchSelectionMode,
    selection,
    selection.replace('lookup(choices,model,effort)', 'lookup(choices,model)'),
  ],
  [patchExperimentExposure, exposure, exposure.replace('||special', '&&special')],
  [
    patchMicroDispatch,
    micro,
    micro.replace('composer.root,composer.composerId', 'other.root,composer.composerId'),
  ],
]) {
  test(`${patch.name} rejects missing, ambiguous, changed and already-patched contracts`, () => {
    const duplicate =
      patch === patchUsageBanners
        ? source.replace('function render(', 'function another(')
        : source;
    for (const invalid of ['', source + ';' + duplicate, changed, patch(source)])
      assert.throws(() => patch(invalid), /Compatibility check failed/);
  });
}

// Opt-in source regression never changes the packaging allowlist or vendors bundles.
const archives = (process.env.MODEL_SPREAD_REGRESSION_ARCHIVES ?? '')
  .split(path.delimiter)
  .filter(Boolean);
if (archives.length === 0)
  test(
    'real source archive regression',
    { skip: 'Set MODEL_SPREAD_REGRESSION_ARCHIVES to compare historical stock ASARs' },
    () => {},
  );
for (const filename of archives) {
  test(`same hooks accept and compile real source: ${filename}`, { timeout: 30000 }, () => {
    const archive = readArchive(filename);
    const names = Object.keys(archive.header.files.webview.files.assets.files);
    for (const [prefix, hooks] of [
      ['app-primary-', [patchUsageBanners, patchSelectionMode, patchExperimentExposure]],
      ['codex-micro-bridge-', [patchMicroDispatch]],
    ]) {
      const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith('.js'));
      assert.equal(matches.length, 1);
      const source = readEntry(archive, `webview/assets/${matches[0]}`).toString();
      let patched = source;
      for (const hook of hooks) {
        const next = hook(patched);
        assert.notEqual(next, patched);
        assert.equal(next, hook(patched), 'deterministic output');
        patched = next;
      }
      new Bun.Transpiler({ loader: 'js' }).transformSync(patched);
    }
  });
}
