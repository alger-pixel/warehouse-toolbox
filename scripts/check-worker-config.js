const fs=require('node:fs');
const path=require('node:path');
const EXPECTED_NAME='mkite-secure-api';
const REQUIRED_OPERATIONAL_TABLES=['FEISHU_CASE_CATEGORY_TABLE_ID','FEISHU_USER_TABLE_ID'];

function configuredVar(source,key){
  const match=source.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`,`m`));
  return match&&match[1].trim();
}

function checkWorkerConfig(file=path.join(__dirname,'..','worker','wrangler.toml')) {
  const source=fs.readFileSync(file,'utf8');
  const match=source.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  if(!match||match[1]!==EXPECTED_NAME)throw new Error(`Worker deployment blocked: expected name = "${EXPECTED_NAME}" in worker/wrangler.toml.`);
  for(const key of REQUIRED_OPERATIONAL_TABLES){
    const value=configuredVar(source,key);
    if(!value||!/^tbl[A-Za-z0-9]+$/.test(value))throw new Error(`Worker deployment blocked: ${key} must contain the existing Feishu table ID in worker/wrangler.toml.`);
  }
  return match[1];
}

if(require.main===module){
  try{const name=checkWorkerConfig(process.argv[2]);console.log(`Worker configuration verified: ${name}`);}
  catch(error){console.error(error.message);process.exitCode=1;}
}

module.exports={EXPECTED_NAME,REQUIRED_OPERATIONAL_TABLES,checkWorkerConfig};
