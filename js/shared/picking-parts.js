(function (root) {
  'use strict';
  // Exact literal keys: punctuation and case are never mapped to another inventory SKU.
  function possible(command) {
    const raw = String(command ?? '');
    const codes = raw.match(/[A-Za-z][A-Za-z0-9]*(?:[-*][A-Za-z0-9]+)+/g) || [];
    const materials = raw.match(/说明书|泡沫板|泡沫|泡棉|仓库箱子|贴纸/g) || [];
    return [...new Set([...codes.filter(v => /^(?:CARTON-\d+-\d+-\d+|M\d+[A-Za-z0-9]*(?:[-*][A-Za-z0-9]+)+)$/i.test(v)), ...materials])].map(sku => ({ sku, quantity: 1 }));
  }
  function aggregate(groups) {
    const totals = new Map();
    for (const parts of groups) for (const part of parts) totals.set(part.sku, (totals.get(part.sku) || 0) + part.quantity);
    return [...totals].map(([sku, quantity]) => ({ sku, quantity })).sort((a,b) => a.sku.localeCompare(b.sku));
  }
  function validate(parts) {
    if (!Array.isArray(parts) || parts.length > 100) throw Error('Provide at most 100 distinct actual part SKUs.');
    const seen = new Set();
    return parts.map(part => {
      const sku = typeof part?.sku === 'string' ? part.sku.trim() : '';
      if (!sku || sku.length > 128 || /[\u0000-\u001f\u007f]/.test(sku) || seen.has(sku) || !Number.isSafeInteger(part.quantity) || part.quantity < 1 || part.quantity > 9999) throw Error('Invalid or duplicate actual part SKU / quantity.');
      seen.add(sku); return { sku, quantity: part.quantity };
    }).sort((a,b) => a.sku.localeCompare(b.sku));
  }
  function parse(value) {
    if (!value) return { version: 1, packages: [] };
    const data = JSON.parse(value);
    if (data?.version !== 1 || !Array.isArray(data.packages)) throw Error('Unrecognized PART USED format.');
    const seen = new Set();
    const packages = data.packages.filter(p => p?.status === 'CONFIRMED').map(p => {
      if (typeof p.packageRecordId !== 'string' || !p.packageRecordId || seen.has(p.packageRecordId) || typeof p.confirmedAt !== 'string' || !Number.isFinite(Date.parse(p.confirmedAt)) || typeof p.requestId !== 'string' || !p.requestId || typeof p.trackingNumber !== 'string') throw Error('Invalid confirmed package usage.');
      seen.add(p.packageRecordId);
      return { packageRecordId: p.packageRecordId, trackingNumber: p.trackingNumber, finalSku: String(p.finalSku || ''), requestId: p.requestId, status: 'CONFIRMED', confirmedAt: p.confirmedAt, parts: validate(p.parts) };
    });
    return { version: 1, packages };
  }
  root.MkitePickingParts = Object.freeze({ possible, aggregate, validate, parse });
}(typeof window === 'undefined' ? globalThis : window));
