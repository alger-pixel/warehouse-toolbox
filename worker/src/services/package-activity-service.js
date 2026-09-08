export const PACKAGE_ACTION_TYPES = Object.freeze({
  RECEIVED: "RECEIVED",
  MOVED_BY_SKU: "MOVED_BY_SKU",
  B044_PUTAWAY_CREATED: "B044_PUTAWAY_CREATED",
  B044_PUTAWAY_COMPLETED: "B044_PUTAWAY_COMPLETED",
  B044_PUTAWAY_CANCELLED: "B044_PUTAWAY_CANCELLED"
});

export class PackageActivityPersistenceError extends Error {
  constructor() {
    super("Package activity update was not confirmed.");
    this.name = "PackageActivityPersistenceError";
  }
}

const SUPPORTED_ACTIONS = new Set(Object.values(PACKAGE_ACTION_TYPES));

function cleanOptional(value) {
  return value == null ? "" : String(value).trim();
}

function timestampParts(occurredAt, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  return Object.fromEntries(formatter.formatToParts(new Date(occurredAt)).map((part) => [part.type, part.value]));
}

export function createPackageActivityService(options = {}) {
  const timeZone = options.timeZone || "America/Toronto";

  function createAction(actionType, details = {}, occurredAt = Date.now()) {
    if (!SUPPORTED_ACTIONS.has(actionType)) throw new Error(`Unsupported package action: ${actionType}`);
    const timestamp = new Date(occurredAt);
    if (Number.isNaN(timestamp.getTime())) throw new Error("Package activity requires a valid server timestamp.");
    return Object.freeze({
      actionType,
      occurredAt: timestamp.toISOString(),
      recordId: cleanOptional(details.recordId),
      sku: cleanOptional(details.sku),
      clientId: cleanOptional(details.clientId),
      fromLocation: cleanOptional(details.fromLocation),
      toLocation: cleanOptional(details.toLocation),
      status: cleanOptional(details.status),
      toolId: cleanOptional(details.toolId),
      packageRecordId: cleanOptional(details.packageRecordId || details.recordId),
      pickingListNumber: cleanOptional(details.pickingListNumber),
      fromStatus: cleanOptional(details.fromStatus),
      toStatus: cleanOptional(details.toStatus)
    });
  }

  function formatActivityLine(action) {
    const parts = timestampParts(action.occurredAt, timeZone);
    const prefix = `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
    if (action.actionType === PACKAGE_ACTION_TYPES.RECEIVED) return `${prefix} - RECEIVED`;
    if (action.actionType === PACKAGE_ACTION_TYPES.MOVED_BY_SKU) {
      return `${prefix} - MOVED BY SKU FROM: ${action.fromLocation} TO: ${action.toLocation}`;
    }
    if ([PACKAGE_ACTION_TYPES.B044_PUTAWAY_CREATED, PACKAGE_ACTION_TYPES.B044_PUTAWAY_COMPLETED, PACKAGE_ACTION_TYPES.B044_PUTAWAY_CANCELLED].includes(action.actionType)) {
      return `${prefix} - B044 SCAN PUT AWAY TOOL: PL NUMBER: ${action.pickingListNumber} - ${action.actionType === PACKAGE_ACTION_TYPES.B044_PUTAWAY_CREATED ? "CREATED" : action.actionType === PACKAGE_ACTION_TYPES.B044_PUTAWAY_CANCELLED ? "CANCELLED" : "DONE PUTTING AWAY"}`;
    }
    throw new Error(`Unsupported package action: ${action.actionType}`);
  }

  function appendActivityNote(existingNote, actionLine) {
    const existing = existingNote == null ? "" : String(existingNote);
    const line = String(actionLine || "").trim();
    if (!line) return existing;
    if (!existing.trim()) return line;
    return `${existing.replace(/(?:\r?\n)+$/, "")}\n${line}`;
  }

  return Object.freeze({ timeZone, createAction, formatActivityLine, appendActivityNote });
}
