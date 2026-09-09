# Development modules

This opt-in mode separates installed integration hooks from editable behavior.
It does not change Electron fuses, renderer content security policy, native
authentication, or the normal self-contained build. Preparing with `--dev-root`
embeds that absolute directory and its hook compatibility identity in the signed
app. External code is not sealed by the app signature and runs with the app's
privileges; use a directory and source you control.

## Commands

`bun run modex dev --output /absolute/dedicated/directory` bundles the selected
modules and publishes a complete generation through `manifest.json`. Add
`--watch` to rebuild after source changes. `--mods` accepts the same complete
selection as the root CLI; omitting `--mods` selects Model Spread and Theme Icon. The first output must be
new or empty. Later builds only reuse valid Modex development output, preserving
older generations. App bundles, non-owned directories, and corrupted output are
rejected; preserve a failed output and choose a new directory to recover it.

`verify --dev-root DIRECTORY` checks the actual stock transforms plus development
bootstrap, syntax, imports, and tests. `prepare --dev-root DIRECTORY` packages the
installed hooks and bundled fallbacks with a fixed reference to that directory.
Use the root README's identity-preserving preparation and isolated-launch steps.

## Reload boundary

| Source | Behavior after rebuilding modules |
| --- | --- |
| `mods/theme-icon/render.mjs`, `tint.mjs` | Main-process pixel renderer reloads live; settings previews update after a window reload |
| `mods/theme-icon/runtime.mjs`, `palette.mjs` | Settings/theme renderer code updates after a window reload or app restart |
| `mods/model-spread/model-spread.mjs`, `editor.mjs` | Slot logic and editor update after a window reload or app restart |
| Native adapters, `.template.js`/`.template.mjs`, `theme-icon/state.mjs`, build scripts, manifests, runtime/bootstrap | Repackage and sign; the installed hook hash no longer matches |

Model Spread's composer, HOME normalization, and Micro hooks remain in the
version-gated stock transforms. Both editor and composer use the same configured
native settings store. Theme Icon's main adapter retains ownership of the current
palette, original icon assets, and bounded image cache; a reload replaces only
the pure rendering functions. Candidates are checked before replacing the current
renderer, including rendering the active palette when available.

Renderer reload is deliberately manual because editor drafts and React hooks
cannot be replaced safely in place. Save work before reloading. A full restart is
the fallback if the renderer does not refresh. No profile or authentication files
are copied. The version-gated app protocol hook serves only fixed development
module URLs on the existing app origin; the stock CSP remains unchanged. Renderer
modules load as normal ES modules, without string evaluation or a preload bridge.

## Failure and status

The manifest contains the stock version/build, selected mod set, hook hash, and
each module's content hash. A build publishes it only after all bundles exist.
The app accepts only the packaged hook/mod/source combination, fixed module IDs,
and files contained in the configured root with matching hashes.

Build failures retain the previous manifest. Missing, malformed, incompatible, or
corrupted updates retain the last accepted modules in the running main process
and emit a diagnostic. At startup, if external modules cannot load, the installed
bundled implementations remain available and renderer shims report their fallback.
A bad renderer module that fails evaluation or has missing exports also falls
back to its packaged implementation. This is recovery from load failures, not a
promise that arbitrary development code cannot introduce runtime bugs.

`modex status --app /path/Modex.app --json` distinguishes the signed build receipt
from the current external modules. It never executes external code. `ready` means
the configured files match the expected contract and hashes, not that a running
window has loaded them. Stop `--watch` with Ctrl-C; stopping it does not change the
app or remove generated modules.
