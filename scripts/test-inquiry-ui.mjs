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
const context = vm.createContext({
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
