'use strict';
// Explicit diagnostic reads only; never sends an email or writes provider resources.
// A refresh-token exchange refreshes authorization, not Calendar events.
async function providerHealth(env,{fetchImpl=fetch}={}){
 const out=[];const state=(name,status,detail)=>({name,status,detail});
 const request=async(url,opts)=>{try{const r=await fetchImpl(url,{...opts,signal:AbortSignal.timeout(8000)});return {ok:r.ok,status:r.status,body:await r.json().catch(()=>null)};}catch{return {ok:false,status:0};}};
 if(env.P1_LOCAL_REVIEW)return [];
 if(env.STRIPE_SECRET_KEY){const r=await request('https://api.stripe.com/v1/products?limit=1',{method:'GET',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY}});out.push({...state('Stripe',r.ok?'Healthy':'Attention Needed',r.ok?'Restricted key accepted by Stripe read API.':r.status===403?'Stripe denied Products read access; permissions were not changed.':'Stripe connectivity could not be verified.'),mode:/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY)?'LIVE':'NOT LIVE'});}
 // The restricted key intentionally has no webhook read permission. Do not broaden it.
 if(env.STRIPE_WEBHOOK_SECRET)out.push(state('Stripe webhook','Degraded','Signing secret present. Subscription health requires Stripe dashboard verification.'));
 if(['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_CALENDAR_ID'].every(k=>env[k])){const t=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN})});if(t.ok&&t.body?.access_token){const r=await request('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(env.GOOGLE_CALENDAR_ID)+'/events?maxResults=1&fields=kind',{method:'GET',headers:{Authorization:'Bearer '+t.body.access_token}});out.push(state('Google Calendar',r.ok?'Healthy':'Attention Needed',r.ok?'Authorization refreshed and Calendar read succeeded.':'Calendar read access could not be verified.'));}else out.push(state('Google Calendar','Attention Needed','Calendar authorization could not be refreshed.'));}
 if(env.RESEND_API_KEY&&env.FROM_EMAIL){const r=await request('https://api.resend.com/domains',{method:'GET',headers:{Authorization:'Bearer '+env.RESEND_API_KEY}});const address=env.FROM_EMAIL.match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1]||'',domain=address.split('@')[1]?.toLowerCase();const verified=r.ok&&r.body?.data?.some(d=>d.name?.toLowerCase()===domain&&d.status==='verified');out.push(state('Email provider',verified?'Healthy':'Degraded',verified?'Sender domain verified; no test email was sent.':r.status===403?'Key cannot read domain health. Sending permissions were not changed.':'Sender domain health could not be verified; no test email was sent.'));}
 return out;
}
module.exports={providerHealth};
