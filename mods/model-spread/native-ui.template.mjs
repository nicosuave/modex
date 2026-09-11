import {
  tit as Dialog,
  Jrt as Body,
  Zrt as Section,
  Xrt as Heading,
  rit as Title,
  nit as Description,
  Yrt as Footer,
  kMt as Button,
  RS as SettingsTrigger,
  KG as Menu,
  JG as Items,
  VS as initSettings,
  ZG as initMenu,
  Spn as init1,
  AMt as init2,
  iit as init3,
  eit as init4,
} from './__INITIAL__';
import {
  initializeModelSpreadSelectableRow as initRow,
  ModelSpreadSelectableRow as SelectableRow,
} from './__PRIMARY__';
import Rewind from './__REWIND__';
export function nativeUI() {
  init1();
  init2();
  init3();
  init4();
  initSettings();
  initMenu();
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
