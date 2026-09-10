import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { paletteChoices, chosenColor } from './palette.mjs';
import { setColor, selectedColor, setVariant, selectedVariant } from './state.mjs';
const gruvbox = {
  accent: '#458588',
  ink: '#ebdbb2',
  semanticColors: { skill: '#b16286', diffAdded: '#98971a', diffRemoved: '#cc241d' },
};

test('small palette consists only of chosen theme resolved roles and overrides', () => {
  const choices = paletteChoices(gruvbox);
  assert.deepEqual(
    choices.map((c) => c.color),
    ['#458588', '#ebdbb2', '#b16286', '#98971a', '#cc241d'],
  );
  assert.equal(choices.length, 5);
  const custom = paletteChoices({
    ...gruvbox,
    accent: '#ff00ff',
    semanticColors: { ...gruvbox.semanticColors, skill: '#ffaa00' },
  });
  assert.equal(custom[0].color, '#ff00ff');
  assert.equal(chosenColor(custom, 'semantic.skill').color, '#ffaa00');
  assert.equal(chosenColor(custom, 'missing').id, 'accent');
});
test('deduplicates nearby roles and never fills the row with unrelated colors', () => {
  assert.deepEqual(
    paletteChoices({
      accent: '#458588',
      ink: '#458589',
      semanticColors: { skill: '#458588', diffAdded: '#888888', diffRemoved: 'invalid' },
    }).map((c) => c.color),
    ['#458588', '#888888'],
  );
  assert.deepEqual(paletteChoices({ accent: '#123456' }), [
    { id: 'accent', label: 'Accent', color: '#123456' },
  ]);
});
test('selection persists independently of background and follows role colors on update', () => {
  let settings = setVariant(null, 'dark:gruvbox', 'light');
  settings = setColor(settings, 'dark:gruvbox', 'semantic.diffRemoved');
  settings = JSON.parse(JSON.stringify(settings));
  assert.equal(selectedVariant(settings, 'dark:gruvbox'), 'light');
  assert.equal(selectedColor(settings, 'dark:gruvbox'), 'semantic.diffRemoved');
  assert.equal(selectedColor(settings, 'light:gruvbox'), 'accent');
  assert.equal(
    selectedColor(setVariant(settings, 'dark:gruvbox', 'theme'), 'dark:gruvbox'),
    'semantic.diffRemoved',
  );
  assert.equal(
    chosenColor(
      paletteChoices({ ...gruvbox, semanticColors: { diffRemoved: '#ff3333' } }),
      selectedColor(settings, 'dark:gruvbox'),
    ).color,
    '#ff3333',
  );
});
