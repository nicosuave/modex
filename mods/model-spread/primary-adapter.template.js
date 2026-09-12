export function ModelSpreadSettings({ hostId = 'local', row: Row }) {
  const {
    React,
    scopeHook,
    scopeKey,
    modelsHook,
    defaultChoices,
    selectionMode,
    ModelLabel,
    Message,
    effortLabels,
  } = modelSpreadBindings();
  const settings = ModelSpreadMod.useSettings(React);
  const scope = scopeHook(scopeKey);
  const { data } = modelsHook({ hostId });
  const models = data?.models ?? [];
  const defaults = ModelSpreadMod.defaultChoices(
    hostId,
    defaultChoices(models, { includeUltraInSlider: false }),
  );
  const N = MSNative();
  const trigger = React.createElement(
    N.SettingsTrigger,
    { disabled: !data, chevronClassName: 'hidden' },
    'Configure…',
  );
  const editor = React.createElement(MSEditor, {
    React,
    Native: N,
    Picker: ModelSpreadSlotPicker,
    models,
    defaults,
    trigger,
    onSave: () => scope.set(selectionMode, 'default'),
    modelLabel: (slot) =>
      React.createElement(ModelLabel, {
        model: slot.model,
        displayName: slot.modelLabel,
        stripGptPrefix: false,
      }),
    effortLabel: (effort) => React.createElement(Message, { ...effortLabels[effort] }),
  });
  return Row
    ? React.createElement(Row, {
        label: 'Model spread',
        description: settings.slots
          ? `${settings.slots.length} slots shared by the slider and Micro knob`
          : 'Default model and reasoning spread',
        control: editor,
      })
    : React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            padding: '16px 0',
          },
        },
        React.createElement('span', null, 'Model spread'),
        editor,
      );
}
function ModelSpreadSlotPicker({ models, slot, onChange }) {
  const { React, allChoices, Picker, ModelLabel, Message, effortLabels, CheckIcon } =
    modelSpreadBindings();
  const [open, setOpen] = React.useState(false);
  const N = MSNative();
  const options = models.map((model) => ({ model, disabledReason: null }));
  const choices = allChoices(models, { stripGptPrefix: false }).map((choice, index) => ({
    ...choice,
    powerSettingIndex: index,
  }));
  const model = models.find((m) => m.model === slot.model);
  return React.createElement(
    'div',
    {
      className: 'ms-slot-picker',
      style: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) 120px',
        gap: 12,
        alignItems: 'center',
      },
    },
    React.createElement(Picker, {
      align: 'end',
      models,
      modelOptions: options,
      model: slot.model,
      reasoningEffort: slot.reasoningEffort,
      selectionMode: 'model',
      hasWorkModeAccess: true,
      menuView: 'advanced',
      open,
      onOpenChange: setOpen,
      onToggleMenuView: () => {},
      showReasoningEffortControls: true,
      powerSelections: choices,
      onSelectModel: (model, reasoningEffort) => {
        onChange({ model, reasoningEffort });
        setOpen(false);
      },
      onSelectModelOption: () => setOpen(false),
      onSelectReasoningEffort: (reasoningEffort) => onChange({ ...slot, reasoningEffort }),
      triggerButton: React.createElement(
        N.SettingsTrigger,
        { 'aria-label': 'Slot model', style: { width: 'fit-content', maxWidth: '100%' } },
        React.createElement(ModelLabel, {
          model: slot.model,
          displayName: model?.displayName,
          stripGptPrefix: false,
        }),
      ),
    }),
    React.createElement(
      N.Menu,
      {
        align: 'end',
        contentWidth: 'menuNarrow',
        triggerButton: React.createElement(
          N.SettingsTrigger,
          { 'aria-label': 'Reasoning level', style: { width: '100%' } },
          React.createElement(Message, { ...effortLabels[slot.reasoningEffort] }),
        ),
      },
      model?.supportedReasoningEfforts.map((e) =>
        React.createElement(
          N.Items.Item,
          {
            key: e.reasoningEffort,
            role: 'menuitemradio',
            'aria-checked': e.reasoningEffort === slot.reasoningEffort,
            RightIcon: e.reasoningEffort === slot.reasoningEffort ? CheckIcon : undefined,
            onSelect: () => onChange({ ...slot, reasoningEffort: e.reasoningEffort }),
          },
          React.createElement(Message, { ...effortLabels[e.reasoningEffort] }),
        ),
      ),
    ),
  );
}
