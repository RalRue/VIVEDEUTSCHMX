const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function mockScores(body){return body.path==='beginner'?[]:body.answers.map((values,b)=>{const count=indexes=>({total:indexes.length,correct:0,answered:indexes.filter(i=>Number.isInteger(values[i])&&values[i]>=0&&values[i]<3).length});const answered=count([0,1,2,3]).answered;return {block:b+1,total:4,correct:0,answered,wrong:answered,unknown:values.filter(v=>v===3).length,unanswered:values.filter(v=>v===null).length,reading:count([0,1]),grammar:count([2]),vocabulary:count([3])};});}
function setup(hash='#abc.'+'a'.repeat(64)){
 const elements=new Map(),events={},sent=[],blobs=[];let mode='lost',calls=0,release;const pending=[];
 function element(){return {hidden:false,disabled:false,value:'',checked:false,textContent:'',children:[],setAttribute(){},append(...c){this.children.push(...c);},replaceChildren(){this.children=[];},focus(){},click(){}};}
 const find=(n,id)=>n.id===id?n:n.children?.map(c=>typeof c==='object'?find(c,id):null).find(Boolean);
 const get=id=>{for(const n of elements.values()){const live=find(n,id);if(live)return live;}if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const location={hash,pathname:'/consulta/nivel/'};
 const context=vm.createContext({document:{getElementById:get,createElement:element,createTextNode:s=>s,querySelector:name=>selected[name]||null},location,history:{replaceState(){location.hash='';}},crypto:{randomUUID:()=> 'ba30b8bc-743b-44f9-bae8-a5296ab89c9b'},window:{addEventListener:(name,f)=>events[name]=f},AbortSignal,URL:{createObjectURL:b=>{blobs.push(b);return 'blob:synthetic';},revokeObjectURL(){}},Blob,setTimeout:fn=>fn(),fetch:async(url,opts)=>{calls++;sent.push(opts.body);if(mode==='lost')throw Error('lost');
 if(mode==='pending')await new Promise(resolve=>pending.push(resolve));
 return {ok:!['expired','conflict'].includes(mode),status:mode==='expired'?401:mode==='conflict'?409:200,json:async()=>({ok:true,stored:true,id:JSON.parse(opts.body).id,version:mode==='wrong-version'?'future':'draft-2026-09-30-v2-1',test:true,reading:mode==='bad-profile'?[]:mockScores(JSON.parse(opts.body))})};}});
 const selected={};for(const file of ['questions.js','nivel.js'])vm.runInContext(fs.readFileSync(__dirname+'/../consulta/nivel/'+file,'utf8'),context);
 return {context,get,events,sent,blobs,location,selected,run:code=>vm.runInContext(code,context),calls:()=>calls,mode:v=>mode=v,release:()=>pending.splice(0).forEach(fn=>fn())};
}
(async()=>{
 const ui=setup(),{get,run}=ui;assert.equal(ui.location.hash,'');
 const unload=()=>{let prevented=false;ui.events.beforeunload({preventDefault(){prevented=true;}});return prevented;};
 assert.equal(unload(),false);get('start').onclick();get('test').onsubmit({preventDefault(){}});assert.equal(unload(),false,'Visited empty block must not warn');
 await get('send').onclick();assert.equal(ui.calls(),0,'Consent required');get('consent').checked=true;await get('send').onclick();assert.equal(ui.calls(),0,'Blank not sent');
 run('answers.forEach(a=>a.fill(3))');await get('send').onclick();assert.equal(ui.calls(),0,'Unknown-only not sent');
 run("writingTask=0;writing[0]='<img src=x onerror=alert(1)>';review()");
 assert.equal(get('scores').children.length,0,'No score before sending');assert.equal(get('review').children.some(n=>n.textContent==='<img src=x onerror=alert(1)>'),true,'Writing rendered as text');
 const edits=get('review').children.filter(n=>n.textContent?.endsWith('ändern'));assert.equal(edits.length,4);edits[0].onclick();assert.equal(run('step'),0);assert.equal(get('test').hidden,false,'Edit before initial send');
 run('review()');await get('send').onclick();assert.equal(ui.calls(),1);assert.equal(get('send').disabled,false);
 assert.equal(get('review').children.filter(n=>n.textContent?.endsWith('ändern')).every(n=>n.disabled),true);
 run("writing[0]='Changed'");await get('send').onclick();assert.equal(ui.calls(),1,'Changed uncertain retry blocked');
 run("writing[0]='<img src=x onerror=alert(1)>'");ui.mode('ok');await get('send').onclick();assert.equal(ui.calls(),2);assert.equal(ui.sent[0],ui.sent[1]);assert.equal(get('send').disabled,true);assert.equal(unload(),false);
 await get('send').onclick();assert.equal(ui.calls(),2,'Stored lock');get('download').onclick();const report=await ui.blobs[0].text();assert.equal(report.includes('abc.'),false);assert.equal(report.includes('token'),false);
 const beginner=setup();beginner.get('beginner').onclick();assert.equal(beginner.run('path'),'beginner');assert.equal(beginner.get('test').hidden,true);assert.equal(beginner.get('scores').children.length,0);beginner.get('consent').checked=true;beginner.mode('ok');await beginner.get('send').onclick();assert.equal(JSON.parse(beginner.sent[0]).writingTask,null);assert.equal(beginner.get('scores').children.length,0);
 const preview=setup('');preview.get('consent').checked=true;preview.run("writingTask=0;writing[0]='Hallo'");await preview.get('send').onclick();assert.equal(preview.calls(),0,'Preview never sends');
 const reload=setup('');assert.equal(reload.run('token'),null);assert.equal(reload.run('hasLanguageEvidence()'),false,'No invented recovery');
 const double=setup();double.get('consent').checked=true;double.run("writingTask=0;writing[0]='Hallo'");double.mode('pending');
 const first=double.get('send').onclick();await double.get('send').onclick();assert.equal(double.calls(),1,'Double-click must submit once');double.mode('ok');double.release();await first;
 for(const mode of ['expired','conflict']){const fail=setup();fail.get('consent').checked=true;fail.run("writingTask=0;writing[0]='Hallo'");fail.mode(mode);await fail.get('send').onclick();assert.equal(fail.run('stored'),false);assert.equal(fail.get('send').disabled,true);await fail.get('send').onclick();assert.equal(fail.calls(),1);}
 const wrongVersion=setup();wrongVersion.get('consent').checked=true;wrongVersion.run("writingTask=0;writing[0]='Hallo'");wrongVersion.mode('wrong-version');await wrongVersion.get('send').onclick();assert.equal(wrongVersion.run('stored'),false);
 const badProfile=setup();badProfile.get('consent').checked=true;badProfile.run("writingTask=0;writing[0]='Hallo'");badProfile.mode('bad-profile');await badProfile.get('send').onclick();assert.equal(badProfile.run('stored'),false,'Missing server profile cannot confirm success');
 const choice=setup();choice.run("step=3;writingTask=0;writing[0]='Hallo';render()");choice.get('writing-choice').value='1';choice.get('writing-choice').onchange();assert.equal(choice.run('writingTask'),1);assert.equal(choice.run("writing.every(v=>v==='')"),true,'Only selected sample retained');
 console.log('PLACEMENT UI 2.1 PASS: consent, blank/unknown, edit/review, text escaping, no early scores, uncertain/exact retry, stored lock, beginner, preview no send, reload loss, token-free download, single writing sample, empty-page unload');
})().catch(e=>{console.error(e);process.exitCode=1;});
