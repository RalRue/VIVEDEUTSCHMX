import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import {sheetValues,sheetDisplay,sheetWriteMethods} from './synthetic-sheet.cjs';
import {issueToken,verifyToken,readingScores,VERSION,LEGACY_VERSION,KEYS,validatePlacement} from '../api/_placement.mjs';
import {createHandler} from '../api/placement.mjs';
const parent='ca30b8bc-743b-44f9-bae8-a5296ab89c9b',id='ba30b8bc-743b-44f9-bae8-a5296ab89c9b';
const secret='s'.repeat(64),now=Date.now();
const env={VIVE_PLACEMENT_ENABLED:'true',VIVE_INQUIRY_MODE:'test',VIVE_INQUIRY_SECRET:secret,VIVE_INQUIRY_RECEIVER_URL:'https://script.google.com/macros/s/test/exec'};
const token=issueToken(parent,true,secret,now,LEGACY_VERSION);
assert.equal(verifyToken(token,secret,now).id,parent);
assert.equal(verifyToken(token,secret,now+86400001),null);
assert.equal(verifyToken(token+'x',secret,now),null);
assert.equal(verifyToken(token,'z'.repeat(64),now),null);
const body={id,token,version:'pilot-2026-09-29',consent:true,answers:[[1,0,2,1],[2,0,1,2],[2,0,1,0]],writing:['Ich wohne in Bonn.','=IMPORTXML("bad")','Ich würde online lernen.']};
const formats={Website_Anfragen:[],Einstufungen:[]};
const data={Website_Anfragen:[[parent,'','','','','','','','','','','TEST']],Einstufungen:[]};
let mails=0,receiverEnabled=true,formulaColumn=null,aliasPropertyWrites=0;
const aliasProperties={};
function sheet(name){return {getLastRow:()=>data[name].length,getMaxRows:()=>1000,appendRow:r=>data[name].push(r),getRange(row,col=1,numRows=1,numCols=1){return {...sheetWriteMethods(data[name],row,col,numCols,formats[name]),
 getDisplayValue:()=>sheetDisplay(data[name][row-1],col-1,1)[0],getDisplayValues:()=>[sheetDisplay(data[name][row-1],col-1,numCols,formats[name][row-1])],getValues:()=>[sheetValues(data[name][row-1],col-1,numCols)],getFormulas:()=>[Array.from({length:numCols},(_,i)=>i===formulaColumn?'=synthetic_formula':'')],
 createTextFinder(value){return {matchEntireCell(){return this;},findNext(){return this.findAll()[0]||null;},findAll(){const c=row==='B:B'?1:0;return data[name].flatMap((r,i)=>r[c]===value?[{getRow:()=>i+1}]:[]);}};}
 };}};}
const context=vm.createContext({Date,JSON,Number,String,Math,Array,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='VIVE_INQUIRY_SECRET'?secret:k==='VIVE_PLACEMENT_ENABLED'?(receiverEnabled?'true':'false'):(aliasProperties[k]??null),setProperties:values=>{aliasPropertyWrites++;Object.assign(aliasProperties,values);}})},
 SpreadsheetApp:{openById:()=>({getSheetByName:name=>data[name]?sheet(name):null}),flush(){}},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 Utilities:{base64EncodeWebSafe:s=>Buffer.from(s).toString('base64url'),computeHmacSha256Signature:(message,key)=>Array.from(createHmac('sha256',key).update(message).digest())},
 MailApp:{sendEmail(){mails++;}},ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({setMimeType:()=>JSON.parse(value)})}});
vm.runInContext(fs.readFileSync(new URL('../../../outputs/VIVE-DEUTSCH-MX-Projekt/operations/private/inquiry-apps-script/Code.gs',import.meta.url),'utf8'),context);
const transport=async(url,options)=>({ok:true,json:async()=>context.doPost({postData:{contents:options.body}})});
async function call(value=body,overrides={},deps={}){let status,result;await createHandler({env,send:transport,now:()=>now,...deps})({method:'POST',headers:{origin:'https://vive-deutsch-mx.vercel.app','content-type':'application/json'},body:value,...overrides},{setHeader(){},status(v){status=v;return this;},json(v){result=v;}});return {status,result};}
assert.equal((await call()).status,200);
assert.equal(data.Einstufungen.length,1);
assert.equal(data.Einstufungen[0][11].startsWith("'="),true,'Formula injection must be text');
assert.equal((await call()).result.duplicate,true);
assert.equal(data.Einstufungen.length,1);
assert.equal((await call({...body,writing:['changed','','']})).status,409);
assert.equal((await call({...body,id:'da30b8bc-743b-44f9-bae8-a5296ab89c9b'})).status,409);
assert.equal(mails,0,'Placement must never send mail');
assert.deepEqual(readingScores(body.answers).map(s=>s.correct),[4,4,4]);
const client=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../consulta/nivel/questions.js',import.meta.url),'utf8'),client);
assert.equal(vm.runInContext('placement.every(p=>p.questions.every(q=>typeof q[2]==="string"))',client),true,'Public questions contain dimensions, no answer keys');
for(const invalid of [{...body,consent:false},{...body,answers:[]},{...body,answers:[[1,2,4,0],[],[]]},{...body,writing:['x'.repeat(1801),'','']},{...body,score:100},{...body,version:'other'}])assert.equal((await call(invalid)).status,400);
assert.equal((await call({...body,token:'bad'})).status,401);
assert.equal((await call(body,{method:'GET'})).status,405);
assert.equal((await call(body,{headers:{origin:'https://evil.example','content-type':'application/json'}})).status,403);
assert.equal((await call(body,{}, {env:{...env,VIVE_PLACEMENT_ENABLED:'false'}})).status,503);
assert.equal((await call(body,{}, {send:async()=>({ok:true,json:async()=>({ok:true,stored:false,id})})})).status,502);
assert.equal((await call(body,{}, {send:async()=>{throw Error('lost');}})).status,502);
assert.equal(data.Einstufungen.length,1);
console.log('PLACEMENT API + PRIVATE RECEIVER PASS: token, expiry, origin, consent, server keys, storage, readback, exact retry, conflict, formula safety, no mail');

// New contract and original contract must remain independent.
assert.deepEqual(readingScores(KEYS[LEGACY_VERSION],LEGACY_VERSION).map(s=>s.correct),[4,4,4]);
assert.notDeepEqual(readingScores(KEYS[VERSION],LEGACY_VERSION).map(s=>s.correct),[4,4,4]);
assert.throws(()=>readingScores([], 'unknown'));
function freshBody(n,extra={}){
 const suffix=String(n).padStart(12,'0'),parent='ca30b8bc-743b-44f9-bae8-'+suffix,id='ba30b8bc-743b-44f9-bae8-'+suffix;
 data.Website_Anfragen.push([parent,'','','','','','','','','','','TEST']);
 return {id,token:issueToken(parent,true,secret,now,extra.version??VERSION),version:VERSION,consent:true,path:'test',writingTask:0,answers:structuredClone(KEYS[VERSION]),writing:['Hallo, ich heiße Mia. Ich wohne in Bonn. Ich lese gern. Was liest du?','',''],...extra};
}
const modern=freshBody(1);let result=await call(modern);assert.equal(result.status,200);
assert.deepEqual(result.result.reading,readingScores(modern.answers,VERSION));
const newRow=data.Einstufungen.at(-1);assert.deepEqual(JSON.parse(newRow[6]),result.result.reading[0]);assert.equal(newRow[13],'pending_teacher_review');
assert.equal((await call(modern)).result.duplicate,true);
// Teacher judgments are mutable; retries compare the immutable submission only.
newRow[13]='teacher_reviewed: A2 writing';newRow[14]='teacher_reviewed: listening';newRow[15]='teacher_reviewed: speaking';
const teacherSnapshot=JSON.stringify(newRow);
assert.equal((await call(modern)).result.duplicate,true);
assert.equal(JSON.stringify(newRow),teacherSnapshot,'Retry must preserve all teacher judgments');
assert.equal((await call({...modern,writing:['changed','','']})).status,409);
const beginner=freshBody(2,{path:'beginner',writingTask:null,answers:Array.from({length:3},()=>[null,null,null,null]),writing:['','','']});
result=await call(beginner);assert.equal(result.status,200);assert.deepEqual(result.result.reading,[]);assert.equal(JSON.parse(data.Einstufungen.at(-1)[6]).status,'not_assessed');assert.equal(data.Einstufungen.at(-1)[13],'not_assessed');
const unknown=freshBody(3,{writingTask:null,answers:Array.from({length:3},()=>[3,3,3,3]),writing:['','','']});assert.equal((await call(unknown)).status,400);
const wrong=structuredClone(unknown);wrong.answers[0][0]=1;assert.equal((await call(wrong)).status,200);assert.equal(readingScores(wrong.answers,VERSION)[0].wrong,1);assert.equal(data.Einstufungen.at(-1)[13],'not_assessed');
const writeOnly=freshBody(4,{answers:Array.from({length:3},()=>[null,null,null,null]),writingTask:1,writing:['','=IMPORTXML("synthetic")','']});assert.equal((await call(writeOnly)).status,200);assert.equal(data.Einstufungen.at(-1)[11].startsWith("'="),true);
for(const invalid of [{...beginner,answers:KEYS[VERSION]},{...modern,writingTask:1},{...modern,path:'auto-B1'},{...modern,writing:['text','second','']},{...modern,writingTask:3},{...body,path:'test'},{...modern,version:'future'}])assert.equal(validatePlacement(invalid),null);
const before=data.Einstufungen.length;const flush=context.SpreadsheetApp.flush;context.SpreadsheetApp.flush=()=>{throw Error('synthetic storage failure');};assert.equal((await call(freshBody(5))).status,502);context.SpreadsheetApp.flush=flush;
assert.equal((await call(freshBody(6),{}, {env:{...env,VERCEL_ENV:'preview',VIVE_INQUIRY_MODE:'live'}})).result.test,true);
assert.equal(mails,0);
console.log('PLACEMENT 2.1 PASS: legacy keys retained; three-way client/API/receiver profile; beginner no score; unknown-only rejected; wrong evidence; one writing sample; version guards; storage failure; preview TEST; no mail');

assert.equal((await call({...modern,token:issueToken(parent,true,secret,now-86400001,VERSION)})).status,401);
receiverEnabled=false;assert.equal((await call(freshBody(7))).status,502);receiverEnabled=true;
assert.equal(JSON.parse(newRow[9]).writingTask,0);assert.equal(JSON.parse(newRow[9]).path,'test');
assert.equal(context.receivePlacement_({version:VERSION,id,parent,writing:[],answers:[]},'synthetic',secret).ok,false);
assert.equal(mails,0);console.log('PLACEMENT EXTRA PASS: handler expiry, receiver flag, writing task readback, independent receiver validation');
const oldUnknown=freshBody(8,{version:LEGACY_VERSION,answers:Array.from({length:3},()=>[3,3,3,3]),writing:['','','']});delete oldUnknown.path;delete oldUnknown.writingTask;
assert.equal((await call(oldUnknown)).status,200);assert.equal((await call(oldUnknown)).result.duplicate,true);assert.deepEqual(readingScores(oldUnknown.answers).map(s=>s.answered),[0,0,0]);assert.equal(mails,0);
console.log('PLACEMENT LEGACY RETRY PASS: unknown-only historical contract remains retryable; no reinterpretation or new 2.1 evidence claim.');

// Signed scope must bind the version and exactly 24 hours; old unversioned access is legacy only.
const signed=o=>{const p=Buffer.from(JSON.stringify(o)).toString('base64url');return p+'.'+createHmac('sha256',secret).update('placement:'+p).digest('hex');};
const legacyToken=signed({id:parent,test:true,expires:now+86400000});
assert.equal(verifyToken(legacyToken,secret,now).version,LEGACY_VERSION);
assert.equal((await call({...modern,token:legacyToken})).status,401);
assert.equal((await call({...body,token:issueToken(parent,true,secret,now,VERSION)})).status,401);
assert.equal(verifyToken(signed({id:parent,test:true,version:VERSION,issued:now,expires:now+86400001}),secret,now),null);
assert.equal(verifyToken(signed({id:parent,test:true,version:'future',issued:now,expires:now+86400000}),secret,now),null);
assert.equal(verifyToken(token,secret,now+86400000),null);
assert.equal((await call({...body,token:legacyToken})).status,200,'Original historical payload digest remains retryable');
// Full write readback: corruption of any stored column must not acknowledge success or a retry.
const realFlush=context.SpreadsheetApp.flush;
for(const column of [3,6,9,10,11,12,16,17]){
 const specimen=freshBody(100+column);
 context.SpreadsheetApp.flush=()=>{data.Einstufungen.at(-1)[column]='synthetic corruption';};
 assert.equal((await call(specimen)).status,502,'Corrupt column '+column+' must fail closed');
 context.SpreadsheetApp.flush=realFlush;
 assert.equal((await call(specimen)).status,409,'Corrupted persisted row cannot be accepted as duplicate');
}
assert.equal(newRow[17],true,'Voluntary consent stored and read back');
formulaColumn=10;assert.equal((await call(freshBody(850))).status,502,'Even a matching formula display must fail closed');formulaColumn=null;
formulaColumn=13;assert.equal((await call(modern)).status,409,'Teacher-field formulas still fail closed');formulaColumn=null;
formulaColumn=2;assert.equal((await call(modern)).status,409,'Skipped receipt-field formulas still fail closed');formulaColumn=null;
assert.equal(context.receivePlacement_({...validatePlacement(modern),consent:undefined,privacyVersion:'placement-2026-10-06-v2-1',inquiryId:parent,test:true},'synthetic',secret).ok,false,'Independent receiver requires explicit modern consent');
const ownerParent='ca30b8bc-743b-44f9-bae8-000000000900';
data.Website_Anfragen.push([ownerParent,'','','','','','','','','','','TEST']);
const beforeOwner=JSON.stringify(data),access=context.issuePlacementForExistingInquiry_(ownerParent,'TEST');
assert.equal(access.ok,true);assert.equal(verifyToken(access.token,secret,Date.now()).version,VERSION);
assert.equal(JSON.stringify(data),beforeOwner,'Existing access must not create another form or row');
const ownerLive='ca30b8bc-743b-44f9-bae8-000000000904';
data.Website_Anfragen.push([ownerLive,'','','','','','','','','','','INQUIRY']);
const liveOwnerBefore=JSON.stringify(data),liveAccess=context.issuePlacementForExistingInquiry_(ownerLive,'INQUIRY');
assert.equal(liveAccess.ok,true);assert.equal(verifyToken(liveAccess.token,secret,Date.now()).test,false);
assert.equal(JSON.stringify(data),liveOwnerBefore,'Existing INQUIRY access is read-only; no new form, row or mail');
assert.equal(context.issuePlacementForExistingInquiry_(ownerParent,'INQUIRY').ok,false);
assert.equal(context.issuePlacementForExistingInquiry_('wa-inquiry-synthetic','INQUIRY').ok,false);
assert.equal(context.issuePlacementForExistingInquiry_('ca30b8bc-743b-44f9-bae8-000000000901','TEST').ok,false);
data.Website_Anfragen.push([...data.Website_Anfragen.find(r=>r[0]===ownerParent)]);
assert.equal(context.issuePlacementForExistingInquiry_(ownerParent,'TEST').ok,false,'Ambiguous identity rejected');
assert.equal(context.issuePlacementForExistingInquiry_(JSON.parse(Buffer.from(modern.token.split('.')[0],'base64url')).id,'TEST').reviewRequired,true);
const testParent=freshBody(902);const liveAgainstTest={...testParent,token:issueToken(JSON.parse(Buffer.from(testParent.token.split('.')[0],'base64url')).id,false,secret,now)};
assert.equal((await call(liveAgainstTest,{}, {env:{...env,VIVE_INQUIRY_MODE:'live'}})).status,502,'Live result cannot bind to TEST inquiry');
assert.equal((await call(freshBody(903),{}, {env:{...env,VIVE_INQUIRY_MODE:'live'}})).result.test,true,'TEST capability stays TEST in live mode');
assert.equal(mails,0);
console.log('PLACEMENT HARDENING PASS: version scope, exact 24h expiry, original legacy retry, immutable-column corruption, stored consent, owner-only existing TEST/INQUIRY identity without writes/mail, ambiguity/missing/WhatsApp rejection, TEST isolation');

// Actual Range.getValues types, independent of locale/number-format display.
const received=new Date('2026-10-06T15:04:05.123Z');
const typed=[true,false,received,4,'Mía','001','TRUE','2026-10-06T15:04:05.123Z','=IMPORTXML("synthetic")'];
function readback(values,expected=typed,formulas=Array(typed.length).fill(''),skip=[]){
 const range={getValues:()=>[values],getDisplayValues:()=>[sheetDisplay(values,0,values.length)],getFormulas:()=>[formulas]};
 return context.rowMatches_({getRange:()=>range},1,expected,skip);
}
assert.equal(sheetDisplay(typed,0,typed.length)[0],'TRUE');
assert.equal(sheetDisplay(typed,0,typed.length)[1],'FALSE');
assert.notEqual(sheetDisplay(typed,0,typed.length)[2],received.toISOString());
assert.equal(sheetDisplay(typed,0,typed.length)[3],'4,00');
assert.equal(readback(typed),true,'Typed boolean/date/number and exact text accepted despite display formatting');
assert.equal(readback(['TRUE','false',received.toISOString(),'4',...typed.slice(4)]),true,'Historical canonical text remains readable');
for(const [index,value] of [[0,false],[1,true],[2,new Date(received.getTime()+1)],[3,5],[4,'Mia'],[5,1],[6,true],[7,received]]){
 const changed=[...typed];changed[index]=value;assert.equal(readback(changed),false,'Type/value corruption '+index+' rejected');
}
assert.equal(readback([...typed.slice(0,8),"'=IMPORTXML(\"synthetic\")"]),true,'Escaped literal formula text accepted');
for(const index of [0,2,8]){const formulas=Array(typed.length).fill('');formulas[index]='=synthetic_formula';assert.equal(readback(typed,typed,formulas,[index]),false,'Executable formula rejected even if skipped');}
assert.equal(readback(typed.slice(0,-1)),false,'Missing cell rejected');
console.log('SHEETS TYPED READBACK PASS: TRUE/FALSE display; localized dates and numbers; canonical old text; exact learner text; type/value corruption; literal/formula distinction; teacher edits preserved on retry');
const missingConsent=freshBody(905);assert.equal((await call(missingConsent)).status,200);
data.Einstufungen.at(-1).pop();const oldSchemaSnapshot=JSON.stringify(data.Einstufungen.at(-1));
assert.equal((await call(missingConsent)).status,409,'Existing 2.1 row without consent evidence requires a schema decision');
assert.equal(JSON.stringify(data.Einstufungen.at(-1)),oldSchemaSnapshot,'No implicit migration or consent backfill');
console.log('EXISTING 2.1 SCHEMA GUARD PASS: missing consent evidence rejects retry without migration; production inventory/schema decision remains open');
for(const [index,text] of ['001','TRUE','2026-09-27',"'=IMPORTXML(\"synthetic\")",'=IMPORTXML("synthetic")','+123','-123','@synthetic'].entries()){
 const specimen=freshBody(950+index,{writing:[text,'','']});assert.equal((await call(specimen)).status,200);
 const saved=data.Einstufungen.at(-1),savedFormats=formats.Einstufungen.at(-1);
 assert.equal(sheetValues(saved,10,1)[0],text,'Learner text must survive storage exactly');assert.equal(savedFormats[10],'@');
 assert.equal((await call(specimen)).result.duplicate,true);
}
const proofRows=[],proofFormats=[],proofTexts=['001','TRUE','2026-09-27',"'=text",'=text'];
let proofCapacity=0;
const proofSheet={getLastRow:()=>proofRows.length,getMaxRows:()=>proofCapacity,insertRowsAfter:(last,count)=>{assert.equal(last,proofCapacity);proofCapacity+=count;},getRange:(row,col,nRows,count)=>{assert(row<=proofCapacity);return sheetWriteMethods(proofRows,row,col,count,proofFormats);}};
context.writeRow_(proofSheet,proofTexts);assert.deepEqual(sheetValues(proofRows[0],0,proofTexts.length),proofTexts);
assert.equal(proofCapacity,1,'Only the new row is allocated before formatting when the grid is full');
const unformatted=[];sheetWriteMethods(unformatted,1,1,3,[]).setValues([proofTexts.slice(0,3)]);
assert.equal(typeof unformatted[0][0],'number');assert.equal(typeof unformatted[0][1],'boolean');assert(unformatted[0][2] instanceof Date,'Fixture actually models conversion without text format');
assert.equal(mails,0);
console.log('PLACEMENT TEXT STORAGE PASS: formatting precedes writes; leading zeros, TRUE, date-looking writing, apostrophes and formula prefixes preserved exactly; retry unchanged; no mail');

// Alias contract uses only synthetic cases. No real inquiry/person/property writes.
const aliasId='aa30b8bc-743b-44f9-bae8-000000001100',aliasCase='wa-inquiry-ABCDEF0123456789';
const aliasRecord={schema:'vive-placement-whatsapp-alias-v1',id:aliasId,source:'whatsapp-private-ledger-v1',sourceId:aliasCase,
 sourceReceiptSha256:'a'.repeat(64),ownerVerifiedAt:Date.now(),version:VERSION,test:true,active:true};
const inquiriesBeforeAlias=JSON.stringify(data.Website_Anfragen),mailBeforeAlias=mails;
let aliasResult=context.registerPlacementAliasForExistingWhatsappInquiry_(aliasRecord);assert.equal(aliasResult.stored,true);
assert.equal(aliasPropertyWrites,1);assert.equal(Object.keys(aliasProperties).length,2,'Exactly two private metadata entries, no second inquiry');
assert.equal(JSON.stringify(data.Website_Anfragen),inquiriesBeforeAlias);assert.equal(mails,mailBeforeAlias);
assert.equal(context.registerPlacementAliasForExistingWhatsappInquiry_(aliasRecord).duplicate,true);assert.equal(aliasPropertyWrites,1);
for(const bad of [{...aliasRecord,id:'aa30b8bc-743b-44f9-bae8-000000001101'},{...aliasRecord,sourceId:'wa-inquiry-ABCDEF0123456790'},
 {...aliasRecord,email:'synthetic@example.invalid'},{...aliasRecord,sourceId:[aliasCase]},{...aliasRecord,ownerVerifiedAt:Date.now()+86400000}]){
 assert.equal(context.registerPlacementAliasForExistingWhatsappInquiry_(bad).ok,false,'Conflicting/invalid alias cannot overwrite a mapping');
}
assert.equal(aliasPropertyWrites,1);
const aliasBeforeIssue=JSON.stringify({data,aliasProperties});
const aliasAccess=context.issuePlacementForExistingWhatsappInquiry_(aliasId,aliasCase,aliasRecord.sourceReceiptSha256,Date.now());
assert.equal(aliasAccess.ok,true);assert.equal(verifyToken(aliasAccess.token,secret,Date.now()).id,aliasId);
const publicAliasClaims=JSON.parse(Buffer.from(aliasAccess.token.split('.')[0],'base64url'));
assert.deepEqual(Object.keys(publicAliasClaims).sort(),['expires','id','issued','test','version']);
assert(!JSON.stringify(publicAliasClaims).includes(aliasCase),'Private source identity is never in client token');
assert.equal(JSON.stringify({data,aliasProperties}),aliasBeforeIssue,'Issuance is read-only');
const aliasBody={id:'ba30b8bc-743b-44f9-bae8-000000001100',token:aliasAccess.token,version:VERSION,consent:true,path:'test',writingTask:0,answers:structuredClone(KEYS[VERSION]),writing:['Synthetic alias writing','','']};
assert.equal((await call(aliasBody,{}, {now:()=>Date.now()})).status,200);
assert.equal((await call(aliasBody,{}, {now:()=>Date.now()})).result.duplicate,true);
assert.equal(data.Einstufungen.at(-1)[1],aliasId);assert.equal(data.Einstufungen.at(-1)[4],'TEST');
assert.equal(context.issuePlacementForExistingWhatsappInquiry_(aliasId,aliasCase,aliasRecord.sourceReceiptSha256,Date.now()).reviewRequired,true);
const sourceKey=context.placementAliasSourceKey_(aliasCase,secret),reverse=aliasProperties[sourceKey];delete aliasProperties[sourceKey];
assert.equal((await call(aliasBody,{}, {now:()=>Date.now()})).status,502,'Missing reverse index rejects even a valid token/retry');aliasProperties[sourceKey]=reverse;
const aliasKey='VIVE_PLACEMENT_ALIAS_'+aliasId,storedAlias=aliasProperties[aliasKey];
aliasProperties[aliasKey]=JSON.stringify({...aliasRecord,active:false});assert.equal((await call(aliasBody,{}, {now:()=>Date.now()})).status,502,'Revocation rejects further access');aliasProperties[aliasKey]=storedAlias;
data.Website_Anfragen.push([aliasId,'','','','','','','','','','','TEST']);
assert.equal((await call(aliasBody,{}, {now:()=>Date.now()})).status,502,'Alias/website ambiguity is rejected');
assert.equal(context.issuePlacementForExistingInquiry_(aliasId,'TEST').ok,false);data.Website_Anfragen.pop();
const liveAliasId='aa30b8bc-743b-44f9-bae8-000000001102',liveAliasCase='wa-inquiry-ABCDEF0123456791';
const liveAliasRecord={...aliasRecord,id:liveAliasId,sourceId:liveAliasCase,ownerVerifiedAt:Date.now(),test:false};
assert.equal(context.registerPlacementAliasForExistingWhatsappInquiry_(liveAliasRecord).stored,true);
const liveAliasAccess=context.issuePlacementForExistingWhatsappInquiry_(liveAliasId,liveAliasCase,liveAliasRecord.sourceReceiptSha256,Date.now());assert.equal(liveAliasAccess.ok,true);
assert.equal(context.issuePlacementForExistingWhatsappInquiry_(liveAliasId,aliasCase,liveAliasRecord.sourceReceiptSha256,Date.now()).ok,false);
assert.equal(context.issuePlacementForExistingWhatsappInquiry_(liveAliasId,liveAliasCase,'b'.repeat(64),Date.now()).ok,false);
assert.equal(context.issuePlacementForExistingWhatsappInquiry_(liveAliasId,liveAliasCase,liveAliasRecord.sourceReceiptSha256,Date.now()-86400000).ok,false);
const liveAliasBody={...aliasBody,id:'ba30b8bc-743b-44f9-bae8-000000001102',token:liveAliasAccess.token};
assert.equal((await call({...liveAliasBody,token:issueToken(liveAliasId,true,secret,Date.now(),VERSION)}, {},{env:{...env,VIVE_INQUIRY_MODE:'live'},now:()=>Date.now()})).status,502,'TEST token cannot use a live alias');
assert.equal((await call(liveAliasBody,{}, {env:{...env,VIVE_INQUIRY_MODE:'live'},now:()=>Date.now()})).result.test,false);
assert.equal((await call({...liveAliasBody,token:issueToken(liveAliasId,false,secret,Date.now()-86400001,VERSION)}, {},{env:{...env,VIVE_INQUIRY_MODE:'live'},now:()=>Date.now()})).status,401);
assert.equal(JSON.stringify(data.Website_Anfragen),inquiriesBeforeAlias);assert.equal(mails,mailBeforeAlias);
console.log('WHATSAPP ALIAS CONTRACT PASS: synthetic owner-attested metadata only; one source/one UUID; exact readback/idempotency; no second inquiry, contact fields or mail; read-only 24h/version token; private source absent from token; immutable retry; conflict/revocation/partial mapping/ambiguity/mode/expiry guards');
