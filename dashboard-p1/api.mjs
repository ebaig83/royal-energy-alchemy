// Local production review: credentials stay in the GET-only server adapter.
let current;
export async function loadData(includeQA=false){
 const r=await fetch('/.netlify/functions/p1-read-model'+(includeQA?'?include_qa=true':''),{method:'GET',credentials:'same-origin',headers:{Accept:'application/json','X-P1-Review':'read-only'},cache:'no-store'});
 if(r.status===401){const e=Error('Sign in to view production records.');e.status=401;throw e;}
 if(!r.ok)throw Error('Production data is unavailable. Reload to retry; no sample data has been substituted.');
 const result=await r.json();for(const k of ['clients','sessions','ledger','communications','aftercare','relationships'])if(!Array.isArray(result[k]))throw Error('Incomplete production read model');
 current={...result,now:new Date(result.now)};return current;
}
export async function clientDetail(id){
 if(!current)throw Error('Production data has not loaded');
 const linked=rows=>rows.filter(r=>r.client_id===id);
 return {record:{client:current.clients.find(c=>c.id===id),sessions:linked(current.sessions),aftercare:linked(current.aftercare),relationships:current.relationships.filter(r=>r.client_id===id||r.related_client_id===id).map(r=>({...r,client:current.clients.find(c=>c.id===(r.client_id===id?r.related_client_id:r.client_id))}))},messages:{communications:linked(current.communications)},finance:{entries:linked(current.ledger)},errors:[]};
}

export async function login(pin){const r=await fetch('/.netlify/functions/verify-pin',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});if(!r.ok)throw Error('Sign-in was not accepted. Check the PIN or try again later.');}
