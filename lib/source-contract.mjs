import { parse } from 'acorn';
import { fullAncestor } from 'acorn-walk';
import { analyze } from 'eslint-scope';

// Verification reuses the same large vendor modules across transforms. Weak
// entries avoid keeping their ASTs alive once consumers release them.
const parsedSources = new Map();
const bindingIndexes = new WeakMap();

// Resolve references to declarations before comparing names. Minifiers routinely
// reuse a module binding's spelling inside unrelated functions and blocks.
export function lexicalBindings(module) {
  if (bindingIndexes.has(module)) return bindingIndexes.get(module);
  const scopes = analyze(module.ast, {
    ecmaVersion: 2024,
    sourceType: 'module',
    optimistic: true,
    ignoreEval: true,
  });
  const resolved = new WeakMap();
  for (const scope of scopes.scopes) {
    for (const variable of scope.variables)
      for (const identifier of variable.identifiers) resolved.set(identifier, variable);
    for (const reference of scope.references)
      if (reference.resolved) resolved.set(reference.identifier, reference.resolved);
  }
  const moduleScope = scopes.scopes.find((scope) => scope.type === 'module');
  const writes = new Map();
  for (const node of module.nodes) {
    const identifier =
      node.type === 'AssignmentExpression'
        ? node.left
        : node.type === 'VariableDeclarator'
          ? node.id
          : null;
    const value = node.type === 'AssignmentExpression' ? node.right : node.init;
    const binding = identifier?.type === 'Identifier' && resolved.get(identifier);
    if (binding && value) {
      if (!writes.has(binding)) writes.set(binding, []);
      writes.get(binding).push({ node, value });
    }
  }
  const result = {
    resolve: (identifier) => resolved.get(identifier),
    moduleBinding: (name) => moduleScope.set.get(name),
    writes: (binding) => writes.get(binding) ?? [],
  };
  bindingIndexes.set(module, result);
  return result;
}

export function lazyInitializerOwner(module, node) {
  const declaration = module.ancestor(
    node,
    (candidate) =>
      candidate.type === 'VariableDeclarator' &&
      candidate.init?.type === 'CallExpression' &&
      candidate.init.arguments.some(isFunction),
  );
  if (declaration?.id.type !== 'Identifier') throw Error('Missing native lazy initializer owner');
  return declaration.id.name;
}

export function bindingInitializer(module, reference) {
  const bindings = lexicalBindings(module);
  const binding =
    typeof reference === 'string' ? bindings.moduleBinding(reference) : bindings.resolve(reference);
  if (!binding) throw Error('Missing native lexical binding');
  const assignment = unique(bindings.writes(binding), `${binding.name} initialization`);
  return lazyInitializerOwner(module, assignment.node);
}

export function unique(values, label) {
  if (values.length !== 1)
    throw Error(`Compatibility check failed: expected one ${label}; found ${values.length}`);
  return values[0];
}

export function literalValue(node) {
  if (node?.type === 'Literal') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return undefined;
}

export function propertyName(node) {
  if (node?.type === 'Identifier') return node.name;
  return literalValue(node);
}

export function isFunction(node) {
  return ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(
    node?.type,
  );
}

export function parseModule(source) {
  const cached = parsedSources.get(source)?.deref();
  if (cached) return cached;
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ranges: true });
  const nodes = [];
  const byType = new Map();
  const parents = new WeakMap();
  fullAncestor(ast, (node, _state, ancestors) => {
    nodes.push(node);
    if (!byType.has(node.type)) byType.set(node.type, []);
    byType.get(node.type).push(node);
    if (ancestors.length > 1) parents.set(node, ancestors.at(-2));
  });
  const module = {
    source,
    ast,
    nodes,
    parents,
    ofType: (type) => byType.get(type) ?? [],
    text: (node) => source.slice(node.start, node.end),
    all: (predicate) => nodes.filter(predicate),
    one: (predicate, label) => unique(nodes.filter(predicate), label),
    ancestor(node, predicate = isFunction) {
      for (let parent = parents.get(node); parent; parent = parents.get(parent))
        if (predicate(parent)) return parent;
      return null;
    },
  };
  parsedSources.set(source, new WeakRef(module));
  if (parsedSources.size > 8) parsedSources.delete(parsedSources.keys().next().value);
  return module;
}

export function editSource(source, edits) {
  const ordered = [...edits].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let cursor = 0;
  const parts = [];
  for (const { start, end, text } of ordered) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < cursor ||
      end < start ||
      end > source.length
    )
      throw Error('Invalid or overlapping source-contract edits');
    parts.push(source.slice(cursor, start), text);
    cursor = end;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}
