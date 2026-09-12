// Adapters refer to semantic roles discovered from native source contracts.
export const providerAdapter = `
export function ModexPaneProviders({task,children}) {
  const native=ModexPaneNative;
  native.initialize();
  const React=native.React,pane=TaskPanesRuntime.usePane(React),outer=native.location(),matches=React.useContext(native.RouteContext);
  const url=new URL(task.path,'https://modex.invalid');
  const local=task.kind!=='cloud';
  const route=local?{routeKind:'local-thread',conversationId:task.conversationId,hostId:task.hostId,pathname:url.pathname,routeTemplate:'/local/:conversationId',search:url.search,projectContext:null}:{routeKind:'remote-thread',taskId:task.taskId,pathname:url.pathname,routeTemplate:'/remote/:taskId',search:url.search};
  const matchesActiveLocation=pane?.active&&outer.pathname+outer.search===url.pathname+url.search;
  const preview=React.useRef(task.archivedConversationPreview===true);
  if(matchesActiveLocation)preview.current=outer.state?.archivedConversationPreview===true;
  const location={pathname:url.pathname,search:url.search,hash:url.hash,key:matchesActiveLocation?outer.key:'modex:'+task.key,state:matchesActiveLocation?outer.state:preview.current?{archivedConversationPreview:true}:null};
  const params=local?{conversationId:task.conversationId}:{taskId:task.taskId};
  const matchValue={...matches,matches:matches.matches.map((match,index)=>index===matches.matches.length-1?{...match,params}:match)};
  return React.createElement(native.LocationContext.Provider,{value:{location,navigationType:'POP'}},React.createElement(native.RouteContext.Provider,{value:matchValue},React.createElement(native.ScopeProvider,{route},React.createElement(native.ComposerProvider,null,children))));
}
function ModexPaneShell({children}) {
  const native=ModexPaneNative;
  native.initialize();
  // Pane toolbars already occupy their own layout space. The stock edge-scroll
  // mode reserves another window-header inset inside each native transcript.
  return native.React.createElement(native.React.Fragment,null,native.React.createElement(native.AppShell.MainContentLayout,{layout:'full-bleed'}),children);
}
function ModexPaneTab(props) {
  const native=ModexPaneNative;
  native.initialize();
  return native.React.createElement(native.Tab,props);
}
function ModexTaskPage({Page}) {
  const native=ModexPaneNative;
  native.initialize();
  const location=native.location(),route={...native.readScope(native.routeScope).value,archivedConversationPreview:location.state?.archivedConversationPreview===true},navigate=native.navigate();
  return native.React.createElement(native.BrowserProvider,null,native.React.createElement(TaskPanesRuntime.Workspace,{React:native.React,route,navigate,Button:native.Button,Tooltip:native.Tooltip,Toolbar:native.AppShell.HeaderToolbar,ToolbarActions:native.AppShell.HeaderToolbar.Actions,Tab:ModexPaneTab,MaximizeIcon:native.MaximizeIcon,RestoreIcon:native.RestoreIcon,Task:TaskPanesRenderer.getRenderer(native.React),Shell:ModexPaneShell},native.React.createElement(Page)));
}
`;
export const localAdapter = `
export function ModexLocalPaneTask({task}) {
  const native=ModexLocalNative;
  return native.React.createElement(ModexPaneProviders,{task},native.React.createElement(ModexLocalPaneGuard,{task}));
}
function ModexLocalPaneGuard({task}) {
  const native=ModexLocalNative;
  const pane=TaskPanesRuntime.usePane(native.React),id=task.conversationId,host=native.read(native.hostAtom,id),connection=native.read(native.connectionAtom,id),archived=native.read(native.archivedAtom,id),title=native.read(native.titleAtom,id),summary=native.read(native.summaryAtom,id),scope=native.readScope(native.scope),globalPreview=native.readGlobal(native.globalPreviewAtom),preview=native.location().state?.archivedConversationPreview===true&&(archived||globalPreview);
  native.React.useEffect(()=>{pane?.setTitle(title??summary?.displayTitle??task.title)},[title,summary?.displayTitle,task.title,pane?.setTitle]);
  if(connection.status==='unavailable')return native.React.createElement(native.Unavailable);
  if(archived&&!preview)return native.React.createElement(native.Archived,{conversationId:id});
  if(task.hostId!=null&&host!==task.hostId)return native.React.createElement(native.Loading,{debugName:'TaskPanes.host'});
  return native.React.createElement(ModexLocalPaneContents,{task,scope,preview,allowMissingConversation:preview&&summary!=null});
}
function ModexLocalPaneContents({task,scope,preview,allowMissingConversation}) {
  const native=ModexLocalNative;
  const pane=TaskPanesRuntime.usePane(native.React),[open,setOpen]=native.React.useState(false),id=task.conversationId,host=task.hostId;
  native.React.useEffect(()=>{if(!pane?.active)setOpen(false)},[pane?.active]);
  const background=agent=>{if(!agent.canInteract){native.openSubagents(scope,{hostId:host,parentConversationId:id,selectedConversationId:agent.conversationId,selectedDisplayName:agent.displayName});return}native.openBackground(scope,{backgroundAgent:agent,hostId:host,TabComponent:native.SubagentTab})};
  const subagents=()=>{native.openSubagents(scope,{hostId:host,parentConversationId:id})};
  const pullRequest=value=>{'request'in value?native.openPullRequestRequest(scope,value):native.openPullRequest(scope,value)};
  ModexInitializeSummary();
  const trigger=native.React.createElement(native.HeaderButton,{label:'Environment and task summary',pressed:open});
  const summary=native.React.createElement(native.Popover,{isOpen:open,onOpenChange:setOpen,trigger},native.React.createElement(native.Summary,{onOpenBackgroundAgent:background,onOpenPullRequestSidePanel:pullRequest,onOpenSubagentsPanel:subagents}));
  return native.React.createElement('div',{style:{display:'flex',flexDirection:'column',height:'100%',minHeight:0,minWidth:0,containerType:'inline-size'}},!preview&&pane?.toolbarElement?modexReactDOM().createPortal(summary,pane.toolbarElement):null,native.React.createElement('div',{style:{flex:1,minHeight:0,minWidth:0}},native.React.createElement(native.PinProvider,{value:native.pinValue},native.React.createElement(native.Thread,{shouldResume:!preview,allowMissingConversation,isReadOnly:preview,showComposer:!preview,footerContent:preview?native.React.createElement(native.Footer,{conversationId:id,hostId:host}):undefined,showSummaryPanel:false,showUtilityBar:true,onOpenBackgroundAgent:background,onOpenPullRequestSidePanel:pullRequest,onOpenSubagentsPanel:subagents}))));
}
`;
export const cloudAdapter = `
export function ModexCloudPaneTask({task}) {
  const native=ModexCloudNative;
  return native.React.createElement(ModexPaneProviders,{task},native.React.createElement(ModexCloudPaneContents,{task}));
}
function ModexCloudPaneContents({task}) {
  const native=ModexCloudNative;
  const pane=TaskPanesRuntime.usePane(native.React),hostId=native.read(native.hostAtom),data=native.read(native.dataAtom).data,archived=native.location().state?.archivedConversationPreview===true;
  native.React.useEffect(()=>{pane?.setTitle(data?.task.title??task.title)},[data?.task.title,task.title,pane?.setTitle]);
  return native.React.createElement('div',{style:{height:'100%',minHeight:0,minWidth:0,containerType:'inline-size'}},native.React.createElement(native.Thread,{hostId,showComposer:!archived,footerContent:archived?native.React.createElement(native.Footer,{conversationId:task.taskId,kind:'cloud'}):undefined}));
}
`;
