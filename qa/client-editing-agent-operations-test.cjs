const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const clients=read('netlify/functions/clients.js');
const actions=read('dashboard-p1/actions.mjs');
const app=read('dashboard-p1/app.mjs');
const telemetry=read('netlify/functions/lib/agent-telemetry.js');
const agentOps=read('dashboard-p1/agent-operations.mjs');
const migration=read('migrations/2026-09-10-client-profile-fields.sql');

assert(migration.includes('ADD COLUMN IF NOT EXISTS address text'));
assert(migration.includes('ADD COLUMN IF NOT EXISTS date_of_birth date'));
assert(migration.includes('ADD COLUMN IF NOT EXISTS emergency_contact text'));
assert(migration.includes('ADD COLUMN IF NOT EXISTS additional_information text'));
assert.equal((migration.match(/ADD COLUMN IF NOT EXISTS/g)||[]).length,4);

const patchBlock=clients.slice(clients.indexOf("if (event.httpMethod === 'PATCH')"));
for(const field of ['full_name','email','phone','address','date_of_birth','emergency_contact','additional_information','preferred_contact','notes','tags'])assert(patchBlock.includes(`'${field}'`));
assert(patchBlock.includes('if (!params.id)'));
assert(/\.from\('clients'\)[\s\S]*\.update\(updates\)[\s\S]*\.eq\('id', params\.id\)/.test(patchBlock));
assert(!patchBlock.includes(".from('clients').insert"));
assert(patchBlock.includes('EMAIL_RE.test'));
assert(patchBlock.includes('validPhone'));
assert(patchBlock.includes('validDateOnly'));
assert(patchBlock.includes('changed_fields'));
assert(!patchBlock.includes('oldData: old'));
assert(!patchBlock.includes('newData: data'));

assert(actions.includes('export function editClient'));
assert(actions.includes("call('clients?id='+encodeURIComponent(client.id),'PATCH',payload)"));
assert(actions.includes("form.dataset.submitting==='true'"));
for(const field of ['full_name','email','phone','address','date_of_birth','emergency_contact','preferred_contact','tags','notes','additional_information'])assert(actions.includes(`name="${field}"`));
assert(actions.includes('data-close'));
assert(app.includes('data-edit-client'));
assert(app.includes('profileField'));
assert(actions.includes('Sessions, appointments, finance, communications, and historical notes remain unchanged.'));
const editForm=actions.slice(actions.indexOf('export function editClient'),actions.indexOf('const form=document.querySelector',actions.indexOf('export function editClient')));
assert(!editForm.includes('name="session_date"'));
assert(!editForm.includes('name="session_time"'));

for(const [key,name,role,file] of [['manager','Spirit','Manager','agent-spirit.svg'],['dashboard','Stuart','Dashboard','agent-stuart.svg'],['website','Kevin','Website','agent-kevin.svg']]){
  assert(telemetry.includes(`${key}: {`));
  assert(telemetry.includes(`name: '${name}'`));
  assert(telemetry.includes(`role: '${role}'`));
  assert(telemetry.includes(`avatar: '/assets/${file}'`));
  assert(fs.existsSync(path.join(ROOT,'assets',file)));
  assert(!/https?:\/\//.test(read(`assets/${file}`).replace('http://www.w3.org','')));
}
assert(agentOps.includes('data-agent-avatar'));
assert(agentOps.includes("addEventListener('error'"));
assert(agentOps.includes('agent.agentRole'));
assert(!/src=["']https?:/.test(agentOps));

console.log('client editing and Agent Operations contract checks passed');
