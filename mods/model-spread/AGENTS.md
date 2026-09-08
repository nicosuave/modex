# Model Spread instructions

Follow the [root instructions](../../AGENTS.md) for installation, app preservation, signing, profiles, publication, and reporting. Read [README.md](README.md) for this mod's feature contract. `compatibility.json` owns supported inputs; `mod.json` owns the Model Spread feature name, Modex app name, and stable app identity.

## Verify and prepare

From the repository root, run `bun install --frozen-lockfile`, then `bun run verify:model-spread` (optionally `--source /absolute/path/to/ChatGPT.app`). The verifier checks signature/hashes, repeatable transforms, syntax/import paths, and tests with temporary stock bundles so the native HOME regression runs.

Run `bun run prepare:model-spread --check` with the source and a new absolute output outside Applications, then repeat without `--check`. Use the exact installation/profile commands in README.md. For native behavior or version adaptation failures, read [REPAIR.md](REPAIR.md) after the shared repair guide.

## Behavioral invariants and acceptance

Preserve all README features, native model/access checks, server enforcement, atomic model+effort selection, Reasoning-only mode, and the persisted settings key `nico.codex.model-spread.v1`.

Verification must include the native HOME regression. For a launched copy, check editing/save/restart persistence; HOME High/Max after saved state settles; add/remove/reorder/reset; unavailable slots and endpoints; both Micro modes; native send and image-limit behavior. Apply the root acceptance rules for startup and hardware/account-dependent limits.
