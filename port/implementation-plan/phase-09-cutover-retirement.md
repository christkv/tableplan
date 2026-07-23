# Phase 09 — Cutover, Observation, and Runtime Retirement

## Objective

Move production to the Spring Boot JAR with controlled writes, verified schema and user
flows, an explicit rollback path, and an observation window. Retire the Cloudflare
application Worker, Mongo gateway, Durable Object sessions, Workflows, and Queues only after
the new runtime is proven stable.

## Preconditions

- [ ] Every prior phase exit gate is signed off with linked evidence.
- [ ] Release candidate is immutable, checksummed, scanned, and deployed successfully in
      preview through the production-like proxy/TLS topology.
- [ ] Production backup and isolated restore drill are current.
- [ ] Migration and index/search dry-run is clean against a recent production copy.
- [ ] Password/session/user communication policy is approved.
- [ ] On-call, database, platform, and product owners agree on cutover and rollback authority.
- [ ] The old deployment version/configuration is captured and can be restored without
      re-enabling incompatible writers.

## Cutover policy

Use a short controlled write cutover unless a separately approved dual-write design has been
built and tested. Schema preservation means no collection copy should be required.

Do not leave the old and new applications accepting independent writes. Read-only comparison
traffic is acceptable only when it cannot mutate sessions, last-used timestamps, jobs, audit
events, or provider state.

## T-minus checklist

### One or more weeks before

- [ ] Announce maintenance, forced re-login, and password reset impact where applicable.
- [ ] Freeze nonessential schema/contract changes in the old application.
- [ ] Run full regression, security, concurrency, load, and provider sandbox suites.
- [ ] Run cutover rehearsal on a production-copy restore and record timings.
- [ ] Validate production OAuth redirect URIs, email domain/provider, S3 policy, Atlas Search,
      TLS/proxy, DNS/origin, and observability.
- [ ] Confirm rollback-compatible migration set and mark one-way changes.
- [ ] Confirm raw-token/session behavior: Durable Object sessions will not be migrated.

### One day before

- [ ] Build and verify the exact release artifact/image again from the tagged commit.
- [ ] Run production migration dry-run, schema diff, Atlas Search status, connection budget,
      and storage/provider connectivity checks.
- [ ] Confirm backup success and restoration access.
- [ ] Confirm alert routing, dashboard access, log redaction, on-call staffing, and incident
      channel.
- [ ] Record baseline old-system error, latency, traffic, queue, and data counts.

## Cutover runbook

Every step requires timestamp, operator, result, and evidence link.

1. Start the change window and stop unrelated deployments/operator jobs.
2. Place the old application in maintenance or verified read-only mode.
3. Wait for in-flight old writes, queue claims, workflows, and imports to settle; record any
   unresolved work.
4. Take/confirm the cutover backup checkpoint for Mongo and object storage.
5. Run `migrate --dry-run` against production and compare to the approved rehearsal.
6. Run `migrate`, then `sync-indexes --dry-run`/approved apply and Atlas Search verification.
7. Deploy the immutable Spring Boot release with conservative replica/job settings.
8. Verify `/health/live`, `/health/ready`, internal metrics, Mongo pool, and dependency
   startup state.
9. Route controlled production traffic to the new origin.
10. Invalidate/ignore all old sessions and require sign-in under the approved policy.
11. Run automated and manual smoke tests:
    - registration if enabled, login, Google login, logout;
    - household bootstrap/switch/invitation;
    - recipe search/detail/favourite/saved search;
    - plan create/edit/copy and shopping generate/toggle;
    - private recipe upload/review/publish/edit;
    - public share/exchange/revoke;
    - email and every PDF variant;
    - API key and MCP;
    - importer/operator command only if scheduled for the window.
12. Verify static caching, direct SPA navigation, missing assets, API/MCP/download exclusions,
    cookie attributes, request IDs, and public origin URLs.
13. Compare key collection counts/schema, Atlas Search results, job state, errors, latency,
    and Mongo connection/pool metrics to expected values.
14. Make the go/no-go decision and record it.

## Rollback triggers

Set numeric thresholds before the window based on the Phase 08 capacity report. At minimum,
rollback is considered for:

- Sustained elevated error rate or tail latency beyond the agreed duration.
- Authentication failure affecting a material portion of valid accounts.
- Cross-household or private-data exposure: stop traffic immediately.
- Data corruption, duplicate critical writes, or unrecoverable job loss.
- Mongo pool exhaustion or connection impact to the cluster.
- Migration/index/search state that prevents core workflows.
- Provider/runtime failure with no safe degraded mode.

Security exposure or active corruption is a stop-the-line event, not an observation item.

## Rollback procedure

- [ ] Stop new Spring Boot writes and job claims.
- [ ] Capture logs, metrics, job leases, schema state, and database checkpoint.
- [ ] Decide from the migration ledger whether the old runtime is compatible with the current
      schema.
- [ ] Apply only the pre-approved rollback migration if required and verified safe.
- [ ] Restore traffic to the captured old deployment in read-write mode only after
      compatibility is confirmed.
- [ ] Reconcile jobs/email/provider calls so work is not duplicated.
- [ ] Communicate user/session impact and open an incident review.

Never perform an improvised database restore over production while either runtime is writing.

## Observation window

Keep the old deployment available but unable to write. Suggested evidence-based checkpoints:

- First hour: continuous monitoring and core-flow sampling.
- First business day: auth, latency, Mongo pool, job age/failures, provider outcomes, and
  support reports.
- Several normal usage cycles: weekly planning/shopping behavior, importer if scheduled,
  session expiration/renewal, email, ingestion, and backups.

At each checkpoint:

- [ ] Review errors and privacy/security denials.
- [ ] Review Mongo pool, slow commands, connections, and Atlas Search.
- [ ] Review job queue depth, lease age, retries, and dead letters.
- [ ] Review auth/password reset/OAuth outcomes.
- [ ] Review object storage, model provider, email, and PDF service.
- [ ] Reconcile key counts and sample domain invariants.
- [ ] Confirm backups continue and run a post-cutover restore check at the agreed time.

## Retirement

Only after the observation gate:

- [ ] Disable and then remove traffic routes to the old application and Mongo gateway.
- [ ] Stop old Workflows, Queues, cron triggers, importers, and Durable Object session usage.
- [ ] Revoke Cloudflare service-binding/gateway tokens and obsolete provider credentials.
- [ ] Apply data-retention policy to Durable Object sessions and obsolete queue/workflow
      state; record what is deleted and recovery implications.
- [ ] Archive old configuration, deployment identifiers, final metrics, and rollback window.
- [ ] Remove obsolete compatibility code only in a later reviewed release.
- [ ] Update architecture diagrams, onboarding, disaster recovery, support, and ownership docs.
- [ ] Close or schedule every temporary bridge, retained Node operator tool, and accepted risk.

DNS, deployment, credential, or stored-state deletion must follow platform change controls and
be independently reviewed because it can make rollback impossible.

## Final validation

- All program definition-of-done statements in the plan index are evidenced.
- No production request uses the Mongo gateway protocol.
- No active session/job relies on Durable Objects, Workflows, or Cloudflare Queues.
- Production runs the immutable Spring Boot artifact and embedded SPA.
- Backup/restore and incident ownership is accepted by the operating team.
- Old infrastructure and credentials are retired or have a dated, owned exception.

## Deliverables

- Completed timestamped cutover record.
- Go/no-go and any rollback record.
- Post-cutover parity, security, performance, and data-integrity report.
- Post-cutover restore evidence.
- Retirement inventory with credential/state disposition.
- Updated production architecture and final decision/risk register.

## Risks and controls

| Risk | Control |
| --- | --- |
| Old/new writers diverge | Maintenance/read-only cutover and one active writer |
| Rollback becomes impossible after migration | Rehearsed compatibility and explicit one-way marker |
| Retiring credentials breaks a hidden workflow | Phase 00/08 inventory plus observation window |
| Forced login overwhelms support/auth | User communication, monitored reset flow, staged traffic if possible |
| Quiet job failures appear days later | Observation across normal cycles and dead-letter alerts |

## Exit gate

Phase 09 and the port are complete when the Spring Boot runtime has passed the agreed
observation window, post-cutover restore and domain checks pass, no active production
capability depends on the old runtime, and old infrastructure is retired or covered by an
explicit dated exception with an owner.

