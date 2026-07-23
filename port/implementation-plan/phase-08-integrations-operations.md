# Phase 08 — Contracts, MCP, Import, and Operational Readiness

## Objective

Complete machine-client and operator parity, then prove the Spring Boot artifact can be
deployed, observed, backed up, restored, and operated without the old application runtime.

## Scope

- Complete OpenAPI and generated TypeScript client.
- MCP Streamable HTTP tools and API-key scope enforcement.
- Agent Skill/documentation contract updates.
- Raw catalog import and facet refresh.
- Final schema/index/Atlas Search operations.
- Deployment, health, observability, security, capacity, backup/restore, and incident
  runbooks.

## Workstream 1: contract completion

- [ ] Reconcile every active endpoint with `contracts/openapi.yaml`.
- [ ] Define reusable schemas for pagination, errors, principals, dates, quantities, jobs,
      shares, and exports.
- [ ] Ensure examples contain no real identifiers or secrets.
- [ ] Run provider-side conformance tests for status, headers, and body.
- [ ] Generate the frontend client reproducibly and fail CI on uncommitted drift according to
      the chosen generated-code policy.
- [ ] Diff the old and new public contracts and document every intentional break.
- [ ] Serve the versioned contract at `/api/v1/openapi.json`.

## Workstream 2: MCP and Agent Skills

- [ ] Freeze the existing tool names, descriptions, inputs, outputs, error mapping, and API
      scopes from Phase 00 evidence.
- [ ] Spike the chosen Kotlin MCP library against current Streamable HTTP test vectors; use a
      small protocol adapter if a library adds unacceptable behavior.
- [ ] Implement MCP tools over application services, never HTTP back into the same JVM.
- [ ] Reuse the unified API-key principal and authorization checks.
- [ ] Bound request/tool execution, payload size, concurrency, and external-provider work.
- [ ] Test session/concurrency behavior and structured result schemas.
- [ ] Update Agent Skill endpoint examples only after parity is verified.
- [ ] Add a protocol compatibility report using the current supported clients.

## Workstream 3: importer and facet operations

- [ ] Inventory raw catalog import, resume/checkpoint, issue reporting, and facet refresh
      behavior.
- [ ] Implement `import-catalog` and `refresh-recipe-facets` in the JAR, or formally retain
      Node scripts with an owner and retirement date.
- [ ] Use streaming/batched reads, bounded memory, bulk writes, checkpoints, and idempotent
      upserts.
- [ ] Preserve `import_runs` and `import_issues` schema/semantics.
- [ ] Add dry-run/validation-only mode where feasible.
- [ ] Make interruption/resume safe and test it on production-shaped volumes.
- [ ] Prevent importer pool use from exhausting serving replicas; operator modes do not start
      HTTP/jobs.
- [ ] Verify Atlas Search and facets after import completion.

## Workstream 4: migration and schema parity

- [ ] Reconcile all 28 collections, validators, named indexes, TTLs, and Atlas Search against
      Phase 00 evidence.
- [ ] Test fresh-database apply, current-database no-op, partial-failure recovery, checksum
      mismatch, and concurrent migrator lock.
- [ ] Separate safe additive changes from destructive/long-running operator approval.
- [ ] Produce human-readable dry-run output and machine-readable CI output.
- [ ] Verify migration on a restored production copy before cutover.
- [ ] Document downgrade/rollback constraints for each applied migration.

## Workstream 5: deployment and capacity

- [ ] Define runtime image with pinned JDK, non-root user, CA certificates, timezone data, and
      Chromium only if selected.
- [ ] Use immutable JAR/image versions and publish checksums/SBOM.
- [ ] Define environment configuration and secret injection; no secrets in image or repo.
- [ ] Test proxy/TLS headers, public origin, OAuth callback, cookies, uploads, downloads, and
      graceful termination in the actual destination topology.
- [ ] Calculate Mongo connection budget:

```text
web replicas × web maxPoolSize
+ job-enabled replicas × additional worker demand
+ importer/admin headroom
< Atlas connection budget with safety margin
```

- [ ] Decide replica count and whether every replica runs jobs.
- [ ] Set request, job, PDF, provider, Mongo, and shutdown concurrency/time limits.
- [ ] Run warm, cold, saturation, soak, and rolling-restart tests on production-shaped data.

## Workstream 6: observability and operations

- [ ] Dashboards: HTTP/error/latency, JVM/GC/threads, Mongo pool/commands, jobs/dead letters,
      ingestion/provider, email, PDF, auth, and MCP.
- [ ] Alerts tied to user impact and runbooks: readiness, elevated errors/latency, Mongo pool
      wait, job age, dead letters, provider failure, disk/memory/GC, and certificate/secret
      expiry where observable.
- [ ] Trace request/application/repository/job boundaries with central redaction.
- [ ] Restrict metrics/Actuator to internal access and verify no sensitive labels/payloads.
- [ ] Add deployment verification and smoke command.
- [ ] Add incident procedures for Mongo, Atlas Search, OAuth, object store, OpenRouter, email,
      PDF, stuck migration, leaked API key, compromised session, and poison job.

## Workstream 7: backup, restore, and disaster recovery

- [ ] Document Mongo and object-store backup ownership, frequency, retention, encryption, and
      restoration.
- [ ] Restore into an isolated environment and run schema verification plus representative
      application reads.
- [ ] Reconcile Mongo artifact references with object-store backup consistency limitations.
- [ ] Define target recovery point/time objectives and identify gaps.
- [ ] Test loss/rebuild of derived search/facet data.
- [ ] Record exact restore evidence and date; a backup existing is not a restore test.

## Security readiness

- [ ] Dependency/SBOM and container scan with triage policy.
- [ ] Secret scan and configuration review.
- [ ] Full cross-user/household authorization suite.
- [ ] CSRF, OAuth, session, API-key, share/invitation token, upload, and output-escaping suite.
- [ ] Rate/size/time limit verification.
- [ ] Log/metric/trace/error redaction test with seeded sensitive values.
- [ ] Threat-model review and resolution/acceptance of high findings.

## Deliverables

- Complete checked-in OpenAPI and generated client.
- MCP implementation and compatibility report.
- Import/facet operator workflow and volume/resume report.
- Schema parity report from a production-copy restore.
- Deployable image/artifact, SBOM, dashboards, alerts, and capacity report.
- Deployment, backup/restore, incident, key/session, job, and provider runbooks.
- Cutover-ready release candidate.

## Risks and controls

| Risk | Control |
| --- | --- |
| MCP library differs subtly from current protocol | Client test vectors and thin-adapter fallback |
| Import exhausts production Mongo | Separate operator mode, pool limits, batches, checkpoints |
| Healthy process is not usable | Separate liveness/readiness and end-to-end smoke |
| Backups are assumed recoverable | Isolated restore drill with application verification |
| Aggregate replica pools exceed Atlas | Explicit connection budget and saturation test |

## Exit gate

Phase 08 is complete when current API/MCP clients pass against the release candidate, imports
resume safely at production-shaped volume, schema verification is clean on a restored copy,
all operational workflows run without the old application, and the cutover owner accepts the
security/capacity/restore evidence.

## Handoff to Phase 09

Provide an immutable release candidate, migration plan and dry-run, verified backups/restores,
capacity limits, dashboards/alerts, smoke tests, dependency map, and current rollback
constraints.

