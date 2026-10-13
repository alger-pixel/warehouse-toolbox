const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND_HOST = '127.0.0.1';
const FRONTEND_PORT = 5501;
const WORKER_HOST = '127.0.0.1';
const WORKER_PORT = 8787;
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const HOP_BY_HOP = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host']);

function controlledWorkerError(response) {
  const body = JSON.stringify({ ok:false, error:{ code:'LOCAL_WORKER_UNAVAILABLE', message:'Local Worker is not available. Start local development with npm run dev.', retryable:true } });
  response.writeHead(502, { 'Content-Type':'application/json; charset=utf-8', 'Content-Length':Buffer.byteLength(body), 'Cache-Control':'no-store' });
  response.end(body);
}

function proxy(request, response, options = {}) {
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase())));
  const upstream = http.request({ hostname:options.workerHost||WORKER_HOST, port:options.workerPort||WORKER_PORT, method:request.method, path:request.url, headers }, upstreamResponse => {
    const responseHeaders = Object.fromEntries(Object.entries(upstreamResponse.headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase())));
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);upstreamResponse.pipe(response);
  });
  upstream.on('error', () => controlledWorkerError(response));
  request.on('aborted', () => upstream.destroy());request.pipe(upstream);
}

function staticFile(request, response, root = ROOT) {
  let pathname;try{pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);}catch{return response.writeHead(400).end('Bad request');}
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),file=path.resolve(root,relative);
  if(file!==root&&!file.startsWith(`${root}${path.sep}`))return response.writeHead(403).end('Forbidden');
  fs.stat(file,(error,stat)=>{if(error||!stat.isFile())return response.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Not found');response.writeHead(200,{'Content-Type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});if(request.method==='HEAD')return response.end();fs.createReadStream(file).pipe(response);});
}

function createDevServer(options = {}) {
  return http.createServer((request,response)=>{
    if(String(request.url||'').startsWith('/api/'))return proxy(request,response,options);
    if(!['GET','HEAD'].includes(request.method))return response.writeHead(405,{'Content-Type':'text/plain; charset=utf-8'}).end('Method not allowed');
    staticFile(request,response,options.root||ROOT);
  });
}

function start() {
  const server=createDevServer();server.on('error',error=>{if(error.code==='EADDRINUSE')console.error(`Local frontend port ${FRONTEND_PORT} is already occupied. Stop the existing process and retry.`);else console.error(`Local frontend server failed: ${error.message}`);process.exitCode=1;});server.listen(FRONTEND_PORT,FRONTEND_HOST,()=>console.log(`Frontend and API proxy: http://${FRONTEND_HOST}:${FRONTEND_PORT}\nWorker target: http://${WORKER_HOST}:${WORKER_PORT}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
if(require.main===module)start();
module.exports={FRONTEND_HOST,FRONTEND_PORT,WORKER_HOST,WORKER_PORT,createDevServer,controlledWorkerError};
