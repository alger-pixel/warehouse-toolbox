import test from "node:test";
import assert from "node:assert/strict";
import { createPackageActivityService, PACKAGE_ACTION_TYPES } from "../src/services/package-activity-service.js";

const service = createPackageActivityService({ timeZone: "America/Toronto" });
const receivedAt = Date.parse("2026-09-04T20:00:00.000Z");
const movedAt = Date.parse("2026-09-04T21:00:00.000Z");

test("normalized package actions retain structured context for future audit consumers", () => {
  const received = service.createAction(PACKAGE_ACTION_TYPES.RECEIVED, { sku: "ABC123", clientId: "B044", toLocation: "66-A1-01", status: "Active", toolId: "receiving" }, receivedAt);
  assert.deepEqual(received, { actionType: "RECEIVED", occurredAt: "2026-09-04T20:00:00.000Z", recordId: "", sku: "ABC123", clientId: "B044", fromLocation: "", toLocation: "66-A1-01", status: "Active", toolId: "receiving", packageRecordId: "", pickingListNumber: "", fromStatus: "", toStatus: "" });
  const moved = service.createAction(PACKAGE_ACTION_TYPES.MOVED_BY_SKU, { recordId: "rec-one", sku: "ABC123", fromLocation: "66-U3-01", toLocation: "66-U2-01", status: "Active", toolId: "move-location-by-sku" }, movedAt);
  assert.equal(moved.actionType, "MOVED_BY_SKU"); assert.equal(moved.recordId, "rec-one"); assert.equal(moved.fromLocation, "66-U3-01"); assert.equal(moved.toLocation, "66-U2-01");
});

test("activity lines use warehouse local 24-hour timestamps and explicit templates", () => {
  const received = service.createAction(PACKAGE_ACTION_TYPES.RECEIVED, {}, receivedAt);
  const moved = service.createAction(PACKAGE_ACTION_TYPES.MOVED_BY_SKU, { fromLocation: "66-U3-01", toLocation: "66-U2-01" }, movedAt);
  assert.equal(service.formatActivityLine(received), "2026/09/04 16:00 - RECEIVED");
  assert.equal(service.formatActivityLine(moved), "2026/09/04 17:00 - MOVED BY SKU FROM: 66-U3-01 TO: 66-U2-01");
});

test("note append preserves history and adds exactly one boundary newline", () => {
  const line = "2026/09/04 17:00 - MOVED BY SKU FROM: 66-U3-01 TO: 66-U2-01";
  assert.equal(service.appendActivityNote("", line), line);
  assert.equal(service.appendActivityNote("  \n", line), line);
  assert.equal(service.appendActivityNote("2026/09/04 16:00 - RECEIVED", line), `2026/09/04 16:00 - RECEIVED\n${line}`);
  assert.equal(service.appendActivityNote("2026/09/04 16:00 - RECEIVED\n\n", line), `2026/09/04 16:00 - RECEIVED\n${line}`);
});
