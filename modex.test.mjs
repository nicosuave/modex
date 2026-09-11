import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './modex.mjs';

const both = ['model-spread', 'theme-icon'];

for (const command of ['verify', 'prepare']) {
  test(`${command} defaults to both mods without an explicit selection`, () => {
    assert.deepEqual(parseArgs([command]), {
      command,
      mods: both,
      explicitSelection: false,
      args: [],
      help: false,
    });
  });
  for (const selection of [
    'model-spread',
    'theme-icon',
    'model-spread,theme-icon',
    'theme-icon,model-spread',
  ]) {
    test(`${command} accepts explicit ${selection} in canonical order`, () => {
      const parsed = parseArgs([command, '--source', '/source app.app', '--mods', selection]);
      assert.deepEqual(parsed, {
        command,
        mods: both.filter((id) => selection.split(',').includes(id)),
        explicitSelection: true,
        args: ['--source', '/source app.app'],
        help: false,
      });
    });
  }
}

test('prepare preserves packaging arguments and accepts selection before other flags', () => {
  const args = [
    '--source',
    '/source.app',
    '--output',
    '/staging/output.app',
    '--backup',
    '/backup.app',
    '--identity-from',
    '/installed.app',
    '--check',
  ];
  assert.deepEqual(parseArgs(['prepare', '--mods', 'theme-icon', ...args]), {
    command: 'prepare',
    mods: ['theme-icon'],
    explicitSelection: true,
    args,
    help: false,
  });
});

test('help is available without a command and for either command', () => {
  assert.equal(parseArgs(['--help']).help, true);
  for (const command of ['verify', 'prepare'])
    assert.equal(parseArgs([command, '--help']).help, true);
});

test('rejects missing and unknown commands', () => {
  for (const args of [[], ['install'], ['--mods', 'model-spread']])
    assert.throws(() => parseArgs(args));
});

test('rejects invalid, empty, duplicate and repeated mod selections', () => {
  for (const selection of [
    '',
    ',',
    'model-spread,',
    ',theme-icon',
    'unknown',
    'model-spread,unknown',
    'model-spread,model-spread',
  ]) {
    assert.throws(() => parseArgs(['prepare', '--mods', selection]), JSON.stringify(selection));
  }
  assert.throws(() => parseArgs(['prepare', '--mods']));
  assert.throws(() => parseArgs(['prepare', '--mods', 'model-spread', '--mods', 'theme-icon']));
});

test('rejects unknown arguments and incomplete path flags', () => {
  for (const command of ['verify', 'prepare']) {
    for (const suffix of [
      ['--unknown'],
      ['unexpected'],
      ['--source'],
      ['--source', '--mods', 'model-spread'],
    ]) {
      assert.throws(() => parseArgs([command, ...suffix]), `${command} ${suffix.join(' ')}`);
    }
  }
  for (const flag of ['--output', '--backup', '--identity-from']) {
    assert.throws(() => parseArgs(['prepare', flag]));
    assert.throws(() => parseArgs(['prepare', flag, '--check']));
    assert.throws(() => parseArgs(['verify', flag, '/some.app']));
  }
  assert.throws(() => parseArgs(['verify', '--check']));
});

test('status only accepts inspection options', () => {
  assert.deepEqual(parseArgs(['status', '--app', '/installed/Modex.app', '--json']).args, [
    '--app',
    '/installed/Modex.app',
    '--json',
  ]);
  for (const flag of ['--mods', '--source', '--output', '--dev-root'])
    assert.throws(() => parseArgs(['status', flag, 'value']));
  assert.throws(() => parseArgs(['status', '--app']));
});

test('development is explicit and cannot leak into status or module-build options', () => {
  assert.deepEqual(parseArgs(['prepare', '--dev-root', '/modules']).args, [
    '--dev-root',
    '/modules',
  ]);
  assert.deepEqual(parseArgs(['verify', '--dev-root', '/modules']).args, [
    '--dev-root',
    '/modules',
  ]);
  assert.deepEqual(
    parseArgs(['dev', '--output', '/modules', '--mods', 'theme-icon', '--watch']).mods,
    ['theme-icon'],
  );
  assert.deepEqual(parseArgs(['dev', '--output', '/modules', '--watch']).args, [
    '--output',
    '/modules',
    '--watch',
  ]);
  for (const command of ['status', 'dev'])
    assert.throws(() => parseArgs([command, '--dev-root', '/modules']));
  for (const command of ['verify', 'prepare', 'status'])
    assert.throws(() => parseArgs([command, '--watch']));
});

test('custom CLI can be selected alone or with task panes without changing defaults', () => {
  assert.deepEqual(parseArgs(['prepare', '--mods', 'custom-cli']).mods, ['custom-cli']);
  assert.deepEqual(parseArgs(['verify', '--mods', 'custom-cli,task-panes']).mods, [
    'task-panes',
    'custom-cli',
  ]);
  assert.deepEqual(parseArgs(['verify']).mods, both);
});

test('update accepts only preservation-oriented options', () => {
  const flags = [
    '--app',
    '/Applications/Modex.app',
    '--source',
    '/Stock.app',
    '--backup',
    '/Original.zip',
    '--wait-seconds',
    '30',
    '--stage-only',
  ];
  assert.deepEqual(parseArgs(['update', ...flags]).args, flags);
  assert.deepEqual(parseArgs(['update', '--check']).args, ['--check']);
  for (const flag of ['--mods', '--identity-from', '--dev-root', '--output'])
    assert.throws(() => parseArgs(['update', flag, 'value']));
  assert.throws(() => parseArgs(['update', '--app']));
});
