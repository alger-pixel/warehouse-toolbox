import test from "node:test";
import assert from "node:assert/strict";
import { createLocationMoveService } from "../src/modules/location-move/location-move-service.js";

const config={appToken:"base",packageTableId:"table"};
const rec=(id,sku,location,status="Active",note="",clientId="B044")=>({record_id:id,fields:{SKU:sku,"CLIENT ID":clientId,LOCATION:location,"DATE OF RECEIVED":1_700_000_000_000,STATUS:status,NOTE:note}});
function service(items, current=items[0]){let update;let persisted=current;const records={listRecords:async()=>items,getRecord:async()=>persisted,updateRecord:async(input)=>{update=input;persisted={...persisted,fields:{...(persisted.fields||{}),...input.fields}};return persisted;}};return {domain:createLocationMoveService(config,records,{now:()=>Date.parse("2026-09-04T21:00:00.000Z")}),getUpdate:()=>update};}

test("lookup distinguishes missing SKU, location, and inactive package",async()=>{
  const {domain}=service([rec("a","ABC123","66-A1-01","Processing"),rec("b","ABC123","66-C4-02","Disposal")]);
  assert.equal((await domain.lookup({sku:"NONE",currentLocation:"66-A1-01"})).state,"SKU_NOT_FOUND");
  assert.equal((await domain.lookup({sku:"abc123",currentLocation:"wrong"})).state,"SKU_NOT_AT_LOCATION");
  const inactive=await domain.lookup({sku:"ABC123",currentLocation:"66-A1-01"});assert.equal(inactive.state,"PACKAGE_NOT_ACTIVE");assert.deepEqual(inactive.statuses,["Processing"]);
});
test("lookup uses exact SKU and current location and requires selection for multiple Active records",async()=>{
  const one=rec("one","ABC123","66-A1-01"),other=rec("other","ABC123","66-C4-02");
  assert.equal((await service([one,other]).domain.lookup({sku:"abc123",currentLocation:"66-a1-01"})).package.recordId,"one");
  assert.equal((await service([one,rec("two","ABC123","66-A1-01")]).domain.lookup({sku:"ABC123",currentLocation:"66-A1-01"})).state,"MULTIPLE_ACTIVE_MATCHES");
  assert.equal((await service([one]).domain.lookup({sku:"ABC",currentLocation:"66-A1-01"})).state,"SKU_NOT_FOUND");
});
test("move rechecks the latest record and updates only LOCATION and appended NOTE",async()=>{
  const stale=rec("one","ABC123","66-A1-01","Active","stale lookup note");const latest=rec("one","ABC123","66-A1-01","Active","2026/09/04 16:00 - RECEIVED");const fixture=service([stale],latest);const result=await fixture.domain.move({recordId:"one",sku:"abc123",currentLocation:"66-a1-01",destinationLocation:"66-B2-03"});
  assert.deepEqual(fixture.getUpdate().fields,{LOCATION:"66-B2-03",NOTE:"2026/09/04 16:00 - RECEIVED\n2026/09/04 17:00 - MOVED BY SKU FROM: 66-A1-01 TO: 66-B2-03"});assert.equal(result.data.recordId,"one");assert.equal(result.data.status,"Active");assert.equal(result.activity.actionType,"MOVED_BY_SKU");
});
test("move initializes a blank legacy NOTE with only the move action",async()=>{
  const current=rec("one","ABC123","66-U3-01","Active","   ");const fixture=service([current],current);await fixture.domain.move({recordId:"one",sku:"ABC123",currentLocation:"66-U3-01",destinationLocation:"66-U2-01"});
  assert.deepEqual(fixture.getUpdate().fields,{LOCATION:"66-U2-01",NOTE:"2026/09/04 17:00 - MOVED BY SKU FROM: 66-U3-01 TO: 66-U2-01"});
});
test("move blocks changed SKU, changed location, inactive state, and same destination",async()=>{
  assert.equal((await service([],rec("one","OTHER","A")).domain.move({recordId:"one",sku:"ABC",currentLocation:"A",destinationLocation:"B"})).conflict,"PACKAGE_CHANGED");
  assert.equal((await service([],rec("one","ABC","C")).domain.move({recordId:"one",sku:"ABC",currentLocation:"A",destinationLocation:"B"})).conflict,"LOCATION_CHANGED");
  assert.equal((await service([],rec("one","ABC","A","Disposal")).domain.move({recordId:"one",sku:"ABC",currentLocation:"A",destinationLocation:"B"})).conflict,"PACKAGE_NOT_ACTIVE");
  assert.equal((await service([],rec("one","ABC","A")).domain.move({recordId:"one",sku:"ABC",currentLocation:"A",destinationLocation:" a "})).conflict,"SAME_LOCATION");
});
test("blocked moves do not issue a NOTE or LOCATION update",async()=>{
  const fixture=service([],rec("one","ABC","A","Disposal","existing history"));
  assert.equal((await fixture.domain.move({recordId:"one",sku:"ABC",currentLocation:"A",destinationLocation:"B"})).conflict,"PACKAGE_NOT_ACTIVE");
  assert.equal(fixture.getUpdate(),undefined);
});
test("move does not report success when Feishu fails to confirm NOTE persistence",async()=>{
  const current=rec("one","ABC","66-U3-01","Active","");let requestedFields;let reads=0;
  const unconfirmed={...current,fields:{...current.fields,LOCATION:"66-U2-01",NOTE:""}};
  const records={listRecords:async()=>[current],getRecord:async()=>++reads===1?current:unconfirmed,updateRecord:async(input)=>{requestedFields=input.fields;return unconfirmed;}};
  const domain=createLocationMoveService(config,records,{now:()=>Date.parse("2026-09-04T21:00:00.000Z")});
  await assert.rejects(domain.move({recordId:"one",sku:"ABC",currentLocation:"66-U3-01",destinationLocation:"66-U2-01"}),/not confirmed/i);
  assert.deepEqual(requestedFields,{LOCATION:"66-U2-01",NOTE:"2026/09/04 17:00 - MOVED BY SKU FROM: 66-U3-01 TO: 66-U2-01"});
});
test("move confirms persisted NOTE with a fresh read when the update response omits it",async()=>{
  const current=rec("one","ABC","66-U3-01","Active","");let requestedFields;let reads=0;
  const finalNote="2026/09/04 17:00 - MOVED BY SKU FROM: 66-U3-01 TO: 66-U2-01";
  const persisted={...current,fields:{...current.fields,LOCATION:"66-U2-01",NOTE:finalNote}};
  const records={listRecords:async()=>[current],getRecord:async()=>++reads===1?current:persisted,updateRecord:async(input)=>{requestedFields=input.fields;return {record_id:"one",fields:{LOCATION:"66-U2-01"}};}};
  const result=await createLocationMoveService(config,records,{now:()=>Date.parse("2026-09-04T21:00:00.000Z")}).move({recordId:"one",sku:"ABC",currentLocation:"66-U3-01",destinationLocation:"66-U2-01"});
  assert.equal(result.data.toLocation,"66-U2-01");assert.equal(reads,2);assert.deepEqual(requestedFields,{LOCATION:"66-U2-01",NOTE:finalNote});
});
