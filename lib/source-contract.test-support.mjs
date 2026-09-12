import { analyze } from 'eslint-scope';
import fs from 'node:fs';
import path from 'node:path';
import { readArchive } from './asar.mjs';
import { archiveModules, directoryModules } from './source-modules.mjs';
import { parseModule, editSource } from './source-contract.mjs';

export function fixtureSourceModules(directory) {
  const metadata = path.join(directory, 'source-archive.json');
  if (!fs.existsSync(metadata)) return directoryModules(directory);
  const { archivePath } = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  return archiveModules(readArchive(archivePath));
}

// Rename lexical bindings and their resolved references, leaving property names
// and module import/export contracts intact. This simulates minifier churn.
export function renameBindings(source) {
  const { ast } = parseModule(source);
  const parents = new WeakMap();
  function visit(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') {
      if (parent) parents.set(node, parent);
      for (const [key, value] of Object.entries(node)) {
        if (key === 'range') continue;
        if (Array.isArray(value)) for (const child of value) visit(child, node);
        else if (value && typeof value.type === 'string') visit(value, node);
      }
    }
  }
  visit(ast, null);
  const scopes = analyze(ast, {
    ecmaVersion: 2024,
    sourceType: 'module',
    optimistic: true,
    ignoreEval: true,
  });
  const usedNames = new Set(
    scopes.scopes.flatMap((scope) => scope.variables.map((variable) => variable.name)),
  );
  const changes = new Map();
  const namesByDeclaration = new Map();
  let index = 0;
  const directExport = (node) => {
    for (let parent = parents.get(node); parent; parent = parents.get(parent)) {
      if (parent.type === 'ExportNamedDeclaration' && parent.declaration) return true;
      if (
        (parent.type === 'FunctionDeclaration' ||
          parent.type === 'FunctionExpression' ||
          parent.type === 'ArrowFunctionExpression') &&
        parent.id !== node
      )
        return false;
    }
    return false;
  };
  for (const scope of scopes.scopes)
    for (const variable of scope.variables) {
      if (!variable.identifiers.length || variable.identifiers.some(directExport)) continue;
      // Class declarations have an outer binding and a class-local binding which
      // share one declaration token. They must receive the same new name.
      let replacement = variable.identifiers
        .map((node) => namesByDeclaration.get(`${node.start}:${node.end}`))
        .find(Boolean);
      if (!replacement)
        do replacement = `modexRenamed_${index++}`;
        while (usedNames.has(replacement));
      usedNames.add(replacement);
      for (const node of variable.identifiers)
        namesByDeclaration.set(`${node.start}:${node.end}`, replacement);
      const identifiers = new Set([
        ...variable.identifiers,
        ...variable.references.map((ref) => ref.identifier),
      ]);
      for (const identifier of identifiers) {
        const parent = parents.get(identifier);
        let text = replacement;
        if (parent?.type === 'ImportSpecifier' && parent.imported.start === identifier.start)
          text = `${source.slice(parent.imported.start, parent.imported.end)} as ${replacement}`;
        else if (parent?.type === 'ExportSpecifier' && parent.exported.start === identifier.start)
          text = `${replacement} as ${source.slice(parent.exported.start, parent.exported.end)}`;
        else {
          const property = parent?.type === 'AssignmentPattern' ? parents.get(parent) : parent;
          if (
            property?.type === 'Property' &&
            property.shorthand &&
            property.key.start === identifier.start
          )
            text = `${source.slice(property.key.start, property.key.end)}: ${replacement}`;
        }
        const key = `${identifier.start}:${identifier.end}`;
        const existing = changes.get(key);
        if (existing && existing.text !== text) throw Error('Conflicting lexical rename');
        changes.set(key, { start: identifier.start, end: identifier.end, text });
      }
    }
  return editSource(source, [...changes.values()]);
}
