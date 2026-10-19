import '../attribution.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../consulta/inquiry.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/, '');
const fields = new Map(Object.entries({name:'TEST', email:'first@example.invalid', course:'A1',
  experience:'Desde cero', goal:'', schedule:'', website:'', privacy:'on'}));
let submit, requests = [], removed = false, successful = false, measurements = 0;
const button = {}, status = {}, success = {hidden:true, focus(){}};
const form = {querySelector:()=>button, reportValidity:()=>true, addEventListener:(name,fn)=>{submit=fn;},
  reset(){}, remove(){removed=true;}};
const context = vm.createContext({viveValidPrivateAttribution: globalThis.viveValidPrivateAttribution,
  document:{querySelector:s=>({'#inquiry':form,'#status':status,'#success':success})[s],body:{dataset:{}}},
  crypto:{randomUUID:()=> 'ca30b8bc-743b-44f9-bae8-a5296ab89c9b'},
  FormData:class {get(k){return fields.get(k) ?? null;} has(k){return fields.has(k);}},
  location:{search:''},history:{replaceState(){}},AbortSignal,
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

function rejectedFlow(replies) {
  const fields = new Map(Object.entries({name:'TEST',email:'a@b',course:'A1',experience:'Desde cero',goal:'',schedule:'',website:'',privacy:'on'}));
  let submit;
  const requests=[],status={},button={},success={hidden:true,focus(){}},link={},pilot={hidden:true};
  const form={querySelector:()=>button,reportValidity:()=>true,addEventListener:(name,fn)=>{submit=fn;},reset(){},remove(){}};
  const context=vm.createContext({viveValidPrivateAttribution: globalThis.viveValidPrivateAttribution,
    document:{querySelector:s=>({'#inquiry':form,'#status':status,'#success':success,'#placement-link':link,'#placement-pilot':pilot})[s],body:{dataset:{}}},
    crypto:{randomUUID:()=> 'ca30b8bc-743b-44f9-bae8-a5296ab89c9b'},
    FormData:class {get(k){return fields.get(k)??null;} has(k){return fields.has(k);}},
    location:{search:''},history:{replaceState(){}},AbortSignal,
    safeAttribution:()=>new URLSearchParams(),sendMeasurement(){},
    fetch:async(url,options)=>{
      requests.push(JSON.parse(options.body));
      const reply=replies.shift();
      if(reply instanceof Error)throw reply;
      return reply;
    }
  });
  vm.runInContext(source,context);
  return {fields,requests,status,button,success,link,pilot,submit:()=>submit({preventDefault(){}})};
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
