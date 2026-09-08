const API_ROOT = "https://open.feishu.cn/open-apis/bitable/v1";

export class FeishuRecordError extends Error {
  constructor(operation, feishuCode, httpStatus, errorType = "FEISHU_API_ERROR") {
    super(`Feishu ${operation} failed`);
    this.name = "FeishuRecordError";
    this.operation = operation;
    // Retain only numeric API codes or our fixed local codes, never upstream text.
    this.feishuCode = Number.isSafeInteger(feishuCode) ? feishuCode
      : typeof feishuCode === 'string' && /^\d{1,12}$/.test(feishuCode) ? Number(feishuCode)
      : ['NETWORK_ERROR', 'RESPONSE_PARSE_ERROR'].includes(feishuCode) ? feishuCode : 'UNKNOWN';
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) this.httpStatus = httpStatus;
    this.errorType = ['FEISHU_API_ERROR', 'NETWORK_ERROR', 'RESPONSE_PARSE_ERROR'].includes(errorType) ? errorType : 'FEISHU_API_ERROR';
  }
}

export function createFeishuRecordService(authService, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  async function request(url, init, operation) {
    const token = await authService.getTenantAccessToken();
    let response; let payload;
    try { response = await fetchImpl(url, { ...init, headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}`, ...(init.headers || {}) } }); }
    catch (error) { throw new FeishuRecordError(operation, "NETWORK_ERROR", undefined, "NETWORK_ERROR"); }
    try { payload = await response.json(); }
    catch (error) { throw new FeishuRecordError(operation, "RESPONSE_PARSE_ERROR", response.status, "RESPONSE_PARSE_ERROR"); }
    if (!response.ok || !payload || payload.code !== 0) throw new FeishuRecordError(operation, payload && payload.code, response.status);
    return payload.data || {};
  }

  return {
    async listRecords({ appToken, tableId, fieldNames = [] }) {
      const records = []; let pageToken = "";
      do {
        const query = new URLSearchParams({ page_size: "500" });
        // fieldNames is optional so lookup can safely discover records while
        // PACKAGE CLASS field titles are being verified.
        if (fieldNames.length) query.set("field_names", JSON.stringify(fieldNames));
        if (pageToken) query.set("page_token", pageToken);
        const url = `${API_ROOT}/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${query}`;
        const data = await request(url, { method: "GET" }, "record list");
        records.push(...(Array.isArray(data.items) ? data.items : [])); pageToken = data.has_more && data.page_token ? String(data.page_token) : "";
      } while (pageToken);
      return records;
    },
    async listFields({ appToken, tableId }) {
      const fields = []; let pageToken = "";
      do {
        const query = new URLSearchParams({ page_size: "100" }); if (pageToken) query.set("page_token", pageToken);
        const data = await request(`${API_ROOT}/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields?${query}`, { method: "GET" }, "field list");
        fields.push(...(data.items || [])); pageToken = data.has_more && data.page_token ? String(data.page_token) : "";
      } while (pageToken);
      return fields;
    },
    async createRecord({ appToken, tableId, fields }) {
      const url = `${API_ROOT}/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`;
      const data = await request(url, { method: "POST", body: JSON.stringify({ fields }) }, "record creation");
      return data.record || {};
    },
    async getRecord({ appToken, tableId, recordId }) {
      const url = `${API_ROOT}/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`;
      const data = await request(url, { method: "GET" }, "record retrieval");
      return data.record || {};
    },
    async updateRecord({ appToken, tableId, recordId, fields }) {
      const url = `${API_ROOT}/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`;
      const data = await request(url, { method: "PUT", body: JSON.stringify({ fields }) }, "record update");
      return data.record || {};
    }
  };
}
