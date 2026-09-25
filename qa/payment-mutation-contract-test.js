'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const endpoint = read('netlify/functions/payments.js');
const financial = read('netlify/functions/financial.js');
const financialUi = read('financial-module.js');
const practitionerCreate = read('netlify/functions/practitioner-create-session.js');
const reconciliationWorker = read('netlify/functions/payment-email-reconcile.js');
const reconciliationDashboard = read('netlify/functions/payment-reconciliation.js');
const hardeningMigration = read('supabase/migrations/20260925020224_appointment_attribution_booking_integrity_hardening.sql');
const executableHardening = hardeningMigration.replace(/\/\*[\s\S]*?\*\//g, '');
const correlationMigration = read('supabase/migrations/20260925020420_correlation_id_normalization.sql');
const paymentPolicyMigration = read('supabase/migrations/20260925020452_payment_overpayment_tip_policy.sql');
const migration = [executableHardening, correlationMigration, paymentPolicyMigration].join('\n');

const checks = [
  ['session-linked manual POST uses atomic ledger/session/audit RPC', endpoint.includes("rpc('practitioner_record_manual_payment_with_audit'")],
  ['standalone manual POST uses a dedicated audited RPC', endpoint.includes("rpc('practitioner_create_standalone_payment_with_audit'")],
  ['payment PATCH uses audited update RPC', endpoint.includes("rpc('practitioner_update_payment_with_audit'")],
  ['no active direct payment-ledger INSERT in endpoint', !/\.from\(['"]payments['"]\)\s*\.insert/.test(endpoint)],
  ['no active direct payment-ledger UPDATE in endpoint', !/\.from\(['"]payments['"]\)\s*\.update/.test(endpoint)],
  ['actor comes from authenticated practitioner session', endpoint.includes('p_actor_id:auth.user.id') && endpoint.includes('p_actor_email:auth.user.email')],
  ['each API mutation sends a correlation ID', endpoint.includes('const correlationId = requestCorrelationId(body)') && endpoint.includes('p_correlation_id:correlationId')],
  ['Stripe cannot be created or edited through manual API', endpoint.includes("String(body.method || '').toLowerCase() === 'stripe'") && endpoint.includes("String(updates.method || '').toLowerCase() === 'stripe'")],
  ['durable payment audit is RLS-protected and service-role-only', migration.includes('create table if not exists public.payment_mutation_audit') && migration.includes('alter table public.payment_mutation_audit enable row level security') && migration.includes('grant all on public.payment_mutation_audit to service_role')],
  ['manual linked payment transaction records payment and appointment audit', migration.includes("'manual_payment_recorded'") && migration.includes('insert into public.appointment_action_audit') && migration.includes('insert into public.payment_mutation_audit')],
  ['standalone RPC rejects session linkage and records payment audit', migration.includes("if nullif(p_payment->>'session_id','') is not null then raise exception 'Standalone payment cannot reference a session'") && migration.includes("'standalone_payment_recorded'")],
  ['manual mutation request IDs are idempotent', migration.includes("pg_advisory_xact_lock(hashtextextended('payment-mutation:'||p_correlation_id,0))") && migration.includes('Payment idempotency key was reused with different payment details')],
  ['session-linked payment edit recomputes paid state in transaction', migration.includes('practitioner_update_payment_with_audit') && migration.includes('new_total') && migration.includes('update public.sessions set amount_paid=new_total')],
  ['Stripe payment audit uses system attribution', migration.includes("'system','stripe_webhook',null,'stripe_webhook'") && migration.includes("'stripe_payment_recorded'")],
  ['reconciliation worker uses fixed-source audited RPC and correlation', reconciliationWorker.includes("rpc('payment_reconciliation_attach_with_audit'") && reconciliationWorker.includes('correlation_id: correlationId') && !reconciliationWorker.includes("rpc('payment_reconciliation_attach'")],
  ['dashboard reconciliation attach uses trusted practitioner RPC context', reconciliationDashboard.includes("rpc('payment_reconciliation_attach_with_audit'") && reconciliationDashboard.includes("p_actor_type: 'practitioner'") && reconciliationDashboard.includes('p_actor_id: auth.user.id') && reconciliationDashboard.includes('p_correlation_id: correlationId')],
  ['dashboard reconciliation decisions update item and audit atomically via RPC', reconciliationDashboard.includes("rpc('practitioner_decide_payment_reconciliation_item_with_audit'") && !/\.from\(['"]payment_reconciliation_items['"]\)\.update/.test(reconciliationDashboard) && !/\.from\(['"]payment_reconciliation_audit['"]\)\.insert/.test(reconciliationDashboard)],
  ['legacy caller-actor reconciliation RPC is retired', migration.includes('Legacy payment reconciliation mutation is retired') && migration.includes('revoke all on function public.payment_reconciliation_attach(uuid,uuid,text,text) from public,anon,authenticated,service_role')],
  ['reconciliation transaction writes payment and both audit records atomically', migration.includes('payment_reconciliation_attach_with_audit') && migration.includes('insert into public.payment_mutation_audit') && migration.includes('insert into public.appointment_action_audit')],
  ['all payment RPCs are restricted to service_role', (migration.match(/grant execute on function public\.(?:practitioner_record_manual_payment_with_audit|practitioner_create_standalone_payment_with_audit|practitioner_update_payment_with_audit)[^\n]*to service_role/g) || []).length === 3],
  ['intermediate text-correlation payment writers are not installed', !/create or replace function public\.(?:practitioner_record_manual_payment_with_audit|practitioner_create_standalone_payment_with_audit|practitioner_update_payment_with_audit)\s*\([\s\S]*?p_correlation_id text/.test(executableHardening) && !/create or replace function public\.practitioner_record_financial_payment_with_audit\s*\([\s\S]*?p_correlation_id uuid,p_request_path text/.test(executableHardening)],
  ['generic Finance ledger entries use audited RPC, not direct INSERT', financial.includes("rpc('practitioner_create_ledger_entry_with_audit'") && !/\.from\(['"]ledger_entries['"]\)\s*\.insert/.test(financial)],
  ['Finance payment and invoice balance use one transactional RPC', financial.includes("rpc('practitioner_record_financial_payment_with_audit'") && !/\.from\(['"]invoices['"]\)\.update\(upd\)/.test(financial)],
  ['Finance payment transaction nests linked session payment RPC', migration.includes('practitioner_record_financial_payment_with_audit') && migration.includes('public.practitioner_record_manual_payment_with_audit(')],
  ['Finance ledger audit is durable, RLS-protected, and actor/correlation attributed', migration.includes('create table if not exists public.financial_ledger_audit') && migration.includes('alter table public.financial_ledger_audit enable row level security') && migration.includes('correlation_id uuid not null unique')],
  ['payment status cannot be set through invoice metadata PATCH', financial.includes('Invoice payments must be recorded through the audited payment workflow.')],
  ['Finance UI reuses key on identical retry and rotates it when request payload changes', financialUi.includes('btn.dataset.idempotencySignature !== paymentSignature') && financialUi.includes('idempotency_key: idempotencyKey') && financialUi.includes('msg.dataset.idempotencySignature !== ledgerSignature')],
  ['financial mutation RPCs are service-role-only', migration.includes('grant execute on function public.practitioner_create_ledger_entry_with_audit(jsonb,text,text,uuid,text) to service_role') && migration.includes('grant execute on function public.practitioner_record_financial_payment_with_audit(uuid,text,uuid,uuid,uuid,numeric,text,text,date,text,text,text,uuid,text,text) to service_role')],
  ['Stripe correlation contract is defined once and checked, not text-rewritten', (executableHardening.match(/create or replace function public\.process_stripe_webhook_event_with_audit\s*\(/g) || []).length === 1 && correlationMigration.includes('stripe_rpc_contract') && !correlationMigration.includes('d:=replace(')],
  ['paid/partial manual appointment creation writes payment and payment audit atomically', migration.includes('manual_payment_recorded_at_appointment_creation') && migration.includes('insert into public.payment_mutation_audit') && practitionerCreate.includes("rpc('practitioner_create_appointment_with_audit'")],
];

checks.forEach(([name, ok]) => { assert.ok(ok, name); console.log('PASS', name); });
console.log(`Payment mutation contract: ${checks.length}/${checks.length} passed`);
