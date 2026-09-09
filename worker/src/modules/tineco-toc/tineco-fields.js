export const IDENTITY = Object.freeze({ warehouse: 'MKS66', clientId: 'TINECO-TOC', toolId: 'CT-MKS66-TINECO-TOC-0001' });
export const TEXT_FIELDS = ['UNIT ID','SN','TRACKING NUMBER','CLIENT ID','ISSUE FOUND','PRE-QC NOTE','PART USED DETAIL','FINAL QC NOTE'];
export const NUMBER_FIELDS = ['TIMES OF RE-ENTER','TOTAL PARTS USED','LABOR MINUTES'];
export const FORM_FIELDS = ['trackingNumber','issueFound','preQcNote','partUsedDetail','totalPartsUsed','repairLevel','finalQcNote'];
export class TinecoError extends Error { constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; } }
export const fail = (code, message, status) => { throw new TinecoError(code, message, status); };
