# Repairing failures

Load this when deterministic verification or runtime behavior fails. Fix the smallest source-backed surface and rerun verification; a green hash gate alone is insufficient.

## Classify first

- Tool/dependency failure: inspect the actual error and use the lockfile. Missing Bun or OS permission may need user action, not patch changes.
- Signature/integrity failure: confirm the source is pristine stock, not a modified copy. Do not bless damaged input or disable checks.
- Version/hash failure: follow the compatibility adaptation below.
- Missing/duplicate anchor, syntax/import/test failure: inspect the owning adapter, surrounding implementation, and callers. Minified names have no stable meaning across builds.
- Existing output/backup: preserve it; choose a new output. Reuse backups only through helper verification.
- Packaging/signing failure: inspect subprocess errors, destination permissions, disk space, and entitlements. Preserve nested vendor signatures and identity-entitlement removal. Do not disable Electron fuses, SIP, or Gatekeeper.
- Input Monitoring denial despite an enabled switch: inspect the actual signed app identity and stored macOS code requirement. Authorize the modded app itself, not an old launcher; preserve the mod bundle ID and certificate team across updates. Never reset unrelated app permissions.
- Runtime failure: inspect the second copy's logs/renderer errors and native import exports. Use an isolated profile before blaming user settings. Do not reset profiles or copy authentication files as a fix.

## Adapt a new build

1. Read `Contents/Info.plist` and verify the stock signature. Inspect `Contents/Resources/app.asar` using `readArchive`, `entryFor`, and `readEntry` from `../../lib/asar.mjs`. The asset inventory is `entryFor(archive, 'webview/assets').files`. Extract needed files only into local scratch space.
2. Locate the roles used by `transform()` in `build-mod.mjs`: primary, initial, agent settings, Micro settings, and Micro bridge. Trace stable UI strings, action names, imports, and callers if prefixes changed. Record a local mapping of old anchors to new implementations with evidence of equivalent behavior.
3. Review every transform and `*.template.*` native alias. Trace model lists, supported efforts, availability/access, atomic selection, persistence, editor components, Micro dispatch, and usage notice ownership. Review the hard-coded rewind asset and persisted-atom exports too. If roles moved, update role selection and manifest together.
4. Prove each new replacement belongs to the intended behavior and matches exactly once. For sliced regions, validate both boundaries and uniqueness; strengthen ambiguous guards. Do not apply broad replacements across minified code.
5. After reviewing mappings, calculate SHA-256 from exact source bytes and update manifest version/build/files. Rerun verification and resolve each concrete remaining failure. An identical repeated failure calls for a new diagnosis, not blind retries.
6. Add or update behavioral regression tests for changed code. Preserve the existing cases. Run verification, preparation dry run, full packaging, and runtime acceptance from AGENTS.md. Update README's supported version only to the accepted implementation; report any incomplete runtime checks.

## Known mechanisms

- HOME post-save stock-preset coercion changed valid custom High/Max to xhigh after optimistic state cleared. Separate supported-effort validation from preset coercion. `native-normalization.test.mjs` executes the shipped block and proves the original failure and corrected behavior. Adapt its source extraction boundaries when necessary; do not replace it with a mock normalizer. Keep default and non-HOME cases.
- Renderer localStorage proved ephemeral here. Persistence uses native persisted atoms through `native-storage.template.mjs`. Trace new exports, preserve the key/schema, and verify restart persistence.
- Compiled parent memoization can stale injected settings. The settings row uses an independently subscribed child. Preserve hook ordering before early returns.
- Composer/Micro share one order, skip unavailable pairs, clamp endpoints, and use native access checks and the atomic setter. Verify both optimistic and settled saved state.
- Usage suppression targets the owning composer notice flow. Preserve image-limit/other notices and native send; do not patch service enforcement.

When semantics remain uncertain, inspect directly related imports/callers and record the unresolved assumption. If evidence still cannot establish correctness, stop dependent edits and report the exact missing evidence or user decision while completing independent work. Never present a partial copy as ready or silently remove features.
