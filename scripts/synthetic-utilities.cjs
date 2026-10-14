// Only the Utilities operations used by the private receiver fixtures.
// https://developers.google.com/apps-script/reference/utilities/utilities
const {createHmac}=require('node:crypto');

function bytes(value){
  if(typeof value==='string')return Buffer.from(value,'utf8');
  if(Array.isArray(value)&&value.every(b=>Number.isInteger(b)&&b>=-128&&b<=255))return Buffer.from(value);
  throw new TypeError('Synthetic Utilities expects a string or byte array');
}
function base64EncodeWebSafe(value){
  // Apps Script preserves '=' padding. Token issuers must remove it themselves.
  return bytes(value).toString('base64').replace(/\+/g,'-').replace(/\//g,'_');
}
function computeHmacSha256Signature(value,key){
  // Apps Script Byte[] can contain negative signed-byte values.
  return Array.from(createHmac('sha256',bytes(key)).update(bytes(value)).digest(),b=>b>127?b-256:b);
}
module.exports={base64EncodeWebSafe,computeHmacSha256Signature};
