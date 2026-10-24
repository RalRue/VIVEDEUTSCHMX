import '../attribution.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validate} from '../api/inquiry.mjs';

const inquiryHtml = readFileSync(new URL('../consulta/index.html', import.meta.url), 'utf8');
const courseMarkup = inquiryHtml.match(/<select\b[^>]*\bname="course"[^>]*>([\s\S]*?)<\/select>/)[0];
const courseOptions = [...courseMarkup.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)]
  .map(([, attributes, label]) => attributes.match(/\bvalue="([^"]*)"/)?.[1] ?? label);
assert.deepEqual(courseOptions, ['', 'A1', 'A2', 'B1', 'No lo sé']);
assert.doesNotMatch(courseMarkup, /\b(?:hidden|disabled)\b/, 'Course must remain a visible editable select');
function courseElements(fields) {
  const control = {get value(){return fields.get('course');}, set value(value){fields.set('course', courseOptions.includes(value) ? value : '');}};
  return {namedItem:name=>name === 'course' ? control : null};
}

const source = readFileSync(new URL('../consulta/inquiry.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/, '');
const fields = new Map(Object.entries({name:'TEST', email:'first@example.invalid', course:'A1',
  experience:'Desde cero', goal:'', schedule:'', website:'', privacy:'on'}));
let submit, requests = [], removed = false, successful = false, measurements = 0;
const button = {}, status = {}, success = {hidden:true, focus(){}};
const form = {querySelector:()=>button, reportValidity:()=>true, addEventListener:(name,fn)=>{submit=fn;},
  elements:courseElements(fields), reset(){}, remove(){removed=true;}};
const context = vm.createContext({viveValidPrivateAttribution: globalThis.viveValidPrivateAttribution,
  document:{querySelector:s=>({'#inquiry':form,'#status':status,'#success':success})[s],body:{dataset:{}}},
  crypto:{randomUUID:()=> 'ca30b8bc-743b-44f9-bae8-a5296ab89c9b'},
  FormData:class {get(k){return fields.get(k) ?? null;} has(k){return fields.has(k);}},
  location:{search:''},history:{replaceState(){}},AbortSignal,URLSearchParams,
  safeAttribution:()=>new URLSearchParams(),sendMeasurement:()=>{measurements++;},
  fetch:async(url,options)=>{
    requests.push(JSON.parse(options.body));
    if(!successful) throw new Error('Response lost after storage');
    return {ok:true,json:async()=>({ok:true,stored:true,id:requests.at(-1).id,duplicate:true,test:true})};
  }
});
vm.runInContext(source,context);
await submit({preventDefault(){}});
assert.equal(requests.length,1);
assert.equal(button.disabled,false);
assert.equal(removed,false);
fields.set('email','corrected@example.invalid');
await submit({preventDefault(){}});
assert.equal(requests.length,1,'Changed retry must not silently acknowledge old stored data');
assert.match(status.textContent,/cambios no se han enviado/);
assert.equal(removed,false);
assert.equal(measurements,0);
fields.set('email','first@example.invalid');
successful=true;
await submit({preventDefault(){}});
assert.equal(requests.length,2);
assert.deepEqual(requests[0],requests[1],'Exact retry must retain ID and body');
assert.equal(removed,true);
assert.equal(success.hidden,false);
console.log('INQUIRY_UI=PASS: uncertain submission, changed retry blocked, exact retry accepted');

function rejectedFlow(replies, search = '', initialCourse = 'A1') {
  const fields = new Map(Object.entries({name:'TEST',email:'synthetic@example.invalid',course:initialCourse,experience:'Desde cero',goal:'',schedule:'',website:'',privacy:'on'}));
  let submit;
  const requests=[],status={},button={},success={hidden:true,focus(){}},link={},pilot={hidden:true};
  const form={querySelector:()=>button,elements:courseElements(fields),reportValidity:()=>true,addEventListener:(name,fn)=>{submit=fn;},reset(){},remove(){}};
  const context=vm.createContext({viveValidPrivateAttribution: globalThis.viveValidPrivateAttribution,
    document:{querySelector:s=>({'#inquiry':form,'#status':status,'#success':success,'#placement-link':link,'#placement-pilot':pilot})[s],body:{dataset:{}}},
    crypto:{randomUUID:()=> 'ca30b8bc-743b-44f9-bae8-a5296ab89c9b'},
    FormData:class {get(k){return fields.get(k)??null;} has(k){return fields.has(k);}},
    location:{search},history:{replaceState(){}},AbortSignal,URLSearchParams,
    safeAttribution:()=>new URLSearchParams(),sendMeasurement(){},
    fetch:async(url,options)=>{
      requests.push(JSON.parse(options.body));
      const reply=replies.shift();
      if(reply instanceof Error)throw reply;
      return reply;
    }
  });
  vm.runInContext(source,context);
  return {fields,course:form.elements.namedItem('course'),requests,status,button,success,link,pilot,submit:()=>submit({preventDefault(){}})};
}
const rejection={ok:false,status:400,json:async()=>({ok:false,storageAttempted:false})};
const accepted={ok:true,status:200,json:async()=>({ok:true,stored:true,id:'ca30b8bc-743b-44f9-bae8-a5296ab89c9b',test:true})};
const corrected=rejectedFlow([rejection,accepted]);
await corrected.submit();
assert.match(corrected.status.textContent,/No se guardó/);
corrected.fields.set('email','corrected@example.invalid');
await corrected.submit();
assert.equal(corrected.requests.length,2,'Definitive validation rejection must allow corrected data');
assert.equal(corrected.success.hidden,false);

const earlierUncertain=rejectedFlow([new Error('Response lost'),rejection]);
await earlierUncertain.submit();
await earlierUncertain.submit();
earlierUncertain.fields.set('email','corrected@example.invalid');
await earlierUncertain.submit();
assert.equal(earlierUncertain.requests.length,2,'A later rejection cannot unlock an earlier uncertain attempt');
assert.match(earlierUncertain.status.textContent,/cambios no se han enviado/);

const ambiguousRejection=rejectedFlow([{ok:false,status:400,json:async()=>({ok:false})}]);
await ambiguousRejection.submit();
ambiguousRejection.fields.set('email','corrected@example.invalid');
await ambiguousRejection.submit();
assert.equal(ambiguousRejection.requests.length,1,'Status alone must not unlock changed retries');
console.log('INQUIRY_UI_REJECTIONS=PASS: corrected definitive rejection, earlier uncertainty retained, explicit contract required');

const accessUrl='/api/placement-access?inquiryId=ca30b8bc-743b-44f9-bae8-a5296ab89c9b';
const placement=rejectedFlow([{ok:true,status:200,json:async()=>({...await accepted.json(),placementAccessUrl:accessUrl})}]);
await placement.submit();
assert.equal(placement.pilot.hidden,false);
assert.equal(placement.link.href,accessUrl,'Native links, including new tabs, use the cookie-protected navigation endpoint');
assert.equal(placement.link.onclick,undefined,'No primary-click-only token handoff');
assert.equal(placement.link.rel,'noopener noreferrer');
const injected=rejectedFlow([{ok:true,status:200,json:async()=>({...await accepted.json(),placementAccessUrl:'https://unapproved.example/access',placementToken:'ignored'})}]);
await injected.submit();
assert.equal(injected.pilot.hidden,true,'Only the exact access URL bound to this inquiry may be shown');
console.log('INQUIRY_UI_ACCESS=PASS: native token-free link, exact inquiry association and no legacy token fallback');

const homeSource = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const homeAttribution = readFileSync(new URL('../attribution.js', import.meta.url), 'utf8');
function groupQuery(level) {
  const link = {dataset:{level},href:''};
  const context = vm.createContext({document:{documentElement:{},querySelectorAll:s=>s === '.group-inquiry-link' ? [link] : []},
    URL,URLSearchParams,window:{location:new URL('https://vive-deutsch-mx.vercel.app/?token=private&course=B1')},
    localStorage:{getItem:()=>null,setItem(){}},translations:{es:{},en:{},de:{}}});
  vm.runInContext(homeAttribution,context);
  vm.runInContext(homeSource.slice(0,homeSource.indexOf('// ===== LIGHTWEIGHT GA4 CLICK TRACKING =====')),context);
  return new URL(link.href).search;
}
for (const level of ['A1','A2','B1']) {
  const flow = rejectedFlow([accepted], groupQuery(level), '');
  assert.equal(flow.course.value,level,'Group CTA must preselect the existing visible course control');
  assert.equal(flow.requests.length,0,'Preselection must never submit automatically');
  await flow.submit();
  assert.equal(flow.requests[0].course,level);
  assert.equal(validate(flow.requests[0]).course,level,'Submitted interest must pass the existing server validator');
  assert.equal(flow.fields.get('experience'),'Desde cero','Course interest must not assign experience or a placement result');
}
const neutralQueries = ['', '?course=', '?course=A0', '?course=B2', '?course=C1', '?course=a1', '?course=%20A1',
  '?course=A1%20', '?course=No%20lo%20s%C3%A9', '?course=A1&course=A2', '?course=A1&course=A1',
  '?course=&course=A1', '?course=A1&course=', '?course=A1%2CA2', '?course=__proto__', '?Course=A1',
  '?course=%3Cscript%3E', '?course=A1%00', '?%63ourse=A1&course=B1', '?inquiryId=private&token=private'];
for (const query of neutralQueries) {
  const flow = rejectedFlow([],query,'');
  assert.equal(flow.course.value,'',`Missing, invalid or ambiguous course must keep Selecciona: ${query}`);
  assert.equal(flow.requests.length,0);
}
for (const course of ['B1','No lo sé']) {
  const flow = rejectedFlow([accepted], '?course=A2', '');
  flow.course.value = course;
  await flow.submit();
  assert.equal(flow.requests[0].course,course,'The editable selection must override the initial query');
  assert.equal(validate(flow.requests[0]).course,course);
}
const courseRetry = rejectedFlow([new Error('Response lost'),accepted], '?course=A2', '');
await courseRetry.submit();
courseRetry.course.value = 'B1';
await courseRetry.submit();
assert.equal(courseRetry.requests.length,1,'Changing course after an uncertain send must not create a second inquiry');
assert.match(courseRetry.status.textContent,/cambios no se han enviado/);
courseRetry.course.value = 'A2';
await courseRetry.submit();
assert.equal(courseRetry.requests.length,2);
assert.deepEqual(courseRetry.requests[0],courseRetry.requests[1]);
console.log(`INQUIRY_COURSE_PREFILL=PASS: 3 real CTA-to-form-to-validator paths, ${neutralQueries.length} neutral/invalid/duplicate queries, manual changes including No lo sé, no automatic submission and exact retry`);
