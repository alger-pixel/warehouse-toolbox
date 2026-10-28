(function(window){'use strict';
 const blocked=new Set(['LOCAL_PRODUCTION_MUTATION_BLOCKED','MUTATION_BLOCKED']);
 function failure(response,fallback){if(response?.ok)return response.data;const error=Error(blocked.has(response?.error?.code)?'This local environment is protected from production changes. Your information was not saved.':response?.error?.message||fallback);error.code=response?.error?.code||'REQUEST_FAILED';error.retryable=Boolean(response?.error?.retryable);throw error;}
 const query=input=>{const value=new URLSearchParams();for(const [key,item]of Object.entries(input||{}))if(item!==''&&item!=null)value.set(key,item);return value.size?`?${value}`:'';};
 const api=window.MkiteApiClient;
 window.MkiteOperationNewsApi={
  async people(){const data=failure(await api.get('/api/cases/assignment-options'),'Unable to load USER CLASS people.');return (data.workers||[]).filter(person=>person.status==='Active'&&person.userId&&person.displayName).sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.userId.localeCompare(b.userId));},
  async list(filters={}){return failure(await api.get(`/api/operation-news${query(filters)}`),'Unable to load Operation News.');},
  async dashboard(){return failure(await api.get('/api/operation-news/dashboard'),'Operation News is temporarily unavailable.');},
  async developmentStatus(){return failure(await api.get('/api/operation-news/development-status'),'Unable to read local test status.');},
  async get(newsId){return failure(await api.get(`/api/operation-news/${encodeURIComponent(newsId)}`),'Unable to load this Operation News post.');},
  async create(input,media={pictures:[],attachments:[]}){if(!media.pictures.length&&!media.attachments.length)return failure(await api.post('/api/operation-news',input),'Unable to post Operation News.');const form=new FormData();form.set('payload',JSON.stringify(input));for(const file of media.pictures)form.append('pictures',file,file.name);for(const file of media.attachments)form.append('attachments',file,file.name);let response,payload;try{response=await window.fetch(api.url('/api/operation-news'),{method:'POST',body:form});try{payload=await response.json();}catch{payload=null;}}catch{const error=Error('The secure MKITE API could not be reached.');error.code='CONNECTION_ERROR';error.retryable=true;throw error;}return response.ok&&payload?.ok!==false?payload?.data:failure({ok:false,error:payload?.error},'Unable to post Operation News.');},
  async updateStatus(newsId,input){return failure(await api.patch(`/api/operation-news/${encodeURIComponent(newsId)}/status`,input),'Unable to update Operation News status.');},
  _test:{failure,query}
 };
}(window));
