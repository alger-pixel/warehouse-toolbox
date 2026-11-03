export const DOWNLOAD_GENERATORS=Object.freeze({
 'matching-excel':Object.freeze({toolId:'AT-MATCHING-0001',toolName:'Matching',function:'Export Excel',sourceRoute:'#tool/matching',warehouse:'',clientId:'',fileType:'XLSX',parameterKeys:['knownItemCount','matchedCount','multipleScanCount','failedCount','totalScanCount']}),
 'tineco-toc-batch-inventory-excel':Object.freeze({toolId:'CT-MKS66-TINECO-TOC-0002',toolName:'TINECO TOC Batch Inventory',function:'Export Filtered Results',sourceRoute:'tineco-toc-batch-inventory',warehouse:'MKS66',clientId:'TINECO-TOC',fileType:'XLSX',parameterKeys:['resultCount']}),
 'b044-picking-exceptions-excel':Object.freeze({toolId:'CT-MKS66-B044-0001',toolName:'Put Away Scan',function:'Export Picking Exceptions',sourceRoute:'put-away-scan',warehouse:'MKS66',clientId:'B044',fileType:'XLSX',parameterKeys:['exceptionCount']}),
 'batch-picking-list-excel':Object.freeze({toolId:'batch-picking-list',toolName:'Batch Picking List',function:'Export Filtered Results',sourceRoute:'batch-picking-list',warehouse:'',clientId:'',fileType:'XLSX',parameterKeys:['resultCount']})
});

export function getDownloadGenerator(key){return typeof key==='string'?DOWNLOAD_GENERATORS[key]||null:null;}
