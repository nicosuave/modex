# Task Panes

Task Panes adds split panes and tab groups to Codex tasks. It is opt-in: the default build still enables only Model Spread and Theme Icon.

## Controls

Open a task, then drag another task from the sidebar into the conversation area. The drop preview shows where it will go:

| Target or control | Behavior |
| --- | --- |
| Left, right, top, or bottom edge | Split the target pane in that direction |
| Center of a pane | Add the task to that pane's tabs |
| Tab strip | Insert at the indicated tab position |
| Drag an existing tab | Reorder it, move it to another group, or create a split |
| Divider | Drag to resize adjacent panes |
| Maximize / Restore pane | Expand one group, then restore the split layout |
| Close button beside a tab | Remove that tab from the layout |

Closing a tab does not stop, archive, or delete its task. Empty groups collapse. A task appears only once in the layout; dragging an already open task moves or activates its tab. Once a layout is open, selecting a new task from the sidebar adds a tab in the focused pane. Selecting an already open task focuses its existing pane and tab without moving it or changing the splits.

Focus a tab and use Left/Right or Home/End to switch tabs; Delete closes the focused tab. Focus a divider and use the arrows along its resize direction to adjust it in 5% steps; Home/End move it to the ratio limits. Escape cancels a pane drag.

## Task support and native behavior

Local Codex tasks, including tasks on SSH hosts, and cloud Codex tasks can share a layout. Each uses its stock transcript and composer. Local panes retain host availability and archived-task guards; archived previews retain their read-only footer. The native task-summary toolbar control opens the stock Environment popover.

Drafts and transcript scroll state stay with the task when switching tabs, moving tabs between groups, resizing, or maximizing. Hidden tabs remain mounted; composer shortcuts and read tracking follow the active pane. Layout state lives in the current renderer session, not durable storage across app restarts or window reloads.

Narrow panes use the native composer and its width-dependent controls. No replacement text editor or compact-chat renderer is introduced. Pane toolbars, tabs, close buttons, and expand/restore icons use the native Codex components. Window-level task headers and side panels are not duplicated into every pane.

The existing **drop-to-reference** behavior takes priority over pane placement: drop onto a composer or stock reference target to reference a task. Use the conversation area or tab strip to arrange panes. Ordinary sidebar reordering, file/text drops, and ChatGPT conversation drags retain their existing behavior; ChatGPT conversations are not pane tasks.

## Build and verify

The exact supported stock build is **26.901.51231 (8109)**. The [compatibility manifest](compatibility.json) gates the patched bundles by hash, and each transform requires a unique matching anchor. Unknown builds require a reviewed adaptation; do not change hashes alone or bypass the gate.

Run from the repository root:

```sh
bun install --frozen-lockfile
bun test mods/task-panes
bun run modex verify --mods model-spread,theme-icon,task-panes
bun run modex prepare --check --mods model-spread,theme-icon,task-panes \
  --identity-from /Applications/Modex.app \
  --output "$HOME/Codex-Mods/task-panes-1/Modex.app"
bun run modex prepare --mods model-spread,theme-icon,task-panes \
  --identity-from /Applications/Modex.app \
  --output "$HOME/Codex-Mods/task-panes-1/Modex.app"
```

Use the actual installed app path for `--identity-from`; omit it only for a first installation. Keep the same complete `--mods` selection in every command. Use `--mods task-panes` if you intentionally want only this UI mod. App-tools authentication is included automatically in either selection.

Preparation creates a separate signed staging app; it does not install, launch, overwrite, or quit an app. Follow the root [installation instructions](../../README.md#install-and-open) and preserve the installed app's bundle ID and signing team when updating. Use a new output path for another attempt and `--backup` explicitly to reuse a verified stock backup.

For external development modules, follow the [development guide](../development/README.md) with the same `--mods model-spread,theme-icon,task-panes` selection for `dev`, `verify`, and `prepare`. Task Panes runtime changes need a window reload or restart; installed hook changes need a newly verified, signed package. The watcher never reloads or quits the app.

The full verifier supplies stock fixtures for renderer, drag, and composition checks; plain tests may skip fixture-dependent cases. Automated verification does not establish native account access or successful cloud execution. With an isolated profile, check two task composers, drafts and scroll across tab moves, reference drops, every split direction, resizing, maximize/restore, close controls, archived previews, and the Environment popover. Check renderer/startup errors as well. Use the root [isolated launch guidance](../model-spread/README.md#isolated-verification) and [repair guide](../../REPAIR.md) for runtime failures.
