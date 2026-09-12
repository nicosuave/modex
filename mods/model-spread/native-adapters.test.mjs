import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverMicroSettings } from './source-contracts.mjs';
import {
  bundle,
  callee,
  evaluate,
  externalNames,
  findOwner,
  identifier,
  nativeFixtures,
  nodes,
  objectProperty,
  one,
  parseSource,
  propertyName,
  textValue,
} from './native-test-helpers.mjs';

const fixtures = nativeFixtures();

function composerInstall(source) {
  const call = one(
    nodes(
      parseSource(source),
      (node) =>
        node.type === 'CallExpression' &&
        propertyName(callee(node.callee)) === 'useComposer' &&
        callee(node.callee).object.name === 'ModelSpreadMod',
      'CallExpression',
    ),
    'injected composer adapter',
  );
  const config = call.arguments[1];
  const get = (name) => objectProperty(config, name).value;
  const select = get('select');
  const access = one(
    select.body.body.filter((node) => node.type === 'IfStatement'),
    'native access guard',
  ).test;
  assert.equal(access.operator, '!');
  assert.equal(access.argument.type, 'CallExpression');
  const write = one(
    nodes(select, (node) => node.type === 'CallExpression' && propertyName(node.callee) === 'set'),
    'native selection preference write',
  );
  const selection = one(
    nodes(
      select,
      (node) => node.type === 'ReturnStatement' && node.argument?.type === 'CallExpression',
    ),
    'atomic native model selection',
  ).argument;
  const terms = [];
  function flatten(node) {
    if (node.type === 'LogicalExpression' && node.operator === '&&') {
      flatten(node.left);
      flatten(node.right);
    } else terms.push(node);
  }
  flatten(get('enabled'));
  const positive = terms.filter((node) => node.type === 'Identifier');
  assert.equal(positive.length, 2, 'native picker and readiness guards');
  const restricted = one(
    terms.filter(
      (node) =>
        node.type === 'UnaryExpression' &&
        node.operator === '!' &&
        node.argument.type === 'Identifier',
    ),
    'restricted-mode guard',
  );
  const locked = one(
    terms.filter(
      (node) =>
        node.type === 'UnaryExpression' &&
        propertyName(node.argument.expression ?? node.argument) === 'isModelLocked',
    ),
    'locked-model guard',
  );
  assert.equal(terms.length, 4, 'all native enablement guards are exercised');
  return ({
    mod,
    model,
    effort,
    canPick,
    loaded,
    restrictedMode,
    lockedModel,
    canSelect,
    store,
    selectModel,
  }) =>
    evaluate(`${source.slice(call.start, call.end)};`, {
      ModelSpreadMod: mod,
      [identifier(call.arguments[0])]: {},
      [identifier(get('trigger'))]: {},
      [identifier(get('choices'))]: [],
      [identifier(get('model'))]: model,
      [identifier(get('effort'))]: effort,
      [identifier(positive[0])]: canPick,
      [identifier(positive[1])]: loaded,
      [identifier(restricted.argument)]: restrictedMode,
      [identifier((locked.argument.expression ?? locked.argument).object)]: {
        isModelLocked: lockedModel,
      },
      [identifier(access.argument.callee)]: canSelect,
      [identifier(write.callee.object)]: store,
      [identifier(write.arguments[0])]: 'native-selection-mode',
      [identifier(selection.callee)]: selectModel,
    });
}

function microDispatch(source) {
  const branch = one(
    nodes(
      parseSource(source),
      (node) =>
        node.type === 'IfStatement' &&
        propertyName(node.test.left) === 'encoderMode' &&
        textValue(node.test.right) === 'reasoning' &&
        nodes(
          node.consequent,
          (child) =>
            child.type === 'CallExpression' && propertyName(child.callee) === 'getActivationTarget',
        ).length === 1,
    ),
    'reasoning dispatch branch',
  );
  const activation = one(
    nodes(
      branch,
      (node) =>
        node.type === 'CallExpression' && propertyName(node.callee) === 'getActivationTarget',
    ),
    'native activation check',
  );
  const composerName = identifier(activation.arguments[0].object);
  const composer = one(
    nodes(branch, (node) => node.type === 'VariableDeclarator' && node.id.name === composerName),
    'active composer lookup',
  );
  const modal = one(
    branch.consequent.body.filter(
      (node) => node.type === 'IfStatement' && node.test.left?.type === 'CallExpression',
    ),
    'native modal guard',
  );
  const command = one(
    nodes(
      branch,
      (node) =>
        node.type === 'CallExpression' &&
        node.arguments[0]?.type === 'ConditionalExpression' &&
        textValue(node.arguments[0].consequent) === 'composer.decreaseReasoningEffort',
    ),
    'native reasoning command',
  );
  const cleanup = one(
    nodes(
      branch,
      (node) =>
        node.type === 'LogicalExpression' &&
        node.operator === '&&' &&
        node.left.left?.type === 'CallExpression' &&
        node.right.type === 'CallExpression',
    ),
    'native reasoning feedback cleanup',
  );
  return ({
    layout,
    modalTarget,
    activeComposer,
    activationTarget,
    mod,
    dispatchCommand,
    direction,
  }) =>
    evaluate(source.slice(branch.start, branch.end), {
      [identifier(branch.test.left.object)]: layout,
      [identifier(modal.test.left.callee)]: () => modalTarget,
      [identifier(composer.init.callee)]: () => activeComposer,
      [identifier(activation.callee.object.callee)]: () => ({
        getActivationTarget: () => activationTarget,
      }),
      ModelSpreadMod: mod,
      CustomEvent,
      [identifier(command.callee)]: dispatchCommand,
      [identifier(command.arguments[0].test.left)]: direction,
      [identifier(cleanup.left.left.callee)]: () => null,
      [identifier(cleanup.right.callee)]: () => {},
    });
}

function usageRenderer(source) {
  const ast = parseSource(source);
  const owner = findOwner(
    ast,
    (node) =>
      node.type === 'ObjectPattern' &&
      ['canShowUsageBanners', 'imageGenerationLimit', 'lowerPriorityContent'].every((name) =>
        objectProperty(node, name),
      ),
    'native usage renderer',
    'ObjectPattern',
  );
  const classification = one(
    nodes(
      owner,
      (node) =>
        node.type === 'CallExpression' &&
        objectProperty(node.arguments[0], 'hasImageGenerationLimit'),
    ),
    'usage classification',
  );
  const classify = one(
    nodes(
      ast,
      (node) =>
        node.type === 'FunctionDeclaration' && node.id.name === identifier(classification.callee),
      'FunctionDeclaration',
    ),
    'native usage classifier',
  );
  const executable = `${source.slice(classify.start, classify.end)};${source.slice(owner.start, owner.end)};`;
  // Supply only the renderer's imported dependency boundaries. Both classification
  // and rendering decisions execute from the shipped, transformed functions.
  const bindings = Object.fromEntries(externalNames(executable).map((name) => [name, () => ({})]));
  const calls = nodes(owner, (node) => node.type === 'CallExpression');
  const jsxCalls = calls.filter((node) =>
    ['jsx', 'jsxs'].includes(propertyName(callee(node.callee))),
  );
  for (const call of jsxCalls)
    bindings[identifier(callee(call.callee).object)] = {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    };
  const cache = one(
    calls.filter((node) => propertyName(callee(node.callee)) === 'c'),
    'native memo cache',
  );
  bindings[identifier(callee(cache.callee).object)] = { c: () => [] };
  for (const call of calls.filter((node) => propertyName(callee(node.callee)) === 'useRef'))
    bindings[identifier(callee(call.callee).object)] = { useRef: () => ({ current: null }) };
  const account = nodes(
    owner,
    (node) =>
      node.type === 'VariableDeclarator' &&
      objectProperty(node.id, 'accountId') &&
      objectProperty(node.id, 'userId'),
  );
  for (const declaration of account)
    bindings[identifier(declaration.init.callee)] = () => ({
      accountId: 'account',
      userId: 'user',
    });
  const image = one(
    jsxCalls.filter((node) => objectProperty(node.arguments[1], 'imageGenerationLimit')),
    'image-limit component',
  );
  bindings[identifier(image.arguments[0])] = 'native-image-limit';
  const imageQuery = nodes(
    owner,
    (node) =>
      node.type === 'VariableDeclarator' &&
      objectProperty(node.id, 'data') &&
      node.init?.type === 'CallExpression',
  );
  assert.ok(imageQuery.length <= 1, 'at most one image usage query');
  let imageUsage;
  if (imageQuery.length) {
    const query = imageQuery[0].init;
    const queryKey = bindings[identifier(query.arguments[0])];
    bindings[identifier(query.callee)] = (key) => (key === queryKey ? { data: imageUsage } : {});
    const backendImage = one(
      jsxCalls.filter(
        (node) =>
          objectProperty(node.arguments[1], 'banner') &&
          objectProperty(node.arguments[1], 'lastImpressionKeyRef'),
      ),
      'backend image-limit component',
    );
    bindings[identifier(backendImage.arguments[0])] = 'native-image-banner';
  }
  return {
    render: evaluate(`${executable}return ${identifier(owner.id)};`, bindings),
    hasImageUsageQuery: imageQuery.length === 1,
    setImageUsage: (value) => {
      imageUsage = value;
    },
  };
}

for (const fixture of fixtures) {
  test(
    `${fixture.name}: native composer retains access checks and atomic model/effort selection`,
    { timeout: 120000 },
    async () => {
      const install = composerInstall(bundle(fixture, 'app-primary-'));
      const writes = [],
        selections = [];
      let config,
        allowed = true;
      const bind = ({ canPick = true, loaded = true, restricted = false, locked = false } = {}) => {
        install({
          mod: {
            useComposer: (_react, value) => {
              config = value;
            },
          },
          model: 'gpt-6-astra',
          effort: 'high',
          canPick,
          loaded,
          restrictedMode: restricted,
          lockedModel: locked,
          canSelect: () => allowed,
          store: { set: (...args) => writes.push(args) },
          selectModel: async (...args) => {
            selections.push(args);
            return true;
          },
        });
        return config;
      };
      assert.equal(bind().enabled, true);
      assert.equal(config.model, 'gpt-6-astra');
      assert.equal(config.effort, 'high');
      assert.equal(await config.select({ model: 'gpt-6-astra', reasoningEffort: 'max' }), true);
      assert.deepEqual(writes, [['native-selection-mode', 'default']]);
      assert.deepEqual(selections, [['gpt-6-astra', 'max']]);
      allowed = false;
      assert.equal(await config.select({ model: 'unavailable', reasoningEffort: 'high' }), false);
      assert.equal(writes.length, 1);
      assert.equal(selections.length, 1);
      for (const options of [
        { canPick: false },
        { loaded: false },
        { restricted: true },
        { locked: true },
      ])
        assert.equal(bind(options).enabled, false);
    },
  );

  test(`${fixture.name}: Micro preserves reasoning-only mode and native activation guards`, () => {
    const dispatch = microDispatch(bundle(fixture, 'codex-micro-bridge-'));
    const directions = [],
      commands = [];
    const root = new EventTarget();
    root.addEventListener('spread-test', (event) => directions.push(event.detail.direction));
    function turn({
      custom = true,
      direction = 'ArrowUp',
      modal = null,
      target = true,
      composer = true,
    } = {}) {
      dispatch({
        layout: { encoderMode: 'reasoning' },
        modalTarget: modal,
        activeComposer: composer ? { root, composerId: 'composer' } : null,
        activationTarget: target ? {} : null,
        mod: { microEnabled: () => custom, EVENT: 'spread-test' },
        dispatchCommand: (...args) => commands.push(args),
        direction,
      });
    }
    turn();
    turn({ direction: 'ArrowDown' });
    assert.deepEqual(directions, [-1, 1]);
    turn({ custom: false });
    turn({ custom: false, direction: 'ArrowDown' });
    assert.deepEqual(commands, [
      ['composer.decreaseReasoningEffort', 'codex_micro_encoder'],
      ['composer.increaseReasoningEffort', 'codex_micro_encoder'],
    ]);
    for (const options of [{ modal: {} }, { target: false }, { composer: false }]) turn(options);
    assert.equal(directions.length, 2);
    assert.equal(commands.length, 2);
  });

  test(`${fixture.name}: Micro row keeps the native layout update and custom-editor state`, () => {
    const source = bundle(fixture, 'codex-micro-settings-');
    const row = one(
      nodes(
        parseSource(source),
        (node) =>
          node.type === 'CallExpression' &&
          node.arguments[0]?.name === 'MSMode' &&
          objectProperty(node.arguments[1], 'onChange'),
        'CallExpression',
      ),
      'injected Micro settings row',
    );
    const props = row.arguments[1];
    const onChange = objectProperty(props, 'onChange').value;
    const calls = nodes(onChange, (node) => node.type === 'CallExpression');
    const toggle = one(
      calls.filter(
        (node) =>
          node.arguments[0]?.type === 'BinaryExpression' &&
          textValue(node.arguments[0].right) === 'custom',
      ),
      'native custom-editor toggle',
    );
    const update = one(
      calls.filter((node) =>
        node.arguments.some((argument) => objectProperty(argument, 'encoderMode')),
      ),
      'native layout write',
    );
    assert.equal(update.arguments.length, 3, 'native host, layout key and updated layout');
    const key = update.arguments[1];
    assert.equal(propertyName(key), 'layout');
    const initialLayout = Object.freeze({
      encoderMode: 'reasoning',
      voiceButtonMode: 'hold',
      retained: 'native field',
    });
    const flags = [],
      writes = [];
    const selectMode = evaluate(`return ${source.slice(onChange.start, onChange.end)};`, {
      [identifier(toggle.callee)]: (value) => flags.push(value),
      [identifier(update.callee)]: (...args) => writes.push(args),
      [identifier(update.arguments[0])]: 'native-device',
      [identifier(key.object)]: { layout: 'native-layout-key' },
      [identifier(objectProperty(props, 'layout').value)]: initialLayout,
    });
    for (const mode of ['reasoning', 'custom', 'conversation-scroll']) selectMode(mode);
    assert.deepEqual(flags, [false, true, false]);
    assert.deepEqual(
      writes,
      ['reasoning', 'custom', 'conversation-scroll'].map((encoderMode) => [
        'native-device',
        'native-layout-key',
        { ...initialLayout, encoderMode },
      ]),
    );
    assert.equal(initialLayout.encoderMode, 'reasoning');
  });

  test(`${fixture.name}: usage owner preserves lower-priority content and image-limit notices`, () => {
    const { render, hasImageUsageQuery, setImageUsage } = usageRenderer(
      bundle(fixture, 'app-primary-'),
    );
    const fallback = { child: 'lower priority notice' };
    const base = {
      canShowUsageBanners: true,
      lowerPriorityContent: fallback,
      imageGenerationLimit: null,
    };
    assert.equal(
      render({ ...base, showUpsell: true, rateLimit: { rate_limit_upsell: {} } }),
      fallback,
    );
    assert.equal(render({ ...base, showModelLimit: true }), fallback);
    assert.equal(render({ ...base, showWorkspaceUsageLimit: true }), fallback);
    assert.equal(
      render({ ...base, showBackendRateLimitUpsell: true, rateLimit: { rate_limit_upsell: {} } }),
      fallback,
    );
    const imageGenerationLimit = { resetAt: 'later' },
      dismiss = () => {};
    const result = render({
      ...base,
      imageGenerationLimit,
      onDismissImageGenerationLimit: dismiss,
    });
    assert.equal(result.type, 'native-image-limit');
    assert.equal(result.props.imageGenerationLimit, imageGenerationLimit);
    assert.equal(result.props.onDismissImageGenerationLimit, dismiss);
    assert.equal(render({ ...base, imageGenerationLimit, canShowUsageBanners: false }), fallback);
    if (hasImageUsageQuery) {
      const imageUsage = {
        rate_limit_upsell: { banner_type: 'image_generation_limit_reached', priority: 0 },
      };
      setImageUsage(imageUsage);
      const backendImage = render({
        ...base,
        imageGenerationLimit,
        onDismissImageGenerationLimit: dismiss,
      });
      assert.equal(backendImage.type, 'div');
      assert.equal(backendImage.props.children.type, 'native-image-banner');
      assert.equal(backendImage.props.children.props.banner, imageUsage.rate_limit_upsell);
      assert.equal(backendImage.props.children.props.onDismiss, dismiss);
      assert.equal(backendImage.props.children.props.fallbackContent.type, 'native-image-limit');
    }
  });

  test(`${fixture.name}: ambiguous native Micro settings owners are rejected`, () => {
    const name = one(
      Object.keys(fixture.originals).filter((name) => name.startsWith('codex-micro-settings-')),
      'Micro settings bundle',
    );
    const source = fixture.originals[name];
    const owner = findOwner(
      parseSource(source),
      (node) =>
        node.type === 'VariableDeclarator' &&
        node.init?.type === 'MemberExpression' &&
        node.init.computed &&
        propertyName(node.init.property) === 'encoderMode',
      'native Micro knob settings owner',
      'VariableDeclarator',
    );
    const duplicate = `\nfunction duplicateMicroFixture(){${source.slice(owner.start, owner.end)}}`;
    assert.throws(() => discoverMicroSettings(source + duplicate), /Micro|micro/);
  });
}

if (!fixtures.length) test('native adapter fixtures unavailable', { skip: true }, () => {});
