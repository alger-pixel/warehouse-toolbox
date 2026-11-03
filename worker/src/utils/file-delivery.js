export function safeFileName(value,fallback='file'){
 const cleaned=String(value||'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,'').replace(/[\\/]/g,'-').replace(/["\r\n]/g,'').trim().slice(0,180);
 return cleaned&&cleaned!=='.'&&cleaned!=='..'?cleaned:fallback;
}

export function attachmentDisposition(value,fallback='download'){
 const name=safeFileName(value,fallback),ascii=name.replace(/[^\x20-\x7e]/g,'_');
 return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
