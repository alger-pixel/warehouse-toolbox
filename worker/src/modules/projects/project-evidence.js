import {F,PREPARATION_KEYS,ITEM_KEYS,allowed,fail,inputText,stableId,validAsset} from './project-schema.js';
const MAX_IMAGE=5*1024*1024,MAX_TOTAL=20*1024*1024;
export function imageBytes(raw){allowed(raw,['type','base64']);if(!['image/png','image/jpeg','image/webp'].includes(raw.type)||typeof raw.base64!=='string'||raw.base64.length>Math.ceil(MAX_IMAGE/3)*4)fail('INVALID_PROJECT_IMAGE','Use a PNG, JPEG or WebP picture up to 5 MiB.');let bytes;try{bytes=Uint8Array.from(atob(raw.base64),c=>c.charCodeAt(0));}catch{fail('INVALID_PROJECT_IMAGE','Picture encoding is invalid.');}const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10,jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';if(!bytes.length||bytes.length>MAX_IMAGE||!(raw.type==='image/png'?png:raw.type==='image/jpeg'?jpeg:webp))fail('INVALID_PROJECT_IMAGE','Picture content does not match its supported image format.');return bytes;}
export async function hydratePreparationEvidence({data,previous,fields,attachments,appToken,projectId,stamp,uuid=()=>crypto.randomUUID()}) {
 const plans=[],resultFields={},time=new Date(stamp).toISOString();let total=0;
 for(const key of PREPARATION_KEYS){const items=ITEM_KEYS.includes(key),listKey=items?'items':'evidence',old=previous[key][listKey],refs=data[key][listKey],ids=new Set(),assets=new Set(),output=[];resultFields[F[key+'Assets']]=[];
  for(const ref of refs){allowed(ref,items?['itemId','name','note','assetId','pendingImage','fileName','mimeType','createdAt','updatedAt','url']:['assetId','pendingImage','fileName','mimeType','url']);let record={},saved;
   if(items){const itemId=stableId(ref.itemId,'Item ID');if(ids.has(itemId))fail('INVALID_PROJECT_INPUT','Duplicate equipment/part item ID.');ids.add(itemId);saved=old.find(r=>r.itemId===itemId);record={itemId,name:inputText(ref.name??'','Item name',false,200),note:inputText(ref.note??'','Item note',false,5000),createdAt:saved?.createdAt||time,updatedAt:time};}
   else saved=old.find(r=>r.assetId===ref.assetId);
   if(ref.pendingImage){const bytes=imageBytes(ref.pendingImage);total+=bytes.length;if(total>MAX_TOTAL)fail('INVALID_PROJECT_IMAGE','A save can contain at most 20 MiB of new pictures.',413);const assetId=`asset-${uuid()}`,mimeType=ref.pendingImage.type,fileName=`${projectId}-${key}-${assetId}.${mimeType==='image/png'?'png':mimeType==='image/webp'?'webp':'jpg'}`;Object.assign(record,{assetId,fileName,mimeType});plans.push({key,record,bytes,mimeType});}
   else if(ref.assetId){if(assets.has(ref.assetId)||!saved||saved.assetId!==ref.assetId||!validAsset(saved,key,fields))fail('UNKNOWN_PROJECT_ASSET','Evidence reference is missing, duplicated or belongs to a different item/category.',422);Object.assign(record,{assetId:saved.assetId,fileName:saved.fileName,mimeType:saved.mimeType});resultFields[F[key+'Assets']].push({file_token:fields[F[key+'Assets']].find(file=>file.name===saved.fileName).file_token});assets.add(ref.assetId);}
   else if(!items)fail('INVALID_PROJECT_IMAGE','An evidence picture is required.');output.push(record);
  }data[key][listKey]=output;
 }
 if(plans.length&&!attachments)fail('PROJECT_EVIDENCE_UNAVAILABLE','Project picture storage is unavailable.',503);
 for(const plan of plans){const token=await attachments.upload({appToken,fileName:plan.record.fileName,bytes:plan.bytes,mimeType:plan.mimeType});resultFields[F[plan.key+'Assets']].push({file_token:token});}
 return resultFields;
}
