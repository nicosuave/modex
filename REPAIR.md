# Repairing Modex

Read this when verification, packaging, signing, permissions, or runtime behavior fails. Diagnose the actual failing layer, fix the smallest source-backed surface, and rerun relevant verification. Follow [AGENTS.md](AGENTS.md) for preservation, installation, and acceptance rules.

## Classify the failure

- Tool/dependency failure: inspect the actual error and use the lockfile. Missing Bun or OS authorization may require user action rather than patch changes.
- Source signature/integrity failure: confirm the source is pristine stock, not a modified copy. Do not bless damaged input or disable checks.
- Version/hash failure: inspect the new stock implementation and follow the affected mod's adaptation guide. Changing manifest hashes alone does not establish compatibility.
- Missing/duplicate anchor, syntax/import/test failure: inspect the owning transform or adapter, surrounding implementation, and callers. Minified names have no stable meaning across builds.
- Existing output/backup: preserve it and choose a new output. Reuse backups only through explicit helper verification.
- Packaging/signing failure: inspect subprocess errors, destination permissions, disk space, certificate availability, and entitlements. Preserve nested vendor signatures and identity-entitlement removal. Retain certificate signing; do not disable Electron fuses, SIP, or Gatekeeper.
- Input Monitoring denial despite an enabled switch: inspect the actual app's bundle ID, signing team, and designated requirement, and whether the macOS grant matches. Authorize the modded app itself, not stock or an old launcher. Preserve bundle ID and team across updates and display-name changes. Never reset unrelated app permissions.
- Runtime failure: inspect the separate copy's logs/renderer errors and native import exports. Use an isolated profile before blaming user settings. Do not reset profiles or copy authentication files as a fix.

## Repair and verify

Read the affected mod's README, compatibility manifest, transforms, and scoped repair guide before adapting it. [Model Spread's repair guide](mods/model-spread/REPAIR.md) covers native model/effort normalization, persistence, composer/Micro behavior, and version adaptation.

Preserve exact replacement guards and behavioral tests. After a source-backed repair, rerun the affected tests and verifier; installation or compatibility changes also require a preparation dry run and full packaging. Check launched behavior when authorized and available, and report incomplete hardware/account checks explicitly.

An identical repeated failure calls for a new diagnosis, not blind retries. When semantics remain uncertain, inspect directly related imports/callers and record the unresolved assumption. If evidence cannot establish correctness, stop dependent edits and report the exact missing evidence or user decision while completing independent work. Never present a partial copy as ready or silently remove features.
