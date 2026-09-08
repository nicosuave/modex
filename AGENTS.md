# Modex agent instructions

When asked to install or adapt Modex, carry the task through verification and creation of a separate working app. Read [README.md](README.md) for repository setup and the selected mod's README, AGENTS.md, and compatibility manifest for its behavior, exact inputs, commands, and acceptance cases. For Model Spread, use [its scoped instructions](mods/model-spread/AGENTS.md).

## Installation and preservation

1. Read the scripts, inspect the installed source app, and confirm macOS/Bun. Install dependencies from the lockfile and run the selected mod's verifier before packaging.
2. Run preparation with `--check`, a supported source, and a new absolute output path outside Applications; then prepare the full copy. Verify the original-app backup before reuse through explicit `--backup`. Preserve existing outputs and choose a new descriptive path for another attempt.
3. Create one directly signed Modex.app and pin that actual app in the Dock, never a separate launcher. Keep the existing mod bundle ID and Developer ID team across updates, including display-name changes. Verify the certificate designated requirement and normal-profile Launch Services environment. Never fall back to ad-hoc signing.
4. Install the staged app in ~/Applications when requested. Preserve the installed original, existing copies, user files, settings, and authentication. Do not modify or stop an app hosting the user's active conversation automatically. Preserve a running old copy until the user can close it, and report when the new app will take effect.
5. Launch when requested or implied. Respect the user's profile choice; default verification launches to an isolated persistent profile. Before sharing a profile, ensure other copies are quit. Do not run pointer/knob tests during the user's manual testing.

## Development and repair

- Keep mod transforms, compatibility manifests, adapters, and behavioral tests scoped under `mods/`. Reuse `lib/` for shared archive, packaging, and signing behavior.
- Retain exact compatibility gates and unique replacement checks. Never bypass failures, loosen hashes, skip failing tests, or change hashes alone to accept unknown code.
- Preserve documented features, native access checks, and server enforcement. If a required native capability disappears, report the evidence and limitation rather than silently dropping it.
- For compatibility or runtime failures, start with [REPAIR.md](REPAIR.md), then the affected mod's repair guide. Inspect new-version source before treating incompatibility as a blocker; repair source/tests and rerun verification.
- Continue routine reversible repairs within the authorized scope. Ask only for missing product decisions, necessary OS/auth interaction, or actions affecting user work.
- Keep vendor bundles, app backups, profiles, authentication, logs, signing material, and local repair worklogs out of the public repository. Publish or commit only within the user's authorized scope.

## Acceptance and reporting

Run the relevant tests, deterministic verifier, preparation dry run, and full packaging for installation/adaptation work. Verify original and copied app signatures, the stable certificate requirement, and profile environment. Determinism means repeatable patch output; signatures and ZIP timestamps need not be byte-identical. Syntax/import checks do not establish native export semantics.

For a launched copy, check startup/renderer errors and the mod's scoped behavioral acceptance cases. Mark hardware/account-dependent checks unverified when unavailable; never infer hardware success from unit tests or an enabled permission switch.

Report app/backup paths, accepted source version, repair evidence, passed checks, and remaining launch/runtime limitations. Maintain an ignored local worklog when work spans phases.
