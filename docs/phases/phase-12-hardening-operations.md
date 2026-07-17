# Phase 12: Hardening and Operations

## Objective

Move from a functioning production launch to an operated service with explicit security controls, performance budgets, observability, recovery exercises, privacy workflows, and dependable maintenance procedures.

## Dependencies

- Phase 11 production workload and baseline metrics.

Hardening begins earlier where required; this phase closes and verifies the complete operational program.

## Deliverables

- Threat model covering browser sessions, OAuth, API keys, MCP tools, imports, and household data.
- Rate limits and abuse controls per route, key, user, household, and IP where appropriate.
- Structured logs, request IDs, dashboards, alerts, and service-level indicators.
- D1 query/index review using production-scale data.
- Queue retry, dead-letter, replay, and alert procedures.
- API-key rotation and credential incident runbooks.
- Account deletion, household export, membership removal, and OAuth disconnect workflows.
- Backup/export cadence and tested recovery exercise.
- Dependency, secret, and vulnerability maintenance policy.
- Cost dashboards and budget alerts for Workers, D1, AI, Vectorize, Queues, and R2.

## Security Workstreams

- Validate all route, API, and MCP inputs at the boundary.
- Enforce household authorization in services and test for identifier substitution.
- Restrict CORS and OAuth redirect URIs by environment.
- Redact credentials and sensitive payload fields from logs and errors.
- Rotate secrets and API keys without downtime.
- Audit privileged, membership, plan, shopping, and import mutations.
- Apply result, payload, execution-time, and mutation limits to agent tools.
- Review source recipe text as untrusted data when exposed to models.

## Reliability and Performance

- Set latency and error-rate budgets for search, recipe detail, plan reads/writes, and list generation.
- Review D1 query plans and add indexes only from measured workloads.
- Load test realistic concurrent reads and bounded household writes.
- Verify FTS fallback during AI/Vectorize outages.
- Exercise queue retries and dead-letter recovery.
- Test import idempotency and partial-failure recovery.
- Define maintenance mode and user-visible degraded states.

## Privacy and Lifecycle

- Document data categories, retention, subprocessors, and household ownership.
- Provide account deletion and household data export with auditable completion.
- Revoke sessions, OAuth tokens, and API keys when accounts or memberships are removed.
- Define retention for security logs, import artifacts, and deleted data.
- Publish privacy, terms, support, and security contact material before broad distribution.

## Verification

- External-style authorization and API-key abuse tests.
- Load tests on production-sized preview data.
- Incident exercises for leaked API key, broken OAuth configuration, D1 failure, and embedding backlog.
- Restore/rebuild exercise from migrations, source fingerprint, import manifest, and controlled artifacts.
- Account deletion/export and membership-removal end-to-end tests.
- Alert tests proving actionable notifications reach the responsible operator.

## Acceptance Criteria

- Critical authorization paths have negative tests across UI, REST, and MCP.
- Operational dashboards expose errors, latency, usage, queue health, import state, and cost.
- Rate limits and key rotation are active and documented.
- Recovery and catalog rebuild procedures have succeeded in a preview exercise.
- Account deletion/export and credential revocation meet the documented lifecycle policy.
- On-call or owner runbooks identify detection, containment, recovery, and communication steps.

## Non-Goals

- Enterprise compliance certification unless required by the chosen market.
- Multi-region active-active database architecture.
- Premature optimization without production evidence.

## Exit Artifact

An operated service with measured reliability, enforceable security boundaries, privacy controls, and tested recovery procedures.
