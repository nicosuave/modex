# Agent handoff: Codex Model Spread

When asked to install or adapt this mod, carry the task through verification and creation of a separate working app. Read README.md for behavior and launch choices. `compatibility.json` owns supported inputs; inspect the installed app rather than assuming it matches.

## Deterministic path

1. Read the scripts, locate the stock app, and confirm macOS/Bun. From the repository root run `bun install --frozen-lockfile`, then `bun run verify:model-spread` (optionally `--source /absolute/path/to/ChatGPT.app`). It checks signature/hashes, repeatable transforms, syntax/import paths, and tests with temporary stock bundles so the native HOME regression runs.
2. If verification passes, run `bun run prepare:model-spread --check` with the source and a new absolute output path outside Applications, then repeat without `--check`. This creates ONE directly signed Model Spread.app; install it in ~/Applications and pin that actual app, never a separate launcher. Keep bundle ID local.codex.model-spread and the same Developer ID team across updates. Verify the certificate designated requirement and normal-profile LSEnvironment. Retire old launcher shortcuts during the one-time migration. README.md gives exact commands. Reuse backups only through explicit `--backup` verification. Preserve existing copies; choose a new descriptive output for another attempt.
3. On compatibility or runtime failure, read REPAIR.md. Diagnose and repair the mod's source/tests, then rerun verification. Inspect new-version source before treating incompatibility as a blocker.
4. Launch when requested or implied by the task. Use the user's stated profile choice; default verification launches to an isolated persistent profile. Before sharing a profile, ensure other copies are quit. Do not quit the user's active conversation automatically or run pointer/knob tests during their manual testing.

## Invariants

- Modify this mod's source and a new second app only. Preserve the installed original, existing copies, user files, settings, and authentication.
- Retain exact compatibility gates and unique replacement checks. Never bypass failures, loosen hashes, skip failing tests, or change hashes alone to pass a gate.
- Preserve all README features, native model/access checks, server enforcement, atomic model+effort selection, Reasoning-only mode, and the persisted settings key.
- Keep vendor bundles, app backups, runtime data, and local repair worklogs out of the public repository. Publish or commit only when requested.
- Continue routine reversible repairs autonomously. Ask only for missing product decisions, necessary OS/auth interaction, or actions affecting user work. If a required native capability is gone, report evidence and the unresolved limitation; do not silently drop it.

## Acceptance

Verification and packaging must pass, including original/copy signature checks and the native regression. Determinism means repeatable patch output; signatures and ZIP timestamps need not be byte-identical. Syntax/import-path checks do not prove native export semantics.

For a launched copy, check startup without renderer errors; editing/save/restart persistence; HOME High/Max after the saved state settles; add/remove/reorder/reset; unavailable slots and endpoints; Micro modes; native send and image-limit behavior. Mark hardware/account-dependent checks unverified when unavailable. Do not infer hardware success from unit tests.

Report app/backup paths, accepted source version, evidence for repairs, passed checks, and remaining limitations. Maintain a local worklog if repairs span phases; exclude it from publication.
