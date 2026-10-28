const SUFFIX_ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function torontoNewsDay(stamp=Date.now(),timeZone='America/Toronto'){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp)).replaceAll('-','');}
export function randomNewsSuffix(randomValues=values=>crypto.getRandomValues(values)){const bytes=randomValues(new Uint8Array(6));return [...bytes].map(value=>SUFFIX_ALPHABET[value&31]).join('');}
export function makeNewsId({stamp=Date.now(),timeZone='America/Toronto',randomValues}={}){return `NEWS-${torontoNewsDay(stamp,timeZone)}-${randomNewsSuffix(randomValues)}`;}
export const NEWS_ID_PATTERN=/^NEWS-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;
