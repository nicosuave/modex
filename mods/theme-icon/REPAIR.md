# Theme Icon repair

Start with ../../REPAIR.md. `source-hooks.mjs` discovers the initial renderer's
root appearance provider and color resolution, general settings' Dock row, and
the main bundle's Dock lifecycle and primary-window message handler from their
behavior and structure. Preserve these semantic contracts instead of adding
release-specific minified aliases. Tests also execute lexically renamed source.

Inspect new source around all callers before adapting the manifest. Check the
React namespace and row exports, native persistence initialization, final theme
resolution, and main-window origin checks. Preserve unique anchors and exact
icon hashes. Do not accept a new icon just by changing its hash: visually inspect
its chromatic/neutral separation and rerun pixel/appearance previews.

If the stock icon persists, check the stock preference is codex-system, the root
provider sends a validated palette, and the receiving window is primary/focused.
Errors prefixed [Theme Icon] come from the native adapter; it falls back to stock.
Theme icon only changes the Dock while running, not Finder's packaged icon.
