import {escapeHTML as E} from './model.mjs';

const fields=[['full_name','Name'],['email','Email'],['phone','Phone'],['address','Address'],['date_of_birth','Date of birth'],['emergency_contact','Emergency contact'],['additional_information','Additional information'],['preferred_contact','Preferred contact']];
const labels={sessions:'Sessions',communications:'Communications',payments:'Payment-linked records',intakes:'Intakes',aftercare:'Aftercare'};
const value=(obj,key,side)=>{const raw=obj?.profile?.[key]??obj?.[key]??'';return raw&&typeof raw==='object'&&('primary' in raw||'duplicate' in raw)?raw[side]??'':raw;};
const display=value=>value===''||value==null?'Not recorded':String(value);

export async function loadDuplicateAudit(fetchImpl=fetch){
 const response=await fetchImpl('/.netlify/functions/client-duplicate-audit',{method:'GET',credentials:'same-origin',headers:{Accept:'application/json','X-P1-Review':'read-only'},cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'Sign in to review possible duplicates.':'Duplicate audit is temporarily unavailable.');
 const body=await response.json();return Array.isArray(body.candidates)?body: {readOnly:true,candidates:[]};
}

export async function loadMergePreview(primaryId,duplicateId,fetchImpl=fetch){
 const params=new URLSearchParams({primary_id:primaryId,duplicate_id:duplicateId});
 const response=await fetchImpl('/.netlify/functions/client-merge-preview?'+params.toString(),{method:'GET',credentials:'same-origin',headers:{Accept:'application/json','X-P1-Review':'read-only'},cache:'no-store'});
 if(!response.ok)throw Error(response.status===401?'Sign in to preview a merge.':'Merge preview is temporarily unavailable.');
 return response.json();
}

export function candidateClientIds(candidate){return new Set((candidate?.clients||[]).map(client=>client.id));}
export function renderDuplicateBadge(){return '<span class="badge purple duplicate-badge">Possible duplicate</span>';}
export function mergeResolutionComplete(preview,resolutions){return (preview?.conflicts||[]).every(conflict=>resolutions?.[conflict.field]==='primary'||resolutions?.[conflict.field]==='duplicate');}

function pairOptions(candidates,primaryId,duplicateId){return candidates.flatMap(candidate=>candidate.clients||[]).filter((client,index,all)=>all.findIndex(other=>other.id===client.id)===index).map(client=>`<option value="${E(client.id)}" ${client.id===primaryId?'selected':''}>${E(client.name||client.full_name||client.id)}</option>`).join('');}
export function renderMergeWorkflow({candidates=[],primaryId='',duplicateId='',preview=null,resolutions={},stage='select',error='' }={}){
 if(stage==='select')return `<div class="merge-workflow" data-merge-stage="select"><p class="muted">Read-only duplicate review. No records change until an explicitly approved merge is submitted.</p><div class="merge-select-grid"><label>Primary profile<select data-merge-primary>${pairOptions(candidates,primaryId,duplicateId)}</select></label><label>Possible duplicate<select data-merge-duplicate>${pairOptions(candidates,duplicateId,primaryId)}</select></label></div><button type="button" class="gold" data-load-merge-preview>Load read-only preview</button><p class="muted">Preview only: historical records and payment evidence are preserved.</p>${error?`<p role="alert">${E(error)}</p>`:''}</div>`;
 if(stage==='confirm')return `<div class="merge-workflow" data-merge-stage="confirm"><span class="eyebrow">Final confirmation</span><h3>Ready to merge profiles?</h3><p>This will remove the duplicate from the active client list while preserving historical sessions, communications, and Stripe/payment evidence.</p><p class="muted">Primary: ${E(preview?.primary?.profile?.full_name||preview?.primary?.id||'Not recorded')} · Duplicate: ${E(preview?.duplicate?.profile?.full_name||preview?.duplicate?.id||'Not recorded')}</p><label class="check"><input type="checkbox" data-merge-confirm> I reviewed the conflicts and want to continue.</label><button type="button" class="gold" data-execute-merge disabled>Confirm merge</button><button type="button" data-merge-back>Back to preview</button><p class="muted" data-merge-result>Merge execution is disabled in this environment. No changes have been made.</p></div>`;
 const counts=preview?.relatedCounts||{};
 const countRows=Object.entries(labels).map(([key,label])=>{const row=counts[key]||{};return `<li><span>${label}</span><strong>${Number(row.primary?.count||0)} + ${Number(row.duplicate?.count||0)}</strong></li>`;}).join('');
 const conflicts=preview?.conflicts||[];
 return `<div class="merge-workflow" data-merge-stage="preview"><p class="muted">Read-only merge preview · zero writes performed.</p><div class="merge-comparison"><div class="merge-column"><h3>Primary profile</h3>${fields.map(([key,label])=>`<div class="merge-field"><span>${label}</span><strong>${E(display(value(preview?.primary,key,'primary')))}</strong></div>`).join('')}</div><div class="merge-column"><h3>Possible duplicate</h3>${fields.map(([key,label])=>`<div class="merge-field"><span>${label}</span><strong>${E(display(value(preview?.duplicate,key,'duplicate')))}</strong></div>`).join('')}</div></div>${conflicts.length?`<fieldset class="merge-conflicts"><legend>Resolve conflicts before continuing</legend>${conflicts.map(conflict=>`<label><span>${E(conflict.field)}</span><select data-merge-resolution="${E(conflict.field)}"><option value="">Choose a value</option><option value="primary" ${resolutions[conflict.field]==='primary'?'selected':''}>Keep primary</option><option value="duplicate" ${resolutions[conflict.field]==='duplicate'?'selected':''}>Keep duplicate</option></select></label>`).join('')}</fieldset>`:'<p class="badge green">No field conflicts detected</p>'}<section class="merge-counts"><h3>Related records preserved</h3><ul>${countRows}</ul><p>Upcoming appointments: ${Number.isFinite(preview?.upcomingAppointments)?preview.upcomingAppointments:(preview?.upcomingAppointments?.length||0)}</p><p>Calendar/session references: ${Number.isFinite(preview?.calendarReferences)?preview.calendarReferences:(preview?.calendarReferences?.length||0)}</p></section>${preview?.unresolvedReferences?.length?`<aside class="merge-warning" role="alert"><strong>Unresolved linkage warnings</strong><ul>${preview.unresolvedReferences.map(w=>`<li>${E(typeof w==='string'?w:w.message||'Reference needs review')}</li>`).join('')}</ul></aside>`:''}<button type="button" class="gold" data-review-merge ${mergeResolutionComplete(preview,resolutions)?'':'disabled'}>Continue to final confirmation</button><button type="button" data-merge-back>Back</button>`;
}

export async function executeMerge(primaryId,duplicateId,resolutions,fetchImpl=fetch){
 if(globalThis.__ALLOW_CLIENT_MERGE__!==true)return {disabled:true};
 const response=await fetchImpl('/.netlify/functions/client-merge',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({primary_id:primaryId,duplicate_id:duplicateId,resolutions})});
 if(!response.ok)throw Error('Merge was not accepted. No assumptions were made about record state.');
 return response.json();
}
