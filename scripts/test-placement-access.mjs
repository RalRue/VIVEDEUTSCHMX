import assert from 'node:assert/strict';
import {createHandler as inquiryHandler} from '../api/inquiry.mjs';
import {createHandler,placementCookieName} from '../api/placement-access.mjs';
import {issueToken,verifyToken} from '../api/_placement.mjs';

const id='ca30b8bc-743b-44f9-bae8-a5296ab89c9b',otherId='b7c0df76-ed93-41a7-ae44-782647999104';
const secret='s'.repeat(64),now=1000;
const env={VIVE_INQUIRY_ENABLED:'true',VIVE_INQUIRY_MODE:'live',VIVE_PLACEMENT_ENABLED:'true',
  VIVE_INQUIRY_RECEIVER_URL:'https://script.google.com/macros/s/test/exec',VIVE_INQUIRY_SECRET:secret};
const record=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return v;},send(v){this.body=v;return v;}});
async function inquire(id,overrides={}) {
  const res=record();
  await inquiryHandler({env:{...env,...overrides},now:()=>now,send:async()=>({ok:true,json:async()=>({ok:true,stored:true,id})})})({method:'POST',headers:{origin:'https://vive-deutsch-mx.vercel.app','content-type':'application/json'},body:{id,name:'TEST',email:'test@example.invalid',course:'A1',experience:'Desde cero',goal:'',schedule:'',website:'',privacy:true,analytics:false,marketing:false}},res);
  assert.equal(res.code,200);
  return res;
}
const first=await inquire(id),second=await inquire(otherId);
for(const [res,inquiryId] of [[first,id],[second,otherId]]) {
  assert.equal(res.body.placementAccessUrl,'/api/placement-access?inquiryId='+inquiryId);
  assert.equal(res.body.placementToken,undefined,'The JSON response must contain no capability');
  assert.match(res.headers['Set-Cookie'],/; Max-Age=86400; Path=\/api\/placement-access; Secure; HttpOnly; SameSite=Strict$/);
  const token=res.headers['Set-Cookie'].split(';')[0].split('=')[1];
  assert.equal(verifyToken(token,secret,now).id,inquiryId);
  assert.equal(JSON.stringify(res.body).includes(token),false);
}
assert.notEqual(first.headers['Set-Cookie'].split('=')[0],second.headers['Set-Cookie'].split('=')[0],
  'Separate inquiries need separate cookies, including simultaneous tabs');
const preview=await inquire(id,{VERCEL_ENV:'preview'});
assert.equal(verifyToken(preview.headers['Set-Cookie'].split(';')[0].split('=')[1],secret,now).test,true);

const navigation={host:'vive-deutsch-mx.vercel.app','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-site':'same-origin'};
const cookies=[first,second].map(res=>res.headers['Set-Cookie'].split(';')[0]).join('; ');
async function access({query='inquiryId='+id,headers={},method='GET',time=now,config={}}={}) {
  const res=record();
  await createHandler({env:{...env,...config},now:()=>time})({method,url:'/api/placement-access?'+query,headers:{...navigation,cookie:cookies,...headers}},res);
  return res;
}
for(const inquiryId of [id,otherId]) {
  const res=await access({query:'inquiryId='+inquiryId});
  assert.equal(res.code,200);
  assert.equal(res.headers['Cache-Control'],'no-store');
  assert.equal(res.headers['Cross-Origin-Opener-Policy'],'same-origin');
  assert.match(res.headers['Content-Security-Policy'],/default-src 'none'; script-src 'nonce-[^']+'; base-uri 'none'; frame-ancestors 'none'/);
  assert.equal(res.headers['Referrer-Policy'],'no-referrer');
  assert.equal(res.headers.Location,undefined,'COOP must commit a document before exposing the fragment');
  const token=res.body.match(/href="\/consulta\/nivel\/#([^"]+)"/)[1];
  assert.equal(verifyToken(token,secret,now).id,inquiryId);
}
for(const headers of [
  {'sec-fetch-mode':'cors','sec-fetch-dest':'empty'},
  {'sec-fetch-mode':'same-origin','sec-fetch-dest':'empty'},
  {'sec-fetch-dest':'iframe'},
  {'sec-fetch-site':'cross-site'},
  {'sec-fetch-site':'same-site'},
  {'sec-fetch-mode':undefined},
  {host:'unapproved.example'}
]) {
  const res=await access({headers});
  assert.equal(res.code,403);
  assert.equal(res.body.includes('/consulta/nivel/#'),false,'Rejected requests must reveal no capability');
}
for(const headers of [{cookie:''},{cookie:placementCookieName(id)+'=broken'},
  {cookie:placementCookieName(id)+'='+issueToken(otherId,false,secret,now)},
  {cookie:first.headers['Set-Cookie'].split(';')[0]+'; '+first.headers['Set-Cookie'].split(';')[0]}]) {
  const res=await access({headers});
  assert.equal(res.code,401);
  assert.match(res.body,/ralph_stoecker@live.com/);
  assert.equal(res.body.includes('/consulta/nivel/#'),false);
}
assert.equal((await access({time:now+86400000})).code,401);
assert.equal((await access({query:'inquiryId='+id+'&inquiryId='+otherId})).code,400);
assert.equal((await access({query:'inquiryId=bad'})).code,400);
assert.equal((await access({method:'POST'})).code,405);
assert.equal((await access({config:{VIVE_PLACEMENT_ENABLED:'false'}})).code,503);
assert.equal((await access({headers:{host:'preview.vercel.app'},config:{VERCEL_ENV:'preview',VERCEL_URL:'preview.vercel.app'}})).code,200);
assert.equal((await access({headers:{host:'preview.vercel.app'},config:{VERCEL_ENV:'production',VERCEL_URL:'preview.vercel.app'}})).code,403);
assert.equal((await access({headers:{'sec-fetch-site':'none'}})).code,200,'Native no-referrer/new-tab navigation is supported');
console.log('PLACEMENT_ACCESS=PASS: HttpOnly per-inquiry cookies, token-free JSON, navigation-only COOP handoff, origin/mode/expiry/binding rejection');
