'use strict';

const ALLOWED = new Set(['clients','sessions','session_notes','aftercare','recommendations']);
function loadConfig(env=process.env){const url=env.SUPABASE_URL||env.QA_SUPABASE_URL;const key=env.SUPABASE_SERVICE_ROLE_KEY||env.QA_SUPABASE_SERVICE_ROLE_KEY||env.QA_SERVICE_ROLE_KEY;if(!url||!key)throw new Error('Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or existing QA aliases)');return{url:url.replace(/\/$/,''),key};}
class SupabaseWorkflowAdapter{
  constructor({url,key,fetchImpl=globalThis.fetch}={}){if(!url||!key)({url,key}=loadConfig());if(typeof fetchImpl!=='function')throw new Error('Fetch implementation required');this.url=url.replace(/\/$/,'');this.key=key;this.fetch=fetchImpl;}
  _table(table){if(!ALLOWED.has(table))throw new Error(`Unsupported QA table: ${table}`);return table;}
  async _request(method,table,{id,body,select='*'}={}){this._table(table);const q=id?`?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(select)}`:`?select=${encodeURIComponent(select)}`;const res=await this.fetch(`${this.url}/rest/v1/${table}${q}`,{method,headers:{apikey:this.key,Authorization:`Bearer ${this.key}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});const text=await res.text();let data=null;if(text){try{data=JSON.parse(text)}catch{data=text}}if(!res.ok)throw new Error(`Supabase QA ${method} ${table} failed (${res.status})`);return data;}
  async get(table,id){if(!id)throw new Error('Exact ID required');const rows=await this._request('GET',table,{id});return Array.isArray(rows)?rows[0]||null:rows;}
  async create(table,row){const rows=await this._request('POST',table,{body:row});const out=Array.isArray(rows)?rows[0]:rows;if(!out?.id)throw new Error(`Supabase QA create ${table} returned no primary key`);return out;}
  async update(table,id,fields){if(!id)throw new Error('Exact ID required');const rows=await this._request('PATCH',table,{id,body:fields});const out=Array.isArray(rows)?rows[0]:rows;if(!out?.id||out.id!==id)throw new Error(`Supabase QA update ${table} did not return exact ID`);return out;}
  async remove(table,id){if(!id)throw new Error('Exact ID required');await this._request('DELETE',table,{id});return (await this.get(table,id))===null;}
}
module.exports={SupabaseWorkflowAdapter,loadConfig,ALLOWED};
