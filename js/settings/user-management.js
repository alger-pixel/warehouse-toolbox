(function (window) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const unique = values => [...new Set(values)].sort();
  const compatible = (tool, user) => tool.status === 'Active' && (user.isAdmin || (user.warehouses.includes(tool.warehouse) && user.clients.includes(tool.clientId)));
  const available = (tools, user, filters = {}) => tools.filter(t => !user.toolIds.includes(t.toolId) && compatible(t,user) && (!filters.warehouse || t.warehouse === filters.warehouse) && (!filters.clientId || t.clientId === filters.clientId));
  const validPassword = password => typeof password === 'string' && Array.from(password).length >= 6 && /[a-z]/i.test(password) && /[0-9]/.test(password) && new TextEncoder().encode(password).length <= 1024;
  const toolFilterOptions = (tools, field) => unique(tools.map(t=>t[field]).filter(Boolean)).map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
  function assign(user, tools, ids) { const allowed = new Set(available(tools,user).map(t=>t.toolId)); user.toolIds = unique([...user.toolIds,...ids.filter(id=>allowed.has(id))]); }
  function remove(user, ids) { user.toolIds = user.toolIds.filter(id=>!ids.includes(id)); }
  let root, api, key='', users=[], tools=[], draft=null, pending=null, busy=false, generation=0;
  const q = selector => root.querySelector(selector);
  const emptyUser = () => ({userId:'',account:'',displayName:'',status:'Active',isAdmin:false,warehouses:[],clients:[],toolIds:[]});
  const date = value => typeof value === 'number' && Number.isFinite(value) ? new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Toronto'}).format(value) : '—';
  function status(message, error=false) { const el=q('[data-um-status]'); el.textContent=message; el.classList.toggle('is-error',error); }
  function setBusy(value) {
    busy=value;
    root.querySelectorAll('[data-um-mutation]').forEach(el=>{el.disabled=value;});
    const fields=q('[data-um-fields]'); if(fields) fields.disabled=value || !!pending;
  }
  async function request(action, body={}) {
    const response=await api.post(`/api/users/${action}`,body,{authorization:`Bearer ${key}`});
    if(!response.ok) { const error=new Error(response.error?.message || 'Unable to complete the user request.'); error.code=response.error?.code; error.retryable=response.error?.retryable; throw error; }
    return response.data;
  }
  function render() {
    return `<div class="user-management"><button class="back-link" type="button" data-route="settings">← Settings</button><div class="page-header"><div><h2>User Management</h2><p>Manage accounts and warehouse, client and tool access.</p></div><button class="button button-primary" data-um-add data-um-mutation disabled>+ ADD USER</button></div>
      <form class="panel um-unlock" data-um-unlock><div><h3>Administration access</h3><p>Enter the User Management administration key. This does not change access to warehouse tools.</p></div><label>Administration key<input type="password" data-um-key autocomplete="off" required minlength="32"></label><button class="button button-primary" data-um-connect data-um-mutation>OPEN USER MANAGEMENT</button></form>
      <p class="um-status" role="status" aria-live="polite" data-um-status>Administration access required.</p><div data-um-content hidden><div class="um-toolbar"><label>Search users<input type="search" data-um-search placeholder="Account, name or User ID"></label><label>Status<select data-um-status-filter><option value="">All Statuses</option><option>Active</option><option>Disabled</option></select></label><button class="button button-neutral" data-um-refresh data-um-mutation>REFRESH USERS</button><button class="button button-neutral" data-um-lock data-um-mutation>LOCK ADMINISTRATION</button></div><div class="table-wrap um-table" data-um-list></div></div><section data-um-editor hidden></section></div>`;
  }
  function renderList() {
    const query=q('[data-um-search]').value.trim().toUpperCase(), filter=q('[data-um-status-filter]').value;
    const matches=users.filter(u=>(!filter || u.status===filter) && `${u.userId} ${u.account} ${u.displayName}`.toUpperCase().includes(query));
    q('[data-um-list]').innerHTML=matches.length ? `<table><thead><tr>${['User ID','Account','Display Name','Status','Admin','Warehouse Access','Client Access',''].map(v=>`<th>${v}</th>`).join('')}</tr></thead><tbody>${matches.map(u=>`<tr><td>${esc(u.userId)}</td><td>${esc(u.account)}</td><td>${esc(u.displayName)}</td><td><span class="um-badge ${u.status==='Active'?'is-active':'is-disabled'}">${esc(u.status)}</span></td><td>${u.isAdmin?'<span class="um-badge is-admin">Admin</span>':'—'}</td><td>${esc(u.warehouses.join(', ')||'—')}</td><td>${esc(u.clients.join(', ')||'—')}</td><td><button type="button" class="button button-neutral" data-um-edit="${esc(u.userId)}" data-um-mutation>EDIT</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-state"><h3>No users found</h3><p>Adjust the search or add a user.</p></div>';
  }
  async function load() {
    const current=generation; setBusy(true);status('Loading users and TOOL CLASS…');
    try {
      // Requests are authenticated individually; no browser-stored user/session is an authority.
      const [nextUsers,nextTools]=await Promise.all([request('list'),request('tools')]);
      if(current!==generation) return;
      users=nextUsers;tools=nextTools; q('[data-um-content]').hidden=false;q('[data-um-unlock]').hidden=true;
      renderList();status(`${users.length} users loaded. Access rules are stored for the later login milestone.`);
    } catch(error) { if(current===generation) status(error.message,true); }
    finally { if(current===generation) {setBusy(false);q('[data-um-add]').disabled=q('[data-um-content]').hidden;} }
  }
  function scopeOptions(kind) {
    const values=unique([...tools.map(t=>kind==='warehouses'?t.warehouse:t.clientId),...users.flatMap(u=>u[kind]),...draft[kind]].filter(Boolean));
    return values.length ? values.map(v=>`<label class="um-choice"><input type="checkbox" data-um-scope="${kind}" value="${esc(v)}"${draft[kind].includes(v)?' checked':''}>${esc(v)}</label>`).join('') : '<p>No scope values in TOOL CLASS yet.</p>';
  }
  function renderEditor() {
    const host=q('[data-um-editor]');host.hidden=false;
    const finalAdmin=draft.userId && draft.isAdmin && draft.status==='Active' && users.filter(u=>u.isAdmin && u.status==='Active').length===1;
    host.innerHTML=`<form class="panel um-editor" data-um-form><div class="panel-header"><div><h3>${draft.userId?'Edit User':'Add User'}</h3><p>${draft.userId?'Leave both password fields blank to keep the current password.':'A password and confirmation are required.'}</p></div></div><fieldset data-um-fields><div class="um-form-grid"><label>User ID<input readonly value="${esc(draft.userId||'Assigned automatically on save')}"></label><label>Account<input name="account" autocomplete="off" required maxlength="160" value="${esc(draft.account)}"></label><label>Display Name<input name="displayName" required maxlength="160" value="${esc(draft.displayName)}"></label><label>Status<select name="status"${finalAdmin?' disabled':''}><option${draft.status==='Active'?' selected':''}>Active</option><option${draft.status==='Disabled'?' selected':''}>Disabled</option></select></label><label class="um-choice"><input name="isAdmin" type="checkbox"${draft.isAdmin?' checked':''}${finalAdmin?' disabled':''}>Administrator</label></div>${finalAdmin?'<p class="um-hint">This is the final Active Admin. It cannot be disabled or demoted. Its password can still be reset.</p>':''}<p class="um-hint" data-um-admin-note>${draft.isAdmin?'Active administrators have full access, including future tools. Assignments below are optional metadata.':'Normal users can be assigned Active tools within their selected warehouse and client scope.'}</p>
      <div class="um-scope-grid"><div><h4>Warehouse Access</h4><div class="um-choices">${scopeOptions('warehouses')}</div></div><div><h4>Client Access</h4><div class="um-choices">${scopeOptions('clients')}</div></div></div>
      <div class="um-form-grid"><label>${draft.userId?'Reset Password':'Password'}<input type="password" name="password" autocomplete="new-password" minlength="6"${draft.userId?'':' required'}></label><label>Confirm Password<input type="password" name="confirmPassword" autocomplete="new-password" minlength="6"${draft.userId?'':' required'}></label></div><p class="um-hint">Use at least 6 characters, including a letter (A–Z) and a number (0–9). Passwords are hashed by the Worker and never stored as plaintext.</p>
      <div class="um-assignment-filters"><label>Warehouse filter<select data-um-tool-filter="warehouse"><option value="">All Warehouses</option>${toolFilterOptions(tools,'warehouse')}</select></label><label>Client filter<select data-um-tool-filter="clientId"><option value="">All Clients</option>${toolFilterOptions(tools,'clientId')}</select></label><p class="um-hint">Filters apply to Available Tools only.</p></div><div class="um-assignment"><div><h4>Assigned Tools</h4><div class="um-tool-list" data-um-assigned></div></div><div class="um-transfer"><button class="button button-neutral" type="button" data-um-assign>← ASSIGN</button><button class="button button-neutral" type="button" data-um-remove>REMOVE →</button></div><div><h4>Available Tools</h4><div class="um-tool-list" data-um-available></div></div></div><p class="um-hint" data-um-scope-warning></p></fieldset>
      ${draft.userId?`<p class="um-hint">Created: ${esc(date(draft.createdDate))} · Updated: ${esc(date(draft.updatedDate))} · Last login: ${esc(date(draft.lastLogin))}</p>`:''}<div class="um-editor-actions"><button class="button button-primary" type="submit" data-um-save data-um-mutation>SAVE USER</button><button class="button button-neutral" type="button" data-um-cancel data-um-mutation>CANCEL EDIT</button></div></form>`;
    renderAssignment();host.scrollIntoView?.({block:'start',behavior:'smooth'});
  }
  function renderAssignment() {
    const assigned=draft.toolIds.map(id=>tools.find(t=>t.toolId===id)||{toolId:id,name:'Unavailable tool',warehouse:'',clientId:'',status:'Unknown'});
    const rows=(items,side)=>items.length ? items.map(t=>`<label class="um-tool-row"><input type="checkbox" data-um-tool="${side}" value="${esc(t.toolId)}"><span><strong>${esc(t.name)}</strong><small>${esc(t.warehouse)} · ${esc(t.clientId)}</small><code>${esc(t.toolId)}</code>${!compatible(t,draft)?'<small class="um-warning">Outside selected scope or unavailable — remove before saving</small>':''}</span></label>`).join('') : '<p class="um-list-empty">No tools in this list.</p>';
    q('[data-um-assigned]').innerHTML=rows(assigned,'assigned');q('[data-um-available]').innerHTML=rows(available(tools,draft,{warehouse:q('[data-um-tool-filter="warehouse"]').value,clientId:q('[data-um-tool-filter="clientId"]').value}),'available');
    const incompatible=assigned.some(t=>!compatible(t,draft));
    q('[data-um-scope-warning]').textContent=incompatible?'Some assigned tools are outside the selected scope or no longer Active. Remove them or restore the scope before saving.':'';
    q('[data-um-save]').disabled=incompatible||busy;
  }
  function selected(side) { return Array.from(root.querySelectorAll(`[data-um-tool="${side}"]:checked`),el=>el.value); }
  function closeEditor() { pending=null;draft=null;q('[data-um-editor]').innerHTML='';q('[data-um-editor]').hidden=true; }
  async function save() {
    const form=q('[data-um-form]');
    if(!pending) {
      const password=form.elements.password.value, confirmation=form.elements.confirmPassword.value;
      if(password!==confirmation) {status('Password confirmation does not match.',true);return;}
      if(!draft.userId && !password) {status('A password is required for new users.',true);return;}
      if(password && !validPassword(password)) {status('Use at least 6 characters, including a letter (A–Z) and a number (0–9), and at most 1024 UTF-8 bytes.',true);return;}
      pending={...draft,account:form.elements.account.value,displayName:form.elements.displayName.value,status:form.elements.status.value,isAdmin:form.elements.isAdmin.checked,password,requestId:window.crypto.randomUUID()};
      if(!draft.userId) delete pending.userId;
      form.elements.password.value=form.elements.confirmPassword.value='';
    }
    const current=generation;setBusy(true);status('Saving user…');
    try {
      const user=await request(draft.userId?'update':'create',pending);
      if(current!==generation)return;
      const index=users.findIndex(u=>u.userId===user.userId);if(index<0)users.push(user);else users[index]=user;
      closeEditor();renderList();status('User saved. Existing warehouse application access is unchanged.');
    } catch(error) { if(current===generation) {const correctable=error.retryable===false && !['WRITE_UNCONFIRMED','REQUEST_CONFLICT'].includes(error.code); if(correctable)pending=null; status(error.message+(correctable?' Correct the fields and re-enter a new password if needed.':''),true);q('[data-um-save]').textContent=correctable?'SAVE USER':'RETRY SAME SAVE';} }
    finally {if(current===generation)setBusy(false);}
  }
  function init(context) {
    root=context.root;api=context.api||window.MkiteApiClient;generation++;key='';users=[];tools=[];draft=pending=null;busy=false;
    root.addEventListener('submit',onSubmit);root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('input',onInput);
  }
  function onSubmit(event) {
    if(event.target.matches('[data-um-unlock]')) {event.preventDefault();if(busy)return;key=q('[data-um-key]').value;q('[data-um-key]').value='';load();}
    if(event.target.matches('[data-um-form]')) {event.preventDefault();if(!busy)save();}
  }
  function onClick(event) {
    if(busy)return;
    if(event.target.closest('[data-um-add]')) {if(draft){status('Save or cancel the current edit first.',true);return;}draft=emptyUser();renderEditor();}
    const edit=event.target.closest('[data-um-edit]');if(edit){if(draft){status('Save or cancel the current edit first.',true);return;}draft=structuredClone(users.find(u=>u.userId===edit.dataset.umEdit));renderEditor();}
    if(event.target.closest('[data-um-cancel]')){closeEditor();status('Edit closed. Reload users if a save response was uncertain.');}
    if(event.target.closest('[data-um-refresh]'))load();
    if(event.target.closest('[data-um-lock]')){const host=root;cleanup();host.innerHTML=render();init({root:host,api});}
    if(event.target.closest('[data-um-assign]')){assign(draft,tools,selected('available'));renderAssignment();}
    if(event.target.closest('[data-um-remove]')){remove(draft,selected('assigned'));renderAssignment();}
  }
  function onChange(event) {
    if(event.target.matches('[data-um-tool-filter]'))renderAssignment();
    if(event.target.matches('[data-um-status-filter]'))renderList();
    if(event.target.matches('[data-um-scope]')){const kind=event.target.dataset.umScope;draft[kind]=Array.from(root.querySelectorAll(`[data-um-scope="${kind}"]:checked`),el=>el.value);renderAssignment();}
    if(event.target.name==='isAdmin'){draft.isAdmin=event.target.checked;q('[data-um-admin-note]').textContent=draft.isAdmin?'Active administrators have full access, including future tools. Assignments are optional metadata.':'Normal users require matching warehouse and client scope.';renderAssignment();}
  }
  function onInput(event) {if(event.target.matches('[data-um-search]'))renderList();}
  function cleanup() {
    generation++;key='';pending=null;draft=null;users=[];tools=[];
    if(root){root.querySelectorAll('input[type="password"]').forEach(el=>{el.value='';});root.removeEventListener('submit',onSubmit);root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);root.removeEventListener('input',onInput);}
  }
  window.MkiteUserManagement={render,init,cleanup,validPassword};
  window.MkiteUserAssignment=Object.freeze({compatible,available,assign,remove});
}(window));
