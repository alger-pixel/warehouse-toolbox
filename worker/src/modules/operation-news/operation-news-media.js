import {OperationNewsError} from './operation-news-service.js';

export const NEWS_MEDIA_LIMITS=Object.freeze({pictureCount:5,pictureBytes:5*1024*1024,pictureTotalBytes:20*1024*1024,attachmentCount:5,attachmentBytes:10*1024*1024});
const PICTURES=new Map([['image/jpeg',new Set(['jpg','jpeg'])],['image/png',new Set(['png'])],['image/webp',new Set(['webp'])]]);
const DOCUMENTS=new Map([
 ['application/pdf',new Set(['pdf'])],
 ['application/vnd.ms-excel',new Set(['xls'])],
 ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',new Set(['xlsx'])],
 ['application/vnd.openxmlformats-officedocument.wordprocessingml.document',new Set(['docx'])],
 ['text/plain',new Set(['txt'])],
 ['text/csv',new Set(['csv'])],
 ['application/csv',new Set(['csv'])],
 ['application/vnd.ms-excel.sheet.macroenabled.12',new Set()]
]);
const fail=(code,message,status=400)=>{throw new OperationNewsError(code,message,status);};
const extension=name=>String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]||'';
export function safeMediaName(value,fallback='file'){
 const cleaned=String(value||'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,'').replace(/[\\/]/g,'-').replace(/["\r\n]/g,'').trim().slice(0,180);
 return cleaned&&cleaned!=='.'&&cleaned!=='..'?cleaned:fallback;
}
const imageSignature=(bytes,type)=>type==='image/png'?bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):type==='image/jpeg'?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
const documentSignature=(bytes,type)=>{
 if(type==='application/pdf')return bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-';
 if(type==='application/vnd.ms-excel')return bytes.length>=8&&[208,207,17,224,161,177,26,225].every((v,i)=>bytes[i]===v);
 if(type.includes('openxmlformats'))return bytes.length>=4&&bytes[0]===80&&bytes[1]===75&&[3,5,7].includes(bytes[2])&&[4,6,8].includes(bytes[3]);
 return !bytes.includes(0);
};
async function normalize(file,kind,index){
 if(!(file instanceof File))fail('INVALID_MEDIA',`${kind} ${index+1} is not a file.`);
 const name=safeMediaName(file.name,kind==='picture'?`picture-${index+1}`:`attachment-${index+1}`),type=String(file.type||'').toLowerCase(),ext=extension(name),allowed=kind==='picture'?PICTURES:DOCUMENTS,max=kind==='picture'?NEWS_MEDIA_LIMITS.pictureBytes:NEWS_MEDIA_LIMITS.attachmentBytes;
 if(!allowed.has(type)||!allowed.get(type).has(ext))fail(kind==='picture'?'INVALID_PICTURE':'INVALID_ATTACHMENT',kind==='picture'?'Pictures must be JPEG, PNG, or WebP files.':'Attachments must be PDF, XLS, XLSX, DOCX, TXT, or CSV files.');
 if(!file.size||file.size>max)fail(kind==='picture'?'INVALID_PICTURE':'INVALID_ATTACHMENT',`${kind==='picture'?'Pictures':'Attachments'} must be between 1 byte and ${max/(1024*1024)} MiB.`,413);
 const bytes=new Uint8Array(await file.arrayBuffer()),valid=kind==='picture'?imageSignature(bytes,type):documentSignature(bytes,type);
 if(!valid)fail(kind==='picture'?'INVALID_PICTURE':'INVALID_ATTACHMENT',`${kind==='picture'?'Picture':'Attachment'} content does not match its declared format.`);
 return {name,type,bytes};
}
export async function validateNewsMedia(pictures=[],attachments=[]){
 if(pictures.length>NEWS_MEDIA_LIMITS.pictureCount)fail('INVALID_PICTURE','Select at most 5 pictures.');
 if(attachments.length>NEWS_MEDIA_LIMITS.attachmentCount)fail('INVALID_ATTACHMENT','Select at most 5 attachments.');
 const result={pictures:[],attachments:[]};
 for(let i=0;i<pictures.length;i++)result.pictures.push(await normalize(pictures[i],'picture',i));
 if(result.pictures.reduce((sum,item)=>sum+item.bytes.length,0)>NEWS_MEDIA_LIMITS.pictureTotalBytes)fail('INVALID_PICTURE','Pictures may total at most 20 MiB.',413);
 for(let i=0;i<attachments.length;i++)result.attachments.push(await normalize(attachments[i],'attachment',i));
 return result;
}
