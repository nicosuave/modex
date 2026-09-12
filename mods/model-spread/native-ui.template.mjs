/*__NATIVE_IMPORTS__*/
import {
  initializeModelSpreadSelectableRow as initRow,
  ModelSpreadSelectableRow as SelectableRow,
} from './__PRIMARY__';
export function nativeUI() {
  /*__NATIVE_INITIALIZERS__*/
  initRow();
  return {
    Dialog,
    Body,
    Section,
    Heading,
    Title,
    Description,
    Footer,
    Button,
    SettingsTrigger,
    Menu,
    Items,
    SelectableRow,
    Rewind,
  };
}
