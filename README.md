# Modex

Build **Modex.app**, a local copy of Codex with **both Model Spread and Theme Icon enabled by default**. The original Codex app stays unchanged.

| Mod | What you get |
| --- | --- |
| [Model Spread](mods/model-spread/README.md) | Editable model/reasoning slots shared by the composer slider and Codex Micro knob |
| [Theme Icon](mods/theme-icon/README.md) | A Dock icon that follows your theme, with color and background choices in Appearance settings |
| [App-tools authentication](mods/app-tools-auth/README.md) | Restores native Codex task tools, including `read_thread`, in the separately signed Modex app; included in every build |

You can also [choose a single UI mod](#choose-mods). The app-tools authentication repair applies to every selection automatically. This repository contains the build tools and mod source; you build the app on the Mac where you will use it.

## Prerequisites

- macOS and [Bun](https://bun.sh).
- Xcode Command Line Tools and Node development headers (Homebrew Node supplies them), for the [app-tools authentication repair](mods/app-tools-auth/README.md).
- An unmodified stock Codex app, version **26.901.51231 (8109)**. Other builds fail compatibility checks.
- A **Developer ID Application** signing certificate with its private key available in Keychain. Preparation requires this certificate; ad-hoc signing is not supported.

The commands below use `/Applications/ChatGPT.app` as the stock source. If yours is elsewhere, add `--source "/absolute/path/to/ChatGPT.app"` to every `verify` and `prepare` command. The source must be stock Codex, not an existing Modex build.

If you have multiple Developer ID Application certificates, select one **before preparing the app**:

```sh
export CODEX_MODS_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)'
```

Use the exact name of your installed certificate. With exactly one available certificate, selection is automatic. Keep the same certificate team when updating an existing Modex installation.

## First build

If you already use Modex, follow [Update Modex](#update-modex) instead so the new build retains its identity.

```sh
git clone https://github.com/nicosuave/modex.git
cd modex
bun install --frozen-lockfile
bun run modex verify
bun run modex prepare --check --output "$HOME/Codex-Mods/first-build/Modex.app"
bun run modex prepare --output "$HOME/Codex-Mods/first-build/Modex.app"
```

These commands verify **both mods**, check the preparation inputs without writing, then create a signed app at `~/Codex-Mods/first-build/Modex.app`. Preparation also creates and verifies a full stock-app backup beside it: `Original-26.901.51231-8109.zip`.

Preparation does not install or launch the app. Output paths must be new, absolute `.app` paths outside Applications. Existing apps and backups are never overwritten. For another attempt, choose a new staging directory; to reuse a backup, pass `--backup` explicitly as shown in the update workflow below.

## Install and open

1. Quit the running Codex or Modex app when you are ready to switch. Do not stop a copy that still has active work.
2. If `~/Applications/Modex.app` already exists, preserve it in a separate folder outside Applications before replacing it.
3. Move the staged `Modex.app` into `~/Applications` (create that folder if needed).
4. Open `~/Applications/Modex.app` and pin that actual app in the Dock.

Modex uses your normal `~/.codex` and `~/Library/Application Support/Codex` profile paths. Do not run another Codex or Modex copy against that same profile simultaneously. For a separate test profile, follow the [isolated launch instructions](mods/model-spread/README.md#isolated-verification), substituting your staged app path.

If you use Codex Micro, grant **Modex.app** Input Monitoring access in System Settings → Privacy & Security, then relaunch if requested. Verify the Micro connection and controls; an enabled permission switch alone does not establish hardware access.

See the mod guides for [Model Spread configuration](mods/model-spread/README.md#configure) and [Theme Icon controls](mods/theme-icon/README.md#appearance-controls). To return to stock, quit Modex and open the unchanged original app.

## Update Modex

From your repository checkout, update the source, install dependencies, and verify the mods. For a clean checkout on `main`:

```sh
git pull --ff-only
bun install --frozen-lockfile
bun run modex verify
```

Always pass `--identity-from` with the **actual installed Modex path**. These examples use `~/Applications/Modex.app`, matching the installation steps above. If you installed in `/Applications`, substitute `/Applications/Modex.app` in both commands.

For an update built from the same stock app, reuse the backup from the first build:

```sh
bun run modex prepare --check \
  --identity-from "$HOME/Applications/Modex.app" \
  --backup "$HOME/Codex-Mods/first-build/Original-26.901.51231-8109.zip" \
  --output "$HOME/Codex-Mods/update-1/Modex.app"
bun run modex prepare \
  --identity-from "$HOME/Applications/Modex.app" \
  --backup "$HOME/Codex-Mods/first-build/Original-26.901.51231-8109.zip" \
  --output "$HOME/Codex-Mods/update-1/Modex.app"
```

Use a new staging directory for each build. The backup must match the current stock source exactly. When using a different supported stock build, omit `--backup` from both commands to create a new backup in the new staging directory.

Review the reported selected, installed, and removed mods, then follow [Install and open](#install-and-open) to switch copies. `--identity-from` preserves the installed bundle ID and signing team and checks for accidental mod removal. Without it, preparation treats this as a fresh build and has no installed app to compare.

**Updates default to both mods too.** If you intentionally use a single mod, pass its selection to verification and both preparation commands as described below.

## Choose mods

`--mods` specifies the **complete intended set**, not an addition to the defaults:

| Selection | Result |
| --- | --- |
| Omit `--mods` | Model Spread + Theme Icon |
| `--mods model-spread,theme-icon` | Model Spread + Theme Icon |
| `--mods model-spread` | Model Spread only |
| `--mods theme-icon` | Theme Icon only |

For example, to intentionally build an update with **Theme Icon only**, use the same selection throughout:

```sh
bun run modex verify --mods theme-icon
bun run modex prepare --check --mods theme-icon \
  --identity-from "$HOME/Applications/Modex.app" \
  --output "$HOME/Codex-Mods/icon-only-1/Modex.app"
bun run modex prepare --mods theme-icon \
  --identity-from "$HOME/Applications/Modex.app" \
  --output "$HOME/Codex-Mods/icon-only-1/Modex.app"
```

This explicitly requests removal of Model Spread if it is installed. Without an explicit `--mods` list, preparation rejects dropping any detected installed mod. Empty, duplicate, and unknown mod names are rejected; the order you list them does not change the build.

Run `bun run modex --help` for all options. The older `verify:model-spread`, `prepare:model-spread`, `verify:theme-icon`, and `prepare:theme-icon` commands remain available as intentionally single-mod workflows.

## Inspect the installed build

```sh
bun run modex status --app "$HOME/Applications/Modex.app"
bun run modex status --app "$HOME/Applications/Modex.app" --json
```

New builds record the stock version and archive hash, Modex Git revision and
uncommitted state, source-content hash, selected mods, and each transform's before/
after hashes. `status` reads that receipt from the app and checks the final recorded
files. Use your actual installed path, such as `/Applications/Modex.app`, when it
differs from the default. Older builds remain readable but report their receipt
as unavailable.

These checks identify packaged code; they do not verify the code signature or
claim that a running process has loaded that build. In development mode, status
also checks external module compatibility and reports modules changed since
packaging. External status describes files on disk, not a running window's state.

## Development modules

Normal builds remain self-contained. An explicit development build can load
editable modules from a dedicated local directory, avoiding app packaging for
changes to those modules. See the [development module guide](mods/development/README.md)
for the compatibility boundary and recovery behavior.

```sh
# Run from this checkout. Use the same --mods selection throughout if using one mod.
modules="$HOME/Library/Application Support/Modex/modules"
bun run modex dev --output "$modules"
bun run modex verify --dev-root "$modules"
bun run modex prepare --check \
  --identity-from /Applications/Modex.app \
  --dev-root "$modules" \
  --output "$PWD/work/development-app/Modex.app"
bun run modex prepare \
  --identity-from /Applications/Modex.app \
  --dev-root "$modules" \
  --output "$PWD/work/development-app/Modex.app"

# After launching the staged app with an isolated profile:
bun run modex dev --output "$modules" --watch
```

Keep one installed Modex beside the untouched stock app. Use the installed app's
actual location for `--identity-from`; the example uses `/Applications/Modex.app`.
The module directory is stable across checkouts. Stage and verify an update, then
replace the installed Modex only after it quits. Keep at most one previous Modex
for rollback and remove temporary app builds after the installed update verifies.

Theme Icon pixel/tint changes reload live and retain the current palette. Changes
to Model Spread's editor/slot logic or the theme settings UI take effect when you
reload the window or restart the development app; save or discard any open draft
first. The watcher never reloads or quits an app. Installed hooks, native payload
contracts, compatibility manifests, and bootstrap changes still require a new
verified, signed build. To return to a self-contained app, prepare without
`--dev-root` into a new staging path.

## Troubleshooting and permissions

Start with [REPAIR.md](REPAIR.md) for compatibility, packaging, signing, permission, or runtime failures, then follow the affected mod's repair guide. Unknown stock versions require a reviewed adaptation; do not bypass the compatibility checks.

New root-CLI builds use `local.codex.model-spread` as their bundle ID. Updates using `--identity-from` retain the installed identity regardless of the selected mods. A first installation has its own macOS permission grants; stock Codex or an old launcher's grants do not authorize it. Changing the bundle ID or signing team can require reauthorization.

The built app is locally signed, not notarized. Vendor keychain, app-group, push, and attestation behavior is not guaranteed under a different signing identity. See [permission continuity](REPAIR.md#macos-permission-continuity) for diagnosis. Build on the destination Mac because the normal-profile paths are set during packaging.

Packaging includes a scoped [app-tools authentication repair](mods/app-tools-auth/README.md) so the native task tools accept the correctly signed Modex ancestor while retaining the vendor Node and CLI checks. It does not alter browser or Computer Use authorization.

## Development

```text
modex.mjs            Root CLI: selection, verification, and preparation
mods/
  app-tools-auth/    Native task-tool authentication repair for every build
  development/       Opt-in external modules, compatibility checks, and reload runtime
  combined/          Ordered composition and joint regression tests
  model-spread/      Model Spread transforms, adapters, and tests
  theme-icon/        Theme Icon transforms, adapters, and tests
lib/                 Shared archive, metadata, packaging, and signing utilities
```

Each mod owns its feature behavior and exact compatibility manifest. Composition validates the selected mods against pristine stock bytes and applies their transforms sequentially, retaining both changes to shared bundles. The signed app records its selected set in ASAR `modex.json`; older builds are detected through known mod files. Malformed or unrecognized installed metadata stops an update.

```sh
bun test
bun run modex verify
```

`bun test` runs the test suites with available fixtures. The root verifier also checks the stock signature, exact hashes, deterministic transforms, syntax, and imports, and supplies stock bundles to the selected mods' integration tests. With both selected, it checks their shared startup behavior and singleton equivalence. Tests requiring unavailable stock fixtures are skipped in plain test runs. The certificate regression runs when `CODEX_MODS_SIGN_IDENTITY` is explicitly set; the legacy `MODEL_SPREAD_SIGN_IDENTITY` is also accepted. Verification does not package or launch an app or prove physical Micro operation.

`bun run verify` is a convenience alias. Packaging uses `bun run modex prepare`; there is no `prepare` lifecycle script, so `bun install` never packages an app.

To add a mod, follow the [shared utility documentation](lib/README.md) and [agent instructions](AGENTS.md). Keep its source, README, compatibility manifest, and tests under `mods/`; register it in `mods/combined/compatibility.mjs`, wire its transform and fixture setup into the composition build/verifier, and test shared-bundle interactions before enabling it by default. See the [composition guide](mods/combined/README.md) for details.

## Source and scope

Model Spread was imported from [the original gist](https://gist.github.com/nicosuave/4cde10499b4bc7bd9a7a33e94e63379c), including its subsequent signing and permission fixes. This repository is the maintained source going forward.

Only mod source and tests belong in the repository. Keep stock binaries, extracted bundles, built apps, backups, profiles, authentication, logs, and signing material local. These are version-specific modifications, not an official plugin interface.
