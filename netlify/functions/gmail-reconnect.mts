import crypto from 'node:crypto';
import auth from './lib/auth.js';
import storage from './lib/gmail-oauth-store.cjs';
const SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const COOKIE='rea_gmail_reconnect';
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
function html(text:string,status=200,extra:Record<string,string>={}){return new Response('<!doctype html><meta charset="utf-8"><title>REA Gmail reconnect</title>'+text,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8',...extra}});}
function cookie(request:Request){return request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';}
const clearCookie=COOKIE+'=; Path=/api/gmail-reconnect; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
function event(request:Request,cookieOverride?:string){return {httpMethod:request.method,headers:{cookie:cookieOverride||request.headers.get('cookie')||'',origin:request.headers.get('origin')||''}};}
export default async (request:Request)=>{
 const env=process.env;
 if(env.GMAIL_RECONNECT_ENABLED!=='true')return html('<h1>Gmail reconnect is not enabled</h1>',503);
 const url=new URL(request.url),origin=new URL(env.SITE_URL||'https://www.daronroyal.com').origin;
 const redirect=origin+'/api/gmail-reconnect';
 try{
  if(request.method==='GET'&&(url.searchParams.has('code')||url.searchParams.has('error'))){
   const state=url.searchParams.get('state')||'',nonce=cookie(request);
   if(!/^[a-f0-9]{64}$/.test(state)||!nonce)return html('<h1>Reconnect request expired</h1><p>Start again from your signed-in dashboard.</p>',400,{'Set-Cookie':clearCookie});
   const store=await storage.getStore(env),encrypted=await store.get('requests/'+state);
   if(!encrypted)return html('<h1>Reconnect request expired</h1>',400,{'Set-Cookie':clearCookie});
   const pending=storage.open(encrypted,env);
   if(pending.expiresAt<Date.now()||pending.nonceHash!==crypto.createHash('sha256').update(nonce).digest('hex'))return html('<h1>Reconnect request expired</h1>',400,{'Set-Cookie':clearCookie});
   const owner=await auth.requireAdmin(event(request,'rea_admin_session='+pending.adminToken));
   if(owner.error||owner.role!=='owner'||owner.sessionId!==pending.sessionId)return html('<h1>Owner sign-in required</h1>',401,{'Set-Cookie':clearCookie});
   await store.delete('requests/'+state);
   if(url.searchParams.has('error'))return html('<h1>Google consent was cancelled</h1>',400,{'Set-Cookie':clearCookie});
   const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:url.searchParams.get('code')||'',client_id:env.GMAIL_CLIENT_ID!,client_secret:env.GMAIL_CLIENT_SECRET!,redirect_uri:redirect,grant_type:'authorization_code',code_verifier:pending.verifier}),signal:AbortSignal.timeout(15000)});
   const token=await tokenResponse.json();
   if(!tokenResponse.ok||!token.refresh_token||!token.access_token||!String(token.scope||'').split(' ').includes(SCOPE))return html('<h1>Google authorization failed</h1><p>Verify the registered callback and matching Gmail client credentials.</p>',400,{'Set-Cookie':clearCookie});
   const profileResponse=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)});
   const profile=await profileResponse.json();
   if(!profileResponse.ok||String(profile.emailAddress||'').toLowerCase()!==String(env.GMAIL_ACCOUNT||'').toLowerCase())return html('<h1>Wrong Google account</h1><p>Start again and choose the Gmail account configured for REA.</p>',400,{'Set-Cookie':clearCookie});
   await store.set('connection',storage.seal({clientId:env.GMAIL_CLIENT_ID,account:String(profile.emailAddress).toLowerCase(),refreshToken:token.refresh_token,updatedAt:new Date().toISOString()},env));
   return new Response(null,{status:303,headers:{...headers,Location:redirect+'?saved=1','Set-Cookie':clearCookie}});
  }
  const owner=await auth.requireAdmin(event(request));
  if(owner.error||owner.role!=='owner')return html('<h1>Owner sign-in required</h1><p>Sign in to the REA practitioner dashboard as owner, then open this page again.</p>',401);
  if(request.method==='GET')return html('<h1>Reconnect REA Gmail</h1>'+(url.searchParams.get('saved')==='1'?'<p>The new Gmail authorization was saved. A successful reconciliation run is still required to verify recovery.</p>':'')+'<p>Choose the configured Gmail account and approve read-only access. This connection does not send, modify, or delete email.</p><form method="post"><button>Continue to Google</button></form>');
  if(request.method!=='POST')return html('<h1>Method not allowed</h1>',405);
  if(request.headers.get('origin')!==origin)return html('<h1>Request origin rejected</h1>',403);
  if(!env.GMAIL_CLIENT_ID||!env.GMAIL_CLIENT_SECRET||!env.GMAIL_ACCOUNT)return html('<h1>Gmail client configuration is incomplete</h1>',503);
  const state=crypto.randomBytes(32).toString('hex'),nonce=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(32).toString('base64url');
  const store=await storage.getStore(env);
  await store.set('requests/'+state,storage.seal({sessionId:owner.sessionId,adminToken:auth.cookieValue(event(request)),nonceHash:crypto.createHash('sha256').update(nonce).digest('hex'),verifier,expiresAt:Date.now()+600000},env));
  const google=new URL('https://accounts.google.com/o/oauth2/v2/auth');google.search=new URLSearchParams({client_id:env.GMAIL_CLIENT_ID,redirect_uri:redirect,response_type:'code',access_type:'offline',prompt:'consent',scope:SCOPE,state,login_hint:env.GMAIL_ACCOUNT,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
  return new Response(null,{status:303,headers:{...headers,Location:google.toString(),'Set-Cookie':COOKIE+'='+nonce+'; Path=/api/gmail-reconnect; HttpOnly; Secure; SameSite=Lax; Max-Age=600'}});
 }catch{return html('<h1>Gmail reconnect could not complete</h1><p>No credentials are displayed. Check secure-storage configuration and retry from the owner dashboard.</p>',503,{'Set-Cookie':clearCookie});}
};
export const config={path:'/api/gmail-reconnect'};
