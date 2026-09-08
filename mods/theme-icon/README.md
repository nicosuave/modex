# Theme Icon

Tint the original Codex Dock icon automatically using the active Codex theme's
resolved accent and background colors. Custom theme colors and ChatGPT accent
changes flow through the same native theme resolver; there are no separate icon
color fields or theme-name presets.

Supported stock app: **26.901.51231 (8109)**. `compatibility.json` gates the exact
renderer/main bundles and original icon assets. `mod.json` owns the stable
`local.codex.theme-icon` identity and **Modex** app name.

## Appearance controls

Open **Settings → Appearance → Preferences → Theme icon**, beside the existing
Dock icon setting. One compact row shows at most five icon previews from the
chosen theme's resolved accent, foreground, and semantic subcolors (highlight,
added, removed). Near-identical colors are collapsed. Hover/focus names identify
the color; no repeated labels are shown under each icon. **Accent** follows the
user's custom accent. A missing saved palette role falls back to Accent.

The small **Icon background** dropdown in that same row controls the tile:

| Variant | Behavior |
| --- | --- |
| Theme | Original light/dark icon with the tile tinted from the theme background and artwork from its accent |
| Dark tile | Original dark tile with theme-accent artwork |
| Light tile | Original light tile with theme-accent artwork |
| Original | Untinted Codex icon, matching the active app appearance |

The defaults are **Accent** color and **Theme** background. Both choices are saved per Codex theme ID and light/dark
appearance in the native persisted store (`nico.codex.theme-icon.v1`). Changing
custom colors updates the icon without resetting that choice. System mode uses
Codex's resolved appearance. The theme foreground is not applied to the glyph.

Selecting a variant enables the existing Codex Dock icon preference. The stock
ChatGPT icon selector still works and disables theme tinting. The setting controls
the running app's Dock icon; the packaged Finder icon remains stock. No bundle
files are rewritten at runtime.

## Build and verify

```sh
bun install --frozen-lockfile
bun run verify:theme-icon
bun run prepare:theme-icon --check --output "$HOME/Codex-Mods/theme-icon/Modex.app"
bun run prepare:theme-icon --output "$HOME/Codex-Mods/theme-icon/Modex.app"
```

Use `--source` for another source path, and explicit `--backup` to verify/reuse a
matching full original-app ZIP. Existing output apps and backups are preserved.
Packaging requires an installed Developer ID Application certificate. See the
[root README](../../README.md) for certificate selection and stable identity rules.

These standalone commands build Theme Icon only. For **both Theme Icon and
Model Spread in one app**, use the default `bun run modex verify` and `bun run modex prepare`
commands in the [root README](../../README.md).
Its identity and macOS permission grants are separate from Model Spread even
though both display as Modex. These commands do not perform an identity-preserving
upgrade of another mod; follow the shared
[permission continuity guidance](../../REPAIR.md#macos-permission-continuity)
before adopting it as a replacement.

## Launch

Run a verification copy with separate persistent directories:

```sh
mkdir -p "$HOME/Codex-Mods/theme-icon/test-profile" "$HOME/Codex-Mods/theme-icon/test-codex-home"
CODEX_HOME="$HOME/Codex-Mods/theme-icon/test-codex-home" \
CODEX_ELECTRON_USER_DATA_PATH="$HOME/Codex-Mods/theme-icon/test-profile" \
  "$HOME/Codex-Mods/theme-icon/Modex.app/Contents/MacOS/ChatGPT" \
  --user-data-dir="$HOME/Codex-Mods/theme-icon/test-profile"
```

No authentication or settings are copied to that profile. For normal use, close
other copies using the normal profile before opening Modex from Finder/Dock.
Launch Services uses the same normal-profile environment as other Modex apps.
Install in `~/Applications` when ready and pin the actual app, not a launcher.
Keep the bundle ID and signing team unchanged across Theme Icon rebuilds.

## Implementation

The renderer subscribes inside Codex's root appearance provider after native color
resolution. It uses that chosen theme's actual resolved roles, without scanning
ANSI colors or syntax tokens. The settings child uses the same React/row components as stock and
subscribes independently of its compiled parent's memo cache. Only bounded color
and variant values cross the existing main-window IPC path; filenames and image
bytes are not accepted from the renderer. The main adapter loads fixed stock
assets, tints in memory, caches at most 16 variants, and uses the existing Dock
refresh path. App startup before the first palette message uses the stock icon.

`renderPixels` and `tintThemeIcon` remain independent of Electron and React. They
preserve alpha and original geometry; HSL maps tonal structure rather than exact
perceptual luminance. Pure black/white accents can flatten relief. The original
assets' chromatic artwork and neutral tile are assumed, so asset hashes are gated.

For standalone palette previews:

```sh
bun mods/theme-icon/preview-codex.mjs
bun mods/theme-icon/preview.mjs
```

The first reads installed Gruvbox, Dracula, and Nord bundles into ignored local
previews. It exercises inspected first-choice palette fields for those bundles;
the runtime uses Codex's full resolver, not this preview extractor. The second is
an arbitrary-accent test sheet. Vendor assets never belong in the public repo.
