# Custom CLI

Use a different local Codex CLI executable or pass configuration overrides to its app server. Select this mod with `--mods custom-cli`, alone or alongside other mods.

## Configuration

Create `modex-custom-cli.json` in the app's user-data directory, normally `~/Library/Application Support/Codex`. Isolated app profiles use their own directory. Restart the app after changing it.

```json
{
  "executablePath": "/absolute/path/to/codex",
  "configOverrides": [
    "model=\"your-model-id\"",
    "model_reasoning_effort=\"high\""
  ]
}
```

Both fields are optional. Omit `executablePath` to keep the bundled CLI. Each override uses the CLI's TOML `key=value` syntax and follows the app's own overrides. The executable must support the app's `app-server` protocol; an arbitrary CLI is not compatible.

A missing file leaves the stock launch unchanged. Set `"enabled": false` to disable a saved configuration. An invalid file stops startup with a configuration error. To use another file, set `MODEX_CUSTOM_CLI_CONFIG` to its absolute path in the app's launch environment; shell exports do not automatically reach Finder-launched apps.

Settings stay outside the app and repository. Configure provider credentials through the CLI's normal authentication. This mod does not ship providers, model catalogs, credentials, or a proxy.

Overrides apply to the local app-server process. SSH, WSL, and cloud connections retain their existing behavior. A configured executable also supplies the app's native CLI tools through its existing `CODEX_CLI_PATH` mechanism. An existing host `codex_cli_command` retains precedence for that host's app server. Custom configuration bypasses local daemon reuse so each app launches with its own settings.

The supported bundled CLI rejects `--profile` for `app-server`. Use configuration overrides instead.

## Build

Follow the root [build instructions](../../README.md#first-build) with `mods="custom-cli"`, or combine it with other mods, such as `mods="task-panes,custom-cli"`. Supported stock source: **26.903.71938 (8576)**.

```sh
bun run modex verify --mods custom-cli
bun run modex verify --mods model-spread,theme-icon,task-panes,custom-cli
```

The native integration is packaged into the app. It can coexist with external development modules for other mods, but changes to this mod's code require rebuilding the app. Editing the local configuration file only requires a restart.
