import {parseAccess} from '../users/user-service.js';

const text=value=>Array.isArray(value)?value.map(item=>item.text||'').join(''):String(value??'');
const categoryFields=['categoryId','clientId','mainCategory','categoryName','warehouseId','status','defaultPriority','defaultInstruction','mandatoryQuestions','issueOptions','requireCompletionPhoto','sortOrder'];

export function operationalCategories(result){
  return {categories:result.categories.filter(category=>category.status==='Active').map(category=>Object.fromEntries(categoryFields.map(field=>[field,category[field]])))};
}

export function createCaseAssignmentService(config,records){
  return {async list(){
    const args={appToken:config.appToken};
    const [users,categories]=await Promise.all([
      records.listRecords({...args,tableId:config.userTableId,fieldNames:['USER ID','DISPLAY NAME','STATUS','IS ADMIN','WAREHOUSE ACCESS']}),
      records.listRecords({...args,tableId:config.caseCategoryTableId,fieldNames:['WAREHOUSE ID']})
    ]);
    const warehouses=[...new Set(categories.map(row=>text(row.fields?.['WAREHOUSE ID']).trim()).filter(Boolean))];
    const ids=new Set(),workers=[];
    for(const row of users){
      const fields=row.fields||{};
      if(text(fields.STATUS)!=='Active')continue;
      const userId=text(fields['USER ID']).trim(),displayName=text(fields['DISPLAY NAME']).trim();
      if(!userId||!displayName||ids.has(userId)){
        const error=new Error('Assignment workers have missing or duplicate identities.');
        Object.assign(error,{code:'CASE_ASSIGNMENT_DATA_CONFLICT',status:409});throw error;
      }
      ids.add(userId);
      const access=parseAccess(fields['WAREHOUSE ACCESS']);
      // Preserve existing admin assignment eligibility without exposing admin roles.
      workers.push({userId,displayName,status:'Active',warehouses:fields['IS ADMIN']==='Admin'?[...new Set([...access,...warehouses])]:access});
    }
    return {workers};
  }};
}
