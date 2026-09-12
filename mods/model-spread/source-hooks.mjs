import { parseModule } from '../../lib/source-contract.mjs';

// These hooks recognize the native operation and capture its local bindings.
// Missing, changed or ambiguous operation shapes fail closed, while renaming
// local bindings does not require another adapter edit.
const identifier = String.raw`[$A-Z_a-z][$\w]*`;

function replaceMatch(source, pattern, label, replacement, accepts = () => true) {
  const matches = [...source.matchAll(new RegExp(pattern, 'g'))].filter(accepts);
  if (matches.length !== 1)
    throw Error(`Compatibility check failed: expected one ${label}; found ${matches.length}`);
  const match = matches[0];
  return (
    source.slice(0, match.index) +
    replacement(match.groups) +
    source.slice(match.index + match[0].length)
  );
}

export function patchUsageBanners(source) {
  const module = parseModule(source);
  return replaceMatch(
    source,
    String.raw`(?<owner>canShowUsageBanners:(?<enabled>${identifier}),hostId:${identifier},imageGenerationLimit:(?<image>${identifier}),[^{};]{0,500}lowerPriorityContent:(?<fallback>${identifier}),[^{};]{0,500}\}=${identifier},[\s\S]{0,6000}?)` +
      String.raw`if\(!\k<enabled>\)return \k<fallback>;` +
      String.raw`(?<classify>let ${identifier}=${identifier}\(\{hasImageGenerationLimit:\k<image>!=null,)`,
    'usage banner owner with image-limit classification',
    ({ owner, enabled, image, fallback, classify }) =>
      `${owner}if(!${enabled}||${image}==null)return ${fallback};${classify}`,
    (match) => {
      const declaration = module
        .ofType('VariableDeclarator')
        .find(
          (node) =>
            node.id.type === 'ObjectPattern' &&
            node.id.start <= match.index &&
            node.id.end > match.index,
        );
      const statement = module.parents.get(declaration);
      const block = module.parents.get(statement);
      if (block?.type !== 'BlockStatement') return false;
      const guardStart = match.index + match.groups.owner.length;
      const guard = block.body.find(
        (node) => node.type === 'IfStatement' && node.start === guardStart,
      );
      const classification = block.body[block.body.indexOf(guard) + 1];
      // Both operations must be direct statements in the declaration's block.
      // Matching names then refer to those lexical bindings, never a sibling
      // function's parameters or bindings shadowed inside a nested block.
      return (
        guard != null &&
        classification?.type === 'VariableDeclaration' &&
        classification.start === guard.end &&
        source.startsWith(match.groups.classify, classification.start)
      );
    },
  );
}

export function patchSelectionMode(source) {
  return replaceMatch(
    source,
    String.raw`(?<mode>${identifier})=(?<lookup>${identifier}\(${identifier},${identifier},${identifier}\)==null\?\x60model\x60:)(?<preference>${identifier})\?\?\x60default\x60`,
    'native model/default selection reconciliation',
    ({ mode, lookup, preference }) =>
      `${mode}=ModelSpreadMod.store().get().slots!==null&&${preference}!==\`model\`?\`default\`:${lookup}${preference}??\`default\``,
  );
}

export function patchExperimentExposure(source) {
  return replaceMatch(
    source,
    String.raw`skipExperimentExposure:(?<native>${identifier}\|\|${identifier}===\x60model\x60\|\|${identifier}\|\|${identifier})(?=[,}])`,
    'native slider experiment exposure guard',
    ({ native }) => `skipExperimentExposure:ModelSpreadMod.store().get().slots!==null||${native}`,
  );
}

export function patchMicroDispatch(source) {
  return replaceMatch(
    source,
    String.raw`(?<guard>let (?<composer>${identifier})=${identifier}\(\);if\(\k<composer>==null\|\|${identifier}\(\).getActivationTarget\(\k<composer>.root,\k<composer>.composerId,\x60reasoning\x60\)==null\)return;)` +
      String.raw`(?<dispatch>${identifier}\((?<direction>${identifier})===\x60ArrowUp\x60\?\x60composer.decreaseReasoningEffort\x60:\x60composer.increaseReasoningEffort\x60,\x60codex_micro_encoder\x60\))`,
    'Micro reasoning dispatch with native activation guard',
    ({ guard, composer, direction, dispatch }) =>
      `${guard}ModelSpreadMod.microEnabled()?${composer}.root.dispatchEvent(new CustomEvent(ModelSpreadMod.EVENT,{detail:{direction:${direction}===\`ArrowUp\`?-1:1}})):${dispatch}`,
  );
}
