// Conservative identity audit; this module never writes records.
function classify(row,data,isQa){
 const parent=row.session_id?data.sessions.find(s=>s.id===row.session_id):null;
 if(isQa(row)||isQa(parent))return {classification:'QA/TEST',reason:'Explicit QA source/tag or known test identity'};
 if(parent?.client_id&&data.clients.some(c=>c.id===parent.client_id))return {classification:'EXACT LINK',client_id:parent.client_id,reason:'Persisted parent session UUID relationship'};
 const text=String(row.seller_notes||row.notes||'');
 const candidates=new Set();
 for(const id of text.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/ig)||[])if(data.clients.some(c=>c.id===id))candidates.add(id);
 const emails=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[];
 for(const email of emails)for(const c of data.clients.filter(c=>c.email?.toLowerCase()===email.toLowerCase()))candidates.add(c.id);
 const phone=text.match(/Phone:\s*([+\d ()-]+)/i)?.[1].replace(/\D/g,'');
 if(phone)for(const c of data.clients.filter(c=>(c.phone||'').replace(/\D/g,'')===phone))candidates.add(c.id);
 if(candidates.size===1)return {classification:'EXACT LINK',client_id:[...candidates][0],reason:'Exact persisted contact or UUID reference'};
 const names=data.clients.filter(c=>c.full_name===row.client_name);
 if(candidates.size>1||names.length)return {classification:'PROBABLE / NEEDS REVIEW',reason:'Conflicting contact matches or display name without corroborating identity',candidates:[...candidates,...names.map(c=>c.id)]};
 return {classification:'UNRESOLVED',reason:'No exact contact, UUID or corroborated historical identity'};
}
module.exports={classify};
