(function(window){
  'use strict';
  // Shared advisory cache. Uses the existing secure frontend API helper only.
  window.MkiteInventoryLocations={create({onChange=()=>{},concurrency=4,warehouseCodes}={}){
    const cache=new Map(),queue=[];let active=0,disposed=false;
    const limit=Number.isInteger(concurrency)?Math.max(1,Math.min(4,concurrency)):4;
    const requestedWarehouses=Array.isArray(warehouseCodes)?[...new Set(warehouseCodes.map(code=>typeof code==='string'?code.trim():'').filter(Boolean))]:null;
    const requestWarehouseSet=new Set(requestedWarehouses||['MKS66']);
    function drain(){
      while(!disposed&&active<limit&&queue.length){
        const sku=queue.shift(),entry=cache.get(sku);active++;
        (async()=>{
          try{
            const filter=requestedWarehouses?{warehouseCodes:requestedWarehouses}:{warehouseCode:'MKS66'};
            const response=await window.MkiteApiClient.post('/api/inventory/lookup',{sku,...filter}),data=response?.data;
            if(!response?.ok||data?.sku!==sku||!Number.isSafeInteger(data.total)||data.total<0||!Array.isArray(data.locations)||data.total!==data.locations.length||data.locations.some(row=>!row||typeof row.locationCode!=='string'||typeof row.warehouseCode!=='string'||!requestWarehouseSet.has(row.warehouseCode.trim())))throw Error('Unavailable');
            entry.state='ready';entry.sku=sku;entry.total=data.total;entry.locations=data.locations.map(row=>({locationCode:row.locationCode,warehouseCode:row.warehouseCode.trim(),availableQuantity:typeof row.availableQuantity==='number'&&Number.isFinite(row.availableQuantity)?row.availableQuantity:null}));
          }catch{entry.state='error';}
          finally{active--;if(!disposed){try{onChange(sku);}catch{/* Advisory rendering must not reject or stop the queue. */}drain();}}
        })();
      }
    }
    return {get:sku=>cache.get(sku),ensure(sku){if(disposed||typeof sku!=='string'||!sku.trim())return;sku=sku.trim();if(!cache.has(sku)){cache.set(sku,{state:'loading'});queue.push(sku);drain();}return cache.get(sku);},dispose(){disposed=true;queue.length=0;cache.clear();}};
  }};
}(window));
