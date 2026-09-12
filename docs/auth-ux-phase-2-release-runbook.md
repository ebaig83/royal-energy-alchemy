# Auth UX Phase 2 release runbook

This runbook covers the staged release of remembered practitioner sessions and
self-service practitioner recovery. It contains variable names only. Never copy
credentials, tokens, hashes, or session cookies into this document or test logs.

## Release boundary and order

1. Phase 2A application commit: `8b83f77d784da61d7df648b2ee5949505f99ebf5`
2. Phase 2B application commit: `6fd0ca22b1c36054d21299961f2afcc53c5b90ea`
3. Netlify fixture-only correction: `540479af5ca8ef3ec2e9372248b03069b3ede689`
4. Versioned-session QA correction: `9e557bca00ec9b938db59f96de815c7109a8a575`

Phase 2B depends on Phase 2A because authenticated requests after Phase 2A use
the version-bound session contract, and recovery increments the practitioner
credential version and revokes old sessions. Apply and validate each migration
before deploying its corresponding application commit. The two QA corrections
change test fixtures only and may accompany the reviewed release.

## Prerequisites

- A Supabase project that is distinct from production.
- A Netlify staging/preview target connected only to that staging project.
- The existing base migrations for `admin_sessions`,
  `practitioner_credentials`, `practitioner_recovery_tokens`,
  `practitioner_recovery_attempts`, `email_templates`, and
  `transactional_notifications` already applied.
- A dedicated staging practitioner account and staging-only email recipient.
- A database snapshot or restorable backup captured before each phase.
- Production client, appointment, payment, Stripe, and Calendar data must not be
  copied unless it has been appropriately sanitized.

## Staging environment-variable inventory

Required for both phases:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SITE_URL`
- `ADMIN_EMAIL`
- `DASHBOARD_PIN` only while the approved legacy fallback remains in use

Required for Phase 2B email delivery:

- `RESEND_API_KEY`
- `FROM_EMAIL`

Optional/restricted:

- `VERIFY_PIN_ALLOWED_ORIGINS` when staging uses more than one approved origin
- `PRACTITIONER_RECOVERY_ADMIN_SECRET` only for the existing restricted admin
  recovery path; it is not required by the public recovery-request endpoint
- `PRACTITIONER_RECOVERY_DIAGNOSTIC` must remain unset or `false`

Every value must be staging-specific, protected, and available to Functions at
runtime. Verify presence only. Do not print values or run commands that echo the
environment.

## Phase 2A migration review

Migration: `migrations/2026-09-11-auth-ux-phase-2a-remembered-sessions.sql`

Expected effects:

- Adds `admin_sessions.remembered` with default `false`.
- Adds `admin_sessions.credential_version`.
- Adds `admin_sessions.absolute_expires_at`.
- Backfills existing sessions with the current credential version and existing
  expiry. This is an intentional administrative-session data update.
- Makes the version and absolute-expiry fields non-null.
- Adds the partial `admin_sessions_policy_idx` index.
- Replaces/creates the service-role-only `practitioner_login_session` RPC.

The migration is transactional and repeatable for columns, index, and RPC. It
does not touch clients, sessions/appointments, payments, Stripe, or Calendar
records. Re-running it may repeat the guarded backfill query but should not
change already populated values.

### Phase 2A staging checklist

1. Record counts and null counts for the three target session columns.
2. Apply the Phase 2A migration to staging.
3. Verify all three columns, constraints, index, RPC signature, grants, and
   revoked public/anon/authenticated execution.
4. Verify every pre-existing active session received a valid version and
   absolute expiry without being revoked.
5. Deploy Phase 2A application code to staging.
6. Verify normal login creates an 8-hour session.
7. Verify `remember_me: true` creates a 30-day absolute expiry.
8. Verify the client cannot submit a custom expiry.
9. Verify remembered sessions become invalid after seven days without activity.
10. Verify normal sessions are not subjected to the remembered idle policy.
11. Verify a stale credential-version session is rejected.
12. Verify logout revokes the active session and clears the cookie.
13. Verify cookies remain `HttpOnly`, `Secure`, and `SameSite=Strict`.
14. Verify the browser stores no plaintext password/PIN.

## Phase 2B migration review

Migration: `migrations/2026-09-11-auth-ux-phase-2b-self-service-recovery.sql`

Expected effects:

- Adds three nullable metadata columns to `practitioner_recovery_tokens`.
- Creates the RLS-protected `practitioner_recovery_audit` table and index.
- Creates the service-role-only `practitioner_recovery_request_attempt` RPC.
- Inserts or updates the `practitioner_password_recovery` email template.

The migration is transactional and isolated from client/payment records. It is
idempotent at the schema/RPC/template-key level, but the email-template upsert
will intentionally restore the reviewed template content and activate it on
every run.

### Phase 2B staging checklist

1. Confirm the Phase 2A staging gate is fully passed.
2. Record recovery-token, rate-limit, template, and audit metadata before the
   migration without reading hashes or token values.
3. Apply the Phase 2B migration to staging.
4. Verify new columns, audit RLS/grants/index, RPC signature/grants, and active
   recovery template.
5. Deploy Phase 2B application code to staging.
6. Submit an ineligible address and verify the same generic 202 response as an
   eligible request; do not expose account existence.
7. Submit the staging practitioner address and verify one staging email arrives.
8. Verify the stored recovery token is hashed and expires in 20 minutes.
9. Verify the raw token appears only in the delivered reset URL and never in
   server logs, audit rows, communications metadata, or API responses.
10. Complete one reset and verify the token cannot be reused.
11. Verify the credential version increments and all prior sessions are revoked.
12. Verify the new credential authenticates and creates a version-bound cookie.
13. Verify request and completion rate limits.
14. Verify audit rows contain outcomes and hashes only, with no raw identifier,
   password, credential hash, token, or secret.
15. Verify Resend idempotency prevents duplicate recovery messages for the same
   reserved notification.

## Test matrix

Run locally before staging:

```text
node qa/auth-ux-phase-2a-test.cjs
node qa/auth-ux-phase-2b-test.cjs
node qa/admin-session-auth-test.js
node qa/p1-endpoint-auth-test.cjs
node qa/p1-reconciliation-endpoint-test.cjs
node qa/payment-email-reconciliation-test.cjs
node qa/payment-email-reconciliation-contract-test.cjs
node qa/p1-dashboard-bootstrap-test.mjs
node qa/p1-dashboard-ui-test.cjs
npm run qa
```

Run `npm run qa` only with the approved staging credential supplied privately to
the process. Do not print it, save it in source, or commit an environment file.
Clear it from the process environment after the run.

For every changed JavaScript module, run `node --check`. Also run:

```text
git diff --check
git diff --cached --check
```

Perform a secret-pattern scan against tracked and staged changes. Confirm the
Netlify build scanner no longer reports a collision in
`qa/payment-email-reconciliation-test.cjs` after commit `540479a`.

## Release gates

Phase 2A may proceed only when its migration, session compatibility, real RPC,
cookie, browser, and authenticated QA checks pass in staging. Phase 2B may
proceed only after Phase 2A and its own email/token/rate-limit/audit tests pass.

For production, repeat the sequence migration first, then exact reviewed code.
Stop before application deployment if schema verification fails. Stop and roll
back application code if authentication, session validity, or recovery privacy
checks fail. Do not continue to the next phase after a critical failure.

## Rollback strategy

### Phase 2A

1. Redeploy the last known-good application commit first.
2. Preserve the added columns and backfilled session metadata during immediate
   rollback; dropping columns is unnecessary and could destroy audit context.
3. Restore the prior `practitioner_login_session` RPC definition from the
   pre-migration database snapshot if the previous application requires it.
4. Revoke unexpectedly issued staging sessions if testing exposed a policy bug.
5. Do not alter practitioner credentials unless separately approved.

### Phase 2B

1. Redeploy the Phase 2A-only application commit.
2. Disable access to the recovery-request function at the deployment layer if a
   security defect is suspected.
3. Preserve recovery tokens and audit rows for investigation; do not delete them.
4. Deactivate the recovery email template if messages must stop immediately.
5. Revoke execution on `practitioner_recovery_request_attempt` only if required
   to contain the issue, then restore the reviewed definition before re-release.
6. Do not reverse a completed credential change automatically.

## Production verification after approval

- Confirm the deployed commit and deploy ID.
- Verify normal and remembered authentication, logout, recovery, and
  version-bound session invalidation.
- Verify worker health, Agent Operations telemetry, and Manager Communication.
- Verify Schedule/Today client names, booking payment gating, Stripe webhook
  authority, and Calendar eligibility using read-only checks.
- Confirm no client, appointment, payment, Stripe, or Calendar record changed as
  a side effect of the authentication release.
