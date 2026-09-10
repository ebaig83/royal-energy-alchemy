# Royal Energy Alchemy Agent Release Status

Manager-maintained release state. No secrets or credential values belong in this file.

## Baseline

- Current production commit: `3a97f7839d2166f8b2c0da89dfb0121a26c481f3`
- Current production deploy: `6aa1ee2edd8a0721f5cc58a2`
- Last verified health state: Google Calendar healthy; authorization refresh and Calendar read healthy; Calendar worker healthy; payment-reconciliation worker healthy; practitioner dashboard accessible
- Automatic payment attachment: OFF
- Service pricing: all 11 services match the canonical backend catalog
- Add Appointment defaults: waiver unchecked; payment unchecked; Meet unchecked

## Worktree and release state

- Original checkout status: dirty; modified `.gitignore` and numerous untracked files remain untouched and is not a release source
- Netlify publish boundary: `publish = "."`; deploy only from this Manager worktree or a clean reviewed export
- Builder branches: `agent/website`, `agent/dashboard`
- Manager branch: `agent/manager`
- Active file locks: Manager owns shared auth, libraries, schema, migrations, provider integrations, deployment configuration, and package files
- Active builder tasks: none
- Unreleased handoffs: none
- Pending migrations: six untracked migrations require production-schema/application reconciliation before versioning; none applied in this pass

## Governance

- Website and Dashboard Agents may inspect, edit assigned files, test, commit only to their own branches, and prepare HANDOFF reports. They may not push to `main`, deploy, apply migrations, change environment variables, or perform production mutations.
- Manager integrates only reviewed builder commits/patches into `agent/manager`, stages exact files, reviews migrations and environment readiness, and is the sole authority for push/deploy/production changes.

## Release procedure

1. Manager receives a HANDOFF with branch, commit, exact files, tests, migration/env impact, and rollback notes.
2. Manager reviews the diff and cherry-picks or applies only the approved patch into `agent/manager`.
3. Manager verifies clean status, stages an explicit file list, runs cached diff checks and secret scanning, and reviews migration/env impact.
4. Manager commits from a clean Manager worktree, pushes the reviewed branch/approved target, deploys only that clean commit, and performs post-deploy verification.
5. Stop and roll back to the last known-good commit on failed tests, unexpected staged files, secret exposure, migration uncertainty, health regression, or production-data anomaly.

## Ownership map

| Area | Owner | Coordination rule |
| --- | --- | --- |
| Public pages, public styles/assets, public booking UI | Website Agent | Public-site scope only; no dashboard, functions, migrations, or deploy config |
| `dashboard-p1/*`, `dashboard-p1.html`, clearly practitioner-only dashboard tests/functions | Dashboard Agent | Shared backend dependencies require Manager review |
| `sessions.js`, `manage-appointment.js`, `verify-pin.js`, `session-calendar-sync.js` | Manager | Shared lifecycle/auth/Calendar behavior; builders submit patches only |
| `netlify/functions/lib/*` | Manager | Shared provider, auth, payment, Calendar, Gmail, and data-access code |
| `netlify.toml`, package manifests/lockfiles, migrations, environment variables | Manager | Exact-file review and release control |

## Publish boundary

Netlify uses `publish = "."`. Never deploy from the original dirty checkout or a builder worktree. Deploy only from a clean, committed Manager worktree or a clean archive produced from the reviewed Manager commit.
