# Modex

**Modex** is the locally built, modded Codex app. This repository contains source-only mods for it, with shared tools for inspecting ASAR archives, packaging a separate app, and signing it consistently across updates.

## Mods

| Mod | What it does | Supported stock build |
| --- | --- | --- |
| [Model Spread](mods/model-spread/README.md) | Configurable model/reasoning slots shared by the composer slider and Codex Micro knob | 26.901.51231 (8109) |
| [Theme Icon](mods/theme-icon/README.md) | Automatic theme-colored Codex Dock icon with per-theme Appearance variants | 26.901.51231 (8109) |

Each mod owns its transforms, compatibility checks, native adapters, and behavioral tests. Mods currently build separate app copies; combining multiple mods into one app is not implemented.

## Get started

Requires macOS, [Bun](https://bun.sh), the supported stock Codex app, and an installed **Developer ID Application** certificate with its private key available in Keychain. Packaging refuses ad-hoc signing because changing build hashes can invalidate macOS permissions.

```sh
git clone https://github.com/nicosuave/modex.git
cd modex
bun install --frozen-lockfile
bun run verify:model-spread
bun run prepare:model-spread --check --output "$HOME/Codex-Mods/Modex.app"
bun run prepare:model-spread --output "$HOME/Codex-Mods/Modex.app"
```

The default stock path is `/Applications/ChatGPT.app`; pass `--source /path/to/your/app` when needed. The preparation command verifies the stock signature and exact supported bundle hashes, creates and verifies a full backup ZIP, then builds a new app. Existing output apps are never overwritten. Reuse an existing backup only with an explicit `--backup /path/to/original.zip`.

After packaging, quit the active Codex copy and move the staged **Modex.app** into `~/Applications`. Pin that actual app in the Dock. **There is no separate launcher.** See the [mod instructions](mods/model-spread/README.md) for installation, profiles, and Micro permission verification.

If several signing identities are installed, select one explicitly:

```sh
export CODEX_MODS_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)'
bun run prepare:model-spread --output "$HOME/Codex-Mods/Modex.app"
```

Use the same signing team and mod bundle ID on subsequent builds. The legacy `MODEL_SPREAD_SIGN_IDENTITY` environment variable is also accepted. Certificate selection stays local; no certificate or signing credentials belong in this repository.

## Permissions and app identity

Each mod has a stable, distinct bundle ID under `local.codex`. The app keeps its packaged native icon and runs directly; Theme Icon changes the running Dock icon. Its certificate-based designated requirement stays the same when the app contents change, allowing later builds to match an existing macOS permission grant.

On the first launch, authorize the **modded app itself** in System Settings → Privacy & Security → Input Monitoring if you use Codex Micro. A grant for the stock app or an old launcher does not authorize a different app identity. Verify the app's permission status and actual Micro operation; an enabled switch alone does not prove a stored signature still matches.

Changing the signing team or bundle ID requires a deliberate permission migration. OS permission resets can also require reauthorization. These locally built apps are not notarized, and vendor keychain, app-group, push, or attestation behavior is not guaranteed under a different signing identity.

General agent instructions live in [AGENTS.md](AGENTS.md). For verification, packaging, signing, permission, or runtime failures, start with [REPAIR.md](REPAIR.md), then follow the affected mod’s scoped repair guide.

## Repository layout

```text
mods/
  model-spread/       Model-specific transforms, adapters, instructions, and tests
  theme-icon/         Theme icon rendering, Appearance controls, and native adapter
lib/
  asar.mjs           Archive reading, integrity verification, and overlay repacking
  prepare-mod.mjs    Shared compatibility, backup, and preparation workflow
  package-app.mjs    Safe second-copy packaging shared by mods
  sign-app.mjs       Stable app identity, profile environment, and certificate signing
```

[Shared utility documentation](lib/README.md) covers the lower-level interfaces. To add a mod, create a directory under `mods/` with its own README, app identity, exact compatibility manifest, transforms, and tests. Reuse `lib/` for archive and app packaging rather than duplicating it. Register the mod in the table above and add its verification/preparation scripts to the root package file.

## Validation

```sh
bun test
bun run verify:model-spread
```

Plain tests use synthetic fixtures. The Model Spread verifier additionally reads the locally installed compatible stock app, checks deterministic transforms and generated import paths, and supplies its native bundles to the HOME regression test. It does not package or launch an app.

The certificate regression signs two disposable fixture apps with different build hashes and a renamed app, and verifies that their designated requirements remain identical. It runs only when `CODEX_MODS_SIGN_IDENTITY` (or the legacy variable) is explicitly set. Without stock bundles or a signing identity, the corresponding integration tests are reported as skipped. No hosted CI needs access to private signing keys or proprietary app files.

## Source and scope

Model Spread was imported from [the original gist](https://gist.github.com/nicosuave/4cde10499b4bc7bd9a7a33e94e63379c), including its subsequent single-app signing and permission fixes. This repository is the maintained source going forward.

Only mod source and tests are included. Stock app binaries, extracted vendor bundles, app backups, profiles, logs, and local signing data stay on the machine. These are version-specific modifications, not an official plugin interface; unknown app versions fail compatibility checks rather than applying guessed patches.
