# MongoDB storage migration plan

Status: implementation complete for repository-controlled compatibility work; D1 remains the configured system of record until the external preview cutover gate  
Scope: replace Cloudflare D1 as the application system of record with MongoDB, introduce a bounded MongoDB gateway, migrate the existing catalog and household data, and retire D1 safely.

## Execution status

Execution started on 2026-07-21. The application remains in compatibility mode with D1 as the configured backend; no production data has moved and no D1 resource has been removed.

- [x] Inventory D1 schemas, call sites, imports, bindings, tests, and documentation.
- [x] Document the target architecture, data model, cutover, rollback, and deletion plan.
- [x] Add a versioned storage contract and D1/MongoDB-gateway health clients.
- [x] Move `/api/health` off direct `env.DB` access and through the storage boundary.
- [x] Add gateway configuration that defaults to D1 in local, preview, and production.
- [x] Add focused contract/client tests and regenerate Cloudflare environment types.
- [x] Implement the bounded Node gateway runtime, MongoDB stores, JSON Schema validators/index migration, health checks, request concurrency/body/deadline ceilings, structured timing logs, and graceful shutdown.
- [x] Move catalog, tenant, planning, shopping, sharing, ingestion, API-key, household, invitation, and email state behind the storage contract.
- [x] Run Better Auth with its official MongoDB adapter in the gateway and proxy `/api/auth/*` through the application origin.
- [x] Implement resumable catalog import plus D1 snapshot, transformation, load, canonical checksums, and orphan-reference verification tooling, including private recipes.
- [x] Make email/invitation queue claims atomic and make recipe publication replay-safe so retries cannot concurrently send or publish twice.
- [x] Add opt-in read shadowing that returns D1 results, compares MongoDB results, never mirrors writes, and emits data-free match/mismatch events.
- [x] Add a container image, local replica-set environment, write-freeze switch, and preview cutover runbook.
- [ ] Deploy the gateway and MongoDB cluster, record the connection budget/load proof, create Atlas Search, and run preview migration. This needs external infrastructure and credentials.
- [ ] Execute the maintenance-window preview cutover and acceptance tests; keep D1 intact until the rollback/retention decision is approved.

Local proof on 2026-07-21 loaded all 500,471 catalog input rows plus a real local D1 snapshot into the MongoDB 8 replica set. The strict verifier returned `ok: true`, every migrated document checksum matched, and every checked relationship reported zero orphans. The proof also exposed and fixed a date-only `plannedDate` conversion bug, verified that two concurrent email claims produce one claim and one no-op, and verified that two concurrent publication requests return the same recipe ID. Better Auth sign-up through the protected gateway returned HTTP 200. The Dash route is now registered before an API key exists, removing the onboarding chicken-and-egg 404; an unauthenticated diagnostic request correctly returns 401 while the Dash wizard supplies its signed bearer token.

Current implementation files:

- `src/storage/contract.ts`
- `src/storage/d1-client.ts`
- `src/storage/gateway-client.ts`
- `src/storage/index.ts`
- `app/routes/api.health.ts`
- `gateway/`
- `scripts/import-recipes-mongodb.ts`
- `scripts/migrate-d1-to-mongodb.ts`
- `docs/migrations/mongodb-cutover-runbook.md`
- `docs/decisions/0001-mongodb-gateway-runtime.md`

## Decision summary

The application Worker must not connect independently to MongoDB from every isolate. A second stateless Cloudflare Worker would move the connection code without bounding the number of database connections. The target is therefore:

```text
Browser / API client
        |
        v
Cloudflare application Worker
        |
        | typed, authenticated domain RPC
        v
MongoDB gateway (bounded instances, one MongoClient per instance)
        |
        | bounded shared pool
        v
MongoDB replica set / Atlas cluster
```

The recommended gateway runtime is a small regional Node.js service located close to the MongoDB cluster. It owns a singleton `MongoClient`, has a hard maximum instance count, and exposes domain operations rather than arbitrary database queries. The existing Cloudflare Worker remains the public application edge.

A Cloudflare-native gateway using sharded Durable Objects may be accepted only after the phase 0 proof demonstrates that the MongoDB driver, TLS/DNS, transactions, connection reuse, duration cost, and failure recovery work under the actual deployment. Cloudflare Workers support outbound TCP sockets, but Hyperdrive does not support MongoDB. MongoDB Atlas App Services/Data API must not be chosen as a shortcut because it reached end of life on September 30, 2025.

Relevant platform references:

- [Cloudflare Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Hyperdrive supported databases and features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/)
- [Durable Objects overview](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), [design guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits/), and [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [MongoDB Atlas Data API migration notice](https://www.mongodb.com/docs/atlas/app-services/data-api/migration/data-api-tutorial/)
- [MongoDB Node.js driver connection guide](https://www.mongodb.com/docs/drivers/node/current/connect/)
- [Better Auth MongoDB adapter](https://better-auth.com/docs/adapters/mongo)

## Goals

- Make MongoDB the only writable system of record after cutover.
- Bound the total MongoDB connection count independently of application traffic.
- Preserve current user-visible behavior, IDs, visibility rules, token security, and HTTP contracts.
- Import the large public recipe catalog without competing with interactive traffic.
- Migrate Better Auth and all private/household data without losing sessions or ownership.
- Make every migration phase measurable, reversible, and safe to retry.
- Remove all D1 bindings, SQL implementations, import artifacts, and operational instructions after the rollback window.

## Non-goals

- Rewriting the React UI or public API while changing storage.
- Introducing a generic HTTP-to-Mongo proxy.
- Converting existing string IDs to MongoDB `ObjectId` values.
- Replacing R2, queues, workflows, email delivery, or recipe extraction providers unless their database calls need to use the gateway.
- Performing an irreversible D1 deletion during implementation.

## Current storage surface

D1 currently stores four different kinds of data:

1. Public catalog data: recipes, steps, ingredient lines, canonical ingredients, units, tags, and the FTS5 search index.
2. Tenant data: households, memberships, profiles, preferences, favourites, saved searches, meal plans, and shopping lists.
3. Authentication and security data: Better Auth users/sessions/accounts/verifications, API keys/events, invitation hashes, and shopping-share hashes.
4. Operational data: import runs/issues/metrics, ingestion jobs/drafts/reviews/events, and email deliveries.

Direct D1 access is not confined to `src/db`. It is present in authentication, household invitations, API keys, email delivery, recipe ingestion, public shopping shares, exports, MCP, ingestion workers, and many route loaders/actions. The refactor must remove all direct `env.DB` access; changing only the files in `src/db` would leave split ownership and bypass the gateway.

The current D1 schema is defined by:

- `migrations/0001_initial.sql`
- `migrations/0002_saved_recipe_searches.sql`
- `migrations/0003_unique_household_meal_plan_weeks.sql`
- `migrations/0004_private_recipe_ingestion.sql`
- `migrations/0005_custom_meal_slots.sql`
- `migrations/0006_pdf_email_public_checklists.sql`
- `migrations/0007_household_invitations.sql`

## Gateway design

### Runtime and connection budget

The gateway process creates one `MongoClient` at process startup and reuses it for every request. It must not create or close a client per operation. Set and test explicit values for:

- `maxPoolSize`
- `minPoolSize` (normally `0` for preview and low traffic)
- `maxIdleTimeMS`
- `waitQueueTimeoutMS`
- `serverSelectionTimeoutMS`
- `maxConnecting`

Cap autoscaling so this invariant holds:

```text
(maximum gateway instances x maxPoolSize)
  + import-job pool
  + administration/migration headroom
  <= 60-70% of the MongoDB deployment connection limit
```

The remaining capacity covers elections, monitoring, maintenance, and unexpected clients. Record the actual cluster limit and chosen values in the deployment runbook; do not copy example numbers blindly.

Use separate MongoDB credentials and connection pools for:

- interactive application traffic;
- catalog import/backfill jobs;
- schema/index administration.

The import credential should be disabled when no import is running.

### API boundary

The shared contract currently lives in `src/storage/contract.ts` (a separate workspace package was unnecessary for this single repository). It contains Zod request/response schemas, domain types, a versioned protocol, and gateway clients. The application Worker never imports the MongoDB driver; only `gateway/` and migration tools do.

The gateway exposes domain methods such as:

- `recipes.search`, `recipes.get`, `recipes.create`, `recipes.update`, `recipes.setVisibility`
- `favourites.list`, `favourites.set`
- `plans.getWeek`, `plans.copyWeek`, `plans.addItem`, `plans.updateItem`, `plans.removeItem`
- `shopping.getLatest`, `shopping.generate`, `shopping.toggleItem`
- `households.getForUser`, `households.invite`, `households.acceptInvitation`
- `ingestions.create`, `ingestions.saveDraft`, `ingestions.publish`
- `shares.resolve`, `shares.touch`, `shares.toggleItem`
- `apiKeys.create`, `apiKeys.verify`, `apiKeys.revoke`
- `emailDeliveries.create`, `emailDeliveries.claim`, `emailDeliveries.complete`

Do not expose raw collection names, `find`, aggregation pipelines, JavaScript expressions, or caller-provided projections. This preserves authorization and prevents the gateway from becoming a public database interface.

Each request must include a request ID, contract version, deadline, authenticated service identity, and the user/household context when applicable. In Cloudflare-to-Cloudflare deployments use a Service Binding. For a regional Node gateway use a private network path where available plus short-lived service credentials or HMAC-signed requests with timestamp and nonce replay protection. The gateway must independently enforce household membership and recipe visibility; it must not trust a caller-provided household ID alone.

Add payload limits, timeouts, bounded request queues, rate limits, circuit breakers, and per-operation metrics. Mutating commands that can be retried must accept an idempotency key and store the result or mutation record.

### Better Auth placement

Better Auth's MongoDB adapter expects a MongoDB `Db`/`MongoClient`, not an HTTP storage client. The recommended design is to run the Better Auth handler in the MongoDB gateway and have the application Worker proxy `/api/auth/*` to it. The browser continues to use the application origin, so cookie domain and same-origin behavior can remain unchanged.

The authentication proxy must preserve method, body, query string, `Set-Cookie`, `Cookie`, `Origin`, `Host`/forwarded-host semantics, and Better Auth's trusted-origin checks. Keep the Dash plugin on the gateway-hosted Better Auth instance and validate `/api/auth/dash/validate` through the public application URL before cutover.

Building a custom Better Auth adapter on the domain RPC protocol is an alternative, but it is not the planned route because it expands the authentication-critical implementation and test surface.

### Transactions and consistency

Use a MongoDB replica set or Atlas deployment that supports transactions. Retain atomic behavior for at least:

- first-login user, household, membership, profile, and preferences provisioning;
- accepting an invitation and updating membership/profile/invitation state;
- cloning a meal-plan week;
- publishing an ingestion draft as a visible recipe;
- creating or replacing a shopping list when multiple collections are touched;
- single-use token exchange/claim operations.

Where a bounded aggregate is embedded in one document, use a single atomic update instead of a multi-document transaction. Configure transaction retry behavior for transient transaction and unknown commit result labels, and make the enclosing command idempotent.

### Caching

Caching reduces read load but is not a substitute for bounded connections.

Safe initial cache candidates are public catalog recipe details, public search/facet results, and canonical ingredient/unit metadata. Cache keys must include all visibility-affecting inputs and a data/index version. Invalidate by version bump after catalog imports or recipe mutation.

Do not cache Better Auth sessions, invitation/share-token validation, private recipes, household membership decisions, API-key verification, or user-specific meal/shopping data in a shared cache. Request coalescing for identical hot catalog reads is useful at the gateway.

## MongoDB data model

Preserve current string identifiers as `_id` (or as `id` during an initial compatibility phase) so foreign references, URLs, imported deterministic IDs, and idempotent reruns remain stable. Store dates as BSON dates, booleans as booleans, and parsed quantities as numeric values rather than carrying SQLite representations forward.

Before import, validate every constructed document against MongoDB's 16 MiB document limit. The source importer already encounters large records; oversized recipes must be rejected/quarantined or split before loading.

| D1 tables | MongoDB target | Shape and important indexes |
| --- | --- | --- |
| `user`, `session`, `account`, `verification` | Better Auth collections | Use the official Better Auth MongoDB adapter and its generated schema/index expectations. Preserve IDs and timestamps. Index session token and expiry as required by Better Auth. |
| `households`, `household_preferences` | `households` | Embed the bounded preference/configuration object, including meal slots. Unique `_id`; index normalized name only if needed. |
| `household_members` | `household_memberships` | One document per membership. Unique `{ householdId, userId }`; index `{ userId, createdAt }` for login/default-household discovery. Keeping this separate makes cross-household membership queries and uniqueness explicit. |
| `user_profiles` | `user_profiles` | One document per user with `defaultHouseholdId` and preferred measurement settings; unique `userId`. |
| `recipes`, `recipe_steps`, `recipe_ingredients`, `recipe_tags` | `recipes` | Embed ordered steps, ingredient lines, and tag references in the recipe document. Index `sourceId`, `ownerUserId`, `householdId`, `visibility`, `status`, and update time as required by query shapes. |
| `ingredients`, `ingredient_aliases`, `household_ingredient_aliases` | `ingredients`, `ingredient_aliases` | Keep canonical ingredients separate. Unique normalized canonical name; indexes on normalized alias plus optional household scope. |
| `units` | `units` | Small reference collection with unique canonical name/symbol rules. It may be loaded and cached in memory by the gateway. |
| `tags` | `tags` | Canonical tag collection with a unique normalized name; recipe documents also carry tag IDs/names needed for display/search. |
| `favorites` | `favourites` | Separate documents with unique `{ userId, recipeId }`; index by user and creation time. |
| `saved_recipe_searches` | `saved_recipe_searches` | Separate documents with unique `{ householdId, id }`; index household and update time. |
| `collections`, `collection_recipes` | `collections` plus optional `collection_recipes` | Keep membership separate during parity migration. Embed later only after size/use patterns are known. Unique `{ collectionId, recipeId }`. |
| `meal_plans`, `meal_plan_items` | `meal_plans` | Embed the bounded week of ordered items. Unique `{ householdId, startsOn, endsOn }`; indexes for household/week and recipe references needed by refresh jobs. |
| `shopping_lists`, `shopping_list_items` | `shopping_lists` | Embed bounded list items. Index `{ householdId, createdAt }` and `planId`; use item IDs plus `arrayFilters` for atomic toggles. |
| `shopping_list_shares` | `shopping_list_shares` | Separate because access starts with a token hash. Unique token hash, indexes on list/household/status/expiry. Keep token hashes only. |
| `household_invitations` | `household_invitations` | Unique token hash; indexes for pending household/email and expiry. A TTL index may purge records only after the required audit/rollback retention, not implement business status. |
| `api_keys`, `api_key_events` | `api_keys`, `api_key_events` | Unique prefix/hash lookup as currently required; append-only events indexed by key/user/time. Keep hashes only. |
| `recipe_ingestions`, `recipe_source_artifacts`, `recipe_ingestion_drafts`, `recipe_ingestion_ingredient_reviews` | `recipe_ingestions` | Embed job state, R2 artifact metadata, draft, and bounded review entries. Keep the binary source in R2. Index household/user/status/update time. |
| `recipe_mutation_events` | `recipe_mutation_events` | Append-only collection indexed by recipe/household/time and idempotency key. |
| `email_deliveries` | `email_deliveries` | Index status/next attempt, user/time, household/time, and provider message ID. Claim work atomically to avoid duplicate sends. |
| `import_runs`, `import_metrics` | `import_runs` | Embed metrics and checkpoint/watermark state. Index source hash and start time. |
| `import_issues` | `import_issues` | Separate, potentially large collection indexed by run/severity/reason/source row. Define retention/export policy. |
| `recipe_search_fts` | Atlas Search index over `recipes` | Replace FTS5/BM25. Index name, description, ingredient text/canonical names, tags, and steps plus filter fields. If Atlas Search is unavailable, choose and prove an external search system before cutover. |

Create MongoDB JSON Schema validators for security- and state-critical collections. Maintain index definitions as code in a versioned, idempotent `gateway migrate` command. Index creation must be a distinct deployment step, not a side effect of request startup.

## Search compatibility

The existing search supports free text, ingredient filtering, tag filters with any/all behavior, visibility scope, facets, limits, and ordering based on SQLite FTS5/BM25. Before application refactoring, capture a golden corpus of queries and expected accessible recipe IDs.

The MongoDB search implementation must preserve:

- household/private visibility filtering inside the search query;
- ingredient and tag any/all semantics;
- deterministic tie-breaking;
- current facet behavior;
- bounded response size;
- stable cursor-based pagination.

Atlas Search is preferred if the deployment is Atlas. Do not emulate the current large-catalog search with unindexed regular expressions. Offset pagination should be replaced with cursor/search-after pagination for deep result sets, while the external API can temporarily translate existing page inputs during compatibility rollout.

## Refactoring workstreams

### 1. Establish contracts before changing routes

Extract pure domain types and transformations from `src/db` into storage-independent modules. Add a `StorageClient` interface and gateway request schemas. Implement a temporary `D1StorageClient` behind the same interface so route conversion can happen before MongoDB is production-ready.

This is the seam used by route loaders/actions, MCP, exports, workers, queues, and auth-adjacent code. It also permits D1-versus-Mongo parity tests during migration.

### 2. Build the gateway

Create the gateway service with:

- singleton MongoDB client and bounded pool;
- readiness that verifies MongoDB selection without disclosing details;
- versioned domain handlers and validation;
- service authentication and authorization;
- structured logs, traces, pool metrics, query duration, errors, retries, and saturation metrics;
- graceful shutdown and deployment draining;
- idempotency store/keys for retryable writes;
- schema/index migration CLI;
- separate health, readiness, and dependency status signals.

Reject unbounded filters, large limits, and unexpected aggregation input at validation time.

### 3. Convert application callers

Convert one domain at a time while retaining its external HTTP contract:

1. Read-only catalog lookup and recipe detail.
2. Search and facets.
3. Preferences, favourites, and saved searches.
4. Meal planning and shopping lists.
5. Public shares, exports, MCP, and API keys.
6. Private recipe ingestion and email/invitation workers.
7. Household membership and Better Auth.

After each slice, run contract tests against both implementations and remove direct SQL from that slice. No route or worker may import MongoDB; all use the typed client.

### 4. Move Better Auth

Provision the Better Auth collections, run a test-user migration, and verify sign-up, sign-in, sign-out, session renewal, account linking, invitation acceptance, Dash validation, and first-login household creation through the proxied public URL.

Existing sessions should be migrated if the adapter schema and token semantics permit it. If they cannot be migrated reliably, schedule and communicate a one-time sign-in requirement rather than attempting a silent partial migration. This decision is a cutover gate.

### 5. Convert background work

The recipe ingestion Durable Object/workflow and email queue consumers currently read/write D1 directly. Change them to use the gateway contract, with idempotency keys derived from workflow/delivery IDs. A retry must not publish a recipe twice, accept an invitation twice, or send an email twice.

## Data import and migration

There are two distinct imports and they should not share one ad hoc command:

1. Catalog rebuild from `data/recipes_ingredients.csv`, which is large, deterministic, and can run before cutover.
2. D1 state migration, which contains current users, sessions, households, private recipes, plans, shares, keys, and operational state and must be captured close to cutover.

### Catalog importer

Retain the useful parts of `scripts/import-recipes.ts`: CSV streaming, deterministic sampling, parsing, normalization, stable IDs, duplicate detection, quality flags, and QA reports. Split those pure stages from the SQLite/D1 writer.

Add a MongoDB writer/import job that:

- writes to a versioned catalog namespace or staging collections;
- uses unordered `bulkWrite` batches, initially 500-1,000 operations and tuned from measurements;
- has bounded concurrency, initially 1-4 batches, with backpressure;
- uses the dedicated import connection pool and credentials;
- checkpoints the source byte/row position and last completed batch;
- records source hash, importer version, parser version, started/completed times, counts, rejects, and checksums;
- upserts by stable ID and source hash so reruns are idempotent;
- routes malformed/oversized documents to `import_issues` without losing the rest of the batch;
- supports `--dry-run`, `--sample`, `--resume`, and a run ID;
- rate-limits itself when gateway latency, pool wait time, replication lag, CPU, or memory crosses a threshold.

For the full catalog, run the importer as a dedicated job close to MongoDB, not through public application requests and not inside a normally autoscaled gateway instance. It may reuse the shared domain transformation library and write directly using the restricted import credential.

Build normal indexes required for validation before the import when their constraints are needed. Build expensive search indexes after the bulk load unless measured Atlas guidance indicates otherwise. Import into a versioned/staging collection and switch an application catalog version only after validation; this avoids exposing a half-loaded catalog.

Local SQLite staging may remain temporarily as a deterministic parser/QA tool, but it must no longer be the production transfer format. SQL chunk generation is not part of the MongoDB path.

### D1 export and transform

Create a versioned `scripts/migrate-d1-to-mongodb.ts` tool with four separable commands:

1. `export`: create a consistent D1 snapshot/export and a manifest containing environment, migration version, export timestamp, counts, and checksums.
2. `transform`: join normalized D1 rows into the target MongoDB document shapes and validate references and document sizes.
3. `load`: idempotently bulk-write to a named MongoDB staging database/namespace.
4. `verify`: compare source and target invariants and produce a signed-off report.

Never print MongoDB connection strings, token hashes, emails, source recipe contents, or secrets in normal logs. Store encrypted exports in a restricted location with an explicit retention date.

Recommended load order:

1. canonical units, ingredients, aliases, and tags;
2. Better Auth users/accounts/verifications, followed by sessions if supported;
3. households, memberships, profiles, and preferences;
4. public and private recipes with embedded steps/ingredients/tags;
5. favourites, saved searches, and collections;
6. meal plans and shopping lists;
7. ingestion state and mutation events;
8. invitations, shares, API keys/events, and email deliveries;
9. import history/issues required for retention;
10. search index build and search validation.

Preserve token hashes exactly; never attempt to reconstruct or export raw invitation, share, or API-key tokens. Existing unexpired hashed tokens should remain usable only if the current hash/lookup code is preserved and verification tests pass.

### Change capture and final delta

The simplest safe cutover is a short maintenance window:

1. Complete and verify the large catalog load in advance.
2. Run at least one rehearsal export/transform/load from preview and production-like data.
3. Enter maintenance/read-only mode for state-changing requests and pause queue consumers/workflows.
4. Record the D1 watermark and export the final mutable data.
5. Load the final delta/idempotent snapshot into the clean target namespace.
6. Run reconciliation and smoke tests.
7. switch application/gateway configuration to MongoDB;
8. resume queues/workflows and leave D1 read-only.

If the required maintenance time is unacceptable, add a D1 outbox/change log and dual-write through the storage abstraction before cutover. Do not attempt dual writes from unrelated route code: the D1 write and event record must be atomic, and replay to MongoDB must be ordered/idempotent. MongoDB stays shadow/read-only until reconciliation passes.

## Validation and reconciliation

Every rehearsal and final migration produces a report with at least:

- document/row counts for every source table and target collection;
- counts by visibility, status, household, and ownership where applicable;
- no orphan recipe, ingredient, household, plan, list, invitation, or share references;
- source-to-target checksums over stable, normalized representations;
- exact ordered step/ingredient/item counts for sampled and boundary documents;
- min/max timestamps and identifier samples;
- no document above the size threshold;
- unique-index validation with no unexpected duplicates;
- authentication/session migration result;
- token-hash verification using dedicated non-production fixtures;
- golden-query search precision/order/facet comparison;
- shopping-list regeneration and recipe-ingestion publish comparisons;
- gateway latency, error rate, pool usage, wait queue, and MongoDB load under expected and burst traffic.

Required automated test layers:

- pure domain/parser tests with no database;
- storage contract tests run against D1 and MongoDB during migration;
- gateway authorization and schema tests;
- MongoDB integration tests against a replica set so transactions are real;
- end-to-end tests through the Cloudflare application Worker;
- load tests that demonstrate the configured connection ceiling;
- failure tests for gateway restart, MongoDB election/unavailability, timeout, retry, duplicate request, and partial import restart.

## Rollout phases and gates

### Phase 0 — prove the platform and record decisions

- Measure the MongoDB deployment connection limit and normal operational headroom.
- Prototype the recommended Node gateway with the real driver, TLS, credentials, replica-set discovery, transactions, and bounded autoscaling.
- Optionally prototype a sharded Durable Object gateway. Test driver compatibility, TCP/TLS/SRV behavior, transaction support, object hibernation/reconnection, object throughput, and duration cost. A single global Durable Object is not acceptable.
- Select Atlas Search or a proven external search implementation.
- Decide whether existing Better Auth sessions can be migrated.
- Record the gateway runtime, region count, instance cap, pool sizes, search engine, maintenance-window allowance, and SLOs in an architecture decision record.

Gate: connection count is demonstrably bounded during burst/restart tests, transactions work, search has a viable design, and the Better Auth placement is approved.

### Phase 1 — storage contract and MongoDB foundation

- Add shared domain schemas and `StorageClient`.
- Wrap current D1 operations in `D1StorageClient` without behavior changes.
- Implement gateway service, migrations/indexes, service authentication, observability, and local replica-set development.
- Define all collections, validators, indexes, and catalog versioning.

Gate: contract tests pass against D1 and MongoDB for the first read slice; no public request can submit arbitrary database operations.

### Phase 2 — catalog and read shadowing

- Implement the MongoDB catalog importer and import a deterministic sample.
- Import the full catalog into staging with checkpoints.
- Build the search index and run golden-query validation.
- Route production reads to D1 while asynchronously comparing sampled MongoDB results without returning them to users.

Gate: counts/checksums pass, search quality is accepted, no oversized documents remain unresolved, and shadow-read mismatch is below the agreed threshold.

### Phase 3 — transactional domains and background jobs

- Convert favourites, preferences, saved searches, plans, shopping, shares, ingestion, email, exports, MCP, and API-key operations.
- Add idempotency and transaction tests.
- Convert all queue/workflow consumers to the gateway.
- Rehearse D1 export/transform/load and rollback in preview.

Gate: all storage contract and end-to-end tests pass; retries do not duplicate writes or messages; preview runs only through the gateway.

### Phase 4 — Better Auth and households

- Host Better Auth with its MongoDB adapter in the gateway.
- Proxy public auth routes through the application Worker.
- Migrate users/accounts/verifications and sessions if approved.
- Verify household provisioning, invitations, Dash ownership validation, cookies, trusted origins, and sign-in flows.

Gate: preview authentication and household tests pass through the real public origin, and the session migration/sign-in-reset decision is documented.

### Phase 5 — production cutover

- Take backups and record recovery owners.
- Put the application in maintenance/read-only mode and pause consumers.
- Export/load the final D1 state, reconcile, and run smoke tests.
- Deploy gateway/application configuration for MongoDB and resume consumers.
- Keep D1 unchanged and read-only.
- Monitor pool saturation, wait time, latency, MongoDB utilization, auth errors, search mismatches, queue retries, and business-level counts.

Gate: the observation period passes the agreed SLO/error thresholds and the rollback deadline has not been exceeded.

### Phase 6 — retire D1

- Remove all D1 code and configuration listed below.
- Archive the final D1 export and migration reports under the agreed retention policy.
- Update setup, deployment, import, local-development, and recovery documentation.
- Delete remote D1 databases only after the rollback window expires, backups are verified, and a human explicitly approves the destructive step.

Gate: repository search finds no runtime D1 access, production has passed the rollback window, and restore-from-backup has been tested.

## Rollback plan

Before cutover, rollback is simply disabling MongoDB/shadow traffic and continuing on D1.

During the final maintenance window, do not reopen writes until either MongoDB has passed validation or the application is restored to D1. This avoids reconciling two writable systems.

After MongoDB writes reopen, use a short, predefined rollback decision window. If rollback must remain possible after user writes have reached MongoDB, a tested reverse change capture/export into D1 is required before cutover. Without that mechanism, post-write rollback means maintenance mode plus a forward repair, not an instant configuration flip. The team must explicitly choose one of these approaches in phase 0:

- keep the post-cutover decision window short and restore/repair forward in MongoDB; or
- implement bidirectional/reverse capture and accept its cost and risk.

Never delete or modify the D1 database during the rollback window. Preserve the final export, watermark, importer version, MongoDB namespace, and configuration release IDs.

## Code and configuration to remove

Removal is staged. Items marked “after cutover” remain available until MongoDB is stable; remote resources are removed only after the rollback window.

### Replace during implementation

- Replace direct `D1Database`, `env.DB`, `.prepare()`, `.batch()`, and SQL use in `src/db/*.ts` with the `StorageClient`; move reusable types and pure calculations into domain modules.
- Replace direct SQL in `src/auth/server.ts`, `src/auth/api-keys.ts`, `src/households/invitations.ts`, `src/email/*.ts`, `src/ingestion/*.ts`, `src/sharing/shopping-share.ts`, `src/exports/models.ts`, `src/mcp/server.ts`, and `workers/recipe-ingestion.ts`.
- Replace direct `env.DB` calls in all `app/routes` loaders/actions with typed domain client calls, including health checks and `waitUntil` share-touch updates.
- Replace `database: env.DB` and SQL household provisioning in `src/auth/server.ts` with gateway-hosted Better Auth plus gateway domain operations.
- Replace D1 mocks and SQL-specific assertions in `src/db/*.test.ts`, `src/auth/server.test.ts`, `src/households/invitations.test.ts`, `src/mcp/server.test.ts`, and route tests with domain, contract, gateway, and MongoDB replica-set integration tests.

### Remove after successful cutover and rollback window

- Delete the obsolete SQL repository implementations in `src/db/*.ts` after every caller uses the gateway and reusable logic has been extracted.
- Delete/freeze then remove all files under `migrations/`:
  - `0001_initial.sql`
  - `0002_saved_recipe_searches.sql`
  - `0003_unique_household_meal_plan_weeks.sql`
  - `0004_private_recipe_ingestion.sql`
  - `0005_custom_meal_slots.sql`
  - `0006_pdf_email_public_checklists.sql`
  - `0007_household_invitations.sql`
- Remove the `d1_databases` blocks and `DB` binding from the base, preview, and production sections of `wrangler.jsonc`.
- Regenerate `worker-configuration.d.ts` so the project environment no longer exposes `DB: D1Database`. Generated platform declarations may still mention Cloudflare's D1 API types; the application environment must not.
- Remove `db:migrate:local`, `db:migrate:preview`, and `db:migrate:production` from `package.json`.
- Remove the D1/SQL production-transfer functions and commands from `scripts/import-recipes.ts`: SQL literal/export/chunk generation, `export-sql`, `apply-local`, `apply-remote`, and Wrangler D1 execution. Retain the parser/normalizer/QA portions in storage-independent modules.
- Replace SQL-focused tests in `scripts/import-recipes.test.ts`; remove generated `.import/sql/*` artifacts and add them to ignore rules if necessary.
- Remove D1 creation, migration, query, import, troubleshooting, and limit instructions from `INITIAL_SETUP.md`, `docs/operations/*.md`, `docs/phases/*.md`, `docs/phased-implementation-plan.md`, `docs/meal-planner-application-plan.md`, and `docs/implementation-progress.md`. Historical progress entries may be retained only when clearly marked historical.
- Remove the D1-specific health query from `app/routes/api.health.ts`; health should report the gateway and MongoDB dependency without exposing credentials or topology.
- Remove any D1 packages or SQLite packages that become unused after the importer decision. Do not remove local SQLite staging support if it is intentionally retained for parser QA.

### Remove remote resources last

- Disable D1 write credentials/bindings first and verify production cannot write to D1.
- Retain the D1 databases read-only for the approved rollback period.
- Verify encrypted export restore and retention metadata.
- Delete `meal-planner-preview` and `meal-planner-production` D1 resources only with explicit human approval. Resource deletion is not part of an ordinary application deployment.

### Code to retain

- CSV streaming, deterministic sampling, recipe parsing, quantity/unit normalization, stable ID generation, duplicate detection, and QA reporting.
- Domain authorization rules, recipe visibility semantics, plan/shopping calculations, export formatting, and public HTTP contracts.
- R2 recipe source artifacts, Cloudflare queues/workflows/Durable Object orchestration, and email/extraction integrations; only their persistence calls change.
- Existing hashed token/key values and verification algorithms unless a separately tested security migration replaces them.
- The final D1 exports and migration/reconciliation reports for the documented retention period.

## Operational controls and SLOs

Alert on gateway instance count, MongoDB checked-out/available pool connections, wait-queue timeouts, server-selection errors, command duration, transaction retries, request rejection, cache hit rate, search errors, replication lag, and cluster CPU/memory/storage. Include operation name and request ID in telemetry, but no secrets or private recipe text.

At minimum define before cutover:

- interactive request latency and availability SLOs;
- maximum gateway instance and connection counts;
- gateway saturation and MongoDB utilization alert thresholds;
- import throttling/pause thresholds;
- maximum acceptable shadow-read mismatch;
- maintenance-window and recovery-time objectives;
- backup retention and restore owner;
- rollback decision deadline.

Runbooks must cover gateway restart/deploy, MongoDB election/outage, pool exhaustion, credential rotation, failed/partial import, search-index rebuild, queue backlog, maintenance mode, cutover, and rollback.

## Definition of done

The migration is complete only when:

- all public and background code reaches persistence through the gateway contract;
- no application code reads or writes `env.DB`;
- MongoDB connections remain under the calculated ceiling during load and rolling restart tests;
- all catalog and D1 state reconciliation checks pass;
- search and authorization golden tests pass;
- Better Auth, Dash validation, households, invitations, API keys, shares, ingestion, email, exports, MCP, meal planning, and shopping work in production;
- a partial import can resume without duplicates or corruption;
- backups and restore procedures are tested;
- the rollback window expires without unresolved severity-one issues;
- D1 code/config/docs are removed and the final resource deletion is separately approved.

## Decisions still required

These decisions are phase 0 outputs, not reasons to delay initial contract work:

1. MongoDB Atlas versus a managed/self-hosted replica set, and its region.
2. Regional Node gateway as recommended, or a Cloudflare Durable Object design that passes the proof and cost review.
3. Atlas Search versus a separately operated search service.
4. Allowed maintenance-window duration and whether dual-write/change capture is necessary.
5. Existing Better Auth session migration versus a one-time sign-in reset.
6. Required D1 rollback and encrypted-export retention periods.
7. Final connection budget, pool values, gateway instance cap, and SLO thresholds based on measured cluster limits.
