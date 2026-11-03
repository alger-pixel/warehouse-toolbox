const {spawn}=require('node:child_process');

const WRANGLER_ARGS=Object.freeze([
  'wrangler','dev',
  '--config','worker/wrangler.toml',
  '--local',
  '--port','8787',
  '--var','DOWNLOAD_CENTER_LOCAL_E2E:enabled'
]);

function start({spawnProcess=spawn,stdout=process.stdout}={}){
  stdout.write([
    'DOWNLOAD CENTRE CONTROLLED LOCAL E2E MODE',
    'Production Download Centre registration is enabled for this development Worker session only.',
    'Stop this Worker before returning to normal development.',
    ''
  ].join('\n'));
  const child=spawnProcess('npx',WRANGLER_ARGS,{cwd:process.cwd(),env:process.env,stdio:'inherit'});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  child.once('error',error=>{console.error(`Unable to start controlled Download Centre Worker: ${error.message}`);process.exitCode=1;});
  child.once('exit',(code,signal)=>{if(signal)return;process.exitCode=code??1;});
  return child;
}

if(require.main===module)start();
module.exports={WRANGLER_ARGS,start};
