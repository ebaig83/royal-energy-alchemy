const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const model = require(path.join(root, 'netlify/functions/lib/p1-read-model'));
const identity = require(path.join(root, 'netlify/functions/lib/client-identity'));
const app = fs.readFileSync(path.join(root, 'dashboard-p1/app.mjs'), 'utf8');
const clients = fs.readFileSync(path.join(root, 'netlify/functions/clients.js'), 'utf8');
const audit = fs.readFileSync(path.join(root, 'netlify/functions/client-duplicate-audit.js'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'netlify/functions/client-merge-preview.js'), 'utf8');
const merge = fs.readFileSync(path.join(root, 'netlify/functions/client-merge.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/2026-09-10-client-merge.sql'), 'utf8');

assert.equal(identity.normalizeEmail('  A@Example.COM '), 'a@example.com');
assert.equal(identity.normalizePhone('(814) 392-2095'), '8143922095');
const raw = {
  clients: [{ id: 'p', full_name: 'Canonical Name', email: null, phone: null, merged_into_client_id: null }],
  sessions: [{ id: 's', client_id: 'p', client_name: 'Historical Name', session_date: '2026-01-01' }],
  ledger_entries: [], payments: [], communications: [], aftercare: [], client_relationships: [], session_notes: [],
};
const projected = model.project(raw);
assert.equal(projected.sessions[0].client_name, 'Canonical Name');
assert.equal(projected.sessions[0].client_display_name, 'Canonical Name');
assert.equal(projected.sessions[0].historical_client_name, 'Historical Name');
assert.match(app, /client_display_name/);
assert.match(app, /client_name\|\|'Client not linked'/);
assert.match(clients, /\.update\(updates\)[\s\S]*\.eq\('id', params\.id\)/);
assert.match(clients, /merged_into_client_id/);
assert.match(audit, /event\.httpMethod !== 'GET'/);
assert.match(audit, /normalized exact email match/);
assert.doesNotMatch(audit, /name similarity|exact name match/);
assert.match(preview, /readOnly: true/);
assert.match(preview, /countRelated/);
assert.match(merge, /event\.httpMethod !== 'POST'/);
assert.match(merge, /Manager authorization required/);
assert.match(merge, /CLIENT_MERGE_ENABLED !== 'true'/);
assert.match(merge, /rpc\('merge_client_profiles'/);
assert.match(migration, /BEGIN;/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS merged_into_client_id/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.client_merge_audits/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.merge_client_profiles/);
assert.match(migration, /self merge is not allowed/);
assert.match(migration, /conflict requires explicit resolution/);
assert.match(migration, /client_merge_duplicate_once_idx/);
assert.match(migration, /COMMIT;/);
assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM public\./i);
console.log('client identity, canonical display, duplicate audit, preview, soft-merge, rollback, and migration contracts passed');
