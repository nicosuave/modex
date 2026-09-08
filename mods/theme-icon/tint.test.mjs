import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {parseAccent, tintIcon, tintThemeIcon} from './tint.mjs';

test('preserves neutral artwork, transparent pixels, alpha and source input', () => {
  const input = new Uint8Array([30,30,30,255, 255,255,255,128, 0,0,255,0, 0,0,255,170]);
  const before = input.slice();
  const result = tintIcon(input, '#f00');
  assert.deepEqual(result.slice(0,12), input.slice(0,12));
  assert.deepEqual([...result.slice(12)], [255,0,0,170]);
  assert.deepEqual(input, before);
});
test('accepts arbitrary accents and preserves highlight ordering', () => {
  const source = new Uint8Array([0,0,128,255, 0,0,255,255, 180,180,255,255]);
  for (const accent of ['#000','#fff','#888','#d28a31','#37bcad','#f471b5']) {
    const output = tintIcon(source, accent);
    const brightness = [0,4,8].map(i => output[i]+output[i+1]+output[i+2]);
    assert.ok(brightness[0] <= brightness[1] && brightness[1] <= brightness[2]);
    assert.deepEqual(output, tintIcon(source, accent));
  }
  const gray = tintIcon(source, '#888');
  for (let i=0;i<gray.length;i+=4) assert.ok(gray[i] === gray[i+1] && gray[i+1] === gray[i+2]);
});
test('normalizes shorthand and rejects unresolved or transparent colors', () => {
  assert.deepEqual(parseAccent('#abc'), parseAccent('#aabbcc'));
  for (const color of ['red','var(--accent)','#abcd','#12345678',null]) assert.throws(() => parseAccent(color));
  assert.throws(() => tintIcon(new Uint8Array(3), '#fff'));
});

test('resolved Codex palette colors tile and artwork independently, including custom accents', () => {
  const pixels = new Uint8Array([31,31,31,255, 0,0,255,128, 1,2,3,0]);
  const theme = {surface:'#282828',ink:'#ebdbb2',accent:'#458588'};
  const original=pixels.slice();
  const first=tintThemeIcon(pixels,theme);
  const custom=tintThemeIcon(pixels,{...theme,accent:'#ff0000'});
  assert.deepEqual(first.slice(0,4),custom.slice(0,4));
  assert.notDeepEqual(first.slice(4,7),custom.slice(4,7));
  assert.equal(first[7],128);
  assert.deepEqual(first.slice(8),pixels.slice(8));
  assert.deepEqual(pixels,original);
  const light=tintThemeIcon(new Uint8Array([245,245,245,255]),{surface:'#eee0bb',accent:'#458588'},'light');
  assert.ok(light[0]>light[2]);
  assert.throws(()=>tintThemeIcon(pixels,theme,'unknown'));
});
