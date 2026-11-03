(function(window){
 'use strict';
 const active=new Set(),mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 function requestId(){if(window.crypto?.randomUUID)return window.crypto.randomUUID();const bytes=new Uint8Array(16);window.crypto.getRandomValues(bytes);return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');}
 function validFileName(value){return typeof value==='string'&&value.length<=180&&!/[\\/\u0000-\u001f\u007f]/.test(value)&&value.toLowerCase().endsWith('.xlsx');}
 function download(bytes,fileName){const blob=new Blob([bytes],{type:mime}),url=window.URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=fileName;link.hidden=true;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>window.URL.revokeObjectURL(url),0);}
 async function deliverXlsx({generatorKey,fileName,workbook,parameters={},notify=()=>{},onProgress=()=>{},XLSX=window.XLSX}={}){
  if(active.has(generatorKey))return {accepted:false,downloaded:false,archived:false};
  if(!generatorKey||!validFileName(fileName)||!workbook||!XLSX?.write)throw Error('Excel export is unavailable.');
  active.add(generatorKey);
  try{onProgress({stage:'serializing'});const serialized=XLSX.write(workbook,{type:'array',bookType:'xlsx',compression:true}),bytes=serialized instanceof Uint8Array?serialized:new Uint8Array(serialized);onProgress({stage:'serialized',byteLength:bytes.byteLength});download(bytes,fileName);onProgress({stage:'downloaded',byteLength:bytes.byteLength});
   try{onProgress({stage:'archiving',byteLength:bytes.byteLength});const saved=await window.MkiteDownloadCenterApi.registerGenerated({generatorKey,bytes,fileName,requestId:requestId(),parameters});if(saved.status!=='READY')throw Error('Archive is not ready.');notify('Excel downloaded and saved to Download Centre.');onProgress({stage:'complete',archived:true,byteLength:bytes.byteLength});return {accepted:true,downloaded:true,archived:true,data:saved};}
   catch{notify('Excel downloaded. Could not save to Download Centre.');onProgress({stage:'complete',archived:false,byteLength:bytes.byteLength});return {accepted:true,downloaded:true,archived:false};}
  }finally{active.delete(generatorKey);}
 }
 window.MkiteGeneratedFileDelivery={deliverXlsx,_test:{requestId,validFileName,download,active}};
}(window));
