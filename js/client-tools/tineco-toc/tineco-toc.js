(function(window) {
  'use strict';
  const KEY='client-tools.MKS66.TINECO-TOC.active',titles=['01 PRE-QC','02 REPAIR','03 FINAL QC'];
  const stepNames=['Pre-QC','Repair','Final QC'];
  const stepGuidance=['Inspect the machine and record the issue found.','Record parts used and continue repair work.','Perform final quality inspection and choose the outcome.'];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let ctx,session=null,busy=false,error='',generation=0,timer,saveState='';
  const persist=()=>ctx.storage.set(KEY,session);
  const minutes=()=>session?.startedAt?Math.max(1,Math.ceil(((session.pending?.action==='finish'?session.pending.submittedAt||Date.now():Date.now())-session.startedAt)/60000)):0;
  function render(){return '<div class="tcu-app" id="tcu-app"></div>';}
  function input(name,label,type='textarea') {const value=session.data?.[name]??'';return `<label>${label}${type==='textarea'?`<textarea data-field="${name}" rows="3">${esc(value)}</textarea>`:type==='select'&&session.repairLevels?.length?`<select data-field="${name}"><option value="">Choose level</option>${session.repairLevels.map(v=>`<option ${v===value?'selected':''}>${esc(v)}</option>`).join('')}</select>`:`<input data-field="${name}" type="${type==='select'?'text':type}" ${type==='number'?'min="0" step="1"':''} value="${esc(value)}">`}</label>`;}
  function parts(){return String(session?.data?.partUsedDetail||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean);}
  function visitData(){const items=parts();return {...session.data,partUsedDetail:items.join('\n'),totalPartsUsed:String(items.length)};}
  function editParts(items){if(busy||session?.pending||session?.step!==1||session.phase!=='draft')return;session.data.partUsedDetail=items.join('\n');session.data.totalPartsUsed=String(items.length);persist();draw();ctx.root.querySelector('#tcu-part-input')?.focus();}
  function addPart(value){const part=String(value||'').trim();if(!part)return;if(/[\r\n]/.test(part)){ctx.toast.show('Scan one part at a time.');return;}editParts([...parts(),part]);}
  function removePart(index){const items=parts();if(!Number.isInteger(index)||index<0||index>=items.length)return;items.splice(index,1);editParts(items);}
  function partsPanel(){return `<section class="tcu-parts"><label for="tcu-part-input">PART USED DETAIL — scan one at a time</label><div class="tcu-part-entry"><input id="tcu-part-input" autocomplete="off" placeholder="Scan or enter part number"><button class="button" type="button" id="tcu-add-part">ADD PART</button></div><p class="tcu-part-total" role="status">TOTAL PARTS USED: <strong>${parts().length}</strong></p><ol class="tcu-part-list">${parts().map((part,i)=>`<li><span>${esc(part)}</span><button type="button" data-remove-part="${i}" aria-label="Remove part ${i+1}: ${esc(part)}">×</button></li>`).join('')}</ol>${parts().length?'':'<p class="tcu-muted">No parts added.</p>'}</section>`;}
  // Presentation only: lookup and save status use the existing visit and pending request.
  function statusPanel(){
    let state='idle',title='Ready for SN',message='Scan or enter a machine serial number to begin.',summary=[];
    const starting=session?.pending?.action==='begin'||session?.phase==='starting';
    const saving=['finish','pause'].includes(session?.pending?.action);
    if(saving||saveState==='failed'){
      state=busy?(saveState==='retrying'||saveState==='recovering'?'recovering':'loading'):'error';
      title=busy?(saveState==='recovering'?'Recovering Save...':saveState==='retrying'?'Retrying Save...':'Saving to Lark...'):'Unable to Save Repair Data';
      message=busy?(state==='recovering'?'Recovering the previous save request safely.':'Updating the TINECO TO C UNIT CLASS record. Please wait.'):'The repair record was not confirmed as saved.';
      summary=[['SN',session.sn],['UNIT ID',session.unitId],...(saving?[['Outcome',session.pending.action==='pause'?'Pause':session.pending.body.outcome]]:[])];
    }else if(starting){
      if(busy){state='loading';title='Checking machine history...';message='Looking for previous record, current step, labor, and parts.';}
      else if(error.startsWith('DUPLICATE_SN_RECORDS:')){state='conflict';title='Duplicate SN Conflict';message='Multiple records were found for this SN. Manual review is required.';}
      else{state='error';title='Unable to Load Unit';message='Retry the lookup or cancel the current unit.';}
    }else if(session?.phase==='completed'){
      state='completed';title='Unit Already Completed';message='This SN cannot be reopened in TINECO TOC.';
    }else if(session?.phase==='disposal'){
      state='disposal';title='Unit Marked for Disposal';message='This unit is not available for normal TOC repair workflow.';
    }else if(session?.phase==='paused'){
      state='completed';title='Unit Paused';message=`Work has been saved. Resume this SN later to continue from ${stepNames[session.step]}.`;
    }else if(session?.phase==='saved'){
      state='completed';title='Repair Data Saved';message='The repair record was successfully updated in Lark.';
    }else if(error||(!busy&&session?.pending)){
      state='error';title=session?.pending?.action==='step'?'Unable to Switch Step':'Action Required';
      message=session?.pending?'The operation was not confirmed. Retry the pending request to continue.':'Review the form error and correct it before continuing.';
    }else if(session?.pending?.action==='step'){
      const {from,to}=session.pending.body;
      state='transition';title=`${to<from?'Returning':'Switching'} to ${stepNames[to]}...`;
      message=`Preparing the ${stepNames[to]} step.`;
    }else if(session?.pending){
      state='transition';title='Updating Unit...';message='Please wait for the current operation to finish.';
    }else if(session?.phase==='draft'){
      state=`ready-${session.step}`;title=`${stepNames[session.step]} Ready`;
      message=stepGuidance[session.step];
      summary=[['Unit',session.resumed?'Existing Unit Found':'New Unit'],['Entry',`#${session.timesOfReEnter??session.entry}`],['Current Step',stepNames[session.step]],['Previous Labor',`${session.previousLaborMinutes||0} min`],['Parts Loaded',parts().length]];
    }
    return `<aside class="tcu-status is-${state}" role="status" aria-live="polite" aria-atomic="true" aria-labelledby="tcu-status-title"><span class="tcu-status-label">CURRENT STATUS</span>${(state==='loading'||state==='recovering')?'<span class="tcu-status-spinner" aria-hidden="true"></span>':''}<h3 id="tcu-status-title">${esc(title)}</h3><p>${esc(message)}</p>${summary.length?`<dl class="tcu-status-summary">${summary.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`:''}${saving&&!busy?'<p class="tcu-save-help">Retry the same save request, or keep this unit here until you are ready.</p><button class="button button-neutral" type="button" id="tcu-keep-unit">KEEP CURRENT UNIT</button>':''}</aside>`;
  }
  const workspace=content=>`<div class="tcu-workspace">${content}${statusPanel()}</div>`;
  function draw(){
    if(!ctx)return; const root=ctx.root.querySelector('#tcu-app');
    if(!session){root.innerHTML=workspace(`<form id="tcu-start" class="tcu-panel"><h3>SCAN / ENTER SERIAL NUMBER</h3><label>SN<input id="tcu-sn" autocomplete="off" required></label><button class="button" ${busy?'disabled':''}>BEGIN UNIT</button><p role="alert">${esc(error)}</p></form>`);root.querySelector('#tcu-start').onsubmit=e=>{e.preventDefault();begin(root.querySelector('#tcu-sn').value);};root.querySelector('#tcu-sn').focus();return;}
    if(['completed','disposal'].includes(session.phase)){const r=session.result||{};root.innerHTML=workspace(`<section class="tcu-panel"><h3>${session.phase==='completed'?'UNIT ALREADY COMPLETED':'UNIT MARKED FOR DISPOSAL'}</h3><dl>${[['SN',session.sn],['UNIT ID',session.unitId],['CLIENT STATUS',session.clientStatus],['REPAIR RESULT',r.repairResult||'—'],['LABOR MINUTES',session.previousLaborMinutes||0]].map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><button class="button" id="tcu-next-unit">START NEXT UNIT</button></section>`);root.querySelector('#tcu-next-unit').onclick=()=>{session=null;ctx.storage.remove(KEY);draw();};return;}
    if(session.phase==='paused'){const r=session.result||{};root.innerHTML=workspace(`<section class="tcu-panel tcu-success"><header><span class="tcu-saved-label">UNIT PAUSED</span><h3>Work has been saved.</h3><p>Resume this SN later to continue from ${esc(stepNames[session.step])}.</p></header><dl class="tcu-summary-grid">${[['SN',session.sn],['UNIT ID',session.unitId],['CLIENT STATUS','Pending'],['CURRENT STEP',stepNames[session.step]],['LABOR MINUTES',r.laborMinutes||session.previousLaborMinutes||0],['PAUSE NOTE',r.pauseNote||'—']].map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><button class="button" id="tcu-next-unit">RETURN TO SN SCAN</button></section>`);root.querySelector('#tcu-next-unit').onclick=()=>{session=null;ctx.storage.remove(KEY);draw();};return;}
    if(session.phase==='saved'){const r=session.result,d=session.data||{};root.innerHTML=workspace(`<section class="tcu-panel tcu-success"><header><span class="tcu-saved-label">REPAIR DATA SAVED</span><h3>${esc(r.repairResult)}</h3><p>The repair visit has been saved.</p></header><dl class="tcu-summary-grid">${[['SN',r.sn],['UNIT ID',r.unitId],['RESULT',r.repairResult],['LABOR MINUTES',r.laborMinutes],['RE-ENTRY','#'+r.entry],['PARTS USED',d.totalPartsUsed||'0'],['REPAIR LEVEL',d.repairLevel||'—'],...(d.trackingNumber?[['TRACKING NUMBER',d.trackingNumber]]:[])].map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${d.partUsedDetail?`<section class="tcu-saved-parts"><h4>PART USED DETAIL</h4><pre>${esc(d.partUsedDetail)}</pre></section>`:''}<button class="button" id="tcu-next-unit">START NEXT UNIT</button></section>`);root.querySelector('#tcu-next-unit').onclick=()=>{session=null;ctx.storage.remove(KEY);draw();};return;}
    const step=session.step||0, pending=Boolean(session.pending), starting=session.pending?.action==='begin', locked=busy||pending||session.phase==='starting';
    root.innerHTML=workspace(`<nav class="tcu-progress" aria-label="Repair stages">${titles.map((t,i)=>`<button type="button" data-step="${i}" ${locked||i!==step-1?'disabled':''} ${i===step?'aria-current="step"':''}>${t}</button>`).join('')}</nav><section class="tcu-panel tcu-stage-${step}">${session.resumed?`<aside class="tcu-resume-banner"><strong>EXISTING UNIT FOUND</strong><p>SN: ${esc(session.sn)} · UNIT ID: ${esc(session.unitId)} · RE-ENTRY: #${esc(session.entry)}</p><p>RESUME STEP: ${titles[step]} · PREVIOUS LABOR: ${session.previousLaborMinutes||0} min</p></aside>`:""}<h3>${titles[step]}</h3><p>SN: <strong>${esc(session.sn)}</strong> · Entry #${esc(session.entry||'…')} · Client Status: ${esc(session.clientStatus||"Pending")}<br>Previous Labor: ${session.previousLaborMinutes||0} min · Current Session: <strong id="tcu-timer">${minutes()}</strong> min · Total Labor: <strong id="tcu-total-labor">${(session.previousLaborMinutes||0)+minutes()}</strong> min</p><p class="tcu-muted">${esc(ctx.warehouse)} · ${esc(ctx.clientId)} · ${esc(session.unitId||'Starting visit…')}</p>${session.generalNote?`<details class="tcu-general-note"><summary>GENERAL NOTE HISTORY</summary><pre>${esc(session.generalNote)}</pre></details>`:''}${step>0?`<p class="tcu-muted">ISSUE FOUND: ${esc(session.data?.issueFound||'—')}</p>`:''}<fieldset ${locked?'disabled':''}>${step===0?input('trackingNumber','Tracking Number (optional)','text')+input('issueFound','ISSUE FOUND (required)')+input('preQcNote','PRE-QC NOTE'):step===1?partsPanel()+input('repairLevel','REPAIR LEVEL','select'):input('finalQcNote','FINAL QC NOTE — required for failure or disposal')}<div class="tcu-actions"><div class="tcu-main-action">${step<2?`<button type="button" id="tcu-forward" class="button ${step===0?'tcu-next-repair':'tcu-next-final'}">${step===0?'CONTINUE TO REPAIR':'CONTINUE TO FINAL QC'}</button>`:'<button class="button" type="button" data-outcome="Completed">ALL PASSES</button>'}</div><section class="tcu-exit-actions"><h4>EXIT — save outcome</h4><p>Save this visit with one of these outcomes.</p><div>${(step===0?['NFF','Awaiting Parts']:step===1?['Can Not Be Fixed']:['Final QC Fail','Client Confirmed Disposal']).map(v=>`<button class="button button-neutral" type="button" data-outcome="${v}">${v.toUpperCase()}</button>`).join('')}<button class="button button-neutral" type="button" id="tcu-pause">PAUSE</button></div></section><div class="tcu-cancel-action"><button class="button button-neutral" type="button" id="tcu-cancel">CANCEL CURRENT UNIT</button><span>Discard local edits; keep the unit record.</span></div></div></fieldset>${pending?(starting?'<h3>'+(busy?'STARTING REPAIR VISIT…':'UNABLE TO START REPAIR VISIT')+'</h3>':'<p>Pending operation — retry the same request to recover safely.</p>')+'<button class="button" id="tcu-retry" '+(busy?'disabled':'')+'>'+(starting?'RETRY START':['finish','pause'].includes(session.pending.action)?'RETRY SAVE':'RETRY / RESUME')+'</button>'+(starting?'<button class="button button-neutral" id="tcu-cancel-start" '+(busy?'disabled':'')+'>CANCEL CURRENT UNIT</button>':''):''}<p role="alert">${esc(error)}</p></section><dialog id="tcu-pause-dialog" aria-labelledby="tcu-pause-title"><form method="dialog"><h3 id="tcu-pause-title">PAUSE UNIT</h3><p>Save current work and resume this SN later at ${esc(stepNames[step])}.</p><label>PAUSE NOTE (required)<textarea id="tcu-pause-note" required rows="3"></textarea></label><p id="tcu-pause-error" role="alert"></p><div><button class="button button-neutral" value="cancel">CANCEL</button><button class="button" type="button" id="tcu-confirm-pause">PAUSE UNIT</button></div></form></dialog>`);
    root.querySelector('#tcu-part-input')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addPart(event.target.value);}});
    root.querySelector('#tcu-add-part')?.addEventListener('click',()=>addPart(root.querySelector('#tcu-part-input').value));
    root.querySelectorAll('[data-remove-part]').forEach(el=>el.onclick=()=>removePart(Number(el.dataset.removePart)));
    root.querySelectorAll('[data-field]').forEach(el=>el.oninput=()=>{session.data[el.dataset.field]=el.value;persist();});
    root.querySelectorAll('[data-step]').forEach(el=>el.onclick=()=>move(Number(el.dataset.step)));
    root.querySelector('#tcu-forward')?.addEventListener('click',()=>move(step+1));
    root.querySelectorAll('[data-outcome]').forEach(el=>el.onclick=()=>{if(window.confirm(`Save this visit as ${el.dataset.outcome}?`))finish(el.dataset.outcome);});
    root.querySelector('#tcu-pause')?.addEventListener('click',()=>root.querySelector('#tcu-pause-dialog').showModal());
    root.querySelector('#tcu-confirm-pause')?.addEventListener('click',()=>{const note=root.querySelector('#tcu-pause-note').value.trim();if(!note){root.querySelector('#tcu-pause-error').textContent='PAUSE NOTE is required.';return;}root.querySelector('#tcu-pause-dialog').close();run('pause',{requestId:session.requestId,pauseNote:note,data:visitData()});});
    root.querySelector('#tcu-cancel')?.addEventListener('click',()=>{if(window.confirm('Discard unsaved local edits? The unit record and already-saved progress will remain.'))run('cancel',{requestId:session.requestId});});
    root.querySelector('#tcu-cancel-start')?.addEventListener('click',async()=>{if(busy||!window.confirm('Recover this start, then cancel the active entry? The unit record will remain.'))return;
      if(session.startRejected){session=null;error='';ctx.storage.remove(KEY);draw();return;}
      const requestId=session.requestId;await run('begin',session.pending.body);
      if(session?.requestId===requestId&&session.phase==='draft'&&!session.pending)await run('cancel',{requestId});
    });
    root.querySelector('#tcu-keep-unit')?.addEventListener('click',()=>{persist();ctx.toast.show('Current unit retained. Retry Save when ready.');});
    root.querySelector('#tcu-retry')?.addEventListener('click',()=>run(session.pending.action,session.pending.body));
  }
  async function run(action,body,recovering=false){
    if(busy)return;saveState=['finish','pause'].includes(action)?(recovering?'recovering':session.pending?.action===action?'retrying':'saving'):'';busy=true;error='';const gen=generation;
    delete session.startRejected;session.pending={action,body,submittedAt:session.pending?.submittedAt||Date.now()};persist();draw();
    try{const response=await window.MkiteApiClient.post(`/api/tineco-toc/${action}`,body);if(!ctx||generation!==gen)return;
      if(!response.ok){const e=new Error(`${response.error.code}: ${response.error.message}`);e.code=response.error.code;throw e;}
      const visit=response.data;
      if(!visit || visit.requestId!==body.requestId || !['draft','saved','paused','cancelled','completed','disposal'].includes(visit.phase) || (visit.phase==='draft' && (!visit.unitId || !visit.sn || !Number.isFinite(visit.startedAt) || !Number.isInteger(visit.entry) || ![0,1,2].includes(visit.step) || !visit.data))){const e=new Error('INVALID_VISIT_RESPONSE: Unable to confirm the repair visit. Retry the same request.');e.code='INVALID_VISIT_RESPONSE';throw e;}
      if(visit.phase==='cancelled'){session=null;ctx.storage.remove(KEY);}else{
        const {pending,pendingOperation,...activeVisit}=visit;
        session=activeVisit;persist();
      }
      saveState='';
      if(['saved','paused'].includes(session?.phase))ctx.audio?.success?.();
    }catch(e){if(ctx&&generation===gen){if(['finish','pause'].includes(action))saveState='failed';error=e.message;ctx.toast.show(error);if(action==='begin'&&['SN_REQUIRED','SN_INVALID','DUPLICATE_SN_RECORDS','TINECO_TOC_RECORD_INVALID','TINECO_TOC_SCHEMA_INVALID','TINECO_TOC_TABLE_NOT_CONFIGURED','UNIT_ALREADY_ACTIVE'].includes(e.code)){session.startRejected=true;persist();}
      // Validation errors are known to precede writes. Unknown save outcomes stay locked.
      if(['PAUSE_NOTE_REQUIRED','ISSUE_FOUND_REQUIRED','INVALID_FORM','PAYLOAD_TOO_LARGE','SN_REQUIRED','SN_INVALID','INVALID_PART_QUANTITY','PART_DETAIL_REQUIRED','REPAIR_LEVEL_REQUIRED','FINAL_QC_FAILURE_REASON_REQUIRED','DISPOSAL_NOTE_REQUIRED','REPAIR_RESULT_OPTION_NOT_AVAILABLE','FINAL_QC_RESULT_OPTION_NOT_AVAILABLE','REPAIR_LEVEL_OPTION_NOT_AVAILABLE','TINECO_TOC_SCHEMA_INVALID','TINECO_TOC_TABLE_NOT_CONFIGURED'].includes(e.code)){if(action!=='begin'){delete session.pending;persist();}}
    }}finally{if(ctx&&generation===gen){busy=false;draw();}}
  }
  function begin(sn){if(busy||session)return;sn=String(sn||'').trim();if(!sn){error='SN_REQUIRED: Scan or enter the serial number.';draw();return;}session={requestId:window.crypto.randomUUID(),sn,data:{totalPartsUsed:'0'},phase:'starting',step:0};run('begin',{requestId:session.requestId,sn});}
  function move(to){if(!session||session.pending||busy||Math.abs(to-session.step)!==1||to<0||to>2)return;run('step',{requestId:session.requestId,from:session.step,to,data:visitData()});}
  function finish(outcome){if(!session||session.pending||busy)return;run('finish',{requestId:session.requestId,outcome,data:visitData()});}
  function init(context){ctx=context;generation++;busy=false;error='';saveState='';session=ctx.storage.get(KEY,null);if(session?.phase==='cancelled')session=null;draw();timer=window.setInterval(()=>{const el=ctx?.root.querySelector('#tcu-timer');if(el)el.textContent=minutes();const total=ctx?.root.querySelector('#tcu-total-labor');if(total)total.textContent=(session?.previousLaborMinutes||0)+minutes();},1000);if(session?.pending?.action==='begin')run('begin',session.pending.body);else if(['finish','pause'].includes(session?.pending?.action))run(session.pending.action,session.pending.body,true);}
  window.MkiteClientToolModules=window.MkiteClientToolModules||{};
  window.MkiteClientToolModules['tineco.toc']={render,init,cleanup(){generation++;window.clearInterval(timer);ctx=null;busy=false;},_test:{begin,move,finish,run,minutes,addPart,removePart,getSession:()=>session,KEY}};
}(window));
