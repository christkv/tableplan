# Tableplan Spring Boot Port — Phased Implementation Plan

Status: phases 00–08 implemented and executed locally; phase 09 awaits production authority  
Target: Spring Boot with Kotlin, Spring MVC, React/Vite, and MongoDB  
Source architecture: [architecture-research.md](../architecture-research.md)  
Last updated: 2026-07-23

## Decision

Spring Boot is the selected backend platform. The framework bake-off proposed in the
architecture research is closed and is not part of this implementation plan.

The production target is one versioned executable JAR that contains:

- Spring MVC API, auth, public, download, and MCP adapters.
- Application and domain services written in Kotlin.
- Direct MongoDB access through the extracted QMplus ODM and the synchronous Mongo driver.
- Mongo-leased background jobs.
- The built React/Vite SPA under Spring Boot classpath resources.

The artifact starts with:

```text
java -jar tableplan.jar serve
```

The same artifact also exposes explicit non-server operator modes such as `migrate`,
`sync-indexes`, `import-catalog`, and `refresh-recipe-facets`.

## Delivery principles

1. Preserve the existing Mongo collections, field names, BSON types, string UUIDs,
   validators, indexes, and Atlas Search definition through the first release.
2. Migrate vertical slices that can be demonstrated and compared with the current
   application.
3. Keep OpenAPI and shared golden fixtures as executable contracts.
4. Keep controllers thin. Authorization-sensitive workflows live in application services;
   Mongo query shape lives in repositories.
5. Use Spring MVC, not WebFlux, because the selected ODM and Mongo driver are synchronous.
6. Keep persistence documents separate from domain models and public API DTOs.
7. Require real replica-set Mongo integration tests for repositories, transactions, leases,
   validators, and indexes.
8. Do not run the old and new applications as uncontrolled concurrent writers.
9. A phase is complete only when its exit gate is evidenced in CI or a checked-in report.
10. Record any deliberate compatibility break in a decision record before implementation.

## Target repository shape

```text
backend/
  app/                 Spring Boot bootstrap, configuration, executable JAR
  api/                 MVC controllers, auth adapters, problem responses, OpenAPI
  application/         use cases, authorization, transaction boundaries, ports
  domain/              pure Kotlin rules and value types
  persistence-mongo/   ODM documents, repositories, migrations, schema manifest
  odm/                 extracted and hardened QMplus ODM
  worker/              job leasing and handlers
  test-support/        Mongo fixtures, clocks, builders, contract utilities
frontend/
  src/                 React SPA, routes, components, generated API client
contracts/
  openapi.yaml
  fixtures/
scripts/
port/
  architecture-research.md
  implementation-plan/
```

Gradle modules may be consolidated initially when that improves delivery speed, but the
package dependencies must continue to point inward:

```text
api / worker / persistence-mongo
              |
              v
         application
              |
              v
            domain
```

`odm` remains an independent Gradle module from the first backend commit.

## Phase map

| Phase | Outcome | Depends on | Relative size |
| --- | --- | --- | --- |
| [00 — Contract and evidence baseline](phase-00-contract-evidence.md) | Parity is measurable before code moves | None | M |
| [01 — Spring Boot foundation and ODM](phase-01-spring-foundation-odm.md) | One bootable JAR safely reads/writes Mongo and serves the SPA | 00 evidence format | L |
| [02 — Read-only recipes](phase-02-read-only-recipes.md) | Search, facets, detail, and recipe SPA routes are production-shaped | 01 | L |
| [03 — Authentication and households](phase-03-auth-households.md) | Secure sessions and household isolation work with migrated identities | 01, 02 access rules | XL |
| [04 — Preferences, favourites, and saved searches](phase-04-preferences-favourites-searches.md) | Lower-risk authenticated mutations and API keys reach parity | 03 | M |
| [05 — Meal planning and shopping](phase-05-planning-shopping.md) | Core collaborative planning workflows reach parity | 03, 04 | XL |
| [06 — Private recipes and ingestion](phase-06-private-recipes-ingestion.md) | Upload, extract, review, publish, and edit are durable and isolated | 03, 05 domain base | XL |
| [07 — Shares, email, and PDF](phase-07-shares-email-pdf.md) | Public exchange and outbound document workflows reach parity | 05, 06 worker base | L |
| [08 — Contracts, MCP, import, and operations](phase-08-integrations-operations.md) | All clients and operator workflows can leave the old runtime | 02–07 | L |
| [09 — Cutover and retirement](phase-09-cutover-retirement.md) | Production moves safely and the Cloudflare runtime can be retired | All prior phases | L |

Sizes are comparative planning aids, not calendar promises. Phase 03 and Phase 06 contain
external compatibility decisions and should receive explicit contingency.

## Cross-phase quality gates

Every phase change must pass the relevant subset of:

- Kotlin unit and architecture tests.
- ODM and repository tests against a real Mongo replica set.
- OpenAPI request/response conformance tests.
- Shared TypeScript/Kotlin golden fixtures.
- Frontend component and accessibility tests.
- Browser end-to-end tests.
- Security and cross-household authorization tests.
- Concurrency/idempotency tests.
- Final `bootJar` smoke test using only `java -jar`.

The main branch must never require a developer-specific absolute path to QMplus or a running
Node server for production.

## Standard phase workflow

1. Confirm inputs and unresolved decisions listed in the phase document.
2. Check in or update contract fixtures before changing behavior.
3. Implement one demonstrable vertical increment at a time.
4. Run parity comparison against the current application.
5. Record deviations, operational consequences, and follow-up ownership.
6. Demonstrate the phase exit gate in preview.
7. Mark the phase complete only after deliverables and evidence are checked in.

## Decision ownership

The following decisions must be recorded during their named phase:

| Decision | Due |
| --- | --- |
| ODM extracted locally or published as a narrow upstream artifact | Phase 01 |
| Password hash compatibility and reset/bridge policy | Phase 03 |
| Self-registration policy and Google account-linking rules | Phase 03 |
| Mongo jobs versus an existing managed queue | Phase 06 |
| R2 through S3 versus another S3-compatible store | Phase 06 |
| Chromium in the runtime image versus a PDF service | Phase 07 |
| Kotlin MCP library or a small protocol adapter | Phase 08 |
| Temporary retention and retirement date for Node import scripts | Phase 08 |
| Replica count, job-runner placement, and Mongo pool budget | Phase 08 |
| Cutover window, rollback authority, and go/no-go owner | Phase 09 |

## Program definition of done

The port is complete when:

- All current page routes are owned by the Vite SPA.
- Spring Boot owns REST, authentication, public-link, PDF, ingestion, email, and MCP
  behavior.
- `tableplan.jar` contains the backend, SPA assets, migrations, and job code.
- Production needs no separately deployed Node application or Mongo gateway Worker.
- No active session, job, or Mongo request depends on a Durable Object or Cloudflare
  Workflow.
- Mongo schema, indexes, Atlas Search, identifiers, field types, and access filters are
  verified against production evidence.
- Users, API keys, and public links follow an explicit tested compatibility policy.
- Security, concurrency, load, backup/restore, deployment, and rollback gates pass.
- The old application and gateway are retired after the observation window.
