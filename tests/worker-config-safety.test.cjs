const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {checkWorkerConfig}=require('../scripts/check-worker-config.js');

test('deployment check accepts only the mkite-secure-api Worker configuration',()=>{
 assert.equal(checkWorkerConfig(),'mkite-secure-api');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mkite-worker-check-')),wrong=path.join(dir,'wrangler.toml');fs.writeFileSync(wrong,'name = "warehouse-toolbox"\n');
 assert.throws(()=>checkWorkerConfig(wrong),/Worker deployment blocked.*mkite-secure-api/);fs.rmSync(dir,{recursive:true,force:true});
});
test('root scripts use explicit Worker config and safe local ports',()=>{
 const scripts=require('../package.json').scripts;assert.equal(scripts['worker:dev'],'npx wrangler dev --config worker/wrangler.toml --local --port 8787');assert.match(scripts['worker:deploy'],/^npm run worker:check && npx wrangler deploy --config worker\/wrangler\.toml$/);assert.equal(scripts['frontend:dev'],'python3 -m http.server 5501');
});
test('developer secrets stay ignored, example values are placeholders, and runtime frontend contains no upstream credentials',()=>{
 const ignore=fs.readFileSync('.gitignore','utf8');assert.match(ignore,/^worker\/\.dev\.vars$/m);assert.match(ignore,/^!worker\/\.dev\.vars\.example$/m);
 const example=fs.readFileSync('worker/.dev.vars.example','utf8'),safeDefaults=new Set(['America/Toronto','https://alger-pixel.github.io,http://127.0.0.1:5501,http://localhost:5501','false','https://tool.mkite.cn/api/v1/open/warehouse-inventory/locations']);for(const line of example.split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match)assert.ok(/^(?:|<[^>]+>|YOUR_[A-Z0-9_]+|REPLACE_[A-Z0-9_]+|EXAMPLE_[A-Z0-9_]+)$/.test(match[2])||safeDefaults.has(match[2]),match[1]);}
 const files=fs.readdirSync('js',{recursive:true}).filter(name=>name.endsWith('.js'));for(const file of files){const source=fs.readFileSync(path.join('js',file),'utf8');assert.doesNotMatch(source,/MKITE_WAREHOUSE_API_KEY|X-API-Key|tool\.mkite\.cn/,file);}
});
