import {
  parseModule,
  unique,
  literalValue,
  propertyName,
  isFunction,
  editSource,
} from '../../lib/source-contract.mjs';
import { findInitializer } from './native-contract.mjs';

const asModule = (source) => (typeof source === 'string' ? parseModule(source) : source);
const isIdentifier = (node) => node?.type === 'Identifier';
const isMember = (node, name) =>
  node?.type === 'MemberExpression' && propertyName(node.property) === name;
const property = (node, name) =>
  node?.properties?.find((p) => p.type === 'Property' && propertyName(p.key) === name)?.value;
const hasProperties = (node, names) =>
  node?.type === 'ObjectExpression' && names.every((name) => property(node, name));
const contains = (outer, inner) => inner.start >= outer.start && inner.end <= outer.end;
const deduplicate = (values) => [...new Set(values)];
const unwrap = (node) => (node?.type === 'ChainExpression' ? node.expression : node);
const callee = (node) =>
  node?.callee?.type === 'SequenceExpression' ? node.callee.expressions.at(-1) : node?.callee;
function scope(module, owner) {
  if (!owner) throw Error('Compatibility check failed: missing native operation owner');
  const nodes = module.nodes.filter((node) => contains(owner, node));
  return {
    ...module,
    nodes,
    all: (predicate) => nodes.filter(predicate),
    one: (predicate, label) => unique(nodes.filter(predicate), label),
  };
}
function jsxProps(node) {
  const target = callee(node);
  return node?.type === 'CallExpression' &&
    target?.type === 'MemberExpression' &&
    ['jsx', 'jsxs'].includes(propertyName(target.property))
    ? node.arguments[1]
    : null;
}
function identifier(node, label) {
  if (!isIdentifier(node))
    throw Error(`Compatibility check failed: expected identifier for ${label}`);
  return node.name;
}
function expressionBinding(module, expression, label) {
  const parent = module.parents.get(expression);
  if (parent?.type === 'VariableDeclarator' && parent.init === expression)
    return identifier(parent.id, label);
  if (parent?.type === 'AssignmentExpression' && parent.right === expression)
    return identifier(parent.left, label);
  throw Error(`Compatibility check failed: expected binding for ${label}`);
}
function functionAssignment(module, name, label) {
  return module.one(
    (node) =>
      node.type === 'AssignmentExpression' &&
      isIdentifier(node.left) &&
      node.left.name === name &&
      isFunction(node.right),
    label,
  ).right;
}
function reactNamespace(module) {
  return unique(
    deduplicate(
      module
        .all(
          (node) =>
            node.type === 'MemberExpression' &&
            ['useRef', 'useState', 'useEffect'].includes(propertyName(node.property)) &&
            isIdentifier(node.object),
        )
        .map((node) => node.object.name),
    ),
    'native React namespace',
  );
}
export function discoverHomeNormalization(input) {
  const module = asModule(input);
  const preset = module.one(
    (node) =>
      node.type === 'CallExpression' &&
      isMember(unwrap(node.arguments[0]), 'models') &&
      hasProperties(node.arguments[1], ['sliderModelsConfig', 'includeUltraInSlider']) &&
      !property(node.arguments[1], 'stripGptPrefix') &&
      isMember(
        unwrap(property(node.arguments[1], 'includeUltraInSlider')).left,
        'ultraEffortEnabled',
      ),
    'HOME stock preset normalization',
  );
  const block = module.ancestor(preset, (node) => node.type === 'IfStatement');
  const local = scope(module, block);
  const fallback = local.one(
    (node) =>
      node.type === 'AssignmentExpression' &&
      node.right.type === 'LogicalExpression' &&
      node.right.operator === '??' &&
      node.right.left.type === 'CallExpression' &&
      isMember(node.right.left.callee, 'at') &&
      isIdentifier(node.right.right) &&
      node.right.right.name === node.left.name &&
      literalValue(node.right.left.arguments[0]?.argument) === 1 &&
      node.right.left.arguments[0]?.operator === '-',
    'HOME last-preset fallback',
  );
  const effort = identifier(fallback.left, 'normalized reasoning effort');
  const owner = module.ancestor(block, (node) => node.type === 'FunctionDeclaration');
  const ownerScope = scope(module, owner);
  const declaration = ownerScope.one(
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.id.name === effort &&
      isMember(node.init, 'reasoningEffort'),
    'HOME saved reasoning effort',
  );
  const responseData = unwrap(property(preset.arguments[1], 'includeUltraInSlider')).left.object;
  if (!isMember(responseData, 'data'))
    throw Error('Compatibility check failed: HOME preset response shape changed');
  const response = responseData.object;
  const dataGuard = local.one(
    (node) =>
      node.type === 'BinaryExpression' &&
      node.operator === '!=' &&
      isMember(unwrap(node.left), 'data') &&
      module.text(unwrap(node.left).object) === module.text(response) &&
      literalValue(node.right) === null,
    'HOME loaded preset guard',
  );
  const nativeAnd = module.parents.get(dataGuard);
  const enabled = identifier(nativeAnd.left, 'HOME normalization enabled');
  const exempt = local.one(
    (node) =>
      node.type === 'CallExpression' &&
      isMember(node.callee, 'some') &&
      isIdentifier(node.arguments[0]),
    'HOME preset exemption predicate',
  );
  const mapper = local.one(
    (node) =>
      node.type === 'CallExpression' &&
      isMember(node.callee, 'map') &&
      isIdentifier(node.arguments[0]),
    'HOME preset effort projection',
  );
  const read = local.all(
    (node) =>
      node.type === 'CallExpression' &&
      literalValue(node.arguments[0]) === 'nico.codex.model-spread.v1',
  );
  if (read.length > 1)
    throw Error('Compatibility check failed: ambiguous HOME persisted settings read');
  const parameters = {
    selection: identifier(declaration.init.object, 'HOME saved selection'),
    enabled,
    response: identifier(response, 'HOME preset response'),
    presetChoices: identifier(preset.callee, 'HOME stock preset function'),
    models: identifier(unwrap(preset.arguments[0]).object, 'HOME models'),
    sliderConfig: identifier(
      property(preset.arguments[1], 'sliderModelsConfig'),
      'HOME slider config',
    ),
    skipPresetCoercion: identifier(exempt.arguments[0], 'HOME preset exemption'),
    effortValue: identifier(mapper.arguments[0], 'HOME effort projection'),
    ...(read.length ? { readSettings: identifier(read[0].callee, 'HOME persisted read') } : {}),
  };
  return {
    code: `let ${module.text(declaration)};${module.text(block)}`,
    parameters,
    result: effort,
    testEnd: block.test.end,
  };
}

export function discoverComposer(input) {
  const module = asModule(input);
  const stockChoices = module.one(
    (node) =>
      node.type === 'CallExpression' &&
      hasProperties(node.arguments[1], [
        'includeUltraInSlider',
        'sliderModelsConfig',
        'stripGptPrefix',
      ]),
    'composer default model spread',
  );
  const owner = module.ancestor(stockChoices, (node) => node.type === 'FunctionDeclaration');
  const local = scope(module, owner);
  const React = reactNamespace(local);
  const choiceBinding = expressionBinding(module, stockChoices, 'composer choices');
  const picker = local.one(
    (node) =>
      hasProperties(jsxProps(node), [
        'onBeforeSelectModel',
        'onSelectReasoningEffort',
        'powerSelections',
        'modelPickerTriggerConfig',
      ]),
    'native model picker',
  );
  const pickerProps = jsxProps(picker);
  const reasonCallback = functionAssignment(
    local,
    identifier(property(pickerProps, 'onSelectReasoningEffort'), 'reasoning callback'),
    'native reasoning selection callback',
  );
  const atomic = unique(
    local.all(
      (node) =>
        contains(reasonCallback, node) &&
        node.type === 'CallExpression' &&
        isIdentifier(node.callee) &&
        node.arguments.length === 2,
    ),
    'atomic model and reasoning setter',
  );
  if (
    module.text(atomic.arguments[0]) !== module.text(property(pickerProps, 'model')) ||
    atomic.arguments[1]?.name !== reasonCallback.params[0]?.name
  )
    throw Error('Compatibility check failed: native model and effort callback changed');
  const modeWrite = local.one(
    (node) =>
      node.type === 'CallExpression' &&
      isMember(node.callee, 'set') &&
      node.arguments.length === 2 &&
      literalValue(node.arguments[1]) === 'default',
    'native default selection mode write',
  );
  const scopeName = identifier(modeWrite.callee.object, 'composer scope');
  const scopeDeclaration = local.one(
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.id.name === scopeName &&
      node.init?.type === 'CallExpression',
    'composer scope hook',
  );
  const surface = local.one(
    (node) =>
      hasProperties(node, [
        'canRenderPowerPickerSurface',
        'isModelSettingsLoading',
        'skipExperimentExposure',
        'resetContextKey',
      ]),
    'native power picker surface',
  );
  const surfaceCondition = property(surface, 'canRenderPowerPickerSurface');
  if (surfaceCondition?.type !== 'LogicalExpression' || surfaceCondition.operator !== '&&')
    throw Error('Compatibility check failed: native picker availability changed');
  const ready = local.one(
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.init?.type === 'LogicalExpression' &&
      node.init.operator === '&&' &&
      module.text(node.init.left) === module.text(surfaceCondition.left) &&
      node.init.right.type === 'UnaryExpression' &&
      node.init.right.operator === '!' &&
      module.text(node.init.right.argument) ===
        module.text(property(surface, 'isModelSettingsLoading')),
    'native picker readiness',
  );
  const exposure = property(surface, 'skipExperimentExposure');
  let restricted = exposure;
  while (restricted?.type === 'LogicalExpression' && restricted.operator === '||')
    restricted = restricted.left;
  const lockObjects = deduplicate(
    local.all((node) => isMember(node, 'isModelLocked')).map((node) => module.text(node.object)),
  );
  const locked = unique(lockObjects, 'native locked model owner');
  const trigger = local.one(
    (node) =>
      node.type === 'ObjectPattern' &&
      ['triggerRef', 'onTriggerBlur', 'handleSelectAndClose'].every((key) =>
        node.properties.some((p) => propertyName(p.key) === key),
      ),
    'native composer trigger hook',
  );
  const triggerRef = identifier(
    trigger.properties.find((p) => propertyName(p.key) === 'triggerRef').value,
    'native trigger ref',
  );
  const effortNode = local.one(
    (node) =>
      node.type === 'Property' && propertyName(node.key) === 'data-selected-reasoning-effort',
    'native selected effort indicator',
  ).value;
  const resets = property(surface, 'resetContextKey');
  const host = unique(
    local.all((node) => contains(resets, node) && isMember(node, 'hostId')),
    'native composer host',
  );
  const catalog = identifier(stockChoices.arguments[0], 'native available model catalog');
  const advanced = local.one(
    (node) =>
      node.type === 'CallExpression' &&
      node.arguments[0]?.name === catalog &&
      hasProperties(node.arguments[1], ['stripGptPrefix']) &&
      node.arguments[1].properties.length === 1,
    'native model-effort catalog',
  );
  const advancedBinding = expressionBinding(module, advanced, 'native expanded model choices');
  local.one(
    (node) =>
      ['IfStatement', 'ConditionalExpression'].includes(node.type) &&
      module.text(node.test) === module.text(restricted) &&
      local.all(
        (candidate) =>
          contains(node.consequent, candidate) &&
          candidate.type === 'CallExpression' &&
          isMember(candidate.callee, 'map') &&
          candidate.callee.object.name === advancedBinding,
      ).length === 1,
    'native restricted model catalog',
  );
  const models = local.one(
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.id.type === 'ObjectPattern' &&
      ['data', 'status'].every((key) =>
        node.id.properties.some((p) => propertyName(p.key) === key),
      ) &&
      node.init?.type === 'CallExpression',
    'native model list query',
  );
  const labelFunction = module.one(
    (node) =>
      node.type === 'FunctionDeclaration' &&
      node.body.body.some(
        (statement) =>
          statement.type === 'VariableDeclaration' &&
          statement.declarations.some(
            (d) =>
              d.id.type === 'ObjectPattern' &&
              [
                'model',
                'displayName',
                'labelClassName',
                'serviceTierIconKind',
                'stripGptPrefix',
              ].every((key) => d.id.properties.some((p) => propertyName(p.key) === key)),
          ),
      ),
    'native model label',
  );
  const labelScope = scope(module, labelFunction);
  const customLabel = labelScope.one(
    (node) => literalValue(property(jsxProps(node), 'id')) === 'composer.mode.local.model.custom',
    'native model label message',
  );
  const labelId = module.one(
    (node) => literalValue(node) === 'composer.mode.local.reasoning.none.label',
    'native reasoning label dictionary',
  );
  const labelsObject = module.ancestor(labelId, (node) => node.type === 'CallExpression');
  const labels = expressionBinding(module, labelsObject, 'native reasoning labels');
  const pickerOwner = module.one(
    (node) =>
      node.type === 'FunctionDeclaration' &&
      node.id.name === identifier(picker.arguments[0], 'native picker component'),
    'native picker implementation',
  );
  const pickerScope = scope(module, pickerOwner);
  const checkIcons = deduplicate(
    pickerScope
      .all(
        (node) =>
          node.type === 'Property' &&
          propertyName(node.key) === 'RightIcon' &&
          node.value.type === 'ConditionalExpression' &&
          isIdentifier(node.value.consequent),
      )
      .map((node) => node.value.consequent.name),
  );
  const directReturn = unique(
    owner.body.body.filter(
      (node) =>
        node.type === 'IfStatement' &&
        local.all(
          (candidate) =>
            candidate.type === 'ReturnStatement' &&
            contains(node, candidate) &&
            module.ancestor(candidate, isFunction) === owner,
        ).length,
    ),
    'composer loading return',
  );
  return {
    edit: {
      start: stockChoices.start,
      end: stockChoices.end,
      text: `ModelSpreadMod.customChoices(ModelSpreadMod.useSettings(${React}),${catalog},${module.text(stockChoices)},${module.text(host)})`,
    },
    hook: {
      start: directReturn.start,
      end: directReturn.start,
      text: `ModelSpreadMod.useComposer(${React},{trigger:${triggerRef},choices:${choiceBinding},model:${module.text(atomic.arguments[0])},effort:${module.text(effortNode)},enabled:${module.text(surfaceCondition.left)}&&${module.text(ready.id)}&&!${module.text(restricted)}&&!${locked}?.isModelLocked,select:async choice=>{if(!${module.text(property(pickerProps, 'onBeforeSelectModel'))}(choice.model))return false;${scopeName}.set(${module.text(modeWrite.arguments[0])},\`default\`);return ${module.text(atomic.callee)}(choice.model,choice.reasoningEffort);}});`,
    },
    bindings: {
      React,
      initialize: findInitializer(module, React),
      scopeHook: module.text(scopeDeclaration.init.callee),
      scopeKey: module.text(scopeDeclaration.init.arguments[0]),
      modelsHook: module.text(models.init.callee),
      defaultChoices: module.text(stockChoices.callee),
      selectionMode: module.text(modeWrite.arguments[0]),
      ModelLabel: labelFunction.id.name,
      Message: module.text(customLabel.arguments[0]),
      effortLabels: labels,
      allChoices: module.text(advanced.callee),
      Picker: module.text(picker.arguments[0]),
      CheckIcon: unique(checkIcons, 'native model picker selected check icon'),
    },
  };
}

export function patchAgentSettings(input) {
  const module = asModule(input);
  const label = module.one(
    (node) => literalValue(node) === 'settings.agent.modelFeatures.modelPickerSliderUltra.label',
    'model feature settings section',
  );
  const owner = module.ancestor(label, (node) => node.type === 'FunctionDeclaration');
  const local = scope(module, owner);
  const row = unique(
    local.all(
      (node) =>
        hasProperties(jsxProps(node), ['label', 'description', 'control']) &&
        contains(property(jsxProps(node), 'label'), label),
    ),
    'native settings row',
  );
  const hostPattern = local.one(
    (node) =>
      node.type === 'ObjectPattern' &&
      node.properties.some((p) => propertyName(p.key) === 'hostId'),
    'model settings host scope',
  );
  const host = hostPattern.properties.find((p) => propertyName(p.key) === 'hostId').value;
  const returned = unique(
    owner.body.body.filter((node) => node.type === 'ReturnStatement'),
    'model settings return',
  );
  const rootCandidates = local.all(
    (node) =>
      contains(returned, node) &&
      jsxProps(node) &&
      property(jsxProps(node), 'children')?.type === 'ArrayExpression',
  );
  const root = unique(
    rootCandidates.filter(
      (node) => !rootCandidates.some((other) => other !== node && contains(other, node)),
    ),
    'native model settings section children',
  );
  const children = property(jsxProps(root), 'children');
  return editSource(module.source, [
    {
      start: children.end - 1,
      end: children.end - 1,
      text: `,(${module.text(row.callee)})(ModelSpreadSettings,{hostId:${module.text(host)},row:${module.text(row.arguments[0])}})`,
    },
  ]);
}

export function discoverMicroSettings(input) {
  const module = asModule(input);
  const label = module.one(
    (node) => node.type === 'SpreadElement' && isMember(node.argument, 'knob'),
    'native Micro knob label',
  );
  const owner = module.ancestor(label, (node) => node.type === 'FunctionDeclaration');
  const local = scope(module, owner);
  const labelCall = module.ancestor(label, (node) => node.type === 'CallExpression');
  const labelBinding = expressionBinding(module, labelCall, 'Micro knob label');
  const row = local.one(
    (node) =>
      hasProperties(jsxProps(node), ['label', 'description', 'control']) &&
      property(jsxProps(node), 'label')?.name === labelBinding,
    'native Micro knob row',
  );
  const control = property(jsxProps(row), 'control');
  const controlProps = jsxProps(control);
  const options = local.one(
    (node) =>
      node.type === 'CallExpression' &&
      isMember(node.callee, 'map') &&
      isMember(node.callee.object, 'options') &&
      node.arguments[0]?.type === 'ArrowFunctionExpression' &&
      local.all(
        (candidate) =>
          contains(node, candidate) &&
          candidate.type === 'Property' &&
          propertyName(candidate.key) === 'encoderMode',
      ).length,
    'Micro knob option mapping',
  );
  const mapped = options.arguments[0];
  const choice = identifier(mapped.params[0], 'Micro knob choice');
  const optionScope = scope(module, mapped);
  const update = optionScope.one(
    (node) =>
      node.type === 'CallExpression' &&
      node.arguments.some((argument) => hasProperties(argument, ['encoderMode'])),
    'native Micro layout update',
  );
  const updateObject = unique(
    update.arguments.filter((argument) => hasProperties(argument, ['encoderMode'])),
    'native encoder layout',
  );
  const layout = unique(
    updateObject.properties.filter((p) => p.type === 'SpreadElement'),
    'native Micro layout spread',
  ).argument;
  const onSelect = optionScope.one(
    (node) => node.type === 'Property' && propertyName(node.key) === 'onSelect',
    'Micro mode select handler',
  ).value;
  if (
    !isFunction(onSelect) ||
    onSelect.params.length !== 0 ||
    property(updateObject, 'encoderMode')?.name !== choice
  )
    throw Error('Compatibility check failed: native Micro mode callback changed');
  const item = module.ancestor(onSelect, (node) => node.type === 'CallExpression');
  const triggerBinding = identifier(
    property(controlProps, 'triggerButton'),
    'Micro knob menu trigger',
  );
  const trigger = local.one(
    (node) =>
      node.type === 'AssignmentExpression' &&
      node.left.name === triggerBinding &&
      jsxProps(node.right),
    'Micro knob trigger component',
  ).right;
  const metadata = local.one(
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.init?.type === 'MemberExpression' &&
      node.init.computed &&
      isMember(node.init.property, 'encoderMode') &&
      module.text(node.init.property.object) === module.text(layout),
    'Micro mode metadata',
  );
  return {
    edit: {
      start: row.start,
      end: row.end,
      text: `(${module.text(row.callee)})(MSMode,{layout:${module.text(layout)},options:${module.text(options.callee.object)},onChange:${choice}=>${module.text(onSelect.body)}})`,
    },
    bindings: {
      React: reactNamespace(local),
      Message: module.text(labelCall.arguments[0]),
      labels: module.text(label.argument.object),
      modes: module.text(metadata.init.object),
      Row: module.text(row.arguments[0]),
      Menu: module.text(control.arguments[0]),
      Items: module.text(item.arguments[0].object),
      SettingsTrigger: module.text(trigger.arguments[0]),
    },
  };
}
