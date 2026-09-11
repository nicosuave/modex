export function ModelSpreadSettings({ hostId = 'local', row: Row }) {
  Yqr();
  const settings = ModelSpreadMod.useSettings(S7);
  const scope = Oe(Ke);
  const { data } = gO({ hostId });
  const models = data?.models ?? [];
  const defaults = ModelSpreadMod.defaultChoices(
    hostId,
    IIe(models, { includeUltraInSlider: false }),
  );
  const N = MSNative();
  const trigger = S7.createElement(
    N.SettingsTrigger,
    { disabled: !data, chevronClassName: 'hidden' },
    'Configure…',
  );
  const editor = S7.createElement(MSEditor, {
    React: S7,
    Native: N,
    Picker: ModelSpreadSlotPicker,
    models,
    defaults,
    trigger,
    onSave: () => scope.set($w, 'default'),
    modelLabel: (slot) =>
      S7.createElement(I4, {
        model: slot.model,
        displayName: slot.modelLabel,
        stripGptPrefix: false,
      }),
    effortLabel: (effort) => S7.createElement(X, { ...P4[effort] }),
  });
  return Row
    ? S7.createElement(Row, {
        label: 'Model spread',
        description: settings.slots
          ? `${settings.slots.length} slots shared by the slider and Micro knob`
          : 'Default model and reasoning spread',
        control: editor,
      })
    : S7.createElement(
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
        S7.createElement('span', null, 'Model spread'),
        editor,
      );
}
function ModelSpreadSlotPicker({ models, slot, onChange }) {
  const [open, setOpen] = S7.useState(false);
  const N = MSNative();
  const options = models.map((model) => ({ model, disabledReason: null }));
  const choices = TAe(models, { stripGptPrefix: false }).map((choice, index) => ({
    ...choice,
    powerSettingIndex: index,
  }));
  const model = models.find((m) => m.model === slot.model);
  return S7.createElement(
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
    S7.createElement(tqr, {
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
      triggerButton: S7.createElement(
        N.SettingsTrigger,
        { 'aria-label': 'Slot model', style: { width: 'fit-content', maxWidth: '100%' } },
        S7.createElement(I4, {
          model: slot.model,
          displayName: model?.displayName,
          stripGptPrefix: false,
        }),
      ),
    }),
    S7.createElement(
      N.Menu,
      {
        align: 'end',
        contentWidth: 'menuNarrow',
        triggerButton: S7.createElement(
          N.SettingsTrigger,
          { 'aria-label': 'Reasoning level', style: { width: '100%' } },
          S7.createElement(X, { ...P4[slot.reasoningEffort] }),
        ),
      },
      model?.supportedReasoningEfforts.map((e) =>
        S7.createElement(
          N.Items.Item,
          {
            key: e.reasoningEffort,
            role: 'menuitemradio',
            'aria-checked': e.reasoningEffort === slot.reasoningEffort,
            RightIcon: e.reasoningEffort === slot.reasoningEffort ? jT : undefined,
            onSelect: () => onChange({ ...slot, reasoningEffort: e.reasoningEffort }),
          },
          S7.createElement(X, { ...P4[e.reasoningEffort] }),
        ),
      ),
    ),
  );
}

// Selectable rows moved from a standalone chunk into the native primary bundle.
export { bKn as ModelSpreadSelectableRow, SKn as initializeModelSpreadSelectableRow };
