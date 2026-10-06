import {createHmac} from 'node:crypto';
import {verifyToken,validatePlacement,readingScores,privacyVersion,LEGACY_VERSION} from './_placement.mjs';
export function createHandler({env=process.env,send=fetch,now=Date.now}={}) {
 return async (req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(status,data)=>res.status(status).json(data);
  if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(405,{ok:false});}
  const origins=['https://vive-deutsch-mx.vercel.app'];
  if(env.VERCEL_ENV==='preview')for(const host of [env.VERCEL_URL,env.VERCEL_BRANCH_URL])if(/^[a-z0-9-]+\.vercel\.app$/i.test(host||''))origins.push('https://'+host);
  if(env.VIVE_INQUIRY_PREVIEW_ORIGIN)origins.push(env.VIVE_INQUIRY_PREVIEW_ORIGIN);
  if(!origins.includes(req.headers.origin))return reply(403,{ok:false});
  if(!String(req.headers['content-type']||'').startsWith('application/json'))return reply(415,{ok:false});
  const secret=env.VIVE_INQUIRY_SECRET?.trim(),endpoint=env.VIVE_INQUIRY_RECEIVER_URL;
  if(env.VIVE_PLACEMENT_ENABLED!=='true'||!secret||secret.length<40||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint||''))return reply(503,{ok:false});
  let body;
  try {const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(!raw||Buffer.byteLength(raw)>24000)return reply(413,{ok:false});body=JSON.parse(raw);}catch{return reply(400,{ok:false});}
  const data=validatePlacement(body),auth=verifyToken(body?.token,secret,now());
  if(!data)return reply(400,{ok:false});
  if(!auth||auth.version!==data.version)return reply(401,{ok:false});
  const reading=data.path==='beginner'?[]:readingScores(data.answers,data.version);
  const writingStatus=data.version!==LEGACY_VERSION&&!data.writing.some(v=>v.trim())?'not_assessed':'pending_teacher_review';
  const payload=JSON.stringify({...data,kind:'PLACEMENT',inquiryId:auth.id,test:auth.test||env.VERCEL_ENV==='preview'||env.VIVE_INQUIRY_MODE!=='live',reading,writingStatus,listening:'not_assessed',speaking:'not_assessed',privacyVersion:privacyVersion(data.version)}).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  const timestamp=now(),signature=createHmac('sha256',secret).update(timestamp+'.'+payload).digest('hex');
  try {
   const response=await send(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timestamp,payload,signature}),signal:AbortSignal.timeout(20000)});
   if(!response.ok)return reply(502,{ok:false});
   if(!String(response.headers?.get('content-type')||'application/json').includes('application/json'))return reply(502,{ok:false});
   const result=await response.json();
   if(result.conflict===true)return reply(409,{ok:false,conflict:true});
   if(result.ok!==true||result.stored!==true||result.id!==data.id||result.inquiryId!==auth.id)return reply(502,{ok:false});
   return reply(200,{ok:true,stored:true,id:data.id,version:data.version,test:auth.test||env.VERCEL_ENV==='preview'||env.VIVE_INQUIRY_MODE!=='live',reading,duplicate:result.duplicate===true});
  }catch{return reply(502,{ok:false});}
 };
}
export default createHandler();
