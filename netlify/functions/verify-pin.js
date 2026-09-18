'use strict';
const crypto=require('crypto');
const {getClient}=require('./lib/supabase');
const {requireAdmin,respond,cookieValue,hashToken,sessionCookie,clearSessionCookie,SESSION_HOURS}=require('./lib/auth');
const credential=require('./lib/practitioner-credential');
const {cookieMaxAge}=require('./lib/session-policy');
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
  if(method==='GET'){const auth=await requireAdmin(event,{touch:false});if(auth.error)return auth.error;const row=auth.user.id?await sb.from('practitioner_users').select('password_hash,credential_version,created_at,last_login_at').eq('id',auth.user.id).single():await credential.read(sb);return respond(200,{authenticated:true,user:auth.user,expires_in_hours:SESSION_HOURS,security:credential.metadata(row.data||row)});}
  if(!['POST','PUT','DELETE'].includes(method))return respond(405,{error:'Method not allowed.'});
  const origin=normalizeOrigin(event.headers?.origin||event.headers?.Origin);
  if(origin&&!allowedOriginsFromEnv().includes(origin))return respond(403,{error:'Origin not allowed.'});
  if(method==='DELETE'){const auth=await requireAdmin(event);if(auth.error)return auth.error;const {error}=await sb.from('admin_sessions').update({revoked_at:new Date().toISOString()}).eq('token_hash',hashToken(cookieValue(event)));if(error)throw Error();return respond(200,{logged_out:true},{cookie:clearSessionCookie()});}
  let auth;if(method==='PUT'){auth=await requireAdmin(event,{touch:false});if(auth.error)return auth.error;}
  if((event.body||'').length>2048)return respond(413,{error:'Request too large.'});
  let body;try{body=JSON.parse(event.body||'{}');}catch{return respond(400,{error:'Invalid request.'});}
  const requestedEmail=String(body.email||'').trim().toLowerCase();
  let account=null,row=null;
  if(requestedEmail){const result=await sb.from('practitioner_users').select('id,email,display_name,role,active,password_hash,credential_version,created_at,last_login_at').eq('email',requestedEmail).eq('active',true).maybeSingle();if(result.error)throw Error();account=result.data||null;}
  if(account)row={password_hash:account.password_hash,version:account.credential_version,created_at:account.created_at,password_changed_at:null};
  else if(!requestedEmail || requestedEmail===String(process.env.ADMIN_EMAIL||'').trim().toLowerCase())row=await credential.read(sb);
  else return respond(401,{error:'Credential was not accepted.'});
  if(!await credential.attempt(sb,event,method==='PUT'?'change':'login'))return respond(429,{error:'Too many attempts. Try again in 15 minutes.'});
  if(!await credential.verify(method==='PUT'?body.current:body.pin,row.password_hash,process.env.DASHBOARD_PIN))return respond(401,{error:'Credential was not accepted.'});
  if(method==='PUT'){
   if(!credential.validNew(body.next)||body.next!==body.confirm)return respond(400,{error:'New credentials must match and contain at least 12 characters (maximum 256 bytes).'});
   if(await credential.verify(body.next,row.password_hash,process.env.DASHBOARD_PIN))return respond(400,{error:'Choose a different credential.'});
   const encoded=await credential.hash(body.next);
   const result=auth.user.id
    ? await sb.rpc('practitioner_user_change_password',{p_user_id:auth.user.id,p_session:auth.sessionId,p_hash:encoded})
    : await sb.rpc('practitioner_change',{p_version:row.version,p_session:auth.sessionId,p_hash:encoded});
   const {data,error}=result;
   if(error)throw Error();if(data!==true)return respond(409,{error:'Security state changed. Sign in again.'},{cookie:clearSessionCookie()});
   return respond(200,{changed:true,sign_in_required:true,sessions_revoked:true},{cookie:clearSessionCookie()});
  }
  if(Object.prototype.hasOwnProperty.call(body,'expires_at')||Object.prototype.hasOwnProperty.call(body,'session_duration'))return respond(400,{error:'Session duration is server-controlled.'});
  const remembered=body.remember_me===true;
  if(body.remember_me!==undefined&&typeof body.remember_me!=='boolean')return respond(400,{error:'Invalid session preference.'});
  const token=crypto.randomBytes(32).toString('base64url');
  const ip=String(event.headers?.['x-nf-client-connection-ip']||event.headers?.['client-ip']||'').split(',')[0].trim();
  const userAgent=String(event.headers?.['user-agent']||'');
  const {data,error}=account
    ? await sb.rpc('practitioner_user_login_session',{p_user_id:account.id,p_token_hash:hashToken(token),p_remembered:remembered,p_ip:ip,p_user_agent:userAgent})
    : await sb.rpc('practitioner_login_session',{p_version:row.version,p_token_hash:hashToken(token),p_email:process.env.ADMIN_EMAIL||'admin',p_remembered:remembered,p_ip:ip,p_user_agent:userAgent});
  if(error)throw Error();
  const session=Array.isArray(data)?data[0]:data;
  if(!session?.session_id)return respond(409,{error:'Credential changed. Sign in again.'});
  if(account)await sb.from('practitioner_users').update({last_login_at:new Date().toISOString()}).eq('id',account.id);
  return respond(200,{success:true,user:account?{id:account.id,email:account.email,displayName:account.display_name,role:account.role}:{email:process.env.ADMIN_EMAIL||'admin',displayName:'Daron Royal',role:'owner'},expires_at:session.expires_at,remembered},{cookie:sessionCookie(token,cookieMaxAge(remembered))});
 }catch{return respond(503,{error:'Secure sign-in is temporarily unavailable. No credential changes were accepted.'});}
};
