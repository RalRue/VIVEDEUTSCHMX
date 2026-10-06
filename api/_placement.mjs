import {createHmac, timingSafeEqual} from 'node:crypto';
export const VERSION='draft-2026-09-30-v2-1';
export const LEGACY_VERSION='pilot-2026-09-29';
export const KEYS={
 [LEGACY_VERSION]:[[1,0,2,1],[2,0,1,2],[2,0,1,0]],
 [VERSION]:[[0,1,2,0],[1,0,2,1],[2,1,0,1]]
};
export const privacyVersion=version=>version===LEGACY_VERSION?'placement-2026-09-29':'placement-2026-10-06-v2-1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function issueToken(id,test,secret,now=Date.now(),version=VERSION) {
 if(!uuid.test(id)||typeof test!=='boolean'||typeof secret!=='string'||secret.length<40||!Number.isSafeInteger(now)||!KEYS[version])throw new Error('Invalid placement access');
 const payload=Buffer.from(JSON.stringify({id,test,version,issued:now,expires:now+86400000})).toString('base64url');
 return payload+'.'+createHmac('sha256',secret).update('placement:'+payload).digest('hex');
}
export function verifyToken(token,secret,now=Date.now()) {
 if(typeof token!=='string'||token.length>600||typeof secret!=='string'||secret.length<40)return null;
 const [payload,sig,...extra]=token.split('.');
 if(extra.length||!/^[a-f0-9]{64}$/.test(sig||''))return null;
 const expected=createHmac('sha256',secret).update('placement:'+payload).digest('hex');
 if(!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
 try {const d=JSON.parse(Buffer.from(payload,'base64url').toString());
 const version=d.version===undefined?LEGACY_VERSION:d.version;
 if(!KEYS[version]||!uuid.test(d.id)||typeof d.test!=='boolean'||!Number.isSafeInteger(d.expires)||d.expires<=now)return null;
 if(d.version!==undefined&&(!Number.isSafeInteger(d.issued)||d.issued>now||d.expires-d.issued!==86400000))return null;
 return {...d,version};
 }catch{return null;}
}
export function validatePlacement(body) {
 if(!body||typeof body!=='object'||Array.isArray(body))return null;
 const modern=body.version===VERSION,allowed=['id','token','version','answers','writing','consent',...(modern?['path','writingTask']:[])];
 if(Object.keys(body).some(k=>!allowed.includes(k))||!uuid.test(body.id)||![VERSION,LEGACY_VERSION].includes(body.version)||body.consent!==true||typeof body.token!=='string')return null;
 if(!Array.isArray(body.answers)||body.answers.length!==3||!body.answers.every(a=>Array.isArray(a)&&a.length===4&&a.every(v=>v===null||(Number.isInteger(v)&&v>=0&&v<=3))))return null;
 if(!Array.isArray(body.writing)||body.writing.length!==3||!body.writing.every(v=>typeof v==='string'&&v.length<=1800&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)))return null;
 if(modern){
  if(!['beginner','test'].includes(body.path)||!(body.writingTask===null||Number.isInteger(body.writingTask)&&body.writingTask>=0&&body.writingTask<=2))return null;
  if(body.writing.some((v,i)=>i!==body.writingTask&&v!==''))return null;
  if(body.path==='beginner'&&(body.writingTask!==null||body.answers.some(a=>a.some(v=>v!==null))||body.writing.some(v=>v!=='')))return null;
 }
 // Keep legacy retry validation byte-contract compatible; improve evidence gating only in 2.1.
 if(modern&&body.path!=='beginner'&&!hasEvidence(body.answers,body.writing))return null;
 if(!modern&&!body.answers.some(a=>a.some(v=>v!==null))&&!body.writing.some(v=>v.trim()))return null;
 return {id:body.id,version:body.version,answers:body.answers,writing:body.writing,...(modern?{path:body.path,writingTask:body.writingTask,consent:true}:{})};
}
export function hasEvidence(answers,writing){return answers.some(a=>a.some(v=>Number.isInteger(v)&&v>=0&&v<3))||writing.some(v=>v.trim());}
export function readingScores(answers,version=LEGACY_VERSION) {
 const keys=KEYS[version];if(!keys)throw new Error('Unknown placement version');
 return keys.map((key,p)=>{
  const values=key.map((_,i)=>answers[p]?.[i]??null),correct=key.filter((v,i)=>values[i]===v).length,answered=values.filter(v=>Number.isInteger(v)&&v>=0&&v<3).length;
  if(version===LEGACY_VERSION)return {level:['A1','A2','B1'][p],total:4,correct,answered};
  const part=indexes=>({total:indexes.length,correct:indexes.filter(i=>values[i]===key[i]).length,answered:indexes.filter(i=>Number.isInteger(values[i])&&values[i]>=0&&values[i]<3).length});
  return {block:p+1,total:4,correct,answered,wrong:answered-correct,unknown:values.filter(v=>v===3).length,unanswered:values.filter(v=>v===null).length,reading:part([0,1]),grammar:part([2]),vocabulary:part([3])};
 });
}
