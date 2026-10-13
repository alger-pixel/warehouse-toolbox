export const IDENTITY = Object.freeze({ warehouse: 'MKS66', clientId: 'TINECO-TOC', toolId: 'CT-MKS66-TINECO-TOC-0001' });
export const STEP_LABOR_FIELD = 'LABOR MINUTES PER STEP';
export const LATEST_REENTRY_FIELD = 'LATEST RE-ENTRY AT';
export const CLIENT_RETURN_COUNT_FIELD = 'CLIENT RETURN COUNT';
export const LATEST_CLIENT_RETURN_FIELD = 'LATEST CLIENT RETURN AT';
export const CLIENT_RETURN_HISTORY_FIELD = 'CLIENT RETURN HISTORY';
export const REPAIR_HISTORY_FIELD = 'REPAIR HISTORY';
export const TEXT_FIELDS = ['UNIT ID','SN','TRACKING NUMBER','CLIENT ID','ISSUE FOUND','PRE-QC NOTE','PART USED DETAIL','FINAL QC NOTE','GENERAL NOTE',STEP_LABOR_FIELD,CLIENT_RETURN_HISTORY_FIELD,REPAIR_HISTORY_FIELD];
export const NUMBER_FIELDS = ['TIMES OF RE-ENTER','TOTAL PARTS USED','LABOR MINUTES',CLIENT_RETURN_COUNT_FIELD];
export const FORM_FIELDS = ['trackingNumber','issueFound','preQcNote','partUsedDetail','totalPartsUsed','repairLevel','finalQcNote'];
export class TinecoError extends Error { constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; } }
export const fail = (code, message, status) => { throw new TinecoError(code, message, status); };

// Reject malformed or future data before constructing any absolute mutation.
export function parseStepLabor(raw) {
  const value = Array.isArray(raw) ? raw.map(v => v.text || '').join('') : String(raw ?? '');
  if (!value.trim()) return { version: 1, preQc: 0, repair: 0, finalQc: 0 };
  try {
    const parsed = JSON.parse(value);
    if (!parsed || parsed.version !== 1 || Object.keys(parsed).sort().join(',') !== 'finalQc,preQc,repair,version' || !['preQc','repair','finalQc'].every(k => Number.isSafeInteger(parsed[k]) && parsed[k] >= 0)) throw Error('Unsupported step labor');
    return parsed;
  } catch {
    fail('TINECO_STEP_LABOR_INVALID', 'LABOR MINUTES PER STEP must contain supported v1 JSON with nonnegative whole minutes. Existing data was preserved.');
  }
}
