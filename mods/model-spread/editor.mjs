import {store,useSettings,resolveSlots} from './model-spread.mjs';
export function Editor({React:R,Native:N,Picker,models,defaults,trigger,modelLabel,effortLabel,onSave}) {
  const h=R.createElement, saved=useSettings(R);
  const [open,setOpen]=R.useState(false),[draft,setDraft]=R.useState([]),[dragged,setDragged]=R.useState(null),[dropAt,setDropAt]=R.useState(null),[restore,setRestore]=R.useState(false),[confirm,setConfirm]=R.useState(false),[error,setError]=R.useState(null);
  const available=resolveSlots(draft,models);
  function toggle(value){if(value){setDraft((saved.slots??defaults??[]).map(({model,reasoningEffort})=>({model,reasoningEffort})));setRestore(false);setError(store().getError());}setOpen(value);if(!value)setConfirm(false);}
  function change(slots){setDraft(slots);setRestore(false);}
  function commit(){try{store().save({...store().get(),slots:restore?null:draft});onSave?.();setOpen(false);}catch(e){setError(e.message);}}
  function edit(index,slot){change(draft.map((s,i)=>i===index?slot:s));}
  function move(from,to){if(from===null||to<0||to>=draft.length||from===to)return;const next=[...draft];next.splice(to,0,next.splice(from,1)[0]);change(next);}
  function reset(){setDraft((defaults??[]).map(({model,reasoningEffort})=>({model,reasoningEffort})));setRestore(true);setConfirm(false);}
  const row=(s,index)=>h('div',{key:index,className:'ms-slot-row','data-drop-before':dropAt===index||undefined,'data-drop-after':index===draft.length-1&&dropAt===draft.length||undefined,role:'group','aria-label':`Slot ${index+1}: ${s.modelLabel}, ${s.reasoningEffort}`,
    onDragOver:e=>{if(dragged!==null){e.preventDefault();e.dataTransfer.dropEffect='move';const rect=e.currentTarget?.getBoundingClientRect();setDropAt(rect&&e.clientY>=rect.top+rect.height/2?index+1:index);}},
    onDrop:e=>{e.preventDefault();const boundary=dropAt??index;move(dragged,boundary>(dragged??-1)?boundary-1:boundary);setDragged(null);setDropAt(null);},
    style:{display:'flex',alignItems:'center',gap:8,minHeight:44,borderRadius:8,padding:'4px 0',position:'relative',opacity:dragged===index?.5:1}},
    h(N.Button,{color:'ghost',uniform:true,size:'iconSm',className:'ms-row-action',draggable:true,'aria-label':`Reorder slot ${index+1}`,title:'Drag to reorder, or use the up and down arrow keys',
      onDragStart:e=>{setDragged(index);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(index));},
      onDragEnd:()=>{setDragged(null);setDropAt(null);},onKeyDown:e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();move(index,index+(e.key==='ArrowUp'?-1:1));}},
      style:{position:'absolute',left:-16,width:16,height:28,cursor:'grab'}},'⠿'),
    h('div',{style:{flex:1,minWidth:0}},h(Picker,{models,slot:draft[index],onChange:slot=>edit(index,slot)}),
      !s.available&&h('span',{className:'text-sm text-secondary',style:{display:'block',paddingLeft:12}},'Unavailable on this host · skipped by the slider and knob')),
    h(N.Button,{color:'ghost',uniform:true,size:'iconSm',className:'ms-row-action',disabled:draft.length===1,'aria-label':`Remove slot ${index+1}`,onClick:()=>change(draft.filter((_,i)=>i!==index)),style:{width:24,height:28,flexShrink:0,fontSize:20}},'×'));
  const confirmation=h(N.Dialog,{open:confirm,size:'compact',onOpenChange:setConfirm},
    h(N.Body,null,
      h(N.Section,null,h(N.Heading,{title:h(N.Title,null,'Restore default spread?'),subtitle:h(N.Description,null,'Replace these slots with the app’s default model spread. Select Done afterward to save.')})),
      h(N.Section,null,h(N.Footer,null,
        h(N.Button,{color:'secondary',onClick:()=>setConfirm(false)},'Cancel'),
        h(N.Button,{color:'primary',onClick:reset},'Restore defaults')))));
  return h(R.Fragment,null,h(N.Dialog,{open,size:'wide',onOpenChange:toggle,triggerContent:trigger},
    h('style',null,`
.ms-slot-row .ms-row-action{opacity:0}
.ms-slot-row[data-drop-before]::before,.ms-slot-row[data-drop-after]::after{content:'';position:absolute;left:0;right:0;height:2px;background:var(--color-text, currentColor);border-radius:2px;pointer-events:none}
.ms-slot-row[data-drop-before]::before{top:-3px}
.ms-slot-row[data-drop-after]::after{bottom:-3px}
.ms-slot-row:not(:hover):not(:focus-within) .ms-slot-picker button:not([data-state=open]){border-color:transparent;background:transparent}
.ms-slot-row:not(:hover):not(:focus-within) .ms-slot-picker button:not([data-state=open]) svg{opacity:0}
.ms-slot-row:hover .ms-row-action,.ms-slot-row:focus-within .ms-row-action{opacity:1}
@media(hover:none){.ms-slot-row .ms-row-action{opacity:1}}
`),
    h(N.Body,{style:{position:'relative',maxHeight:'min(740px,calc(100vh - 4rem))',overflow:'auto',gap:0}},
      h(N.Button,{color:'ghost',uniform:true,size:'iconSm','aria-label':'Restore default spread',title:'Restore default spread',onClick:()=>setConfirm(true),style:{position:'absolute',right:48,top:16,width:24,height:24,padding:4}},h(N.Rewind,{size:16,'aria-hidden':true})),
      h(N.Section,null,h(N.Heading,{title:h(N.Title,null,'Model spread'),subtitle:h(N.Description,null,'Choose the model and reasoning level at each slider position')})),
      h(N.Section,null,h('div',{'aria-label':'Model spread slots',style:{display:'flex',flexDirection:'column',gap:4}},available.map(row)),
        h(N.Button,{color:'ghost',style:{alignSelf:'flex-end',marginLeft:'auto',paddingRight:4},disabled:!models?.length||draft.length>=32,onClick:()=>{const m=models.find(m=>m.isDefault)??models[0];change([...draft,{model:m.model,reasoningEffort:m.defaultReasoningEffort??m.supportedReasoningEfforts[0]?.reasoningEffort}]);}},'Add slot')),
      h(N.Section,null,h('p',{className:'text-sm text-secondary'},'The composer slider and Micro use this order. Identical model and reasoning pairs share one slider stop.'),
        restore&&h('p',{role:'status',className:'text-sm text-secondary'},'The default spread will be restored when you select Done.'),error&&h('p',{role:'alert'},error)),
      h(N.Section,null,h(N.Footer,null,h(N.Button,{color:'primary',disabled:!restore&&!draft.length,onClick:commit,style:{width:'100%'}},'Done'))))),confirmation);
}
