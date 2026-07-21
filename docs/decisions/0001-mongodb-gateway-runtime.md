# ADR 0001: MongoDB gateway runtime

Status: proposed; repository implementation complete, external deployment proof pending  
Date: 2026-07-21  
Related plan: `docs/migrations/mongodb-storage-migration-plan.md`

## Context

The Cloudflare application Worker must not create an unbounded number of MongoDB pools as isolates and deployments scale. A gateway is useful only if it owns and limits the actual database connections; another stateless proxy Worker does not provide that guarantee by itself. Cloudflare Hyperdrive does not currently support MongoDB.

The gateway must support the official MongoDB driver, TLS and replica-set discovery, transactions, predictable connection reuse, bounded scaling, graceful deployment, and metrics for pool saturation. Better Auth's MongoDB adapter also needs access to a real MongoDB `Db` object.

## Proposed decision

Use a regional Node.js gateway service close to the MongoDB deployment. Each instance owns one singleton `MongoClient`; the deployment has a hard instance cap and explicit pool settings. The Cloudflare application calls versioned domain RPC operations over an authenticated private or HTTPS path.

Keep a sharded Durable Object gateway as an alternative only if a time-boxed proof shows that it meets the same driver, transaction, connection, throughput, recovery, and cost requirements. Do not use a single global Durable Object, MongoDB Atlas App Services/Data API, or a generic query proxy.

The codebase has started with a transport-independent storage contract. `STORAGE_BACKEND=d1` remains the default. The `mongodb-gateway` option cannot initialize without an HTTPS gateway URL and service credential.

## Proof checklist

- [ ] Select the MongoDB deployment, tier, replica-set topology, and region.
- [ ] Record its connection limit and reserve administration/maintenance headroom.
- [ ] Deploy a Node gateway prototype in the candidate region.
- [ ] Verify TLS, DNS/replica-set discovery, credential rotation, and IP/private-network access.
- [ ] Verify one `MongoClient` per process and connection reuse across requests.
- [ ] Set `maxPoolSize`, `minPoolSize`, `maxIdleTimeMS`, `waitQueueTimeoutMS`, `serverSelectionTimeoutMS`, and `maxConnecting` from measurements.
- [ ] Cap instance scaling and prove the total connection budget during burst and rolling-restart tests.
- [ ] Verify multi-document transactions and transient transaction retries.
- [ ] Verify service authentication, deadlines, payload limits, idempotency, and authorization enforcement.
- [ ] Verify pool, request, query, error, retry, and saturation telemetry.
- [ ] Verify Better Auth sign-in/session behavior in the gateway runtime.
- [ ] Compare the Durable Object alternative only if a Cloudflare-only runtime remains desirable.

## Acceptance rule

Change this ADR to `accepted` only when the proof artifacts record the chosen runtime, region, deployment cap, pool values, connection-budget calculation, load-test results, transaction result, operational cost, and named owner. Until then MongoDB must not become the production write backend.

The repository now contains the bounded singleton client, explicit pool controls, authenticated/versioned RPC, request deadlines and payload limits, domain authorization, transaction-backed operations, Better Auth Mongo adapter/proxy, schema/search migrations, container image, local replica-set composition, and migration tooling. These are implementation prerequisites, not evidence for the unchecked deployment proof items above.

## Local implementation proof

On 2026-07-21 the Compose environment was built with Node 22/npm 11 and MongoDB 8, the single-node replica set became ready, and the validator/index migration completed. The full 500,471-row catalog input and a real local D1 snapshot were loaded; canonical checksums matched for every migrated collection and all checked reference counts were zero. Real requests verified gateway readiness, authenticated versioned RPC, Better Auth email sign-up and session-cookie issuance through the Mongo adapter, transactional first-household provisioning, API-key creation/hash authentication, ingestion draft storage, transactional private-recipe publication, and household-authorized recipe retrieval. Concurrent proof requests produced exactly one email claim and returned the same recipe ID for duplicate publication. The named Docker data volume is retained for repeatability.

This local result does not satisfy the regional deployment, TLS/networking, connection-limit, autoscaling, load, failover, observability, cost, or live authentication checks. Those remain the acceptance gate.

## Consequences

- The application Worker remains stateless and does not import the MongoDB driver.
- Interactive traffic, imports, and administration use separate credentials and pool budgets.
- Better Auth will move behind the gateway and remain exposed through the application's same-origin `/api/auth/*` proxy.
- The gateway becomes a critical service and needs deployment draining, health/readiness probes, monitoring, backups, and outage runbooks.
- D1 remains the source of truth throughout compatibility and shadow-read phases.
