# Combined Modex

The root CLI defaults to both [Model Spread](../model-spread/README.md) and [Theme Icon](../theme-icon/README.md). This directory owns their ordered composition and also supports either explicit singleton selection. Each selected mod's complete feature contract still applies.

Run `bun run modex verify`, then `bun run modex prepare --check --identity-from /absolute/path/to/installed/Modex.app --output /absolute/new/staging/Modex.app`, followed by the same preparation command without `--check`. Add `--mods model-spread` or `--mods theme-icon` to both commands for a standalone build. A fresh installation can omit `--identity-from` and uses Model Spread’s stable bundle ID. Source defaults to `/Applications/ChatGPT.app`; pass `--source` for another supported stock app and `--backup` to explicitly reuse a verified original ZIP.

Compatibility is derived from both sibling manifests, normalizing their ASAR paths and rejecting version or shared-hash disagreement. No separate copied hash list is maintained. Build input must match every pristine bundle hash. Model Spread transforms first; Theme Icon receives that result, including the modified app-initial bundle. Overlays are never built independently and merged over each other.

The verifier runs the selected real-bundle suites. With both selected this includes native HOME normalization, a combined regression executing HOME High/Max preservation and theme-hook delivery from the final shared bundle, and singleton equivalence checks. It checks deterministic output, syntax, and relative imports. Packaging verifies the installed signature/team before work and compares the final certificate designated requirement when `--identity-from` is supplied. It stores the selected set in signed ASAR metadata and requires explicit `--mods` to remove any installed mod; older builds use known-file detection.

Preparation only creates a new staged app. Follow the root README for installation and profiles; preserve the running copy until the user closes it. Check both mods’ runtime acceptance cases after launch, including persistence, HOME High/Max, Micro, and Appearance icon variants. Unit and stock-bundle tests do not prove hardware or account access.

Intentionally standalone builds remain available through `verify:model-spread`, `prepare:model-spread`, `verify:theme-icon`, and `prepare:theme-icon`. Those named preparation commands are explicit single-mod requests and also record metadata. Prefer the root CLI for new workflows.
