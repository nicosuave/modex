function MSMode({ layout, options, onChange }) {
  Dr();
  const config = ModelSpreadMod.useSettings(Cr),
    mode = layout.encoderMode === 'reasoning' && config.micro ? 'model-spread' : layout.encoderMode;
  const [error, setError] = Cr.useState(null);
  const items = [...options, 'model-spread'];
  const title = (value) =>
    value === 'model-spread' ? 'Model spread' : Cr.createElement(f, { ...Oi[value].label });
  const description = (value) =>
    value === 'model-spread'
      ? 'Move through your model and reasoning slots'
      : Cr.createElement(f, { ...Oi[value].description });
  const choices = items.map((value) =>
    Cr.createElement(
      A.Item,
      {
        key: value,
        onSelect: () => {
          try {
            ModelSpreadMod.setMicro(value === 'model-spread');
            onChange(value === 'model-spread' ? 'reasoning' : value);
            setError(null);
          } catch (e) {
            setError(e.message);
          }
        },
      },
      Cr.createElement(
        'div',
        null,
        title(value),
        Cr.createElement('div', { className: 'text-sm text-secondary' }, description(value)),
      ),
    ),
  );
  const control = Cr.createElement(
    F,
    {
      align: 'end',
      contentWidth: 'menuWide',
      triggerButton: Cr.createElement(ue, null, title(mode)),
    },
    choices,
  );
  return Cr.createElement(
    Cr.Fragment,
    null,
    Cr.createElement(Dt, {
      label: Cr.createElement(f, { ...X.knob }),
      description: Cr.createElement(f, { ...X.knobDescription }),
      control,
    }),
    mode === 'model-spread' && Cr.createElement(ModelSpreadSettings, { hostId: 'local', row: Dt }),
    error && Cr.createElement('p', { role: 'alert' }, error),
  );
}
