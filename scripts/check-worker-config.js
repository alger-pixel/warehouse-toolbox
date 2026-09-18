const fs=require('node:fs');
const path=require('node:path');
const EXPECTED_NAME='mkite-secure-api';

function checkWorkerConfig(file=path.join(__dirname,'..','worker','wrangler.toml')) {
  const source=fs.readFileSync(file,'utf8');
  const match=source.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  if(!match||match[1]!==EXPECTED_NAME)throw new Error(`Worker deployment blocked: expected name = "${EXPECTED_NAME}" in worker/wrangler.toml.`);
  return match[1];
}

if(require.main===module){
  try{const name=checkWorkerConfig(process.argv[2]);console.log(`Worker configuration verified: ${name}`);}
  catch(error){console.error(error.message);process.exitCode=1;}
}

module.exports={EXPECTED_NAME,checkWorkerConfig};
