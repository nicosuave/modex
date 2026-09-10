import {
  KEY,
  VARIANTS,
  themeKey,
  selectedVariant,
  setVariant,
  selectedColor,
  setColor,
} from './state.mjs';
import { renderPixels, sourceVariant } from './render.mjs';
import { paletteChoices, chosenColor } from './palette.mjs';
let snapshot = null;
const listeners = new Set();
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const getSnapshot = () => snapshot;
function publish(value) {
  snapshot = value;
  for (const fn of listeners) fn();
}

export function useTheme(React, { theme, appearance, id, read, write, listen, bridge }) {
  const key = themeKey(id ?? 'codex', appearance);
  const [revision, changed] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => listen(KEY, null, () => changed()), []);
  const variant = selectedVariant(read(KEY, null), key),
    colorId = selectedColor(read(KEY, null), key);
  const semantic = JSON.stringify(theme.semanticColors ?? {});
  React.useEffect(() => {
    const choices = paletteChoices(theme),
      selected = chosenColor(choices, colorId);
    if (!selected) return;
    const payload = { appearance, variant, accent: selected.color, surface: theme.surface };
    const send = () => bridge.dispatchMessage('modex-theme-icon', payload);
    const timer = setTimeout(send, 80);
    window.addEventListener('focus', send);
    publish({
      key,
      id: id ?? 'codex',
      ...payload,
      choices,
      colorId: selected.id,
      save: (next) => {
        write(KEY, setVariant(read(KEY, null), key, next));
        changed();
      },
      saveColor: (next) => {
        write(KEY, setColor(read(KEY, null), key, next));
        changed();
      },
    });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', send);
    };
  }, [key, variant, colorId, theme.accent, theme.surface, theme.ink, semantic, revision]);
}

const decoded = new Map();
async function decode(url) {
  if (!decoded.has(url))
    decoded.set(
      url,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 256;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(image, 0, 0, 256, 256);
          resolve(ctx.getImageData(0, 0, 256, 256));
        };
        image.onerror = () => {
          decoded.delete(url);
          reject(new Error('Could not load the original icon'));
        };
        image.src = url;
      }),
    );
  return decoded.get(url);
}
export async function previewIcon(previews, palette, variant) {
  const appearance = sourceVariant(variant, palette.appearance);
  const source = await decode(appearance === 'dark' ? previews.codexDark : previews.codexLight);
  const pixels = renderPixels(new Uint8Array(source.data), palette, variant, palette.appearance);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas
    .getContext('2d')
    .putImageData(new ImageData(new Uint8ClampedArray(pixels), 256, 256), 0, 0);
  return canvas.toDataURL('image/png');
}
export function Settings({
  React: R,
  Row,
  Dropdown,
  DropdownButton,
  Menu,
  CheckIcon,
  previews,
  enabled,
  onEnable,
}) {
  const h = R.createElement,
    state = R.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [images, setImages] = R.useState({}),
    [error, setError] = R.useState(null);
  R.useEffect(() => {
    if (!state) return;
    let cancelled = false;
    Promise.all(
      state.choices.map(async (c) => [
        c.id,
        await previewIcon(
          previews,
          { ...state, accent: c.color },
          state.variant === 'original' ? 'theme' : state.variant,
        ),
      ]),
    )
      .then((entries) => {
        if (!cancelled) {
          setImages(Object.fromEntries(entries));
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [state?.surface, state?.appearance, state?.variant, JSON.stringify(state?.choices), previews]);
  if (!state) return null;
  const choose = async (variant, color) => {
    try {
      if (color) {
        state.saveColor(color);
        if (state.variant === 'original') state.save('theme');
      } else state.save(variant);
      if (!enabled) await onEnable();
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };
  const name = state.id
    .split('-')
    .map((s) => s[0]?.toUpperCase() + s.slice(1))
    .join(' ');
  return h(Row, {
    label: 'Theme icon',
    description: h(
      R.Fragment,
      null,
      `Colors from ${name}.`,
      error && h('span', { role: 'alert', className: 'block' }, error),
    ),
    control: h(
      'div',
      {
        'data-modex-theme-icon': true,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          maxWidth: '100%',
          overflowX: 'auto',
          padding: 2,
        },
      },
      h(
        'div',
        {
          role: 'radiogroup',
          'aria-label': 'Theme icon color',
          style: { display: 'flex', flexWrap: 'nowrap', gap: 6 },
        },
        state.choices.map((c) =>
          h(
            'label',
            {
              key: c.id,
              className: 'group cursor-interaction',
              title: `${c.label} · ${c.color}`,
              style: { flexShrink: 0 },
            },
            h('input', {
              type: 'radio',
              name: 'modex-theme-icon-color',
              className: 'peer sr-only',
              'aria-label': c.label,
              checked: enabled && state.variant !== 'original' && state.colorId === c.id,
              onChange: () => choose(null, c.id),
            }),
            h(
              'span',
              {
                className: `flex items-center justify-center rounded-xl border peer-focus-visible:outline-2 peer-focus-visible:outline-ring ${enabled && state.variant !== 'original' && state.colorId === c.id ? 'border-text bg-primary-ghost-hover' : 'border-default bg-surface group-hover:border-strong'}`,
                style: { width: 44, height: 44 },
              },
              images[c.id] &&
                h('img', { src: images[c.id], alt: '', style: { width: 38, height: 38 } }),
            ),
          ),
        ),
      ),
      h(
        Dropdown,
        {
          align: 'end',
          contentWidth: 'menu',
          triggerButton: h(
            DropdownButton,
            { 'aria-label': 'Icon background', className: 'shrink-0' },
            state.variant === 'theme'
              ? 'Theme background'
              : VARIANTS.find((v) => v.id === state.variant)?.label,
          ),
        },
        h(
          Menu.Section,
          null,
          VARIANTS.map((v) =>
            h(
              Menu.Item,
              {
                key: v.id,
                RightIcon: state.variant === v.id ? CheckIcon : undefined,
                onSelect: () => choose(v.id),
              },
              v.id === 'theme' ? 'Theme background' : v.label,
            ),
          ),
        ),
      ),
    ),
  });
}
