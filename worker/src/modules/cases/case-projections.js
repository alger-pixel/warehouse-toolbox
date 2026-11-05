const raw=value=>Array.isArray(value)?value.map(item=>item?.text??'').join(''):String(value??'');
const text=value=>raw(value).trim();
const answerText=value=>Array.isArray(value)?value.map(text).filter(Boolean).join(', '):text(value);

export function projectAssignedWorker(users){
  if(!Array.isArray(users)||!users.length)return '';
  const names=users.map(user=>text(user?.displayName));
  if(names.some(name=>!name||name.includes('@')))return '';
  return names.join(', ');
}

export function projectCaseAnswers(event,questions){
  const parts=[];
  if(text(event?.issue?.issueName))parts.push(`ISSUE: ${text(event.issue.issueName)}`);
  const answers=new Map((event?.answers||[]).map(item=>[text(item?.questionId),item?.answer]));
  for(const question of questions||[]){
    const value=answerText(answers.get(text(question?.questionId)));
    if(value&&text(question?.label))parts.push(`${text(question.label)}: ${value}`);
  }
  if(text(event?.note))parts.push(`ADDITIONAL NOTE: ${text(event.note)}`);
  return parts.join(' | ');
}

function parse(value){try{return JSON.parse(raw(value));}catch{return null;}}

export function planCaseProjectionBackfill(record){
  const fields=record?.fields||{},caseId=text(fields['CASE ID']),updates={},reasons=[];
  let assignedState=text(fields['ASSIGNED WORKER'])?'already':'no-source';
  const assignedData=parse(fields['ASSIGNED USERS']);
  if(!text(fields['ASSIGNED WORKER'])){
    const users=assignedData?.schemaVersion===1&&Array.isArray(assignedData.users)?assignedData.users:null;
    const value=projectAssignedWorker(users);
    if(value&&!users.some(user=>text(user?.userId)&&value.includes(text(user.userId)))){updates['ASSIGNED WORKER']=value;assignedState='eligible';}
    else reasons.push(users?'unsafe-assignment-display-name':'missing-or-malformed-assigned-users');
  }
  let answersState=text(fields['CASE ANSWERS'])?'already':'no-report';
  const reportData=parse(fields['REPORT DATA']);
  if(!text(fields['CASE ANSWERS'])){
    if(reportData?.schemaVersion!==1||!Array.isArray(reportData.reports)){answersState='malformed';reasons.push('malformed-report-data');}
    else if(reportData.reports.length){
      const event=reportData.reports.at(-1),questionData=parse(fields['QUESTION SNAPSHOT']),answers=Array.isArray(event?.answers)?event.answers:null,questions=questionData?.schemaVersion===1&&Array.isArray(questionData.questions)?questionData.questions:null;
      const completionMismatch=text(fields.STATUS)==='Completed'&&(event?.type!=='Completion'||event?.statusAfter!=='Completed');
      if(!event||!answers||completionMismatch||answers.length&&!questions){answersState='malformed';reasons.push(completionMismatch?'completed-final-event-mismatch':answers&&!questions?'missing-question-snapshot':'malformed-report-event');}
      else{const value=projectCaseAnswers(event,questions||[]);if(value){updates['CASE ANSWERS']=value;answersState='eligible';}else{answersState='no-report';reasons.push('report-has-no-projectable-content');}}
    }
  }
  return {caseId,recordId:text(record?.record_id),current:{assignedWorker:text(fields['ASSIGNED WORKER']),caseAnswers:text(fields['CASE ANSWERS'])},updates,assignedState,answersState,reasons};
}
