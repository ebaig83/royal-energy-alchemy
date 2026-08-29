# Workflow Validation Production QA Runbook

## Preconditions

- The adapter, fixture, and validator lifecycle unit suites pass locally.
- Client Journey QA is green.
- `git diff --check` passes.
- The existing server-side Supabase QA URL and service-role configuration are available.
- No incomplete workflow manifest exists. An incomplete manifest must be recovered before a new run.

## Safety rules

- Execute exactly one explicitly approved run at a time.
- Use only a unique `[QA][workflow-<timestamp>-<random>]` fixture.
- Never select or fall back to an existing client.
- Never perform heuristic cleanup by name, email, date, or partial marker.
- Never call production workflow write endpoints from adapter persistence QA.
- Stripe, payments, refunds, Resend, customer/practitioner email, real booking, and customer-facing availability actions must remain blocked.
- Never print or store credential values in output or manifests.

## Create the fixture

Generate a unique run ID, then use the fixture lifecycle tool:

```text
node qa/workflow-fixture.js create workflow-<timestamp>-<random>
```

Confirm the resulting manifest contains schema version 1, the exact run ID, an exact QA client ID, a matching `[QA]` marker, and one registered client entry.

## Execute one validation

Instantiate `SupabaseWorkflowAdapter` from the existing server-side QA environment and call `executeRun(manifestPath, adapter)` exactly once. Do not invoke customer-facing workflow endpoints.

The validator creates and tracks one session, one session note, one follow-up, and one recommendation. Every exact ID is persisted to the manifest before dependent work continues.

## Manifest and teardown behavior

The manifest persists run ownership, created records, mutation snapshots, creation order, and cleanup status. The lifecycle always enters teardown through `finally`.

Expected cleanup order:

1. Restore any snapshotted pre-existing QA mutations.
2. Delete recommendations.
3. Delete follow-ups.
4. Delete session notes.
5. Delete sessions.
6. Delete the disposable QA client last.

Each action targets an exact primary key and is verified before its entry is marked complete.

## Success criteria

- Validation passes with no warnings or failures.
- Teardown and cleanup verification pass.
- Every registered ID is absent afterward.
- Any snapshots exactly match their original state.
- No current-run QA records remain.
- No transactional or external side effects occur.

After verified cleanup, remove the completed runtime manifest. Runtime manifests and `.workflow-runs` are ignored by Git.

## Cleanup failure and recovery

If cleanup fails, stop. Retain the manifest and report every exact remaining table/type/ID. Do not broaden cleanup.

Recovery mode must load that manifest, create no records, run no validation steps, and resume only pending exact-ID cleanup and verification:

```text
node qa/workflow-validation.js --recover <manifest>
```

Use the controlled runner that supplies the Supabase adapter; direct validator execution remains disabled without an explicit adapter and manifest.

## Coverage boundary

Adapter-based QA validates direct workflow persistence and reversible state transitions. It does **not** claim end-to-end write coverage for production sessions, session-note processing, aftercare, or recommendation HTTP endpoints because those endpoints can have indirect writes. Their safe coverage is limited to read-only and contract checks documented in `workflow-endpoint-contract.md`.
