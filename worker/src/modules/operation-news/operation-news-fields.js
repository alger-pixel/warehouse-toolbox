export const NEWS_TYPES=Object.freeze(['SOP IMPROVEMENT','PROJECT FOLLOW UP','CASE FOLLOW UP','OTHER ATTENTION NEEDED']);
export const NEWS_STATUSES=Object.freeze(['ACTIVE','ARCHIVED']);
export const NEWS_FIELDS=Object.freeze({id:'NEWS ID',type:'NEWS TYPE',title:'TITLE',clientId:'CLIENT ID',content:'CONTENT',pictures:'PICTURES',attachments:'ATTACHMENTS',postedBy:'POSTED BY',postedAt:'POSTED AT',updatedBy:'UPDATED BY',updatedAt:'UPDATED AT',status:'STATUS'});
export const NEWS_FIELD_TYPES=Object.freeze({[NEWS_FIELDS.id]:1,[NEWS_FIELDS.type]:3,[NEWS_FIELDS.title]:1,[NEWS_FIELDS.clientId]:1,[NEWS_FIELDS.content]:1,[NEWS_FIELDS.pictures]:17,[NEWS_FIELDS.attachments]:17,[NEWS_FIELDS.postedBy]:1,[NEWS_FIELDS.postedAt]:5,[NEWS_FIELDS.updatedBy]:1,[NEWS_FIELDS.updatedAt]:5,[NEWS_FIELDS.status]:3});
export const NEWS_FIELD_NAMES=Object.freeze(Object.values(NEWS_FIELDS));
export const NEWS_LIMITS=Object.freeze({title:160,clientId:64,content:10000,actor:100,preview:240});
