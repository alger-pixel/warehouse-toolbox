(function(window){'use strict';
 const api=window.MkiteApiClient;
 function failure(response,fallback){if(response?.ok)return response.data;const error=Error(response?.error?.message||fallback);error.code=response?.error?.code||'REQUEST_FAILED';error.retryable=Boolean(response?.error?.retryable);throw error;}
 function query(input){const params=new URLSearchParams();for(const [key,value]of Object.entries(input||{}))if(value!==''&&value!=null)params.set(key,value);return params.size?`?${params}`:'';}
 window.MkiteDownloadCenterApi={
  async list(filters={}){return failure(await api.get(`/api/download-center${query(filters)}`),'Unable to load Download Centre.');},
  async get(downloadId){return failure(await api.get(`/api/download-center/${encodeURIComponent(downloadId)}`),'Unable to load this download.');},
  async registerGenerated({generatorKey,bytes,fileName,requestId,parameters}){const form=new FormData();form.set('generatorKey',generatorKey);form.set('requestId',requestId);form.set('parameters',JSON.stringify(parameters));form.set('file',new File([bytes],fileName,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));let response,payload;try{response=await window.fetch(api.url('/api/download-center/register'),{method:'POST',body:form});payload=await response.json();}catch{throw Error('Unable to save this export to Download Centre.');}return failure(payload,'Unable to save this export to Download Centre.');},
  async registerMatching(input){return this.registerGenerated({...input,generatorKey:'matching-excel'});},
  fileUrl(downloadId){return api.url(`/api/download-center/${encodeURIComponent(downloadId)}/file`);},
  _test:{failure,query}
 };
}(window));
