import { FeishuRecordError } from './feishu-record-service.js';
// Official Bitable attachment flow: drive/v1/medias/upload_all -> file_token.
// https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/attachment
export function createFeishuAttachmentService(auth, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  return {
    async upload({ appToken, fileName, bytes }) {
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Attachment must be between 1 byte and 20 MiB.');
      const form = new FormData();
      form.set('file_name', fileName); form.set('parent_type', 'bitable_file'); form.set('parent_node', appToken); form.set('size', String(bytes.length));
      form.set('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
      const token = await auth.getTenantAccessToken();
      const response = await fetchImpl('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const payload = await response.json();
      if (!response.ok || payload.code !== 0 || !payload.data?.file_token) throw new FeishuRecordError('attachment upload', payload.code);
      return payload.data.file_token;
    }
  };
}
