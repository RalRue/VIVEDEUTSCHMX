const assert=require('node:assert/strict');
const {base64EncodeWebSafe,computeHmacSha256Signature}=require('./synthetic-utilities.cjs');

(async()=>{
  // Literal examples in the Apps Script reference, including retained padding.
  assert.equal(base64EncodeWebSafe('A string here'),'QSBzdHJpbmcgaGVyZQ==');
  assert.equal(base64EncodeWebSafe('Google グループ'),'R29vZ2xlIOOCsOODq-ODvOODlw==');
  assert.equal(base64EncodeWebSafe([-1,-2]),'__4=');
  assert.equal(base64EncodeWebSafe(''),'');
  // RFC 4231 case 1: independent known digest, not another Node HMAC calculation.
  const signature=computeHmacSha256Signature('Hi There',Array(20).fill(0x0b));
  assert.equal(signature[0],-80);
  assert.equal(signature.length,32);
  assert.equal(signature.map(b=>(b&255).toString(16).padStart(2,'0')).join(''),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  assert.throws(()=>base64EncodeWebSafe([256]),TypeError);
  assert.throws(()=>computeHmacSha256Signature({},'key'),TypeError);

  // A padded token can pass server decoding while failing the browser fragment
  // syntax. Exercise all possible padding lengths so the fixture cannot hide it.
  const {verifyToken,VERSION}=await import('../api/_placement.mjs');
  const secret='s'.repeat(64),now=1000;
  let padded=0;const paddingLengths=new Set();
  for(const issued of [now,now+10000,now+100000]){
    const claims={id:'ca30b8bc-743b-44f9-bae8-a5296ab89c9b',test:true,version:VERSION,issued,expires:issued+86400000};
    const payload=base64EncodeWebSafe(JSON.stringify(claims));
    paddingLengths.add((payload.match(/=+$/)||[''])[0].length);
    const sign=value=>computeHmacSha256Signature('placement:'+value,secret).map(b=>(b&255).toString(16).padStart(2,'0')).join('');
    const rawToken=payload+'.'+sign(payload);
    assert.ok(verifyToken(rawToken,secret,issued),'Server base64 decoder tolerates padding');
    if(payload.endsWith('=')){
      padded++;
      assert.equal(/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(rawToken),false,'A padded link would fail the real browser');
    }
    const unpadded=payload.replace(/=+$/,'');
    const token=unpadded+'.'+sign(unpadded);
    assert.match(token,/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
    assert.equal(verifyToken(token,secret,issued).id,claims.id);
  }
  assert.ok(padded>0,'The cases must actually expose the previously hidden mismatch');
  assert.deepEqual([...paddingLengths].sort(),[0,1,2],'Exercise all padding lengths');
  console.log('SYNTHETIC UTILITIES PASS: documented padded web-safe Base64, UTF-8/byte arrays, signed RFC4231 HMAC, browser/server token-format mismatch and explicit issuer normalization');
})().catch(error=>{console.error(error);process.exitCode=1;});
