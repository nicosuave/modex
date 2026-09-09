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
- Missing native task tools with `Codex app tools pipe closed`: check for `dynamic_app_tools_peer_rejected reason=untrusted-code-signing-identity`. Follow the [app-tools authentication repair](mods/app-tools-auth/README.md); preserving Node and CLI signatures alone does not authorize the Modex ancestor. Do not disable the shared peer authorizer.

## Repair and verify

For native permission failures, also use the identity and process-lifetime checks below.

Read the affected mod's README, compatibility manifest, transforms, and scoped repair guide before adapting it. [Model Spread's repair guide](mods/model-spread/REPAIR.md) covers native model/effort normalization, persistence, composer/Micro behavior, and version adaptation.

Preserve exact replacement guards and behavioral tests. After a source-backed repair, rerun the affected tests and verifier; installation or compatibility changes also require a preparation dry run and full packaging. Check launched behavior when authorized and available, and report incomplete hardware/account checks explicitly.

An identical repeated failure calls for a new diagnosis, not blind retries. When semantics remain uncertain, inspect directly related imports/callers and record the unresolved assumption. If evidence cannot establish correctness, stop dependent edits and report the exact missing evidence or user decision while completing independent work. Never present a partial copy as ready or silently remove features.

## macOS permission continuity

The installed app is the baseline for an update. Compare its bundle ID, Developer ID team, and certificate designated requirement with the staged app using `codesign -dv --verbose=4` and `codesign -dr -`. A stable requirement across builds of a new mod does not establish continuity with the existing installation. Display names, Dock icons, and shared Codex profiles do not establish permission continuity either.

Keep the installed identity when changing the enabled mods. Do not silently substitute a standalone mod's defaults. If an entrypoint cannot retain the intended identity, resolve that limitation before presenting its output as an update. An intentionally separate app has separate grants: identify the exact app path to authorize before the user adopts it.

For Input Monitoring or native access failures:

1. Identify the running executable and PID. Inspect current app logs and narrowly scoped TCC logs. Check the responsible app attribution as well as the requesting helper; a direct test launch from another app can affect attribution. An isolated Codex profile isolates settings, not macOS permission identity.
2. Separate authorization from native success. An enabled switch or allowed TCC request does not prove Micro can open its HID device, global shortcuts work, or computer use works. `IOHIDDevice ... not permitted` remains a failed connection even when the permission preflight passes.
3. Compare process start and grant times. If authorization changed while the app was running, a full quit and relaunch of that exact app is the next recovery check. Stale process authorization is a hypothesis until native access succeeds after relaunch. Do not restart an app hosting active user work automatically; leave that restart to the user and report the pending check.
4. After relaunch, check the affected behavior and previous denial when available and authorized. If failure persists, recheck identity, attribution, and native errors before proposing a narrowly targeted permission repair. Never reset unrelated grants, profiles, or authentication.

Report native checks separately from signing and renderer tests, and mark unavailable or user-deferred checks unverified. Keep incident logs and local paths in the ignored worklog rather than public instructions.
