# Modex

Customize Codex with the mods you want. Modex builds them into a separate, signed **Modex.app** and leaves the original app unchanged.

## Choose mods

All mods are optional. Use any one or combine them.

| Mod | Name for `--mods` | What you get |
| --- | --- | --- |
| [Model Spread](mods/model-spread/README.md) | `model-spread` | Editable model/reasoning slots shared by the composer slider and Codex Micro knob |
| [Theme Icon](mods/theme-icon/README.md) | `theme-icon` | A Dock icon that follows your theme, with color and background choices in Appearance settings |
| [Task Panes](mods/task-panes/README.md) | `task-panes` | Split panes and tabs for local, SSH, and cloud Codex tasks |
| [Custom CLI](mods/custom-cli/README.md) | `custom-cli` | Use a different local CLI executable or configuration overrides |

For example, `--mods theme-icon,task-panes` combines Theme Icon and Task Panes. Build on the Mac where you will use the app.

## Prerequisites

- macOS and [Bun](https://bun.sh).
- Xcode Command Line Tools and Node development headers (Homebrew Node supplies them), for the [app-tools authentication repair](mods/app-tools-auth/README.md).
- An unmodified stock Codex app, version **26.903.71938 (8576)**. Other builds fail compatibility checks.
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
mods="task-panes" # Choose one or more names from the list above.
bun run modex verify --mods "$mods"
bun run modex prepare --check --mods "$mods" --output "$HOME/Codex-Mods/first-build/Modex.app"
bun run modex prepare --mods "$mods" --output "$HOME/Codex-Mods/first-build/Modex.app"
```

These commands verify your selection, check the preparation inputs, then create a signed app at `~/Codex-Mods/first-build/Modex.app`. Preparation also creates and verifies a full stock-app backup beside it: `Original-26.903.71938-8576.zip`.

Preparation does not install or launch the app. Output paths must be new, absolute `.app` paths outside Applications. Existing apps and backups are never overwritten. For another attempt, choose a new staging directory; to reuse a backup, pass `--backup` explicitly as shown in the update workflow below.

## Install and open

1. Quit the running Codex or Modex app when you are ready to switch. Do not stop a copy that still has active work.
2. If `~/Applications/Modex.app` already exists, preserve it in a separate folder outside Applications before replacing it.
3. Move the staged `Modex.app` into `~/Applications` (create that folder if needed).
4. Open `~/Applications/Modex.app` and pin that actual app in the Dock.

Modex uses your normal `~/.codex` and `~/Library/Application Support/Codex` profile paths. Do not run another Codex or Modex copy against that same profile simultaneously. For a separate test profile, follow the [isolated launch instructions](mods/model-spread/README.md#isolated-verification), substituting your staged app path.

If you use Codex Micro, grant **Modex.app** Input Monitoring access in System Settings → Privacy & Security, then relaunch if requested. Verify the Micro connection and controls; an enabled permission switch alone does not establish hardware access.

See the mod guides linked above for their controls and configuration. To return to stock, quit Modex and open the unchanged original app.

## Update Modex

After updating the stock app, run this from a current Modex checkout:

```sh
bun run modex update
```

The command detects Modex in `/Applications` or `~/Applications`, reads its enabled
mods, installs dependencies from the lockfile, runs the verifier and preparation
checks, and builds a signed replacement with the same bundle ID and signing team.
If both locations contain Modex, choose one with `--app /Applications/Modex.app`.
It preserves a configured development-module directory as well.

Once the build is ready, it waits up to ten minutes for you to close Modex, installs
the replacement at the same path, and prints the preserved previous-app location.
It never quits or launches an app. Close stock Codex before reopening Modex if both
use your normal profile. Settings and authentication stay in their existing locations.

Use `--check` for read-only preflight, `--stage-only` to build without installing,
or `--wait-seconds 3600` for a longer wait. `--source` selects a different stock app;
`--backup` reuses an existing stock ZIP after validation. New staging apps, stock
backups, and previous installed copies are kept under `work/updates/` in this checkout.
Preserved builds are not automatically deleted. Installation requires write access
to the installed app's parent directory and the same volume as the staging directory.

This command uses the current checkout; it does not pull Git changes or operate the
stock updater. Unknown stock versions stop at the compatibility gate before replacing
Modex and still require a reviewed adaptation. A failed or cancelled build leaves the
installed app in place. If the close wait times out, the staged app is retained and
can be installed using the manual steps below, or you can rerun the command.

### Manual build and installation

From your repository checkout, update the source, install dependencies, and verify the mods. For a clean checkout on `main`:

```sh
git pull --ff-only
bun install --frozen-lockfile
mods="task-panes" # Set this to the complete set you want in the updated app.
bun run modex verify --mods "$mods"
```

Always pass `--identity-from` with the **actual installed Modex path**. These examples use `~/Applications/Modex.app`, matching the installation steps above. If you installed in `/Applications`, substitute `/Applications/Modex.app` in both commands.

For an update built from the same stock app, reuse the backup from the first build:

```sh
bun run modex prepare --check --mods "$mods" \
  --identity-from "$HOME/Applications/Modex.app" \
  --backup "$HOME/Codex-Mods/first-build/Original-26.903.71938-8576.zip" \
  --output "$HOME/Codex-Mods/update-1/Modex.app"
bun run modex prepare --mods "$mods" \
  --identity-from "$HOME/Applications/Modex.app" \
  --backup "$HOME/Codex-Mods/first-build/Original-26.903.71938-8576.zip" \
  --output "$HOME/Codex-Mods/update-1/Modex.app"
```

Use a new staging directory for each build. The backup must match the current stock source exactly. When using a different supported stock build, omit `--backup` from both commands to create a new backup in the new staging directory.

Review the reported selected, installed, and removed mods, then follow [Install and open](#install-and-open) to switch copies. `--identity-from` preserves the installed bundle ID and signing team and checks for accidental mod removal. Without it, preparation treats this as a fresh build and has no installed app to compare.

Use the same complete `--mods` list for verification and preparation. Leaving a mod out of that list removes it from the new build. If `--mods` is omitted, the CLI currently selects Model Spread and Theme Icon and rejects updates that would drop an installed mod.

Run `bun run modex --help` for all options.

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
# Run from this checkout with the same selection throughout.
mods="task-panes"
modules="$HOME/Library/Application Support/Modex/modules"
bun run modex dev --mods "$mods" --output "$modules"
bun run modex verify --mods "$mods" --dev-root "$modules"
bun run modex prepare --check --mods "$mods" \
  --identity-from /Applications/Modex.app \
  --dev-root "$modules" \
  --output "$PWD/work/development-app/Modex.app"
bun run modex prepare --mods "$mods" \
  --identity-from /Applications/Modex.app \
  --dev-root "$modules" \
  --output "$PWD/work/development-app/Modex.app"

# After launching the staged app with an isolated profile:
bun run modex dev --mods "$mods" --output "$modules" --watch
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
  task-panes/        Task splits, tabs, native renderer adapters, and tests
lib/                 Shared archive, metadata, packaging, and signing utilities
```

Each mod owns its feature behavior and exact compatibility manifest. Composition validates the selected mods against pristine stock bytes and applies their transforms sequentially, retaining changes to shared bundles. The signed app records its selected set in ASAR `modex.json`; older builds are detected through known mod files. Malformed or unrecognized installed metadata stops an update.

```sh
bun test
bun run modex verify --mods model-spread,theme-icon,task-panes
```

`bun test` runs the test suites with available fixtures. The root verifier also checks the stock signature, exact hashes, deterministic transforms, syntax, and imports, and supplies stock bundles to the selected mods' integration tests. For combined selections, it also checks shared-bundle behavior. Tests requiring unavailable stock fixtures are skipped in plain test runs. The certificate regression runs when `CODEX_MODS_SIGN_IDENTITY` is explicitly set; the legacy `MODEL_SPREAD_SIGN_IDENTITY` is also accepted. Verification does not package or launch an app or prove physical Micro operation.

`bun run verify` is a convenience alias. Packaging uses `bun run modex prepare`; there is no `prepare` lifecycle script, so `bun install` never packages an app.

To add a mod, follow the [shared utility documentation](lib/README.md) and [agent instructions](AGENTS.md). Keep its source, README, compatibility manifest, and tests under `mods/`; register it in `mods/combined/compatibility.mjs`, wire its transform and fixture setup into the composition build/verifier, and test shared-bundle interactions before publishing it. See the [composition guide](mods/combined/README.md) for details.

## Source and scope

Model Spread was imported from [the original gist](https://gist.github.com/nicosuave/4cde10499b4bc7bd9a7a33e94e63379c), including its subsequent signing and permission fixes. This repository is the maintained source going forward.

Only mod source and tests belong in the repository. Keep stock binaries, extracted bundles, built apps, backups, profiles, authentication, logs, and signing material local. These are version-specific modifications, not an official plugin interface.
