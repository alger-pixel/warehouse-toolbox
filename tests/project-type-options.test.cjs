const test=require('node:test'),assert=require('node:assert/strict');
const {ensureReWork}=require('../scripts/update-project-type-options.js');
test('Re-Work schema update preserves all existing option IDs, names and colors and is idempotent',async()=>{
 let field={field_id:'type',field_name:'PROJECT TYPE',type:3,property:{options:[{id:'a',name:'Repair',color:1},{id:'b',name:'Other',color:6}]}};let writes=0;
 const service={listFields:async()=>[structuredClone(field)],updateField:async args=>{writes++;field={...field,...args.field};field.property.options.forEach(o=>o.id||= 'new');}};
 assert.equal((await ensureReWork(service)).missing,true);assert.equal(writes,0);
 const result=await ensureReWork(service,{apply:true});assert.equal(result.changed,true);assert.deepEqual(result.options.map(o=>o.name),['Repair','Re-Work','Other']);assert.deepEqual(result.options.map(o=>o.id),['a','new','b']);
 assert.equal((await ensureReWork(service,{apply:true})).changed,false);assert.equal(writes,1);
});
