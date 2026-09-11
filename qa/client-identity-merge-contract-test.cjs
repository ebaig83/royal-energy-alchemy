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
assert.match(app, /s\?\.client_name\|\|'Client not linked'/);

const softMerged = model.project({
  clients: [
    { id: 'p', full_name: 'Primary Name', merged_into_client_id: null },
    { id: 'd', full_name: 'Duplicate Name', merged_into_client_id: 'p' },
  ],
  sessions: [{ id: 'merged-session', client_id: 'd', client_name: 'Historical Duplicate', session_date: '2026-01-02', session_time: '10:00', status: 'confirmed' }],
  ledger_entries: [], payments: [], communications: [], aftercare: [], client_relationships: [], session_notes: [],
});
assert.equal(softMerged.sessions[0].client_display_name, 'Primary Name');
assert.equal(softMerged.sessions[0].client_name, 'Primary Name');
assert.equal(softMerged.sessions[0].historical_client_name, 'Historical Duplicate');

const missingLink = model.project({
  clients: [],
  sessions: [{ id: 'missing-link', client_id: 'gone', client_name: 'Historical Client', session_date: '2026-01-03', status: 'pending' }],
  ledger_entries: [], payments: [], communications: [], aftercare: [], client_relationships: [], session_notes: [],
});
assert.equal(missingLink.sessions[0].client_display_name, 'Historical Client');
assert.equal(missingLink.sessions[0].client_name, 'Historical Client');

const unlinked = model.project({
  clients: [],
  sessions: [{ id: 'unlinked', client_id: null, client_name: 'Planner Snapshot', session_date: '2026-01-04', status: 'pending' }, { id: 'unknown', client_id: null, client_name: null, session_date: '2026-01-05', status: 'pending' }],
  ledger_entries: [], payments: [], communications: [], aftercare: [], client_relationships: [], session_notes: [],
});
assert.equal(unlinked.sessions[0].client_display_name, 'Planner Snapshot');
assert.equal(unlinked.sessions[1].client_display_name, null);
assert.equal(unlinked.sessions[1].session_date, '2026-01-05');
assert.equal(unlinked.sessions[1].status, 'pending');
assert.match(clients, /\.update\(updates\)[\s\S]*\.eq\('id', params\.id\)/);
assert.match(clients, /merged_into_client_id/);
assert.match(audit, /event\.httpMethod !== 'GET'/);
assert.match(audit, /normalized exact email match/);
assert.match(audit, /name_similarity_manual_review/);
assert.match(audit, /manualVerificationRequired/);
assert.equal(identity.nameSimilarityManual('Erika Baig', 'Erika'), true);
assert.equal(identity.nameSimilarityManual('Ava Martinez', 'Evan Martin'), false);
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
