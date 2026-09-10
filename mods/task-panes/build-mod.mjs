import fs from 'node:fs';
import path from 'node:path';

export const files = {
  initial: 'webview/assets/app-initial-cadb12d4a15e.js',
  primary: 'webview/assets/app-primary-6cd7b8b3f5e3.js',
  localPage: 'webview/assets/local-conversation-page-fc339fa9c34d.js',
  localThread: 'webview/assets/local-conversation-thread-40db5af470f5.js',
  cloudPage: 'webview/assets/remote-conversation-page-4a5925193bd5.js',
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
  mT();$Ds();IDs();
  const React=iT,pane=TaskPanesRuntime.usePane(React),outer=Zw(),matches=React.useContext(pT);
  const url=new URL(task.path,'https://modex.invalid');
  const local=task.kind!=='cloud';
  const route=local?{routeKind:'local-thread',conversationId:task.conversationId,hostId:task.hostId,pathname:url.pathname,routeTemplate:'/local/:conversationId',search:url.search,projectContext:null}:{routeKind:'remote-thread',taskId:task.taskId,pathname:url.pathname,routeTemplate:'/remote/:taskId',search:url.search};
  const matchesActiveLocation=pane?.active&&outer.pathname+outer.search===url.pathname+url.search;
  const preview=React.useRef(task.archivedConversationPreview===true);
  if(matchesActiveLocation)preview.current=outer.state?.archivedConversationPreview===true;
  const location={pathname:url.pathname,search:url.search,hash:url.hash,key:matchesActiveLocation?outer.key:'modex:'+task.key,state:matchesActiveLocation?outer.state:preview.current?{archivedConversationPreview:true}:null};
  const params=local?{conversationId:task.conversationId}:{taskId:task.taskId};
  const matchValue={...matches,matches:matches.matches.map((match,index)=>index===matches.matches.length-1?{...match,params}:match)};
  return React.createElement(fT.Provider,{value:{location,navigationType:'POP'}},React.createElement(pT.Provider,{value:matchValue},React.createElement(JDs,{route},React.createElement(NDs,null,children))));
}
function ModexPaneShell({children}) {
  rQa();
  // Pane toolbars already occupy their own layout space. The stock edge-scroll
  // mode reserves another window-header inset inside each native transcript.
  return r3.createElement(r3.Fragment,null,r3.createElement(_1.MainContentLayout,{layout:'full-bleed'}),children);
}
function ModexPaneTab(props) {
  _Ua();
  return r3.createElement(uUa,props);
}
function ModexTaskPage({Page}) {
  qN();rQa();sH();
  const location=Zw(),route={...Db(Dj).value,archivedConversationPreview:location.state?.archivedConversationPreview===true},navigate=$w();
  return r3.createElement(pSo,null,r3.createElement(TaskPanesRuntime.Workspace,{React:r3,route,navigate,Button:KN,Tooltip:RV,Toolbar:_1.HeaderToolbar,ToolbarActions:_1.HeaderToolbar.Actions,Tab:ModexPaneTab,MaximizeIcon:ssi,RestoreIcon:osi,Task:TaskPanesRenderer.getRenderer(r3),Shell:ModexPaneShell},r3.createElement(Page)));
}
`;
export const cloudAdapter = `
export function ModexCloudPaneTask({task}) {
  return bo.createElement(ModexPaneProviders,{task},bo.createElement(ModexCloudPaneContents,{task}));
}
function ModexCloudPaneContents({task}) {
  const pane=TaskPanesRuntime.usePane(bo),hostId=G(m),data=G(Re).data,archived=Ke().state?.archivedConversationPreview===true;
  bo.useEffect(()=>{pane?.setTitle(data?.task.title??task.title)},[data?.task.title,task.title,pane?.setTitle]);
  return bo.createElement('div',{style:{height:'100%',minHeight:0,minWidth:0,containerType:'inline-size'}},bo.createElement(Ja,{hostId,showComposer:!archived,footerContent:archived?bo.createElement(Wr,{conversationId:task.taskId,kind:'cloud'}):undefined}));
}
`;
// Page-level guards retain stock missing-host and archive behavior. Pane content
// is the actual LocalThread; the page's window header registrations stay outside.
export const localAdapter = `
export function ModexLocalPaneTask({task}) {
  return Cs.createElement(ModexPaneProviders,{task},Cs.createElement(ModexLocalPaneGuard,{task}));
}
function ModexLocalPaneGuard({task}) {
  const pane=TaskPanesRuntime.usePane(Cs),id=task.conversationId,host=X(At,id),connection=X(ln,id),archived=X(p,id),title=X(sn,id),summary=X(ue,id),scope=Ut(qe),globalPreview=Y(r),preview=dt().state?.archivedConversationPreview===true&&(archived||globalPreview);
  Cs.useEffect(()=>{pane?.setTitle(title??summary?.displayTitle??task.title)},[title,summary?.displayTitle,task.title,pane?.setTitle]);
  if(connection.status==='unavailable')return Cs.createElement(bs);
  if(archived&&!preview)return Cs.createElement(xs,{conversationId:id});
  if(task.hostId!=null&&host!==task.hostId)return Cs.createElement(It,{debugName:'TaskPanes.host'});
  return Cs.createElement(ModexLocalPaneContents,{task,scope,preview,allowMissingConversation:preview&&summary!=null});
}
function ModexLocalPaneContents({task,scope,preview,allowMissingConversation}) {
  const pane=TaskPanesRuntime.usePane(Cs),[open,setOpen]=Cs.useState(false),id=task.conversationId,host=task.hostId;
  Cs.useEffect(()=>{if(!pane?.active)setOpen(false)},[pane?.active]);
  const background=agent=>{if(!agent.canInteract){$a(scope,{hostId:host,parentConversationId:id,selectedConversationId:agent.conversationId,selectedDisplayName:agent.displayName});return}Qa(scope,{backgroundAgent:agent,hostId:host,TabComponent:Ea})};
  const subagents=()=>{$a(scope,{hostId:host,parentConversationId:id})};
  const pullRequest=value=>{'request'in value?Va(scope,value):Ha(scope,value)};
  Qr();
  const trigger=Cs.createElement(Mi.HeaderButton,{label:'Environment and task summary',pressed:open});
  const summary=Cs.createElement(aa,{isOpen:open,onOpenChange:setOpen,trigger},Cs.createElement(Ca,{onOpenBackgroundAgent:background,onOpenPullRequestSidePanel:pullRequest,onOpenSubagentsPanel:subagents}));
  return Cs.createElement('div',{style:{display:'flex',flexDirection:'column',height:'100%',minHeight:0,minWidth:0,containerType:'inline-size'}},!preview&&pane?.toolbarElement?modexReactDOM().createPortal(summary,pane.toolbarElement):null,Cs.createElement('div',{style:{flex:1,minHeight:0,minWidth:0}},Cs.createElement(Pa,{value:Ta},Cs.createElement(xa,{shouldResume:!preview,allowMissingConversation,isReadOnly:preview,showComposer:!preview,footerContent:preview?Cs.createElement(lo,{conversationId:id,hostId:host}):undefined,showSummaryPanel:false,showUtilityBar:true,onOpenBackgroundAgent:background,onOpenPullRequestSidePanel:pullRequest,onOpenSubagentsPanel:subagents}))));
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
    'path:Mv,element:(0,i3.jsx)(pSo,{children:(0,i3.jsx)(wSo,{})})',
    'path:Mv,element:(0,i3.jsx)(ModexTaskPage,{Page:wSo})',
  );
  patch(
    files.initial,
    'path:`/remote/:taskId`,element:(0,i3.jsx)(TSo,{})',
    'path:`/remote/:taskId`,element:(0,i3.jsx)(ModexTaskPage,{Page:TSo})',
  );
  patch(
    files.initial,
    'function iN(){if(cN!=null&&cN.isConnected&&aN.has(cN))return cN;cN=null;let e=u5n();if(e!=null)return e;for(let e of aN.keys())if(e.isConnected)return e;return document.querySelector(`[data-codex-composer]`)}',
    'function iN(){if(cN!=null&&cN.isConnected&&aN.has(cN)&&TaskPanesRuntime.composerAvailable(cN))return cN;cN=null;let e=u5n();if(e!=null)return e;for(let e of aN.keys())if(e.isConnected&&TaskPanesRuntime.composerAvailable(e))return e;return Array.from(document.querySelectorAll(`[data-codex-composer]`)).find(e=>TaskPanesRuntime.composerAvailable(e))??null}',
  );
  patch(
    files.initial,
    'function u5n(){for(let[e,{isPrimaryComposer:t}]of aN)if(t&&e.isConnected)return e;return null}',
    'function u5n(){for(let[e,{isPrimaryComposer:t}]of aN)if(t&&e.isConnected&&TaskPanesRuntime.composerAvailable(e))return e;return null}',
  );
  output[files.initial] += providerAdapter;
  output[files.primary] =
    'import {drag as TaskPanesDrag} from "./task-panes-drag.mjs";' + output[files.primary];
  patch(
    files.primary,
    'function mEn(e,t,n){if(e==null||t==null||document.elementsFromPoint==null)return null;',
    'function mEn(e,t,n){if(TaskPanesDrag.claims({x:e,y:t}))return null;if(e==null||t==null||document.elementsFromPoint==null)return null;',
  );
  patch(
    files.primary,
    'D.current=r?.(a)??[a];let o=D.current.length>1?',
    'D.current=r?.(a)??[a];TaskPanesDrag.start(D.current.flatMap(state=>{const ref=state.threadReference,decoded=Fv(state.threadKey);if(decoded?.kind===`remote`){const id=decoded.taskId;return[{kind:`cloud`,routeKind:`remote-thread`,taskId:id,key:`cloud:${id}`,path:`/remote/${id}`,title:id}]}if(decoded?.kind!==`local`||state.threadId==null||ref==null)return[];const id=state.threadId,hostId=ref.hostId??`local`,path=Mv(id);return[{kind:`local`,routeKind:`local-thread`,conversationId:id,hostId,key:`local:${hostId}:${id}`,path:hostId===`local`?path:jpe(path,hostId),title:ref.getTitle()}]}));let o=D.current.length>1?',
  );
  patch(
    files.primary,
    'k.current=e.pointerCoordinates?.x??null,A.current=e.pointerCoordinates?.y??null;let t=EZ(e.active.data.current);',
    'k.current=e.pointerCoordinates?.x??null,A.current=e.pointerCoordinates?.y??null;TaskPanesDrag.move(e.pointerCoordinates);let t=EZ(e.active.data.current);',
  );
  patch(
    files.primary,
    'te=e=>{l.current=null,S(!1);let t=k.current,n=A.current,r=EZ(e.active.data.current)',
    'te=e=>{if(mEn(k.current,A.current)==null&&TaskPanesDrag.drop()){ee(e);return}TaskPanesDrag.cancel();l.current=null,S(!1);let t=k.current,n=A.current,r=EZ(e.active.data.current)',
  );
  patch(
    files.primary,
    'J=e=>{l.current=null,S(!1),k.current=null,A.current=null,j.current=null,D.current=[],yZ(null,null),SZ(null);',
    'J=e=>{TaskPanesDrag.cancel();l.current=null,S(!1),k.current=null,A.current=null,j.current=null,D.current=[],yZ(null,null),SZ(null);',
  );
  output[files.localPage] =
    'import * as TaskPanesRuntime from "./task-panes-runtime.mjs";import {ModexPaneProviders,Run as modexReactDOM} from "./app-initial-cadb12d4a15e.js";' +
    output[files.localPage] +
    localAdapter;
  output[files.localThread] =
    'import * as TaskPanesRuntime from "./task-panes-runtime.mjs";' + output[files.localThread];
  // Hidden native summary content extends beyond this clipping wrapper. Hidden
  // overflow can still scroll on focus; clip prevents it shifting the transcript.
  patch(
    files.localThread,
    'function X_(e){let t=(0,Z_.c)(22)',
    'function X_(e){const modexPane=TaskPanesRuntime.usePane(YO);let t=(0,Z_.c)(23)',
  );
  patch(
    files.localThread,
    't[16]!==b||t[17]!==x?(S=(0,Q_.jsxs)(`div`,{className:`group/realtime-voice-thread relative h-full min-h-0 overflow-hidden`,children:[b,x]}),t[16]=b,t[17]=x,t[18]=S)',
    't[16]!==b||t[17]!==x||t[22]!==!!modexPane?(S=(0,Q_.jsxs)(`div`,{className:`group/realtime-voice-thread relative h-full min-h-0 overflow-hidden`,style:modexPane?{overflow:`clip`}:undefined,children:[b,x]}),t[16]=b,t[17]=x,t[18]=S,t[22]=!!modexPane)',
  );
  patch(
    files.localThread,
    '(0,YO.useEffect)(Ce,we);let Te;',
    'TaskPanesRuntime.useActiveEffect(YO,Ce,we);let Te;',
  );
  patch(
    files.localThread,
    '(0,YO.useEffect)(Le,Re);let ze;',
    'TaskPanesRuntime.useActiveEffect(YO,Le,Re);let ze;',
  );
  // Global header registration from the inner thread is unnecessary inside panes;
  // all stock task actions remain available in the normal task view.
  patch(
    files.localThread,
    'function RO(e){let t=(0,JO.c)(150)',
    'function RO(e){const modexPane=TaskPanesRuntime.usePane(YO);let t=(0,JO.c)(150)',
  );
  patch(
    files.localThread,
    'et=i!=null&&ad(V.value)===i&&!Rc()&&!P()?',
    'et=i!=null&&ad(V.value)===i&&!Rc()&&!P()&&!modexPane?',
  );
  output[files.cloudPage] =
    'import * as TaskPanesRuntime from "./task-panes-runtime.mjs";import {ModexPaneProviders} from "./app-initial-cadb12d4a15e.js";' +
    output[files.cloudPage] +
    cloudAdapter;
  patch(files.cloudPage, '(0,bo.useEffect)(R,z);', 'TaskPanesRuntime.useActiveEffect(bo,R,z);');
  for (const file of ['runtime', 'layout', 'drag', 'renderer']) {
    let content = fs.readFileSync(path.join(import.meta.dirname, `${file}.mjs`), 'utf8');
    for (const dependency of ['runtime', 'layout', 'drag', 'renderer'])
      content = content.replaceAll(`'./${dependency}.mjs'`, `'./task-panes-${dependency}.mjs'`);
    output[`webview/assets/task-panes-${file}.mjs`] = content;
  }
  return output;
}
