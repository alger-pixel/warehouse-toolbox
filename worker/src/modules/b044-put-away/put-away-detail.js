export function warehouseTimestamp(value, timeZone = 'America/Toronto') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatB044Detail(job, timeZone) {
  return [`PL NUMBER: ${job.pickingListNumber}`, 'CLIENT ID: B044', 'WAREHOUSE: MKS66', 'TOOL: B044 SCAN PUT AWAY', `CREATED: ${warehouseTimestamp(job.createdAt, timeZone)}`, `PACKAGE COUNT: ${job.rows.length}`, 'STATUS: CREATED', '', 'PACKAGES:', '', ...job.rows.map(row => `[${String(row.sequence).padStart(3, '0')}]\nPACKAGE ID: ${row.packageRecordId}\nSKU: ${row.trackingNumber}\nLOCATION: ${row.currentLocation}\nPUT AWAY SKU: ${row.finalSku}\nWAREHOUSE ORDER: ${row.warehouseInboundOrder}\n${row.commandRaw?`COMMAND SNAPSHOT: ${JSON.stringify({commanded:true,commandRaw:row.commandRaw,commandDisplay:row.commandDisplay||row.commandRaw,commandReference:row.commandReference||''})}\n`:''}`)].join('\n');
}
