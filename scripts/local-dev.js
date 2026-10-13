const {spawn}=require('node:child_process');
const commands=[['Worker','npm',['run','worker:dev']],['Frontend','node',['scripts/local-dev-server.js']]];
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)if(!child.killed)child.kill('SIGTERM');setTimeout(()=>process.exit(code),500).unref();}
for(const [name,command,args] of commands){const child=spawn(command,args,{cwd:process.cwd(),stdio:'inherit',env:process.env});children.push(child);child.on('error',error=>{console.error(`${name} failed to start: ${error.message}`);stop(1);});child.on('exit',(code,signal)=>{if(!stopping){console.error(`${name} stopped (${signal||`exit ${code}`}). Stopping the complete local session.`);stop(code||1);}});}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(0));
