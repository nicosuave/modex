# Model Spread

A Codex app mod with an ordered list of model + reasoning pairs shared by the composer slider and the Codex Micro knob.

Supported stock app: **26.903.71938 (8576)**. `compatibility.json` owns the exact source hashes; `mod.json` keeps the feature name **Model Spread** separate from the app name **Modex**, and owns its stable bundle ID.

## Features

- Add, edit, reorder, and reset model/reasoning slots in native settings.
- Use the same spread from the composer slider and Micro's **Model spread** mode. **Reasoning-only** mode remains available.
- Keep unavailable slots in settings but skip them during navigation; clamp at the endpoints.
- Save settings in the app's native persisted store. The existing `nico.codex.model-spread.v1` key is preserved for users migrating from the gist.
- Preserve custom High/Max reasoning after HOME settles its saved model selection.
- Suppress the composer's usage/upsell banner and automatic usage modal. Server-enforced usage limits, image-limit notices, and native Cmd+Enter behavior remain unchanged.

## Build

For **both Model Spread and Theme Icon in one app**, use the default `bun run modex verify`
and `bun run modex prepare` commands in the [root README](../../README.md). The commands
below intentionally build Model Spread only.

Run these commands from the repository root:

```sh
bun install --frozen-lockfile
bun run verify:model-spread
bun run prepare:model-spread --check --output "$HOME/Codex-Mods/Modex.app"
bun run prepare:model-spread --output "$HOME/Codex-Mods/Modex.app"
```

An installed Developer ID Application certificate is required for packaging. Select it with `CODEX_MODS_SIGN_IDENTITY` if necessary; see the [root README](../../README.md). The stock app is preserved and a full original-app ZIP is verified before packaging. Existing app outputs are refused. To reuse a matching backup, pass its path with `--backup`.

An unknown version/hash stops before producing the app. For updates, follow [REPAIR.md](REPAIR.md); changing hashes without reviewing native behavior is insufficient.

## Install and launch

Quit the running Codex copy, then move the staged **Modex.app** into `~/Applications`. If an older copy is already there, preserve it outside Applications before installing the replacement. Pin **Modex.app itself** in the Dock. No launcher app, command file, or terminal window is needed.

The signed app has bundle ID `local.codex.model-spread`, retains the native icon, and uses `~/.codex` and `~/Library/Application Support/Codex` through its Launch Services environment. These paths are resolved on the machine that builds it. Do not distribute the resulting app as a portable binary; rebuild from source on the destination machine.

This normal profile preserves existing chats, accounts, settings, and the saved spread. Do not run stock and modded copies against the same profile simultaneously. To return to stock, quit Modex and open the unmodified original app.

For Codex Micro, grant Input Monitoring to **Modex.app** in System Settings → Privacy & Security, then relaunch it if macOS requests. An enabled grant for **Model Spread Launcher** or **ChatGPT** is a different app identity. Check the Micro connection, key presses, and knob after migration.

Future mod builds keep the same bundle ID and Developer ID team. The signing tests demonstrate that changed app contents still satisfy the same designated requirement. Do not replace that signature with an ad-hoc signature to work around a packaging failure.

## Configure

Open **Configuration → Model spread → Configure**. Add or edit slots and drag rows into order. **Done** saves the draft; closing discards it. The rewind button restores defaults after confirmation. For Micro, choose **Model spread** as the knob mode.

## Isolated verification

For a separate persistent test profile, invoke the executable with an explicit environment:

```sh
mkdir -p "$HOME/Codex-Mods/test-profile" "$HOME/Codex-Mods/test-codex-home"
CODEX_HOME="$HOME/Codex-Mods/test-codex-home" \
CODEX_ELECTRON_USER_DATA_PATH="$HOME/Codex-Mods/test-profile" \
  "$HOME/Codex-Mods/Modex.app/Contents/MacOS/ChatGPT" \
  --user-data-dir="$HOME/Codex-Mods/test-profile"
```

The isolated profile does not import authentication or settings. Double-clicking the app uses the normal profile configured during signing instead. An isolated launch checks startup; it does not prove the normal profile or physical Micro works.

## Development

`build-mod.mjs` applies checked renderer transforms, and `*.template.*` adapt the native UI, storage, composer, and Micro interfaces. `prepare-mod.mjs` handles this mod's compatibility and backup workflow, then calls the shared packaging utilities. `verify-mod.mjs` verifies hashes, deterministic transforms, generated imports, and tests against local stock bundles.

`source-hooks.mjs` captures local bindings for usage banners, selection-mode reconciliation,
experiment exposure, and Micro reasoning dispatch from their native operations. These hooks
reject missing or ambiguous matches instead of depending on particular minified names.
Other adapters still require version-specific review. To check these hooks against multiple
local stock archives without changing the packaging allowlist:

```sh
MODEL_SPREAD_REGRESSION_ARCHIVES="/absolute/old/app.asar:/absolute/new/app.asar" \
  bun test mods/model-spread/source-hooks.test.mjs
```

```sh
bun mods/model-spread/build-mod.mjs BUNDLE_DIRECTORY OVERLAY_DIRECTORY
```

Keep extracted bundles and overlays in ignored local scratch space. [AGENTS.md](AGENTS.md) is the scoped install/repair contract; [REPAIR.md](REPAIR.md) records the relevant failure mechanisms.
