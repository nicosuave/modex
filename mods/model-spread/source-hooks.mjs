// These hooks recognize the native operation and capture its local bindings.
// Exact input hashes are still enforced by preparation; this only avoids manual
// rewrites when a reviewed build renames those bindings.
const identifier = String.raw`[$A-Z_a-z][$\w]*`;

function replaceMatch(source, pattern, label, replacement) {
  const matches = [...source.matchAll(new RegExp(pattern, 'g'))];
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
  return replaceMatch(
    source,
    String.raw`(?<owner>canShowUsageBanners:(?<enabled>${identifier}),hostId:${identifier},imageGenerationLimit:(?<image>${identifier}),[^{};]{0,500}lowerPriorityContent:(?<fallback>${identifier}),[^{};]{0,500}\}=${identifier},[^{};]{0,500};\s*)` +
      String.raw`if\(!\k<enabled>\)return \k<fallback>;` +
      String.raw`(?<classify>let ${identifier}=${identifier}\(\{hasImageGenerationLimit:\k<image>!=null,)`,
    'usage banner owner with image-limit classification',
    ({ owner, enabled, image, fallback, classify }) =>
      `${owner}if(!${enabled}||${image}==null)return ${fallback};${classify}`,
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
