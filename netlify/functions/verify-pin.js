'use strict';
const crypto=require('crypto');
const {getClient}=require('./lib/supabase');
const {requireAdmin,respond,cookieValue,hashToken,sessionCookie,clearSessionCookie,SESSION_HOURS}=require('./lib/auth');
const credential=require('./lib/practitioner-credential');
function normalizeOrigin(raw){
  return String(raw || '').trim().replace(/\/$/, '');
}
function allowedOriginsFromEnv(){
  const explicit=(process.env.VERIFY_PIN_ALLOWED_ORIGINS || '').split(',').map(normalizeOrigin).filter(Boolean);
  const base=normalizeOrigin(process.env.SITE_URL || 'https://www.daronroyal.com');
  return Array.from(new Set([...explicit, ...(base?[base]:[])]));
}
exports.handler=async event=>{
 try{
  const sb=getClient(),method=String(event.httpMethod||'GET').toUpperCase();
  if(method==='GET'){const auth=await requireAdmin(event,{touch:false});if(auth.error)return auth.error;return respond(200,{authenticated:true,expires_in_hours:SESSION_HOURS,security:credential.metadata(await credential.read(sb))});}
  if(!['POST','PUT','DELETE'].includes(method))return respond(405,{error:'Method not allowed.'});
  const origin=normalizeOrigin(event.headers?.origin||event.headers?.Origin);
  if(origin&&!allowedOriginsFromEnv().includes(origin))return respond(403,{error:'Origin not allowed.'});
  if(method==='DELETE'){const auth=await requireAdmin(event);if(auth.error)return auth.error;const {error}=await sb.from('admin_sessions').update({revoked_at:new Date().toISOString()}).eq('token_hash',hashToken(cookieValue(event)));if(error)throw Error();return respond(200,{logged_out:true},{cookie:clearSessionCookie()});}
  let auth;if(method==='PUT'){auth=await requireAdmin(event,{touch:false});if(auth.error)return auth.error;}
  if((event.body||'').length>2048)return respond(413,{error:'Request too large.'});
  let body;try{body=JSON.parse(event.body||'{}');}catch{return respond(400,{error:'Invalid request.'});}
  if(!await credential.attempt(sb,event,method==='PUT'?'change':'login'))return respond(429,{error:'Too many attempts. Try again in 15 minutes.'});
  const row=await credential.read(sb);
  if(!await credential.verify(method==='PUT'?body.current:body.pin,row.password_hash,process.env.DASHBOARD_PIN))return respond(401,{error:'Credential was not accepted.'});
  if(method==='PUT'){
   if(!credential.validNew(body.next)||body.next!==body.confirm)return respond(400,{error:'New credentials must match and contain at least 12 characters (maximum 256 bytes).'});
   if(await credential.verify(body.next,row.password_hash,process.env.DASHBOARD_PIN))return respond(400,{error:'Choose a different credential.'});
   const encoded=await credential.hash(body.next);
   const {data,error}=await sb.rpc('practitioner_change',{p_version:row.version,p_session:auth.sessionId,p_hash:encoded});
   if(error)throw Error();if(data!==true)return respond(409,{error:'Security state changed. Sign in again.'},{cookie:clearSessionCookie()});
   return respond(200,{changed:true,sign_in_required:true,sessions_revoked:true},{cookie:clearSessionCookie()});
  }
  const token=crypto.randomBytes(32).toString('base64url'),expires=new Date(Date.now()+SESSION_HOURS*3600000).toISOString();
  const {data,error}=await sb.rpc('practitioner_login',{p_version:row.version,p_token_hash:hashToken(token),p_email:process.env.ADMIN_EMAIL||'admin',p_expires:expires});
  if(error)throw Error();if(data!==true)return respond(409,{error:'Credential changed. Sign in again.'});
  return respond(200,{success:true,expires_at:expires},{cookie:sessionCookie(token)});
 }catch{return respond(503,{error:'Secure sign-in is temporarily unavailable. No credential changes were accepted.'});}
};
