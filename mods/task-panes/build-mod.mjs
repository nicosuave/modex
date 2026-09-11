import fs from 'node:fs';
import path from 'node:path';

export const files = {
  initial: 'webview/assets/app-initial-a9514281e192.js',
  primary: 'webview/assets/app-primary-defe25a79fce.js',
  localPage: 'webview/assets/local-conversation-page-4f23a630b0af.js',
  localThread: 'webview/assets/local-conversation-thread-9210b06f69b1.js',
  cloudPage: 'webview/assets/remote-conversation-page-f76463019395.js',
};
export function replaceOnce(source, anchor, replacement) {
  if (typeof source !== 'string' || source.split(anchor).length !== 2)
    throw new Error(`Expected exactly one Task Panes anchor: ${anchor.slice(0, 110)}`);
  return source.replace(anchor, replacement);
}
// These providers reuse the stock scope-key derivation and composer initializer.
// Router location and route params must also be isolated: atom scopes alone do
// not prevent another mounted composer consuming the active route's prefill.
export const providerAdapter = `
export function ModexPaneProviders({task,children}) {
  CT();uIs();qFs();
  const React=mT,pane=TaskPanesRuntime.usePane(React),outer=sT(),matches=React.useContext(ST);
  const url=new URL(task.path,'https://modex.invalid');
  const local=task.kind!=='cloud';
  const route=local?{routeKind:'local-thread',conversationId:task.conversationId,hostId:task.hostId,pathname:url.pathname,routeTemplate:'/local/:conversationId',search:url.search,projectContext:null}:{routeKind:'remote-thread',taskId:task.taskId,pathname:url.pathname,routeTemplate:'/remote/:taskId',search:url.search};
  const matchesActiveLocation=pane?.active&&outer.pathname+outer.search===url.pathname+url.search;
  const preview=React.useRef(task.archivedConversationPreview===true);
  if(matchesActiveLocation)preview.current=outer.state?.archivedConversationPreview===true;
  const location={pathname:url.pathname,search:url.search,hash:url.hash,key:matchesActiveLocation?outer.key:'modex:'+task.key,state:matchesActiveLocation?outer.state:preview.current?{archivedConversationPreview:true}:null};
  const params=local?{conversationId:task.conversationId}:{taskId:task.taskId};
  const matchValue={...matches,matches:matches.matches.map((match,index)=>index===matches.matches.length-1?{...match,params}:match)};
  return React.createElement(xT.Provider,{value:{location,navigationType:'POP'}},React.createElement(ST.Provider,{value:matchValue},React.createElement(aIs,{route},React.createElement(WFs,null,children))));
}
function ModexPaneShell({children}) {
  W3a();
  // Pane toolbars already occupy their own layout space. The stock edge-scroll
  // mode reserves another window-header inset inside each native transcript.
  return z3.createElement(z3.Fragment,null,z3.createElement(X1.MainContentLayout,{layout:'full-bleed'}),children);
}
function ModexPaneTab(props) {
  KYa();
  return z3.createElement(zYa,props);
}
function ModexTaskPage({Page}) {
  oP();W3a();YB();
  const location=sT(),route={...ub(Lj).value,archivedConversationPreview:location.state?.archivedConversationPreview===true},navigate=lT();
  return z3.createElement(rko,null,z3.createElement(TaskPanesRuntime.Workspace,{React:z3,route,navigate,Button:aP,Tooltip:aH,Toolbar:X1.HeaderToolbar,ToolbarActions:X1.HeaderToolbar.Actions,Tab:ModexPaneTab,MaximizeIcon:F9r,RestoreIcon:N9r,Task:TaskPanesRenderer.getRenderer(z3),Shell:ModexPaneShell},z3.createElement(Page)));
}
`;
export const cloudAdapter = `
export function ModexCloudPaneTask({task}) {
  return bo.createElement(ModexPaneProviders,{task},bo.createElement(ModexCloudPaneContents,{task}));
}
function ModexCloudPaneContents({task}) {
  const pane=TaskPanesRuntime.usePane(bo),hostId=v(nn),data=v(l).data,archived=ne().state?.archivedConversationPreview===true;
  bo.useEffect(()=>{pane?.setTitle(data?.task.title??task.title)},[data?.task.title,task.title,pane?.setTitle]);
  return bo.createElement('div',{style:{height:'100%',minHeight:0,minWidth:0,containerType:'inline-size'}},bo.createElement(Ja,{hostId,showComposer:!archived,footerContent:archived?bo.createElement(Hr,{conversationId:task.taskId,kind:'cloud'}):undefined}));
}
`;
// Page-level guards retain stock missing-host and archive behavior. Pane content
// is the actual LocalThread; the page's window header registrations stay outside.
export const localAdapter = `
export function ModexLocalPaneTask({task}) {
  return Cs.createElement(ModexPaneProviders,{task},Cs.createElement(ModexLocalPaneGuard,{task}));
}
function ModexLocalPaneGuard({task}) {
  const pane=TaskPanesRuntime.usePane(Cs),id=task.conversationId,host=X(mt,id),connection=X(Hr,id),archived=X(fr,id),title=X(Mr,id),summary=X(Mn,id),scope=i(on),globalPreview=k(Jn),preview=de().state?.archivedConversationPreview===true&&(archived||globalPreview);
  Cs.useEffect(()=>{pane?.setTitle(title??summary?.displayTitle??task.title)},[title,summary?.displayTitle,task.title,pane?.setTitle]);
  if(connection.status==='unavailable')return Cs.createElement(bs);
  if(archived&&!preview)return Cs.createElement(xs,{conversationId:id});
  if(task.hostId!=null&&host!==task.hostId)return Cs.createElement(Zn,{debugName:'TaskPanes.host'});
  return Cs.createElement(ModexLocalPaneContents,{task,scope,preview,allowMissingConversation:preview&&summary!=null});
}
function ModexLocalPaneContents({task,scope,preview,allowMissingConversation}) {
  const pane=TaskPanesRuntime.usePane(Cs),[open,setOpen]=Cs.useState(false),id=task.conversationId,host=task.hostId;
  Cs.useEffect(()=>{if(!pane?.active)setOpen(false)},[pane?.active]);
  const background=agent=>{if(!agent.canInteract){$a(scope,{hostId:host,parentConversationId:id,selectedConversationId:agent.conversationId,selectedDisplayName:agent.displayName});return}Qa(scope,{backgroundAgent:agent,hostId:host,TabComponent:Ca})};
  const subagents=()=>{$a(scope,{hostId:host,parentConversationId:id})};
  const pullRequest=value=>{'request'in value?Va(scope,value):Ha(scope,value)};
  si();
  const trigger=Cs.createElement(oi.HeaderButton,{label:'Environment and task summary',pressed:open});
  const summary=Cs.createElement(ta,{isOpen:open,onOpenChange:setOpen,trigger},Cs.createElement(_a,{onOpenBackgroundAgent:background,onOpenPullRequestSidePanel:pullRequest,onOpenSubagentsPanel:subagents}));
  return Cs.createElement('div',{style:{display:'flex',flexDirection:'column',height:'100%',minHeight:0,minWidth:0,containerType:'inline-size'}},!preview&&pane?.toolbarElement?modexReactDOM().createPortal(summary,pane.toolbarElement):null,Cs.createElement('div',{style:{flex:1,minHeight:0,minWidth:0}},Cs.createElement(Pa,{value:xa},Cs.createElement(va,{shouldResume:!preview,allowMissingConversation,isReadOnly:preview,showComposer:!preview,footerContent:preview?Cs.createElement(lo,{conversationId:id,hostId:host}):undefined,showSummaryPanel:false,showUtilityBar:true,onOpenBackgroundAgent:background,onOpenPullRequestSidePanel:pullRequest,onOpenSubagentsPanel:subagents}))));
}
`;
export function transform(bundles) {
  const output = { ...bundles };
  const patch = (file, anchor, value) => {
    output[file] = replaceOnce(output[file], anchor, value);
  };
  output[files.initial] =
    'import * as TaskPanesRuntime from "./task-panes-runtime.mjs";import * as TaskPanesRenderer from "./task-panes-renderer.mjs";' +
    output[files.initial];
  patch(
    files.initial,
    'path:_v,element:(0,B3.jsx)(rko,{children:(0,B3.jsx)(mko,{})})',
    'path:_v,element:(0,B3.jsx)(ModexTaskPage,{Page:mko})',
  );
  patch(
    files.initial,
    'path:`/remote/:taskId`,element:(0,B3.jsx)(hko,{})',
    'path:`/remote/:taskId`,element:(0,B3.jsx)(ModexTaskPage,{Page:hko})',
  );
  patch(
    files.initial,
    'function hN(){if(yN!=null&&yN.isConnected&&gN.has(yN))return yN;yN=null;let e=g7n();if(e!=null)return e;for(let e of gN.keys())if(e.isConnected)return e;return document.querySelector(`[data-codex-composer]`)}',
    'function hN(){if(yN!=null&&yN.isConnected&&gN.has(yN)&&TaskPanesRuntime.composerAvailable(yN))return yN;yN=null;let e=g7n();if(e!=null)return e;for(let e of gN.keys())if(e.isConnected&&TaskPanesRuntime.composerAvailable(e))return e;return Array.from(document.querySelectorAll(`[data-codex-composer]`)).find(e=>TaskPanesRuntime.composerAvailable(e))??null}',
  );
  patch(
    files.initial,
    'function g7n(){for(let[e,{isPrimaryComposer:t}]of gN)if(t&&e.isConnected)return e;return null}',
    'function g7n(){for(let[e,{isPrimaryComposer:t}]of gN)if(t&&e.isConnected&&TaskPanesRuntime.composerAvailable(e))return e;return null}',
  );
  output[files.initial] += providerAdapter;
  output[files.primary] =
    'import {drag as TaskPanesDrag} from "./task-panes-drag.mjs";' + output[files.primary];
  patch(
    files.primary,
    'function Hjn(e,t,n){if(e==null||t==null||document.elementsFromPoint==null)return null;',
    'function Hjn(e,t,n){if(TaskPanesDrag.claims({x:e,y:t}))return null;if(e==null||t==null||document.elementsFromPoint==null)return null;',
  );
  patch(
    files.primary,
    'E.current=r?.(a)??[a];let o=E.current.length>1?',
    'E.current=r?.(a)??[a];TaskPanesDrag.start(E.current.flatMap(state=>{const ref=state.threadReference,decoded=iT(state.threadKey);if(decoded?.kind===`remote`){const id=decoded.taskId;return[{kind:`cloud`,routeKind:`remote-thread`,taskId:id,key:`cloud:${id}`,path:`/remote/${id}`,title:id}]}if(decoded?.kind!==`local`||state.threadId==null||ref==null)return[];const id=state.threadId,hostId=ref.hostId??`local`,path=iS(id);return[{kind:`local`,routeKind:`local-thread`,conversationId:id,hostId,key:`local:${hostId}:${id}`,path:hostId===`local`?path:zFe(path,hostId),title:ref.getTitle()}]}));let o=E.current.length>1?',
  );
  patch(
    files.primary,
    'O.current=e.pointerCoordinates?.x??null,k.current=e.pointerCoordinates?.y??null;let t=qJ(e.active.data.current);',
    'O.current=e.pointerCoordinates?.x??null,k.current=e.pointerCoordinates?.y??null;TaskPanesDrag.move(e.pointerCoordinates);let t=qJ(e.active.data.current);',
  );
  patch(
    files.primary,
    'J=e=>{l.current=null,S(!1);let t=O.current,n=k.current,r=qJ(e.active.data.current)',
    'J=e=>{if(Hjn(O.current,k.current)==null&&TaskPanesDrag.drop()){q(e);return}TaskPanesDrag.cancel();l.current=null,S(!1);let t=O.current,n=k.current,r=qJ(e.active.data.current)',
  );
  patch(
    files.primary,
    'K=e=>{l.current=null,S(!1),O.current=null,k.current=null,A.current=null,E.current=[],RJ(null,null),HJ(null);',
    'K=e=>{TaskPanesDrag.cancel();l.current=null,S(!1),O.current=null,k.current=null,A.current=null,E.current=[],RJ(null,null),HJ(null);',
  );
  output[files.localPage] =
    'import * as TaskPanesRuntime from "./task-panes-runtime.mjs";import {ModexPaneProviders,pmn as modexReactDOM} from "./app-initial-a9514281e192.js";' +
    output[files.localPage] +
    localAdapter;
  output[files.localThread] =
    'import * as TaskPanesRuntime from "./task-panes-runtime.mjs";' + output[files.localThread];
  // Hidden native summary content extends beyond this clipping wrapper. Hidden
  // overflow can still scroll on focus; clip prevents it shifting the transcript.
  patch(
    files.localThread,
    'function bv(e){let t=(0,xv.c)(22)',
    'function bv(e){const modexPane=TaskPanesRuntime.usePane(Uk);let t=(0,xv.c)(23)',
  );
  patch(
    files.localThread,
    't[16]!==b||t[17]!==x?(S=(0,Sv.jsxs)(`div`,{className:`group/realtime-voice-thread relative h-full min-h-0 overflow-hidden`,children:[b,x]}),t[16]=b,t[17]=x,t[18]=S)',
    't[16]!==b||t[17]!==x||t[22]!==!!modexPane?(S=(0,Sv.jsxs)(`div`,{className:`group/realtime-voice-thread relative h-full min-h-0 overflow-hidden`,style:modexPane?{overflow:`clip`}:undefined,children:[b,x]}),t[16]=b,t[17]=x,t[18]=S,t[22]=!!modexPane)',
  );
  patch(
    files.localThread,
    '(Ce=t[18],we=t[19]),(0,Uk.useEffect)(Ce,we);let Te;',
    '(Ce=t[18],we=t[19]),TaskPanesRuntime.useActiveEffect(Uk,Ce,we);let Te;',
  );
  patch(
    files.localThread,
    '(0,Uk.useEffect)(Fe,Ie);let Le;',
    'TaskPanesRuntime.useActiveEffect(Uk,Fe,Ie);let Le;',
  );
  // Global header registration from the inner thread is unnecessary inside panes;
  // all stock task actions remain available in the normal task view.
  patch(
    files.localThread,
    'function Mk(e){let t=(0,Hk.c)(155)',
    'function Mk(e){const modexPane=TaskPanesRuntime.usePane(Uk);let t=(0,Hk.c)(155)',
  );
  patch(
    files.localThread,
    'rt=i!=null&&md(z.value)===i&&!Gd()&&!cr()?',
    'rt=i!=null&&md(z.value)===i&&!Gd()&&!cr()&&!modexPane?',
  );
  output[files.cloudPage] =
    'import * as TaskPanesRuntime from "./task-panes-runtime.mjs";import {ModexPaneProviders} from "./app-initial-a9514281e192.js";' +
    output[files.cloudPage] +
    cloudAdapter;
  patch(files.cloudPage, '(0,bo.useEffect)(z,B);', 'TaskPanesRuntime.useActiveEffect(bo,z,B);');
  for (const file of ['runtime', 'layout', 'drag', 'renderer']) {
    let content = fs.readFileSync(path.join(import.meta.dirname, `${file}.mjs`), 'utf8');
    for (const dependency of ['runtime', 'layout', 'drag', 'renderer'])
      content = content.replaceAll(`'./${dependency}.mjs'`, `'./task-panes-${dependency}.mjs'`);
    output[`webview/assets/task-panes-${file}.mjs`] = content;
  }
  return output;
}
