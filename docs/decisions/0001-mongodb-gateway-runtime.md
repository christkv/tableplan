# ADR 0001: MongoDB gateway runtime

Status: accepted for implementation; Atlas deployment proof pending
Date: 2026-07-21
Related plan: `docs/migrations/mongodb-storage-migration-plan.md`

## Context

The Cloudflare application Worker must not create an unbounded number of MongoDB pools as isolates and deployments scale. A gateway is useful only if it owns and limits the actual database connections; another stateless proxy Worker does not provide that guarantee by itself. Cloudflare Hyperdrive does not currently support MongoDB.

The gateway must support the official MongoDB driver, TLS and replica-set discovery, transactions, predictable connection reuse, bounded scaling, graceful deployment, and metrics for pool saturation. Better Auth's MongoDB adapter also needs access to a real MongoDB `Db` object.

## Decision

Use a dedicated Cloudflare gateway Worker whose single named Durable Object (`pool-0`) owns one singleton `MongoClient` and its bounded pool. Pin the Durable Object near Atlas with `MONGO_LOCATION_HINT`, use `MONGODB_MIN_POOL_SIZE=0`, and keep the initial Durable Object count at one. The application calls the existing versioned domain RPC and Better Auth routes through a private Cloudflare service binding. The service token remains as defense in depth.

MongoDB itself remains on Atlas. Cloudflare deploys only the application and gateway code. The Node HTTP gateway remains a local-development fallback, not the preview or production deployment target. Do not expose a generic query proxy or give the application Worker the Atlas URI.

The codebase uses a transport-independent storage contract. Preview and production require the `MONGODB_GATEWAY` service binding and service credential; local development may use `MONGODB_GATEWAY_URL`.

## Proof checklist

- [ ] Select the MongoDB deployment, tier, replica-set topology, and region.
- [ ] Record its connection limit and reserve administration/maintenance headroom.
- [ ] Deploy the gateway Worker in the candidate region.
- [ ] Verify TLS, DNS/replica-set discovery, credential rotation, and IP/private-network access.
- [x] Verify one `MongoClient` per Durable Object and connection reuse across requests locally.
- [ ] Set `maxPoolSize`, `minPoolSize`, `maxIdleTimeMS`, `waitQueueTimeoutMS`, `serverSelectionTimeoutMS`, and `maxConnecting` from measurements.
- [ ] Cap instance scaling and prove the total connection budget during burst and rolling-restart tests.
- [ ] Verify multi-document transactions and transient transaction retries.
- [x] Verify service authentication, deadlines, payload limits, idempotency, and authorization enforcement in repository tests.
- [ ] Verify pool, request, query, error, retry, and saturation telemetry.
- [ ] Verify Better Auth sign-in/session behavior in the gateway runtime.
- [x] Verify local Durable Object startup, MongoDB TCP connection, readiness, sanitized query logging, and authenticated versioned RPC.

## Acceptance rule

Do not promote the production deployment until proof artifacts record the Atlas region, connection-budget calculation, load-test results, transaction result, failover behavior, operational cost, and named owner.

The repository contains the Durable Object gateway, bounded singleton client, explicit pool controls, private service bindings, authenticated/versioned RPC, request deadlines and payload limits, domain authorization, transaction-backed operations, Better Auth Mongo adapter/proxy, schema/search migrations, and migration tooling. These are implementation prerequisites, not evidence for the unchecked Atlas deployment proof items above.

## Local implementation proof

On 2026-07-21 the Compose environment was built with Node 22/npm 11 and MongoDB 8, the single-node replica set became ready, and the validator/index migration completed. The full 500,471-row catalog input and a real local D1 snapshot were loaded; canonical checksums matched for every migrated collection and all checked reference counts were zero. Real requests verified gateway readiness, authenticated versioned RPC, Better Auth email sign-up and session-cookie issuance through the Mongo adapter, transactional first-household provisioning, API-key creation/hash authentication, ingestion draft storage, transactional private-recipe publication, and household-authorized recipe retrieval. Concurrent proof requests produced exactly one email claim and returned the same recipe ID for duplicate publication. The named Docker data volume is retained for repeatability.

On 2026-07-22 the Cloudflare Worker implementation also started locally, created its SQLite-backed Durable Object, connected to `application_local`, emitted the full sanitized MongoDB command log, passed `/readyz`, and completed an authenticated versioned health RPC. This does not satisfy Atlas TLS/networking, connection-limit, load, failover, cost, or live authentication checks; those remain the production gate.

## Consequences

- The application Worker remains stateless and does not import the MongoDB driver; only the gateway bundle contains it.
- Interactive traffic, imports, and administration use separate credentials and pool budgets.
- Better Auth will move behind the gateway and remain exposed through the application's same-origin `/api/auth/*` proxy.
- The gateway becomes a critical service and needs health monitoring, connection-budget alerts, deployment verification, and outage runbooks.
- Atlas remains the application source of truth and must be backed up independently of Cloudflare.
