function MSMode({ layout, options, onChange }) {
  const { React, Message, labels, modes, Row, Menu, Items, SettingsTrigger } =
    modelSpreadMicroBindings();
  const config = ModelSpreadMod.useSettings(React),
    mode = layout.encoderMode === 'reasoning' && config.micro ? 'model-spread' : layout.encoderMode;
  const [error, setError] = React.useState(null);
  const items = [...options, 'model-spread'];
  const title = (value) =>
    value === 'model-spread'
      ? 'Model spread'
      : React.createElement(Message, { ...modes[value].label });
  const description = (value) =>
    value === 'model-spread'
      ? 'Move through your model and reasoning slots'
      : React.createElement(Message, { ...modes[value].description });
  const choices = items.map((value) =>
    React.createElement(
      Items.Item,
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
      React.createElement(
        'div',
        null,
        title(value),
        React.createElement('div', { className: 'text-sm text-secondary' }, description(value)),
      ),
    ),
  );
  const control = React.createElement(
    Menu,
    {
      align: 'end',
      contentWidth: 'menuWide',
      triggerButton: React.createElement(SettingsTrigger, null, title(mode)),
    },
    choices,
  );
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(Row, {
      label: React.createElement(Message, { ...labels.knob }),
      description: React.createElement(Message, { ...labels.knobDescription }),
      control,
    }),
    mode === 'model-spread' &&
      React.createElement(ModelSpreadSettings, { hostId: 'local', row: Row }),
    error && React.createElement('p', { role: 'alert' }, error),
  );
}
