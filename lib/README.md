# Shared utilities

These utilities operate on local copies of the installed macOS Codex app. They contain no Model Spread renderer transforms.

- `asar.mjs`: inspect archives, read entries, validate paths, and repack overlays with per-entry and archive integrity. It preserves unpacked entries and refuses source/output overlap.
- `package-app.mjs`: validate a stock archive/signature, copy it to a new staging path outside Applications, apply an overlay, update its integrity metadata, and sign it. Existing outputs are refused. It never launches or installs the app.
- `sign-app.mjs`: apply an explicit mod name/bundle ID and normal-profile environment, retain the native icon, sanitize vendor-only identity entitlements, and sign with a locally available Developer ID Application identity. It verifies the result and rejects per-build cdhash requirements.

## Package an overlay

```sh
bun lib/package-app.mjs \
  --source /Applications/ChatGPT.app \
  --overlay /absolute/path/to/overlay \
  --output /absolute/path/to/staging/Example.app \
  --app-name 'Example Mod' \
  --bundle-id local.codex.example-mod
```

Use `--inspect` for read-only input validation. `--unsigned` is for inspecting an intentionally invalidated staged bundle, not for normal use. Mod-specific entrypoints should check exact source compatibility and verify a backup first; this generic utility does not know a mod's supported source hashes.

## Signing

`CODEX_MODS_SIGN_IDENTITY` selects a certificate by its exact installed name or hash. If omitted, exactly one available Developer ID Application identity must exist. The old `MODEL_SPREAD_SIGN_IDENTITY` variable remains an alias for compatibility.

Every mod must supply its own stable app name and bundle ID under `local.codex`. Signing never changes the original stock app. Vendor-signed nested code is preserved; vendor keychain, application-group, application-identifier, and developer entitlements are removed from the new top-level identity. Cross-team framework loading requires the existing `disable-library-validation` entitlement. Other runtime permission entitlements remain.

Use the same bundle ID and Developer ID team across rebuilds. Do not replace a certificate failure with ad-hoc signing. `designatedRequirement(app)` exposes the verified certificate-based requirement for comparing builds. Tests exercise two different synthetic app builds and confirm they keep the same requirement.

The app's `LSEnvironment` is set for the local user's normal Codex profile. It applies when launching through Finder/Dock. An explicit shell environment can select another profile for direct executable invocation. Apps are built for local use and are not notarized or automatically installed.
