import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { configure, update, apply, setRenderer } from './main.mjs';
import { renderPixels, sourceVariant } from './render.mjs';

test('native adapter uses palette, caches bounded work and respects the stock selector', () => {
  const source = new PNG({ width: 256, height: 256 });
  for (let i = 0; i < source.data.length; i += 4) source.data.set([0, 0, 255, 255], i);
  const png = PNG.sync.write(source);
  const paths = [],
    rendered = [],
    icons = [];
  let refreshed = 0;
  const api = {
    app: { dock: { setIcon: (image) => icons.push(image) } },
    nativeImage: {
      createFromPath: (path) => {
        paths.push(path);
        return { isEmpty: () => false, resize: () => ({ toPNG: () => png }) };
      },
      createFromBuffer: (buffer) => {
        rendered.push(PNG.sync.read(buffer));
        return { crop: (rect) => ({ rect, buffer }) };
      },
    },
  };
  configure(api, '/fixtures/resources', () => {
    refreshed++;
    apply('codex-system');
  });
  assert.equal(
    update({ appearance: 'dark', variant: 'theme', surface: '#282828', accent: '#00ff00' }),
    true,
  );
  assert.equal(refreshed, 1);
  assert.deepEqual([...rendered[0].data.slice(0, 4)], [0, 255, 0, 255]);
  assert.equal(apply('app-default'), false);
  assert.equal(icons.length, 1);
  assert.equal(apply('codex-system'), true);
  assert.equal(rendered.length, 1);
  update({ appearance: 'dark', variant: 'light', surface: '#282828', accent: '#ff0000' });
  assert.ok(paths[1].endsWith('icon-codex-light.png'));
  assert.deepEqual([...rendered.at(-1).data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual(icons.at(-1).rect, { x: 2, y: 2, width: 252, height: 252 });
  update({ appearance: 'dark', variant: 'original', surface: '#282828', accent: '#ff0000' });
  assert.deepEqual(rendered.at(-1).data, source.data);
  const count = icons.length;
  assert.equal(update({ appearance: 'system' }), false);
  assert.equal(icons.length, count);
});

test('development renderer replacement preserves palette and invalidates the native image cache', () => {
  const source = new PNG({ width: 256, height: 256 });
  source.data.fill(255);
  const pixels = [],
    icons = [];
  const api = {
    app: { dock: { setIcon: (image) => icons.push(image) } },
    nativeImage: {
      createFromPath: () => ({
        isEmpty: () => false,
        resize: () => ({ toPNG: () => PNG.sync.write(source) }),
      }),
      createFromBuffer: (bytes) => {
        pixels.push(PNG.sync.read(bytes).data);
        return { crop: () => bytes };
      },
    },
  };
  configure(api, '/fixture', () => apply('codex-system'));
  update({ appearance: 'dark', variant: 'theme', surface: '#222222', accent: '#00ff00' });
  let observed;
  try {
    setRenderer({
      sourceVariant,
      renderPixels: (bytes, palette) => {
        observed = palette;
        const result = new Uint8Array(bytes);
        result.set([17, 23, 41, 255]);
        return result;
      },
    });
    assert.equal(observed.accent, '#00ff00');
    assert.deepEqual([...pixels.at(-1).slice(0, 4)], [17, 23, 41, 255]);
    const count = pixels.length;
    apply('codex-system');
    assert.equal(pixels.length, count);
    assert.throws(() => setRenderer({ renderPixels: () => {} }), /Invalid Theme Icon renderer/);
    assert.throws(
      () =>
        setRenderer({
          sourceVariant,
          renderPixels: () => {
            throw Error('candidate failed');
          },
        }),
      /candidate failed/,
    );
    assert.throws(
      () => setRenderer({ sourceVariant, renderPixels: (p) => new Uint8Array(p.length - 1) }),
      /pixel output/,
    );
    assert.throws(
      () =>
        setRenderer({
          sourceVariant,
          renderPixels: (bytes, palette) => {
            if (palette.accent === '#00ff00') throw Error('current palette failed');
            return bytes;
          },
        }),
      /current palette failed/,
    );
    apply('codex-system');
    assert.deepEqual([...pixels.at(-1).slice(0, 4)], [17, 23, 41, 255]);
    const displayed = icons.length;
    assert.equal(apply('app-default'), false);
    assert.equal(icons.length, displayed);
  } finally {
    setRenderer({ renderPixels, sourceVariant });
  }
});
