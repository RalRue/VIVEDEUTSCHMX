// Optional local Chromium integration test. All HTTP requests stay on loopback;
// persistence uses an in-process fixture; inquiry and placement frontends/APIs are real.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {createHandler as inquiryHandler} from '../api/inquiry.mjs';
import {createHandler as accessHandler} from '../api/placement-access.mjs';
import {createHandler as accessCheckHandler} from '../api/placement-access-check.mjs';
import {createHandler as placementHandler} from '../api/placement.mjs';
import {issueToken,verifyToken} from '../api/_placement.mjs';

const binary=process.env.VIVE_CHROMIUM_BINARY||'/usr/bin/chromium';
assert.ok(existsSync(binary),'Set VIVE_CHROMIUM_BINARY to a local Chromium executable');
const secret='s'.repeat(64),env={VIVE_INQUIRY_ENABLED:'true',VIVE_INQUIRY_MODE:'live',VIVE_PLACEMENT_ENABLED:'true',
  VIVE_INQUIRY_SECRET:secret,VIVE_INQUIRY_RECEIVER_URL:'https://script.google.com/macros/s/test/exec'};
const inquiries=new Set(),placements=[];
const syntheticReceiver=async(url,options)=>{
  assert.equal(url,env.VIVE_INQUIRY_RECEIVER_URL);
  const envelope=JSON.parse(options.body);
  assert.equal(envelope.signature,createHmac('sha256',secret).update(envelope.timestamp+'.'+envelope.payload).digest('hex'));
  const data=JSON.parse(envelope.payload);
  if(data.kind==='PLACEMENT') {
    assert.ok(inquiries.has(data.inquiryId),'Placement must stay associated with a stored synthetic inquiry');
    placements.push(data);
    return {ok:true,json:async()=>({ok:true,stored:true,id:data.id,inquiryId:data.inquiryId})};
  }
  inquiries.add(data.id);
  return {ok:true,json:async()=>({ok:true,stored:true,id:data.id})};
};
const receive=inquiryHandler({env,send:syntheticReceiver});
const access=accessHandler({env});
const checkAccess=accessCheckHandler({env});
const place=placementHandler({env,send:syntheticReceiver});
const requests=[];
const server=createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    const observed={path,method:req.method,hasQuery:req.url.includes('?'),mode:req.headers['sec-fetch-mode'],destination:req.headers['sec-fetch-dest'],site:req.headers['sec-fetch-site']};
    requests.push(observed);
    res.on('finish',()=>{observed.status=res.statusCode;});
    res.status=code=>{res.statusCode=code;return res;};
    res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    res.send=value=>res.end(value);
    if(path==='/api/inquiry') {
      let raw='';for await(const chunk of req)raw+=chunk;
      req.body=raw;await receive(req,res);return;
    }
    if(path==='/api/placement-access'){await access(req,res);return;}
    if(path==='/api/placement-access-check') {
      let raw='';for await(const chunk of req)raw+=chunk;
      req.body=raw;await checkAccess(req,res);return;
    }
    if(path==='/api/placement') {
      let raw='';for await(const chunk of req)raw+=chunk;
      req.body=raw;await place(req,res);return;
    }
    if(path==='/external-app') {
      res.setHeader('Content-Type','text/html');
      res.end('<!doctype html><title>Synthetic external app</title><a id="external-link" href="#">Open personal orientation</a>');return;
    }
    const files={'/consulta/':['consulta/index.html','text/html'],'/consulta/inquiry.js':['consulta/inquiry.js','text/javascript'],
      '/consulta/measurement.mjs':['consulta/measurement.mjs','text/javascript'],'/consulta/inquiry.css':['consulta/inquiry.css','text/css'],'/logo.png':['logo.png','image/png'],
      '/consulta/nivel/':['consulta/nivel/index.html','text/html'],'/consulta/nivel/nivel.js':['consulta/nivel/nivel.js','text/javascript'],
      '/consulta/nivel/questions.js':['consulta/nivel/questions.js','text/javascript'],'/consulta/nivel/nivel.css':['consulta/nivel/nivel.css','text/css'],
      '/consulta/nivel/privacidad.html':['consulta/nivel/privacidad.html','text/html']};
    if(!files[path]){res.statusCode=404;res.end();return;}
    res.setHeader('Content-Type',files[path][1]);res.end(readFileSync(new URL('../'+files[path][0],import.meta.url)));
  } catch(error) {res.statusCode=500;res.end('Local fixture failed');console.error(error);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://localhost:'+server.address().port;
env.VIVE_INQUIRY_PREVIEW_ORIGIN=origin;
const profile=mkdtempSync(join(tmpdir(),'vive-placement-browser-'));
const browser=spawn(binary,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update',
  '--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+profile,
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1','about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
let pending=new Map(),sequence=0,buffer='';
browser.stderr.on('data',()=>{});
browser.stdio[4].on('data',chunk=>{
  buffer+=chunk.toString();let end;
  while((end=buffer.indexOf('\0'))>=0) {
    const raw=buffer.slice(0,end);buffer=buffer.slice(end+1);
    if(!raw)continue;
    const message=JSON.parse(raw),request=pending.get(message.id);
    if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}
    if(message.method==='Fetch.requestPaused') {
      const probe='(()=>{const result={domHasToken:document.body.innerHTML.includes("/consulta/nivel/#"),cookieHasToken:document.cookie.includes("vive-placement")};fetch(document.querySelector("#placement-link").href).then(async response=>{result.status=response.status;result.responseHasToken=(await response.text()).includes("/consulta/nivel/#");(window.measurementProbes||=[]).push(result);});})();';
      command('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(probe).toString('base64')},message.sessionId).catch(()=>{});
    }
  }
});
const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Chromium timed out: '+method));},10000);
  pending.set(id,{resolve,reject,timer});browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
});
const evaluate=async(session,expression)=>{
  const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.text+': '+result.exceptionDetails.exception?.description);
  return result.result.value;
};
async function until(fn,label){const limit=Date.now()+8000;while(Date.now()<limit){try{const result=await fn();if(result)return result;}catch{}await new Promise(resolve=>setTimeout(resolve,30));}throw new Error('Timed out: '+label);}
async function page(url,browserContextId){const {targetId}=await command('Target.createTarget',{url,...(browserContextId?{browserContextId}:{})});const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});return{targetId,sessionId};}
async function fill(session,email,measurement=false){return evaluate(session,`(()=>{const f=document.querySelector('#inquiry');for(const [name,value]of Object.entries({name:'TEST SYNTHETIC',email:${JSON.stringify(email)},course:'A1',experience:'Desde cero'}))f.elements[name].value=value;f.elements.privacy.checked=true;f.elements.analytics.checked=f.elements.marketing.checked=${measurement};const valid=f.reportValidity();f.requestSubmit();return valid;})()`);}
async function click(session,selector,button='left') {
  const point=await evaluate(session,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView();const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button,clickCount:1},session);
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button,clickCount:1},session);
}
try {
  const first=await page(origin+'/consulta/');
  await command('Fetch.enable',{patterns:[{urlPattern:'https://*',requestStage:'Request'}]},first.sessionId);
  await until(()=>evaluate(first.sessionId,"document.readyState==='complete'&&!!document.querySelector('#inquiry')"),'form ready');
  assert.equal(await fill(first.sessionId,'a@b'),true,'Exercise real HTML email validation before server rejection');
  await until(()=>evaluate(first.sessionId,"document.querySelector('#status').textContent.includes('No se guardó')"),'definitive rejection');
  await fill(first.sessionId,'first@example.invalid',true);
  await until(()=>evaluate(first.sessionId,"!document.querySelector('#placement-pilot').hidden"),'corrected inquiry accepted');
  const firstUrl=await evaluate(first.sessionId,"document.querySelector('#placement-link').href");
  const probes=await until(()=>evaluate(first.sessionId,'window.measurementProbes?.length===2&&window.measurementProbes'),'both measurement scripts probed');
  for(const probe of probes)assert.deepEqual(probe,{domHasToken:false,cookieHasToken:false,status:403,responseHasToken:false},'Scripts loaded at the real GA/Meta insertion points must not obtain capabilities');
  const second=await page(origin+'/consulta/');
  await until(()=>evaluate(second.sessionId,"document.readyState==='complete'&&!!document.querySelector('#inquiry')"),'second form ready');
  await fill(second.sessionId,'second@example.invalid');
  await until(()=>evaluate(second.sessionId,"!document.querySelector('#placement-pilot').hidden"),'second inquiry accepted');
  const secondUrl=await evaluate(second.sessionId,"document.querySelector('#placement-link').href");
  assert.notEqual(firstUrl,secondUrl);
  const cookies=(await command('Network.getCookies',{urls:[origin+'/api/placement-access']},first.sessionId)).cookies;
  assert.equal(cookies.filter(cookie=>cookie.name.startsWith('__Secure-vive-placement-')).length,2);
  assert.ok(cookies.every(cookie=>cookie.httpOnly&&cookie.secure&&cookie.sameSite==='Strict'&&cookie.path==='/api/placement-access'));
  assert.equal(await evaluate(first.sessionId,"document.cookie.includes('vive-placement')"),false);
  assert.equal(await evaluate(first.sessionId,"document.body.innerHTML.includes('/consulta/nivel/#')"),false);
  const denied=await evaluate(first.sessionId,`fetch(${JSON.stringify(firstUrl)}).then(async r=>({status:r.status,body:await r.text()}))`);
  assert.equal(denied.status,403);assert.equal(denied.body.includes('/consulta/nivel/#'),false);
  assert.equal(await evaluate(first.sessionId,'localStorage.length+sessionStorage.length'),0,'No capability is stored in browser-readable storage');

  const opened=new Set();
  async function destination() {
    const info=await until(async()=>{const {targetInfos}=await command('Target.getTargets');return targetInfos.find(target=>target.url===origin+'/consulta/nivel/'&&!opened.has(target.targetId));},'native new-tab destination');
    opened.add(info.targetId);
    const {sessionId}=await command('Target.attachToTarget',{targetId:info.targetId,flatten:true});
    const token=await until(()=>evaluate(sessionId,'token'),'destination fragment');
    assert.equal(await evaluate(sessionId,'opener===null'),true);
    return verifyToken(token,secret).id;
  }
  await click(first.sessionId,'#placement-link','middle');
  assert.equal(await destination(),new URL(firstUrl).searchParams.get('inquiryId'),'Middle click preserves the first inquiry association');
  await click(second.sessionId,'#placement-link','middle');
  assert.equal(await destination(),new URL(secondUrl).searchParams.get('inquiryId'),'A second inquiry tab retains its own association');

  await evaluate(first.sessionId,`(()=>{const b=document.createElement('button');b.id='attack-popup';b.textContent='TEST';b.onclick=()=>{window.attackWindow=window.open(${JSON.stringify(firstUrl)},'vive-attack-test');};document.body.append(b);})()`);
  await click(first.sessionId,'#attack-popup');
  assert.equal(await destination(),new URL(firstUrl).searchParams.get('inquiryId'));
  assert.equal(await evaluate(first.sessionId,'window.attackWindow.closed'),true,'COOP must sever an opener retained by same-origin script after a genuine user click');
  const probe=await evaluate(first.sessionId,'(()=>{try{return window.attackWindow.location.href;}catch{return "unreadable";}})()');
  assert.equal(probe,'unreadable','The opener must never recover the token through popup.location');

  // A personal fragment link is portable across browsers; the technical cookie URL is not.
  const {browserContextId}=await command('Target.createBrowserContext',{disposeOnDetach:true});
  const fresh=await page(origin+'/consulta/nivel/',browserContextId);
  const freshCookies=()=>command('Network.getCookies',{urls:[origin+'/api/placement-access']},fresh.sessionId);
  assert.equal((await freshCookies()).cookies.length,0,'The portable-link test must start without cookies');
  await until(()=>evaluate(fresh.sessionId,"document.readyState==='complete'&&!!document.querySelector('#beginner')"),'real generic placement frontend');
  await click(fresh.sessionId,'#beginner');
  assert.equal(await evaluate(fresh.sessionId,"document.querySelector('#submit-area').hidden"),true,'Generic preview must not expose submission');
  await evaluate(fresh.sessionId,"document.querySelector('#consent').checked=true;document.querySelector('#send').click()");
  assert.equal(placements.length,0,'Even a programmatic click must not submit a generic preview');
  assert.equal(requests.filter(req=>req.path==='/api/placement').length,0);

  await command('Page.navigate',{url:firstUrl},fresh.sessionId);
  await until(()=>evaluate(fresh.sessionId,"document.querySelector('h1')?.textContent==='No se pudo abrir la prueba'"),'cookie access denied in fresh context');
  assert.equal(requests.filter(req=>req.path==='/api/placement-access').at(-1).status,401,'A real navigation without its inquiry cookie must fail authentication');
  assert.equal(await evaluate(fresh.sessionId,"document.body.innerHTML.includes('/consulta/nivel/#')"),false,'A new browser must not recover a capability from the cookie URL');
  assert.equal((await freshCookies()).cookies.length,0);

  const inquiryId=new URL(firstUrl).searchParams.get('inquiryId');
  const personalToken=issueToken(inquiryId,true,secret);
  const checksBeforePersonal=requests.filter(req=>req.path==='/api/placement-access-check').length;
  const externalOrigin='http://127.0.0.1:'+server.address().port;
  const externalNavigation=await command('Page.navigate',{url:externalOrigin+'/external-app'},fresh.sessionId);
  assert.equal(externalNavigation.errorText,undefined,'The synthetic external app must load entirely on loopback');
  await until(()=>evaluate(fresh.sessionId,"!!document.querySelector('#external-link')"),'synthetic external app');
  await evaluate(fresh.sessionId,`document.querySelector('#external-link').href=${JSON.stringify(origin+'/consulta/nivel/#'+personalToken)}`);
  await click(fresh.sessionId,'#external-link');
  await until(()=>evaluate(fresh.sessionId,"document.readyState==='complete'&&typeof token==='string'&&!!document.querySelector('#beginner')"),'personal link in real placement frontend');
  assert.equal(await evaluate(fresh.sessionId,'token'),personalToken);
  assert.equal(await evaluate(fresh.sessionId,'location.hash'),'','The frontend must remove the capability from the address bar');
  assert.equal(await evaluate(fresh.sessionId,"document.body.innerHTML.includes("+JSON.stringify(personalToken)+")"),false,'The personal capability must not appear in rendered frontend content');
  assert.equal((await freshCookies()).cookies.length,0,'Personal links must work independently of inquiry cookies');
  assert.ok(requests.some(req=>req.path==='/consulta/nivel/'&&req.site==='cross-site'),'Exercise an actual cross-site app-to-placement navigation');
  await until(()=>evaluate(fresh.sessionId,"!document.querySelector('#submit-area').hidden"),'server-confirmed personal access');
  const accessChecks=requests.filter(req=>req.path==='/api/placement-access-check');
  assert.ok(accessChecks.length>checksBeforePersonal,'Opening personal access must perform the server-side preflight');
  assert.equal(accessChecks.at(-1).method,'POST');
  assert.equal(accessChecks.at(-1).status,200);
  await click(fresh.sessionId,'#beginner');
  assert.equal(await evaluate(fresh.sessionId,"document.querySelector('#submit-area').hidden"),false);
  await click(fresh.sessionId,'#consent');
  await click(fresh.sessionId,'#send');
  await until(()=>evaluate(fresh.sessionId,"document.querySelector('#send').textContent==='Gespeichert'"),'real placement API confirmed synthetic storage');
  assert.equal(placements.length,1);
  assert.equal(placements[0].inquiryId,inquiryId,'Portable personal access must preserve the inquiry association');
  assert.equal(placements[0].path,'beginner');
  assert.equal(placements[0].test,true,'This synthetic acceptance must remain marked TEST');
  assert.ok(placements[0].answers.every(block=>block.every(answer=>answer===null)));
  assert.deepEqual(placements[0].writing,['','','']);
  assert.equal('token' in placements[0],false,'The persistence envelope must not contain the signed capability');
  assert.equal(await evaluate(fresh.sessionId,"document.querySelector('#send').disabled"),true);
  assert.equal((await freshCookies()).cookies.length,0);

  const nojs=await page('about:blank');
  await command('Emulation.setScriptExecutionDisabled',{value:true},nojs.sessionId);
  await command('Page.navigate',{url:origin+'/consulta/'},nojs.sessionId);
  await until(async()=>{
    const {root}=await command('DOM.getDocument',{},nojs.sessionId);
    const {nodeId}=await command('DOM.querySelector',{nodeId:root.nodeId,selector:'#inquiry'},nojs.sessionId);
    return nodeId;
  },'no-JavaScript form');
  const {root}=await command('DOM.getDocument',{},nojs.sessionId);
  for(const [selector,value]of [['input[name=name]','TEST SYNTHETIC'],['input[name=email]','nojs@example.invalid']]) {
    const {nodeId}=await command('DOM.querySelector',{nodeId:root.nodeId,selector},nojs.sessionId);
    await command('DOM.setAttributeValue',{nodeId,name:'value',value},nojs.sessionId);
  }
  const {nodeId:submit}=await command('DOM.querySelector',{nodeId:root.nodeId,selector:'button[type=submit]'},nojs.sessionId);
  await command('DOM.scrollIntoViewIfNeeded',{nodeId:submit},nojs.sessionId);
  const {model}=await command('DOM.getBoxModel',{nodeId:submit},nojs.sessionId);
  const point={x:(model.border[0]+model.border[2])/2,y:(model.border[1]+model.border[5])/2};
  await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},nojs.sessionId);
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1},nojs.sessionId);
  await until(async()=>{const {targetInfos}=await command('Target.getTargets');return targetInfos.some(target=>target.targetId===nojs.targetId&&target.url===origin+'/api/inquiry');},'native POST without query parameters');
  const nativeRequest=requests.filter(req=>req.path==='/api/inquiry').at(-1);
  assert.equal(nativeRequest.method,'POST');assert.equal(nativeRequest.hasQuery,false);
  const {root:rejectionRoot}=await command('DOM.getDocument',{},nojs.sessionId);
  const {outerHTML}=await command('DOM.getOuterHTML',{nodeId:rejectionRoot.nodeId},nojs.sessionId);
  assert.match(outerHTML,/storageAttempted[^a-z]+false/,'No-script native POST is safely rejected before storage');
  assert.ok(requests.some(req=>req.path==='/api/placement-access'&&req.mode==='navigate'&&req.destination==='document'));
  assert.ok(requests.every(req=>req.path.startsWith('/')));
  console.log('PLACEMENT_ACCESS_BROWSER=PASS: real inquiry/placement frontends and APIs; validation/correction, HttpOnly cookies, GA/Meta probes denied, middle-click, two inquiries, COOP popup isolation, cookie-free external personal link with inquiry-bound TEST storage, generic preview blocked, fresh-browser cookie URL denied, no-JavaScript POST without PII URL');
} finally {
  try{await command('Browser.close');}catch{}
  browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('Browser closed'));}pending.clear();
  await new Promise(resolve=>browser.exitCode!==null?resolve():browser.once('exit',resolve));
  rmSync(profile,{recursive:true,force:true});
}
