import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as walk from 'acorn-walk';
import { analyze } from 'eslint-scope';
import { parseModule } from '../../lib/source-contract.mjs';
import { fixtureSourceModules, renameBindings } from '../../lib/source-contract.test-support.mjs';
import { readArchive } from '../../lib/asar.mjs';
import { archiveModules, directoryModules } from '../../lib/source-modules.mjs';
import { transform } from './build-mod.mjs';

const modules = new WeakMap();
export function parseSource(source) {
  const module = parseModule(source);
  modules.set(module.ast, module);
  return module.ast;
}
export const textValue = (node) =>
  node?.type === 'Literal'
    ? node.value
    : node?.type === 'TemplateLiteral' && node.expressions.length === 0
      ? node.quasis[0].value.cooked
      : undefined;
export const propertyName = (node) =>
  node?.computed ? textValue(node.property) : node?.property?.name;
export const objectProperty = (node, name) =>
  node?.properties?.find(
    (property) =>
      property.type === 'Property' && (property.key.name ?? textValue(property.key)) === name,
  );
export const callee = (node) =>
  node?.type === 'SequenceExpression' ? node.expressions.at(-1) : node;

export function nodes(root, predicate, type) {
  const module = modules.get(root);
  if (module) return (type ? module.ofType(type) : module.nodes).filter(predicate);
  const found = [];
  walk.full(root, (node) => {
    if (predicate(node)) found.push(node);
  });
  return found;
}

export function one(values, label) {
  assert.equal(values.length, 1, `one ${label}`);
  return values[0];
}

export function identifier(node, label = 'binding') {
  assert.equal(node?.type, 'Identifier', label);
  return node.name;
}

export function evaluate(source, bindings) {
  return new Function(...Object.keys(bindings), source)(...Object.values(bindings));
}

export function externalNames(source) {
  const scope = analyze(parseSource(source), { ecmaVersion: 2024, sourceType: 'module' });
  return [
    ...new Set(scope.globalScope.through.map((reference) => reference.identifier.name)),
  ].filter((name) => !(name in globalThis));
}

let fixtures;
export function nativeFixtures() {
  if (fixtures) return fixtures;
  const directory = process.env.MODEL_SPREAD_BUNDLES
    ? path.resolve(process.env.MODEL_SPREAD_BUNDLES)
    : path.join(import.meta.dirname, 'bundles');
  const roles = [
    'app-primary-',
    'app-initial-',
    'agent-settings-',
    'codex-micro-settings-',
    'codex-micro-bridge-',
  ];
  const files = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  const names = roles.map((prefix) =>
    files.filter((name) => name.startsWith(prefix) && name.endsWith('.js')),
  );
  const available = names.every((matches) => matches.length === 1);
  if (process.env.MODEL_SPREAD_BUNDLES)
    assert.ok(available, 'explicit fixture directory contains exactly one bundle per role');
  if (!available) return (fixtures = []);
  const original = Object.fromEntries(
    names.flat().map((name) => [name, fs.readFileSync(path.join(directory, name), 'utf8')]),
  );
  const archives = [
    ...new Set([
      ...(process.env.MODEL_SPREAD_REGRESSION_ARCHIVES ?? '').split(path.delimiter).filter(Boolean),
      ...(process.env.APP_TOOLS_AUTH_SOURCE
        ? [path.join(process.env.APP_TOOLS_AUTH_SOURCE, 'Contents/Resources/app.asar')]
        : []),
    ]),
  ];
  const hasArchiveMarker = fs.existsSync(path.join(directory, 'source-archive.json'));
  let sourceModules = hasArchiveMarker
    ? fixtureSourceModules(directory)
    : directoryModules(directory);
  if (!hasArchiveMarker && archives.length) {
    sourceModules = one(
      archives
        .map((file) => archiveModules(readArchive(file)))
        .filter((candidate) =>
          Object.entries(original).every(
            ([name, source]) => candidate.names.includes(name) && candidate.read(name) === source,
          ),
        ),
      'stock archive matching the native fixtures',
    );
  }
  const renamed = Object.fromEntries(
    Object.entries(original).map(([name, source]) => [name, renameBindings(source)]),
  );
  const renamedModules = new Map(Object.entries(renamed));
  const alphaModules = {
    names: sourceModules.names,
    read(name) {
      if (!renamedModules.has(name))
        renamedModules.set(name, renameBindings(sourceModules.read(name)));
      return renamedModules.get(name);
    },
  };
  fixtures = [
    ['shipped', original, sourceModules],
    ['alpha-renamed', renamed, alphaModules],
  ].map(([name, originals, modules]) => {
    let patched;
    const context = { sourceModules: modules };
    return {
      name,
      originals,
      context,
      get patched() {
        return (patched ??= transform(originals, context));
      },
    };
  });
  return fixtures;
}

export function bundle(fixture, prefix, patched = true) {
  const source = patched ? fixture.patched : fixture.originals;
  return source[
    one(
      Object.keys(source).filter((name) => name.startsWith(prefix)),
      `${prefix} bundle`,
    )
  ];
}

export function findOwner(ast, predicate, label, type) {
  const owners = new Set();
  const module = modules.get(ast);
  if (module) {
    for (const node of nodes(ast, predicate, type)) {
      const owner = module.ancestor(node, (ancestor) => ancestor.type === 'FunctionDeclaration');
      assert.ok(owner, `${label} is owned by a function`);
      owners.add(owner);
    }
    return one([...owners], label);
  }
  walk.fullAncestor(ast, (node, _state, ancestors) => {
    if (!predicate(node)) return;
    const owner = ancestors.findLast((ancestor) => ancestor.type === 'FunctionDeclaration');
    assert.ok(owner, `${label} is owned by a function`);
    owners.add(owner);
  });
  return one([...owners], label);
}
