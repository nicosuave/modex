# Theme Icon instructions

Follow the root installation, preservation, signing, and profile rules. Read
README.md for variants and compatibility.json for exact source and asset gates.

Use the native root appearance provider's resolved palette, including custom
colors and ChatGPT accent overrides. Do not add theme-name color presets or a
second color configuration. Preserve stock Dock selection, per-theme/appearance
preferences, original alpha/geometry, and the bounded main-process image cache.
Only fixed stock icon paths may be loaded by the native adapter.

Keep settings to one compact row: at most five deduplicated resolved theme roles
(accent, ink, skill, diffAdded, diffRemoved), with background in a small dropdown.
Do not scan ANSI/syntax colors into a rainbow of options or generate shade variants.

Run `bun run verify:theme-icon`, preparation `--check`, and full packaging. For
live acceptance, use an isolated persistent profile; check Appearance controls,
all variants, theme/custom color changes, system appearance, settings persistence
after relaunch, and stock ChatGPT icon selection. Observe renderer/main errors
and actual Dock behavior rather than inferring native success from pixel tests.
Do not quit an app hosting the user's conversation or share its live profile.
