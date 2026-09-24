import { FeishuRecordError } from './feishu-record-service.js';
// Official Bitable attachment flow: drive/v1/medias/upload_all -> file_token.
// https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/attachment
export function createFeishuAttachmentService(auth, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  return {
    async upload({ appToken, fileName, bytes, mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) {
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Attachment must be between 1 byte and 20 MiB.');
      const form = new FormData();
      form.set('file_name', fileName); form.set('parent_type', 'bitable_file'); form.set('parent_node', appToken); form.set('size', String(bytes.length));
      form.set('file', new Blob([bytes], { type: mimeType }), fileName);
      const token = await auth.getTenantAccessToken();
      const response = await fetchImpl('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const payload = await response.json();
      if (!response.ok || payload.code !== 0 || !payload.data?.file_token) throw new FeishuRecordError('attachment upload', payload.code);
      return payload.data.file_token;
    },
    async download(fileToken) {
      if (!/^[a-zA-Z0-9_-]{1,256}$/.test(fileToken || '')) throw new Error('Invalid attachment token.');
      const token = await auth.getTenantAccessToken();
      const endpoint = `https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`;
      let response = await fetchImpl(endpoint, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        const location=response.headers.get('Location');let target;
        try { target=new URL(location); } catch { throw new FeishuRecordError('attachment redirect', 'RESPONSE_PARSE_ERROR', response.status, 'RESPONSE_PARSE_ERROR'); }
        if(target.protocol!=='https:')throw new FeishuRecordError('attachment redirect', 'UNKNOWN', response.status);
        // A redirect target is a signed download URL. Never forward the Feishu bearer token.
        response=await fetchImpl(target.href,{redirect:'follow'});
      }
      if (!response.ok) {
        let code=response.status;
        try { const payload=await response.clone().json();code=payload?.code??code; } catch { /* Binary/text error body; status is sufficient. */ }
        throw new FeishuRecordError('attachment download', code, response.status);
      }
      return response;
    }
  };
}
