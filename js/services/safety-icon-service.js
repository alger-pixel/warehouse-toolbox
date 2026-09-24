(function(window){
  'use strict';
  function unwrap(response){if(!response?.ok)throw new Error(response?.error?.message||'Unable to load safety icons.');return response.data;}
  function resolveImageUrls(data){
    const base=String(window.MkiteApiConfig?.baseUrl||'').replace(/\/$/,'');
    return {...data,icons:(data.icons||[]).map(icon=>({...icon,image:icon.image?.url?.startsWith('/')?{...icon.image,url:`${base}${icon.image.url}`}:icon.image}))};
  }
  window.MkiteSafetyIcons={
    async list({status}={}){const data=resolveImageUrls(unwrap(await window.MkiteApiClient.get('/api/safety-icons')));return status?{...data,icons:data.icons.filter(icon=>icon.status===status)}:data;},
    async create(data){return unwrap(await window.MkiteApiClient.post('/api/safety-icons',data));},
    async update(recordId,data){return unwrap(await window.MkiteApiClient.patch(`/api/safety-icons/${encodeURIComponent(recordId)}`,data));}
  };
}(window));
