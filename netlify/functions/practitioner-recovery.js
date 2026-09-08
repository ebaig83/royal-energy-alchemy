'use strict';
const crypto=require('crypto');
const {getClient}=require('./lib/supabase');
const {respond,hashToken,clearSessionCookie}=require('./lib/auth');
const credential=require('./lib/practitioner-credential');
const RECOVERY_MINUTES=20;
function origin(raw){return String(raw||'').trim().replace(/\/$/,'');}
function allowed(event){const actual=origin(event.headers?.origin||event.headers?.Origin);const configured=(process.env.VERIFY_PIN_ALLOWED_ORIGINS||'').split(',').map(origin).filter(Boolean);const base=origin(process.env.SITE_URL||'https://www.daronroyal.com');return !actual||[...new Set([...configured,base])].includes(actual);}
function sameSecret(value){const expected=process.env.PRACTITIONER_RECOVERY_ADMIN_SECRET||'';if(!expected||typeof value!=='string')return false;const a=Buffer.from(value),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
exports.handler=async event=>{
 try{
  if(String(event.httpMethod||'').toUpperCase()!=='POST'||!allowed(event))return respond(403,{error:'Recovery request was not accepted.'});
  if((event.body||'').length>2048)return respond(400,{error:'Recovery request was not accepted.'});
  let body;try{body=JSON.parse(event.body||'{}');}catch{return respond(400,{error:'Recovery request was not accepted.'});}
  const sb=getClient();
  if(body.action==='initiate'){
   if(!sameSecret(event.headers?.['x-practitioner-recovery-secret']||event.headers?.['X-Practitioner-Recovery-Secret']))return respond(403,{error:'Recovery request was not accepted.'});
   if(!await credential.recoveryAttempt(sb,event))return respond(429,{error:'Recovery request was not accepted.'});
   const token=crypto.randomBytes(32).toString('base64url'),expires=new Date(Date.now()+RECOVERY_MINUTES*60000).toISOString();
   const {error}=await sb.from('practitioner_recovery_tokens').insert({token_hash:hashToken(token),expires_at:expires});
   if(error)throw Error();
   return respond(200,{recovery_token:token,expires_at:expires,expires_in_minutes:RECOVERY_MINUTES});
  }
  if(body.action!=='complete'||typeof body.token!=='string'||body.token.length<32||body.token.length>256||!credential.validNew(body.next)||body.next!==body.confirm)return respond(400,{error:'Recovery request was not accepted.'});
  if(!await credential.recoveryAttempt(sb,event))return respond(429,{error:'Recovery request was not accepted.'});
  const encoded=await credential.hash(body.next);
  const {data,error}=await sb.rpc('practitioner_recover',{p_token_hash:hashToken(body.token),p_hash:encoded});
  if(error)throw Error();
  if(data!==true)return respond(400,{error:'Recovery request was not accepted.'},{cookie:clearSessionCookie()});
  return respond(200,{reset:true,sign_in_required:true,sessions_revoked:true},{cookie:clearSessionCookie()});
 }catch{return respond(503,{error:'Recovery request was not accepted.'});}
};
