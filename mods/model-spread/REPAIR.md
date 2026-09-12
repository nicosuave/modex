# Repairing failures

Load this when deterministic verification or runtime behavior fails. Fix the smallest source-backed surface and rerun verification; a green hash gate alone is insufficient.

Start with the [shared repair guide](../../REPAIR.md) for environment, source integrity, packaging, signing, permissions, and profile failures. The sections below cover Model Spread adaptation and native behavior.

## Adapt a new build

1. Read `Contents/Info.plist` and verify the stock signature. Inspect `Contents/Resources/app.asar` using `readArchive`, `entryFor`, and `readEntry` from `../../lib/asar.mjs`. The asset inventory is `entryFor(archive, 'webview/assets').files`. Extract needed files only into local scratch space.
2. Locate the roles used by `transform()` in `build-mod.mjs`: primary, initial, agent settings, Micro settings, and Micro bridge. Trace stable UI strings, action names, imports, and callers if prefixes changed. `source-hooks.mjs`, `source-contracts.mjs`, and `native-contract.mjs` capture these roles from source structure; do not add tables of minified aliases for each release.
3. Review the captured model lists, supported efforts, availability/access, atomic selection, persistence, editor components, Micro dispatch, and usage notice ownership. Native adapters follow dependency modules through the source inventory, including their exports and lazy initializers. If roles moved, repair the semantic contract and its behavioral tests.
4. Prove each new replacement belongs to the intended behavior and matches exactly once. For sliced regions, validate both boundaries and uniqueness; strengthen ambiguous guards. Do not apply broad replacements across minified code.
5. Use `--current-source` to verify the new source without changing the baseline manifest. Only when deliberately promoting a reviewed baseline, calculate SHA-256 from exact source bytes and update manifest version/build/files. Rerun verification and resolve each concrete remaining failure. An identical repeated failure calls for a new diagnosis, not blind retries.
6. Add or update behavioral regression tests for changed code, including lexically renamed source and missing/ambiguous contracts. Preserve the existing cases. Run verification, preparation dry run, full packaging, and runtime acceptance from AGENTS.md. Update README's supported version only to the accepted implementation; report any incomplete runtime checks.

## Known mechanisms

- HOME post-save stock-preset coercion changed valid custom High/Max to xhigh after optimistic state cleared. Separate supported-effort validation from preset coercion. `native-normalization.test.mjs` executes the shipped block and proves the original failure and corrected behavior. Adapt its source extraction boundaries when necessary; do not replace it with a mock normalizer. Keep default and non-HOME cases.
- Renderer localStorage proved ephemeral here. Persistence uses native persisted atoms through `native-storage.template.mjs`. Trace new exports, preserve the key/schema, and verify restart persistence.
- Compiled parent memoization can stale injected settings. The settings row uses an independently subscribed child. Preserve hook ordering before early returns.
- Composer/Micro share one order, skip unavailable pairs, clamp endpoints, and use native access checks and the atomic setter. Verify both optimistic and settled saved state.
- Usage suppression targets the owning composer notice flow. Preserve image-limit/other notices and native send; do not patch service enforcement.

When semantics remain uncertain, inspect directly related imports/callers and record the unresolved assumption. If evidence still cannot establish correctness, stop dependent edits and report the exact missing evidence or user decision while completing independent work. Never present a partial copy as ready or silently remove features.
