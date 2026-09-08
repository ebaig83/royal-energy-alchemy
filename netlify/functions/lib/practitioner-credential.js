'use strict';
const crypto=require('crypto');
const {promisify}=require('util');
const scrypt=promisify(crypto.scrypt);
function validNew(value){return typeof value==='string'&&value.length>=12&&Buffer.byteLength(value)<=256;}
async function hash(value){if(!validNew(value))throw Error('Use 12 or more characters, up to 256 bytes.');const salt=crypto.randomBytes(16).toString('hex');const result=await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return `scrypt$32768$${salt}$${result.toString('hex')}`;}
async function verify(value,encoded,bootstrap){
 if(typeof value!=='string'||Buffer.byteLength(value)>256)return false;
 if(!encoded){if(!bootstrap)return false;return crypto.timingSafeEqual(crypto.createHash('sha256').update(value).digest(),crypto.createHash('sha256').update(bootstrap).digest());}
 const match=/^scrypt\$32768\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);if(!match)return false;
 const actual=await scrypt(value,match[1],64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return crypto.timingSafeEqual(actual,Buffer.from(match[2],'hex'));
}
async function read(sb){const {data,error}=await sb.from('practitioner_credentials').select('version,password_hash,password_changed_at,created_at').eq('id',true).single();if(error||!data)throw Error('Security storage unavailable.');return data;}
async function attempt(sb,event,kind){const ip=String(event.headers?.['x-nf-client-connection-ip']||event.headers?.['client-ip']||event.headers?.['x-forwarded-for']||'unknown').split(',')[0].trim();const bucket=crypto.createHash('sha256').update(kind+':'+ip).digest('hex');const {data,error}=await sb.rpc('practitioner_attempt',{p_bucket:bucket,p_kind:kind});if(error)throw Error('Security verification unavailable.');return data===true;}
async function recoveryAttempt(sb,event){const ip=String(event.headers?.['x-nf-client-connection-ip']||event.headers?.['client-ip']||event.headers?.['x-forwarded-for']||'unknown').split(',')[0].trim();const bucket=crypto.createHash('sha256').update('recovery:'+ip).digest('hex');const {data,error}=await sb.rpc('practitioner_recovery_attempt',{p_bucket:bucket});if(error)throw Error('Security verification unavailable.');return data===true;}
function metadata(row,now=Date.now()){const due=new Date(Date.parse(row.password_changed_at||row.created_at)+180*86400000).toISOString();return {password_changed_at:row.password_changed_at,security_review_due_at:due,security_review_recommended:Date.parse(due)<=now,credential_type:row.password_hash?'password':'initial PIN',signed_in_as:'Daron',session_status:'Active'};}
module.exports={hash,verify,validNew,read,attempt,recoveryAttempt,metadata};
