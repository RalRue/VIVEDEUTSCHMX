import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHandler, validate} from '../api/inquiry.mjs';
import {measurementPlan, safeAttribution} from '../consulta/measurement.mjs';

const id = 'ca30b8bc-743b-44f9-bae8-a5296ab89c9b';
const body = {id, name:'PRUEBA VIVE', email:'test-vive@example.com', course:'A1', experience:'Desde cero',
  goal:'Test only', schedule:'', website:'', privacy:true, analytics:false, marketing:false};
const env = {VIVE_INQUIRY_ENABLED:'true', VIVE_INQUIRY_MODE:'test', VIVE_INQUIRY_RECEIVER_URL:'https://script.google.com/macros/s/test/exec', VIVE_INQUIRY_SECRET:'s'.repeat(64)};
let sent = 0;
let envelope;
const diagnostics = [];
const send = async (url, options) => { sent++; envelope=JSON.parse(options.body); return {ok:true,json:async()=>({ok:true,stored:true,id})}; };
async function invoke(changes={}, deps={}) {
  let status, result; const headers={};
  const res={setHeader:(k,v)=>headers[k]=v,status(n){status=n;return this;},json(v){result=v;return v;}};
  const req={method:'POST',headers:{origin:'https://vive-deutsch-mx.vercel.app','content-type':'application/json'},body,...changes};
  await createHandler({env,send,now:()=>1000,report:code=>diagnostics.push(code),...deps})(req,res);
  return {status,result,headers};
}
assert.ok(validate(body));
for (const invalid of [{...body,privacy:false},{...body,id:'bad'},{...body,email:'bad'}, {...body,name:''}, {...body,goal:'x'.repeat(301)}, {...body,website:'spam'}, {...body,token:'extra'}, {...body,marketing:'yes'}]) assert.equal(validate(invalid),null);
assert.equal((await invoke()).status,200);
assert.equal(envelope.signature,createHmac('sha256',env.VIVE_INQUIRY_SECRET).update('1000.'+envelope.payload).digest('hex'));
assert.equal(JSON.parse(envelope.payload).test,true);
assert.equal((await invoke({}, {env:{...env,VIVE_INQUIRY_SECRET:' '+env.VIVE_INQUIRY_SECRET+'\r\n'}})).status,200);
assert.equal(envelope.signature,createHmac('sha256',env.VIVE_INQUIRY_SECRET).update('1000.'+envelope.payload).digest('hex'));
assert.equal((await invoke({method:'GET'})).status,405);
assert.equal((await invoke({headers:{origin:'https://evil.example','content-type':'application/json'}})).status,403);
const previewEnv = {...env, VERCEL_ENV:'preview', VERCEL_URL:'vive-preview.vercel.app', VERCEL_BRANCH_URL:'vive-git-test.vercel.app', VIVE_INQUIRY_MODE:'live'};
for (const origin of ['https://vive-preview.vercel.app','https://vive-git-test.vercel.app']) {
  const preview = await invoke({headers:{origin,'content-type':'application/json'}},{env:previewEnv});
  assert.equal(preview.status,200);
  assert.equal(preview.result.test,true);
  assert.equal(JSON.parse(envelope.payload).test,true);
}
assert.equal((await invoke({headers:{origin:'https://other.vercel.app','content-type':'application/json'}},{env:previewEnv})).status,403);
assert.equal((await invoke({headers:{origin:'https://vive-preview.vercel.app','content-type':'application/json'}},{env:{...previewEnv,VERCEL_ENV:'production'}})).status,403);
const routing = JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
for (const route of routing.redirects.filter(route=>route.source==='/consulta'||route.source==='/consulta/')) {
  assert.deepEqual(route.has,[{type:'host',value:'vive-deutsch-mx.vercel.app'}]);
  assert.ok(route.destination.startsWith('https://docs.google.com/forms/'));
}
assert.equal((await invoke({body:'{'})).status,400);
assert.equal((await invoke({body:' '.repeat(8001)})).status,413);
assert.equal((await invoke({}, {env:{}})).status,503);
assert.equal((await invoke({}, {send:async()=>({ok:true,json:async()=>({ok:true,stored:false,id})})})).status,502);
assert.equal((await invoke({}, {send:async()=>({ok:true,json:async()=>({ok:true,stored:true,id:'wrong'})})})).status,502);
assert.equal((await invoke({}, {send:async()=>{throw new Error('secret details');}})).status,502);
assert.equal((await invoke({}, {send:async()=>({ok:false,status:403})})).status,502);
assert.equal((await invoke({}, {send:async()=>({ok:true,headers:{get:()=> 'text/html'}})})).status,502);
assert.deepEqual(diagnostics,['upstream_storage_not_confirmed','upstream_storage_not_confirmed','upstream_network_or_parse','upstream_http_403','upstream_non_json']);
const successful = (await invoke({}, {env:{...env,VIVE_INQUIRY_MODE:'live'}})).result;
assert.deepEqual(Object.keys(successful).sort(),['duplicate','id','ok','stored','test']);
assert.equal(JSON.stringify(successful).includes('example.com'),false);
assert.equal(measurementPlan(successful,{analytics:true,marketing:true}).length,2);
assert.equal(measurementPlan(successful,{analytics:false,marketing:false}).length,0);
for (const state of [{...successful,stored:false},{...successful,test:true},{...successful,duplicate:true},{...successful,ok:false}]) assert.equal(measurementPlan(state,{analytics:true,marketing:true}).length,0);
const html = readFileSync(new URL('../consulta/index.html',import.meta.url),'utf8');
assert.equal(safeAttribution('?email=private@example.com&utm_source=private@example.com&utm_content=student_answer').size,0);
assert.equal(safeAttribution('?utm_source=ig&utm_content=mini01&utm_campaign=a1_minilecciones_sep2026').size,3);
assert.equal(safeAttribution('?fbclid=private@example.com').size,0);
assert.ok(!/analytics\.js|meta-pixel\.js|googletagmanager|fbevents/.test(html));
assert.ok(!/checked/.test(html));
assert.ok(html.includes('type="email"'));
const ui = readFileSync(new URL('../consulta/inquiry.js',import.meta.url),'utf8');
assert.ok(ui.includes("fetch('/api/inquiry'"));
assert.ok(ui.includes("credentials: 'same-origin'"));
assert.ok(ui.indexOf('form.remove()')<ui.lastIndexOf('sendMeasurement('));
console.log('Inquiry API, fail-closed storage, signed requests, privacy, test exclusion and measurement gates: PASS');

// An actual persistence acknowledgment, not an HTTP 200 or button click, gates success.
let rows=[], props={}, mailCount=0;
const sheet={setFrozenRows(){},appendRow:r=>rows.push(r),getLastRow:()=>rows.length,
  getRange(range){return {createTextFinder:value=>({matchEntireCell(){return this;},findNext:()=>rows.find(r=>r[0]===value)||null}),getDisplayValue:()=>rows.at(-1)[0],setValue:()=>{}};}};
const receiver=readFileSync(new URL('../../../outputs/VIVE-DEUTSCH-MX-Projekt/operations/private/inquiry-apps-script/Code.gs',import.meta.url),'utf8');
const context=vm.createContext({Date,JSON,Number,String,Math,
  SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet}),flush(){}},
  MailApp:{sendEmail(){mailCount++;}},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='VIVE_INQUIRY_SECRET'?env.VIVE_INQUIRY_SECRET:props[k],setProperties:o=>Object.assign(props,o)})},
  Utilities:{computeHmacSha256Signature:(message,key)=>Array.from(createHmac('sha256',key).update(message).digest())},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:v=>({setMimeType:()=>JSON.parse(v)})}});
vm.runInContext(receiver,context);
function receive(overrides={}){
  const payload=JSON.stringify({...validate(body),test:true}); const timestamp=Date.now();
  return context.doPost({postData:{contents:JSON.stringify({timestamp,payload,signature:createHmac('sha256',env.VIVE_INQUIRY_SECRET).update(timestamp+'.'+payload).digest('hex'),...overrides})}});
}
assert.equal(receive().stored,true);
assert.equal(receive().duplicate,true);
assert.equal(rows.length,1); assert.equal(mailCount,1);
assert.equal(receive({signature:'bad'}).ok,false);
assert.equal(receive({timestamp:0}).ok,false);
assert.equal(context.doGet().ok,false);
assert.equal(context.cell_('=IMPORTXML("bad")').startsWith("'"),true);
assert.equal(context.cell_('+123').startsWith("'"),true);
console.log('Private receiver: signature, expiry, deduplication, write readback, notification and formula-injection guard: PASS');
