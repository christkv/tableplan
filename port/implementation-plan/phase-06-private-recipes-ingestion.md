# Phase 06 — Private Recipes and Ingestion

## Objective

Port private/household recipe creation, upload-based ingestion, extraction, review, editing,
and publication onto a durable job model. Ensure artifacts and recipes never cross owner or
household boundaries and retries cannot publish duplicates.

## Scope

- Manual private recipe create/edit and visibility changes.
- Multipart source upload and S3-compatible artifact storage.
- Persistent job publishing, leasing, retry, recovery, and dead-letter state.
- Deterministic extraction and OpenRouter-backed structured extraction.
- Review draft, ingredient mapping, remembered aliases, publish, and mutation events.
- `/recipes/new`, `/recipes/import/:ingestionId`, and `/recipes/:recipeId/edit`.

## Mandatory decisions before implementation

- [ ] Select Mongo-leased jobs or an existing managed queue behind the same `JobPublisher`
      and `JobHandler` ports. Default to Mongo leases if no destination standard exists.
- [ ] Select R2 through S3 or another S3-compatible store.
- [ ] Define upload media types, per-type and global size limits, retention, malware/content
      scanning policy, and deletion schedule.
- [ ] Define provider/model configuration, cost/time limits, and whether any private content
      may be sent to the configured model provider.
- [ ] Define dead-letter ownership and operator replay policy.

Record these as ADRs before production credentials are configured.

## Job model

At minimum, persist:

```text
id, type, schemaVersion, payloadReference
status, attempts, availableAt
leaseOwner, leaseExpiresAt
idempotencyKey, lastErrorCode
createdAt, updatedAt, completedAt
```

Rules:

- Claim with one atomic `findOneAndUpdate`.
- A worker may complete/fail only a job it still leases.
- Handlers are idempotent across process crashes and lease expiry.
- Retry uses bounded exponential backoff and jitter.
- Terminal failures are visible and replay requires an audited operator action.
- Job payloads contain references, not raw files, tokens, or credentials.
- `serve` may start pollers only when `JOBS_ENABLED=true`; operator modes never do.

## Workstream 1: artifact storage and uploads

- [ ] Define `ArtifactStore` put/get/head/delete interfaces and typed object references.
- [ ] Preserve the key boundary:
      `households/{householdId}/users/{userId}/recipe-ingestions/{ingestionId}/source`.
- [ ] Generate object keys server-side; never accept a full key from the browser.
- [ ] Stream multipart uploads with byte/time limits and without buffering entire files.
- [ ] Validate media type using content and declared type; normalize filenames for display
      only.
- [ ] Encrypt transport and provider storage, use least-privilege credentials, and never
      expose internal keys/bucket credentials to the SPA.
- [ ] Implement cleanup for abandoned/expired ingestion artifacts with dry-run support.

## Workstream 2: job engine

- [ ] Add `jobs` collection, validators, lease indexes, idempotency index, and schema version.
- [ ] Implement publish, claim, extend lease if needed, complete, retry, dead-letter, cancel,
      and audited replay.
- [ ] Bound worker concurrency separately from MVC request concurrency and Mongo pool use.
- [ ] Stop claiming during graceful shutdown and allow a bounded drain period.
- [ ] Recover safely after kill/restart and expired leases.
- [ ] Expose queue depth, oldest available age, active leases, attempts, dead letters, and
      handler duration.
- [ ] Add an operator inspection/replay command that never prints private payload content.

## Workstream 3: extraction adapters

- [ ] Plain text/Markdown UTF-8 extraction.
- [ ] PDF text extraction with detection of scan/low-text cases.
- [ ] DOCX/ODT extraction using a bounded JVM library path.
- [ ] Image/scan path through the configured vision provider when policy permits.
- [ ] OpenRouter adapter behind `RecipeExtractor`, with connect/read/total timeouts, request
      size limits, retry classification, and model identifier recording.
- [ ] Validate all provider output against the recipe-draft schema; provider JSON is
      untrusted input.
- [ ] Port deterministic parsing/normalization fixtures before enabling model extraction.
- [ ] Prevent document bombs, archive traversal, external entity resolution, and unbounded
      decompression.

## Workstream 4: ingestion workflow

- [ ] Create ingestion and artifact reference atomically enough that retries can reconcile
      partial upload failures.
- [ ] Define states and allowed transitions for uploaded, queued, extracting, review-ready,
      publishing, published, failed, cancelled, and expired.
- [ ] Make every transition compare-and-set against expected state/version.
- [ ] Store safe structured error codes for user display and restricted diagnostic detail for
      operators.
- [ ] Implement status polling with cache headers/backoff; do not expose worker lease fields.
- [ ] Allow safe retry from appropriate states without duplicating artifacts/jobs.
- [ ] Add retention/anonymization rules for provider inputs/outputs.

## Workstream 5: review, mapping, and publication

- [ ] Port recipe draft DTO/domain validation.
- [ ] Port ingredient/unit/tag matching and remembered alias behavior.
- [ ] Implement create/edit/visibility use cases with owner and household filters.
- [ ] Publish recipe, aliases, mutation event, and ingestion completion transactionally where
      possible.
- [ ] Enforce a unique publication/idempotency relationship so duplicate requests return one
      recipe.
- [ ] Recheck membership and role at publish time, not only upload time.
- [ ] Ensure private and household recipes enter search only under correct visibility.
- [ ] Define cleanup/reversal behavior if publication commits but a non-critical follow-up
      fails.

## Workstream 6: React/Vite

- [ ] Port manual new/edit forms with generated DTOs.
- [ ] Add streaming upload progress, cancel behavior, and exact file-limit feedback.
- [ ] Port ingestion status/review route with polling backoff and restart-safe navigation.
- [ ] Add mapping/review validation, provider warning, retry, failed, expired, and conflict
      states.
- [ ] Prevent duplicate publish submission and handle server idempotency result.
- [ ] Test direct navigation to an authorized and unauthorized ingestion.

## Testing

### Job and failure testing

- Lease claim exclusivity and expiry recovery.
- Worker killed before/after external call, state update, and transaction commit.
- Duplicate job publish and duplicate publish request.
- Retryable versus terminal provider/storage/database failures.
- Graceful shutdown with active jobs.
- Poison job reaching dead-letter and audited replay.

### Security and content testing

- Cross-user/household artifact, ingestion, draft, edit, and publication attempts.
- Media spoofing, oversized input, decompression bomb, path traversal, XML entity, malformed
  document, and provider prompt/output injection cases.
- Private content redaction from logs, metrics, traces, job records, and errors.
- Least-privilege object-store credential and pre-signed URL behavior if URLs are used.

### Functional

- Manual recipe create/edit/visibility.
- Each supported media type through review and publication.
- Deterministic and provider extraction fixtures.
- Alias memory and duplicate publication.
- Search visibility after publish/edit.
- Browser E2E from upload to published recipe.

## Deliverables

- Job engine and operational commands.
- Artifact store and extraction adapters.
- Private recipe/ingestion/publish backend slice.
- New/import/edit SPA routes.
- Security/failure/concurrency evidence.
- Dead-letter, provider outage, artifact cleanup, and job recovery runbooks.

## Risks and controls

| Risk | Control |
| --- | --- |
| Crash duplicates publication | State CAS, idempotency key, unique index, transaction |
| Private source leaks to logs/provider | Explicit provider policy and redaction/content tests |
| Parser accepts hostile document | Streaming limits and hardened per-format extraction |
| Job leases consume request pool | Separate bounded concurrency and connection budget |
| Abandoned artifacts accumulate | Retention metadata, dry-run cleanup, and metrics |

## Exit gate

Phase 06 is complete when every supported source can reach a validated review draft and one
published recipe; worker crash/retry tests cannot duplicate publication; dead letters are
operable; and private recipes, ingestion state, and artifacts remain inaccessible outside
the authorized user/household scope.

## Handoff to Phase 07

Provide the durable job engine, artifact store, recipe/export view models, safe retry
conventions, and operator visibility needed for email and PDF workflows.

