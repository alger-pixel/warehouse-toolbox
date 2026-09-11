const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={location:{hash:'#settings/users'},addEventListener(){}};
for(const file of ['js/settings/user-management.js','js/router.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),{window});
const assignment=window.MkiteUserAssignment;
const tools=[{toolId:'A',name:'First',warehouse:'MKS66',clientId:'B044',status:'Active'},{toolId:'B',name:'Second',warehouse:'MKS66',clientId:'TINECO-TOC',status:'Active'},{toolId:'C',warehouse:'MKS159',clientId:'B044',status:'Active'},{toolId:'D',warehouse:'MKS66',clientId:'B044',status:'Disabled'}];
const user=()=>({isAdmin:false,warehouses:['MKS66'],clients:['B044'],toolIds:[]});
test('Settings User Management route and admin access UI render without global login',()=>{
 assert.equal(window.MkiteRouter.current().view,'settings/users');window.MkiteRouter.navigate({view:'dashboard'});assert.equal(window.location.hash,'#dashboard');
 const html=window.MkiteUserManagement.render();for(const text of ['User Management','ADD USER','data-um-search','All Statuses','Administration key','data-route="settings"'])assert.ok(html.includes(text));assert.ok(!html.includes('PASSWORD HASH'));
 const app=fs.readFileSync('js/app.js','utf8');assert.match(app,/data-route="settings\/users"/);assert.match(app,/activeToolModule = window.MkiteUserManagement/);
});
test('dual-list scope filters normal users and multi-assign/remove deduplicates stable IDs',()=>{
 const u=user();assert.equal(assignment.available(tools,u).map(t=>t.toolId).join(','),'A');assignment.assign(u,tools,['A','A','B','unknown']);assert.equal(u.toolIds.join(','),'A');assert.equal(assignment.available(tools,u).length,0);assignment.remove(u,['A']);assert.equal(u.toolIds.length,0);u.clients.push('TINECO-TOC');assignment.assign(u,tools,['A','B']);assert.equal(u.toolIds.join(','),'A,B');
});
test('admin can view all active tools, scope changes leave assignments visible for explicit removal',()=>{
 const u=user();u.isAdmin=true;assert.equal(assignment.available(tools,u).length,3);assignment.assign(u,tools,['B','C']);u.isAdmin=false;assert.equal(u.toolIds.join(','),'B,C');assert.equal(assignment.compatible(tools[1],u),false);assignment.remove(u,['B','C']);assert.equal(u.toolIds.length,0);
});
test('editor renders safe dynamic tool text, blank password inputs and responsive list containers',()=>{
 const source=fs.readFileSync('js/settings/user-management.js','utf8'),css=fs.readFileSync('css/user-management.css','utf8');
 for(const value of ['Assigned Tools','Available Tools','Confirm Password','data-um-assign','data-um-remove','data-um-fields','autocomplete="new-password"'])assert.ok(source.includes(value));
 assert.ok(source.includes('esc(t.name)'));assert.ok(source.includes('esc(t.toolId)'));assert.ok(!source.includes('localStorage'));assert.ok(!source.includes('PASSWORD HASH'));assert.match(css,/grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/var\(--panel-bg\)/);
});
test('available-tool Warehouse and Client filters combine without changing assignments or scope',()=>{
 const u=user();u.isAdmin=true;u.toolIds=['A'];
 assert.equal(assignment.available(tools,u,{warehouse:'MKS66',clientId:'TINECO-TOC'}).map(t=>t.toolId).join(','),'B');
 assert.equal(assignment.available(tools,u,{warehouse:'MKS159',clientId:'TINECO-TOC'}).length,0);
 assert.equal(assignment.available(tools,u,{warehouse:'',clientId:''}).length,2);
 assert.equal(u.toolIds.join(','),'A');assert.equal(u.clients.join(','),'B044');
 u.isAdmin=false;assert.equal(assignment.available(tools,u,{warehouse:'MKS66',clientId:'TINECO-TOC'}).length,0);
});
test('new TOOL CLASS entries appear automatically in available-tool filtering',()=>{
 const u=user();u.isAdmin=true;const future={toolId:'NEW',name:'Future',warehouse:'MKS999',clientId:'FUTURE',status:'Active'};
 assert.equal(assignment.available([...tools,future],u,{warehouse:'MKS999',clientId:'FUTURE'})[0].toolId,'NEW');
 const source=fs.readFileSync('js/settings/user-management.js','utf8');assert.ok(source.includes("toolFilterOptions(tools,'warehouse')"));assert.ok(source.includes("toolFilterOptions(tools,'clientId')"));assert.ok(source.includes('All Warehouses'));assert.ok(source.includes('All Clients'));
});
test('frontend password rule accepts letters plus numbers at six characters without case/symbol requirements',()=>{
 const w={};vm.runInNewContext(fs.readFileSync('js/settings/user-management.js','utf8'),{window:w,TextEncoder});
 for(const value of ['mkite66','user123','Alger2026','abc123','ABC123'])assert.equal(w.MkiteUserManagement.validPassword(value),true,value);
 for(const value of ['123456','abcdef','abc','abc12','',null,'a1'+'x'.repeat(1024)])assert.equal(w.MkiteUserManagement.validPassword(value),false,String(value));
});
