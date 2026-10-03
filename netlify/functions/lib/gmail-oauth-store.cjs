'use strict';
const crypto=require('node:crypto');
const STORE='rea-gmail-oauth';
function key(env=process.env){
 if(!env.APPOINTMENT_ACTION_SECRET||env.APPOINTMENT_ACTION_SECRET.length<32)throw Error('Gmail secure storage key unavailable');
 return crypto.hkdfSync('sha256',env.APPOINTMENT_ACTION_SECRET,'rea-gmail-oauth-v1','encrypted-storage',32);
}
function seal(value,env=process.env){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(env),iv);const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(b=>b.toString('base64url')).join('.');}
function open(value,env=process.env){const parts=String(value).split('.');if(parts.length!==3)throw Error('Invalid encrypted Gmail record');const [iv,tag,data]=parts.map(s=>Buffer.from(s,'base64url'));if(iv.length!==12||tag.length!==16)throw Error('Invalid encrypted Gmail record');const decipher=crypto.createDecipheriv('aes-256-gcm',key(env),iv);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'));}
async function getStore(env=process.env){const {getStore}=await import('@netlify/blobs');if(!env.GMAIL_OAUTH_SITE_ID||!env.NETLIFY_ACCESS_TOKEN)throw Error('Gmail secure storage configuration unavailable');return getStore({name:STORE,consistency:'strong',siteID:env.GMAIL_OAUTH_SITE_ID,token:env.NETLIFY_ACCESS_TOKEN});}
async function refreshToken(env=process.env){if(env.GMAIL_RECONNECT_ENABLED!=='true')return env.GMAIL_REFRESH_TOKEN;const store=await getStore(env);const record=await store.get('connection');if(!record)return env.GMAIL_REFRESH_TOKEN;const saved=open(record,env);if(saved.clientId!==env.GMAIL_CLIENT_ID||saved.account!==String(env.GMAIL_ACCOUNT||'').toLowerCase())throw Error('Gmail connection does not match configuration');return saved.refreshToken;}
module.exports={seal,open,getStore,refreshToken};
