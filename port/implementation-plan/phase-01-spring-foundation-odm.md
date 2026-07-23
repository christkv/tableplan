# Phase 01 — Spring Boot Foundation and ODM Qualification

## Objective

Produce a portable Spring Boot foundation that safely connects directly to MongoDB, serves a
minimal Vite SPA, exposes operational health, and packages as one executable JAR. Qualify and
harden the extracted QMplus ODM before application repositories depend on it.

## Committed technology

- Kotlin on the current supported LTS JDK selected by the team.
- Gradle Kotlin DSL with the wrapper checked in.
- Spring Boot and Spring MVC; no WebFlux.
- Spring Security present but only a minimal development security shape in this phase.
- Synchronous MongoDB Java driver.
- Jackson configured once for API and persistence boundary use.
- Testcontainers MongoDB configured as a replica set.
- React/Vite SPA embedded under `classpath:/static`.

Pin exact versions in the version catalog and record the JDK/Spring support decision. Do not
use dynamic dependency versions.

## Workstream 1: build and module foundation

- [ ] Add the Gradle wrapper, version catalog, root build, formatting, static analysis, and
      dependency-locking policy.
- [ ] Create `app`, `api`, `application`, `domain`, `persistence-mongo`, `odm`, `worker`, and
      `test-support` modules or equivalent strict source sets/packages.
- [ ] Add architecture tests that prevent domain/application code from importing Spring,
      Mongo, HTTP, or frontend classes.
- [ ] Create environment-validated configuration for Mongo, sessions, object storage, email,
      OAuth, OpenRouter, jobs, and public origin. Optional integrations stay disabled unless
      configured.
- [ ] Fail startup with a clear error for invalid required configuration; never log secrets.
- [ ] Establish UTC as the backend default and inject `Clock` into time-sensitive code.

## Workstream 2: extract and harden the ODM

- [ ] Extract only the QMplus ODM source into `backend/odm` or consume a newly published
      narrow `qmplus-odm` artifact.
- [ ] Add a provenance/NOTICE file with upstream repository, commit, path, license, and local
      modifications.
- [ ] Replace the QMplus shared object-mapper dependency with an ODM-local mapping interface.
- [ ] Remove or generalize the QMplus `Feature` enum dependency.
- [ ] Move Sentry support behind an optional adapter.
- [ ] Replace unsafe mutable reflection caches with concurrent or startup-initialized caches.
- [ ] Fix `@Field(name)` read/write symmetry.
- [ ] Ensure APM spans finish on empty results and redact query values by default.
- [ ] Add a Tableplan insert guard that rejects missing or non-string `_id` values.
- [ ] Document when repositories must use the native driver instead of the ODM.

The backend must build in CI without the full `qmplus-shared-core` artifact and without an
absolute filesystem dependency.

## Workstream 3: ODM qualification suite

Run against a real replica-set Mongo container:

- [ ] String UUID insert/read/replace/update/delete.
- [ ] Named field round trip.
- [ ] Missing versus BSON null and `$unset`.
- [ ] `Instant`, legacy date types, and ISO date-only strings.
- [ ] Embedded lists/maps and representative recipe, plan, and shopping documents.
- [ ] Projection onto partially populated documents.
- [ ] `Int`, `Long`, `Double`, and `Decimal128` conversions.
- [ ] Unique, sparse, TTL, compound, and multikey indexes.
- [ ] Duplicate-key classification.
- [ ] Transactions through `ClientSession`.
- [ ] Concurrent mapper-cache access.
- [ ] Query/log/span redaction.
- [ ] ODM-generated `ObjectId` rejection.

Tests should import representative Phase 00 Extended JSON fixtures, not only synthetic happy
paths.

## Workstream 4: Mongo and migration foundation

- [ ] Configure one process-level `MongoClient` with explicit application name, timeouts,
      retry policy, pool limits, and command/pool metrics.
- [ ] Add typed database selection for local, preview, and production.
- [ ] Implement an ordered migration ledger with immutable IDs, checksums, start/completion/
      failure records, and an application lock.
- [ ] Implement `migrate --dry-run`, `migrate`, `sync-indexes --dry-run`, and `sync-indexes`.
- [ ] Diff collection creation, validators, named indexes, and Atlas Search separately.
- [ ] Forbid automatic destructive index/validator changes during normal server startup.
- [ ] Establish transaction retry handling for transient transaction and unknown-commit
      results.

## Workstream 5: Spring Boot runtime

- [ ] Implement a small `Application` bootstrap and explicit runtime modes.
- [ ] Configure MVC validation, JSON date/time/UUID behavior, multipart limits, proxy
      headers, compression, and graceful shutdown.
- [ ] Add request IDs and one standardized problem/error envelope.
- [ ] Add structured JSON logging with central redaction.
- [ ] Expose `/health/live` and `/health/ready`; readiness includes Mongo only when serving.
- [ ] Expose restricted Actuator/Micrometer endpoints and Mongo pool/command metrics without
      raw commands.
- [ ] Add a global exception mapper for validation, duplicate keys, timeouts, dependency
      failures, and unexpected errors.
- [ ] Return safe `404`/SPA behavior without routing `/api`, `/mcp`, `/actuator`, `/health`,
      downloads, or file-like paths to `index.html`.

## Workstream 6: frontend and artifact packaging

- [ ] Scaffold Vite SPA mode and preserve the existing React/Tailwind/component conventions.
- [ ] Configure development proxying for `/api`, `/mcp`, and download paths.
- [ ] Add a build task graph: deterministic frontend install, frontend tests/build, copy
      `dist` to Spring resources, then `bootJar`.
- [ ] Ensure hashed assets receive immutable caching and `index.html` does not.
- [ ] Add one browser route and one `/api/v1/system/version` endpoint for the vertical smoke
      test.
- [ ] Start the packaged artifact with only `java -jar tableplan.jar serve` in CI and verify
      API, health, asset, SPA fallback, missing asset, and graceful shutdown behavior.

## Workstream 7: development and CI experience

- [ ] Add Compose for replica-set Mongo and documented local startup.
- [ ] Make frontend and backend hot-reload workflows independent but same-origin compatible.
- [ ] Add CI stages for format/lint, unit, Mongo integration, frontend, `bootJar`, and artifact
      smoke tests.
- [ ] Publish test reports, dependency/security scan results, and the JAR checksum.
- [ ] Add a minimal developer guide covering configuration, migrations, tests, and runtime
      modes.

## Testing and evidence

- Architecture dependency test.
- Configuration binding/validation tests.
- ODM qualification suite.
- Migration checksum, locking, dry-run, partial-failure, and idempotency tests.
- Health/readiness state tests.
- Problem response and redaction tests.
- Packaged-JAR same-origin browser smoke test.
- Saturation smoke at and above Mongo pool size to confirm bounded failure behavior.

## Deliverables

- Portable Gradle build and module skeleton.
- Qualified ODM module with provenance.
- Replica-set test environment.
- Mongo client, schema diff, and migration foundation.
- Spring Boot operational baseline.
- Minimal Vite SPA embedded in the executable JAR.
- CI pipeline and development guide.

## Risks and controls

| Risk | Control |
| --- | --- |
| ODM extraction silently changes behavior | Fixture-driven qualification against current documents |
| Spring Data introduces a second mapping model | Use the driver/ODM deliberately; add Spring Data only for a bounded need |
| SPA fallback masks backend 404s | Explicit excluded namespaces and integration tests |
| Migration starts destructive work on boot | Server mode only verifies required baseline; explicit operator apply |
| Mongo pool is oversized per replica | Configuration limits plus Phase 08 capacity budget |

## Exit gate

Phase 01 is complete when a clean machine can build the repository without QMplus-local paths,
the ODM qualification suite passes against a replica set, schema commands are dry-run safe,
and the packaged JAR serves API plus SPA with correct health, metrics, caching, errors, and
graceful shutdown.

## Handoff to Phase 02

Provide stable DTO/error conventions, repository testing utilities, request IDs, schema
migration primitives, the frontend build bridge, and an executable artifact pipeline.

