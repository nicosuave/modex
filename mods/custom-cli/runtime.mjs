import fs from 'node:fs';
import path from 'node:path';

let configuration = null;
let initialized = false;
const fail = (message) => {
  throw Error(`Custom CLI: ${message}`);
};

export function validateConfiguration(value, { fileSystem = fs } = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('configuration must be an object');
  if (
    Object.keys(value).some(
      (key) => !['enabled', 'executablePath', 'configOverrides'].includes(key),
    )
  )
    fail('unknown configuration field');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    fail('enabled must be a boolean');
  if (
    value.executablePath !== undefined &&
    (typeof value.executablePath !== 'string' ||
      !path.isAbsolute(value.executablePath) ||
      value.executablePath.includes('\0'))
  )
    fail('executablePath must be an absolute path');
  if (
    value.configOverrides !== undefined &&
    (!Array.isArray(value.configOverrides) ||
      value.configOverrides.some(
        (item) =>
          typeof item !== 'string' ||
          item.indexOf('=') < 1 ||
          !item.slice(0, item.indexOf('=')).trim() ||
          item.includes('\0'),
      ))
  )
    fail('configOverrides must contain TOML key=value strings');
  if (value.enabled === false) return null;
  if (value.executablePath !== undefined) {
    try {
      if (!fileSystem.statSync(value.executablePath).isFile())
        fail('executablePath must be an executable file');
      fileSystem.accessSync(value.executablePath, fs.constants.X_OK);
    } catch {
      fail('executablePath must be an executable file');
    }
  }
  const configOverrides = [...(value.configOverrides ?? [])];
  if (value.executablePath === undefined && !configOverrides.length) return null;
  return Object.freeze({
    executablePath: value.executablePath,
    configOverrides: Object.freeze(configOverrides),
  });
}

export function loadConfiguration({ userData, env = process.env, fileSystem = fs }) {
  const explicit = env.MODEX_CUSTOM_CLI_CONFIG;
  if (explicit !== undefined && (!path.isAbsolute(explicit) || explicit.includes('\0')))
    fail('MODEX_CUSTOM_CLI_CONFIG must be an absolute path');
  const file = explicit ?? path.join(userData, 'modex-custom-cli.json');
  let text;
  try {
    text = fileSystem.readFileSync(file, 'utf8');
  } catch (error) {
    if (explicit === undefined && error.code === 'ENOENT') return null;
    fail('cannot read configuration file');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail('configuration file must contain valid JSON');
  }
  return validateConfiguration(value, { fileSystem });
}

export function initialize(app, env = process.env) {
  if (initialized) return configuration;
  const loaded = loadConfiguration({ userData: app.getPath('userData'), env });
  if (loaded?.executablePath) env.CODEX_CLI_PATH = loaded.executablePath;
  configuration = loaded;
  initialized = true;
  return configuration;
}

export function isActive() {
  return configuration !== null;
}
export function applyLaunch(launch, hostConfig, config = configuration) {
  if (
    !launch ||
    hostConfig.kind !== 'local' ||
    launch.spawnCommand !== undefined ||
    launch.spawnArgs !== undefined ||
    config === null
  )
    return launch;
  return {
    ...launch,
    args: [...launch.args, ...config.configOverrides.flatMap((value) => ['-c', value])],
  };
}
