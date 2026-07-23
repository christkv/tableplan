# Tableplan Performance Optimization Plan

Status: proposed  
Date: 2026-07-23  
Scope: application Worker, MongoDB gateway Worker, MongoDB schema and queries, React Router loaders, recipe browsing, shopping-list generation, ingestion review, PDF exports, and client rendering

## 1. Purpose

This document turns the performance review into an implementation plan. It focuses on the changes most likely to improve request latency, gateway capacity, database efficiency, and browser responsiveness before production load testing.

The current system has a sound connection-safety boundary: one MongoDB gateway Durable Object owns a bounded `MongoClient` pool. The main performance problem is that the application Worker treats that gateway as a remote `Db` object. A single business operation therefore becomes several service-binding requests, each carrying a JSON-encoded MongoDB operation. Several request paths add N+1 queries, repeat session and membership work, or move complete embedded documents when only summaries are required.

The target state keeps the bounded MongoDB pool, but moves business operations closer to MongoDB, reduces cross-Worker calls, adopts cursor pagination, batches related reads, and gives the gateway enforceable capacity and execution limits.

## 2. Baseline and measurement requirements

This plan is based on static code-path analysis. Production latency and capacity have not yet been measured, so implementation must be accompanied by a reproducible baseline.

Before changing the architecture, add a preview load-test suite that records:

- end-to-end latency for recipe browse, text search, recipe detail, plan load, plan mutation, shopping-list generation, and shopping-item toggle;
- application-to-gateway request count per end-user request;
- MongoDB command count and total command duration per end-user request;
- gateway in-flight requests, pool checkout wait, checked-out connections, and rejected requests;
- request and response bytes between the application and gateway Workers;
- MongoDB documents and keys examined for the main query shapes;
- Worker CPU time and memory for recipe search, shopping generation, ingestion review, and PDF generation;
- browser DOM node count, scripting time, and memory after loading 24, 240, 1,000, and 5,000 recipe cards.

Use production-scale preview data. The current local proof contains approximately 500,000 catalog recipes, which is suitable for query-shape tests, but Atlas Search and Cloudflare service-binding latency must be measured in preview.

### Proposed initial budgets

These are starting targets, not contractual SLOs. Confirm them after the first baseline.

| Operation | p50 target | p95 target | Gateway calls per request |
| --- | ---: | ---: | ---: |
| Catalog browse page | 150 ms | 400 ms | 1 domain call |
| Text recipe search | 250 ms | 750 ms | 1 domain call |
| Recipe detail | 150 ms | 400 ms | 1 page-data call |
| Meal-plan load | 150 ms | 400 ms | 1 page-data call |
| Plan item mutation | 200 ms | 600 ms | 1 mutation call, excluding async refresh |
| Shopping-list generation | 300 ms | 1,000 ms | 1 domain call |
| Shopping-item toggle | 100 ms | 300 ms | 1 mutation call |

## 3. Target request architecture

The existing operations-only MongoDB endpoint remains useful for Better Auth, but application domain operations should stop using it directly.

```text
Browser
  |
  v
React Router application Worker
  |  one authenticated page or mutation request
  v
Storage domain RPC over service binding
  |
  v
MongoGatewayDO ("pool-0")
  |  domain store runs next to the real MongoDB Db
  |  one membership check and one or more local driver calls
  v
Bounded MongoDB connection pool
  |
  v
MongoDB Atlas
```

Better Auth can continue using the restricted `/v1/mongodb` facade until it has a dedicated auth service. Application storage should use a new `/v1/storage` endpoint backed by the existing versioned storage contract.

### Primary code areas

| Recommendation | Main files and modules |
| --- | --- |
| Domain RPCs | `gateway/runtime.ts`, `gateway/app.ts`, new `gateway/storage-handler.ts`, `workers/mongodb-gateway.ts`, `src/storage/application-client.ts`, `src/storage/index.ts`, `src/storage/contract.ts`, new `src/storage/domain-gateway-client.ts` |
| Cursor recipe search | `src/storage/mongodb/recipes.ts`, `src/domain/recipe-search.ts`, `src/domain/recipes.ts`, `gateway/schema.ts`, `gateway/migrate.ts`, `app/routes/recipes.tsx`, `app/routes/api.recipes.search.ts` |
| Shopping aggregation | `src/storage/mongodb/shopping.ts`, `src/storage/mongodb/plans.ts`, `src/storage/mongodb/recipes.ts`, `app/routes/plan.tsx`, `workers/app.ts`, `wrangler.jsonc` |
| Request-scoped auth | `app/context.ts`, `workers/app.ts`, `src/auth/server.ts`, all authenticated route loaders and actions |
| Ingredient candidates | `src/storage/mongodb/ingestions.ts`, `app/routes/recipe-import-review.tsx`, `gateway/schema.ts`, `gateway/migrate.ts`, `src/storage/contract.ts` |
| Gateway protection | `gateway/app.ts`, `gateway/config.ts`, `gateway/mongo.ts`, `src/storage/mongo-gateway.ts`, `wrangler.gateway.jsonc` |
| Domain size limits | `src/domain/planning/*`, `src/domain/shopping.ts`, `src/ingestion/types.ts`, `src/storage/mongodb/plans.ts`, `src/storage/mongodb/shopping.ts`, `gateway/schema.ts` |
| Catalog and PDF caching | `src/storage/mongodb/recipes.ts`, recipe API routes, `src/exports/models.ts`, `src/exports/pdf.ts`, PDF routes, `wrangler.jsonc` |
| Recipe-grid virtualization | `app/routes/recipes.tsx`, `app/app.css`, `package.json` if a virtualization dependency is selected |
| Command logging | `src/observability/logger.ts`, `gateway/mongo.ts`, importer and gateway logging tests |

## 4. Recommendation 1: Replace fine-grained collection proxy calls with coarse domain RPCs

### Current limitation

`createApplicationStorageClient` runs domain stores in the application Worker against a remote `Db` facade. Every `findOne`, `find`, `aggregate`, or update becomes a separate service-binding request. The transport repeatedly encodes BSON-compatible values, serializes JSON, parses the response, and decodes it.

This makes network boundaries appear inside store methods. A plan mutation or shopping-list refresh can generate many sequential application-to-gateway calls even though all operations target the same database.

### Target design

Run the MongoDB domain stores inside `MongoGatewayDO`, where they can use the real `Db`. Add a versioned domain endpoint:

```text
POST /v1/storage
Authorization: Bearer <service token>
Content-Type: application/json

{
  "contractVersion": "2026-07-23.1",
  "requestId": "...",
  "deadlineAt": 1784800000000,
  "operation": "recipes.search",
  "input": { ... }
}
```

The repository already defines most request and response schemas in `src/storage/contract.ts`. Use those schemas rather than creating a second contract.

### Implementation changes

1. Add `gateway/storage-handler.ts`.
   - Parse requests with `gatewayRequestSchema`.
   - Reject unknown contract versions and invalid operations before database access.
   - Dispatch operations to a `StorageClient` built from the real MongoDB `Db`.
   - Serialize results with the existing response schemas.
   - Map known domain errors to stable error codes and retryability.
   - Record operation duration, MongoDB command count, and response bytes.

2. Compose the stores inside the gateway.
   - Refactor `createApplicationStorageClient` into a transport-neutral `createMongoStorageClient(database)`.
   - Do not pass a `MongoGatewayClient` into this server-side client.
   - Keep the health operation separately wired to the gateway's `MongoRuntime`.
   - Ensure nested store calls share the same server-side store instances.

3. Add `src/storage/domain-gateway-client.ts`.
   - Implement `StorageClient` by sending one `/v1/storage` request per method.
   - Validate responses with the operation-specific Zod schemas.
   - Preserve request deadlines and error metadata.
   - Reuse one client instance per application request.

4. Change `src/storage/index.ts`.
   - Application code should construct `DomainGatewayStorageClient`.
   - Remove `createMongoGatewayDatabase` from application domain paths.
   - Keep `createMongoGatewayDatabase` available only to Better Auth while it still requires a `Db` adapter.

5. Extend `gateway/runtime.ts`.
   - Route `/v1/storage` to the domain handler.
   - Route `/v1/mongodb` to the restricted collection handler used by Better Auth.
   - Apply shared authentication, request-size, admission-control, deadline, and logging middleware.

6. Update the storage contract.
   - Add any missing page-oriented operations described later in this plan.
   - Keep request and response schemas backward compatible during rollout.
   - Increment `STORAGE_CONTRACT_VERSION` when the deployed application requires the new endpoint.

### Page-oriented operations

Coarse domain methods remove query-level network calls, but a page loader may still issue four domain calls. Add page-data operations where fields share the same authorization and lifecycle:

- `recipes.page`: search results, facets, saved searches, meal slots, and optional plan-selection label;
- `recipes.detailPage`: recipe, favorite state, measurement preference, meal slots, and optional plan-item context;
- `plans.page`: requested week, previous week summary, configured slots, and optional recipe being added;
- `shopping.page`: measurement preference, latest list, active shares, and linked plan summary;
- `settings.page`: API keys, measurement preference, meal slots, and household overview.

These operations should perform one membership lookup and execute independent database reads with bounded `Promise.all`.

### Transactions

Once domain operations run beside the real driver, restore transaction support for operations that require multi-document consistency:

- first-household provisioning;
- invitation acceptance;
- private recipe publication and mutation-event creation;
- plan mutation plus refresh-version update;
- shopping share and email-delivery creation where both records must agree.

Use the driver's transaction retry behavior for transient transaction errors. Do not expose sessions through the network contract.

### Rollout

1. Deploy the gateway with both `/v1/storage` and `/v1/mongodb`.
2. Add contract tests that compare the old application-side store results with the new domain RPC results.
3. Move one read-only operation at a time, starting with health and recipe detail.
4. Move recipe search and page-data operations.
5. Move mutations after transaction and idempotency tests pass.
6. Retain `/v1/mongodb` only for Better Auth and remove unused application collection methods.

### Acceptance criteria

- An application `StorageClient` method creates at most one service-binding request.
- Initial recipes, plan, shopping, and settings pages each use one storage domain request after session resolution.
- Domain operations use the real `Db`, not `createMongoGatewayDatabase`.
- Better Auth continues to work through its restricted facade.
- Contract-version mismatch, invalid input, timeout, and retryable MongoDB errors have stable tests.

## 5. Recommendation 2: Replace offset pagination and project summary-only recipe fields

### Current limitation

The `all` scope fetches `offset + page size` rows from catalog and custom recipes for every page, merges them in the application Worker, and then slices the desired window. Work grows quadratically as the user scrolls. The generic gateway also caps `find` at 10,000 rows, which causes the all-scope browser to stop early.

Other scopes transfer only one page but use `skip`, so MongoDB must walk progressively larger index ranges. All browse queries currently return complete recipe documents, including steps and ingredient arrays.

### Target API

Use an opaque cursor instead of `offset`:

```json
{
  "recipes": [],
  "hasMore": true,
  "nextCursor": "eyJ2IjoxLCJuYW1lIjoiLi4uIiwiaWQiOiIuLi4ifQ",
  "limit": 24
}
```

For alphabetical browsing, the cursor contains a version, normalized sort name, and recipe ID. Encode it as base64url and validate its decoded length and fields. Treat it as opaque outside the storage implementation.

Text search requires a search-specific cursor containing the Atlas Search sequence token or equivalent stable continuation state. Do not mix alphabetical cursors and relevance cursors.

### Browse-query implementation

1. Add a shared summary projection containing only:
   - `_id`;
   - `sourceId`;
   - `name`;
   - `description`;
   - `servings`;
   - `qualityFlags`;
   - `tags`;
   - `visibility`;
   - `origin`;
   - `ownerUserId`;
   - the first six `recipeIngredients.ingredient` values.

2. Add a stable normalized sort field.
   - Introduce `sortName`, produced by the same normalization code for imports and private recipes.
   - Backfill it for existing recipes.
   - Continue to use `_id` as the tie-breaker.

3. Add indexes aligned with access branches:
   - catalog: `{ visibility: 1, status: 1, sortName: 1, _id: 1 }`;
   - owner: `{ ownerUserId: 1, status: 1, sortName: 1, _id: 1 }`;
   - household: `{ ownerHouseholdId: 1, visibility: 1, status: 1, sortName: 1, _id: 1 }`.

4. For each access branch, query only rows after the cursor:

```js
{
  ...accessBranch,
  $or: [
    { sortName: { $gt: cursor.sortName } },
    { sortName: cursor.sortName, _id: { $gt: cursor.id } }
  ]
}
```

5. For `scope=all`, request at most `limit + 1` catalog rows and `limit + 1` custom rows, merge those bounded windows, and return the first `limit` rows.
   - This preserves custom/catalog interleaving without refetching earlier pages.
   - Deduplicate by `_id` before returning results.
   - Generate the next cursor from the last returned row.

6. For catalog, mine, and household scopes, query one branch directly with the same cursor predicate.

### Text-search implementation

1. Add `status`, `visibility`, `ownerUserId`, `ownerHouseholdId`, and any tag filter fields to the Atlas Search mapping.
2. Move access, status, and supported tag restrictions into `$search.compound.filter`.
3. Return an Atlas Search continuation token with each result page.
4. Use `searchAfter` or the Atlas-supported equivalent instead of `$skip`.
5. Project summary fields before results cross the gateway boundary.
6. Keep a bounded offset compatibility path for old API clients during one contract version, with an explicit deprecation response header.

### Facets

- Continue using precomputed catalog tag counts for unfiltered catalog browsing.
- Calculate private and household tag counts only from those small access scopes.
- For text searches, use Atlas Search facets if preview measurements show the current `$search` plus `$unwind` pipeline is expensive.
- Return only the top configured number of facets and an explicit `truncated` flag.

### Migration and rollout

1. Add `sortName` to write paths.
2. Backfill catalog and private recipes in bounded batches.
3. Create the new indexes.
4. Deploy cursor-capable read APIs while retaining `offset`.
5. Change the recipe UI to consume cursors.
6. Remove offset pagination after external clients have migrated.

### Tests

- duplicate recipe names across catalog, owner, and household branches;
- cursor boundaries containing non-ASCII recipe names;
- insertions and deletions between page requests;
- no duplicate or missing rows across 1,000 sequential pages;
- all-scope browsing beyond 10,000 and 100,000 recipes;
- summary projection excludes steps and full ingredient arrays;
- Atlas text-search continuation with equal scores;
- cursor tampering and oversized cursor rejection.

### Acceptance criteria

- Database and gateway work per browse page is proportional to page size, not offset.
- All-scope browsing can traverse the complete catalog.
- A recipe-card page never transfers recipe steps or more than six ingredient names per recipe.
- Explain plans show indexed scans without a blocking full-catalog sort for standard browse queries.

## 6. Recommendation 3: Batch shopping-list recipe reads and remove synchronous full refreshes

### Current limitation

Shopping-list aggregation reads one recipe at a time in a sequential loop. Every plan mutation synchronously refreshes an existing list, so changing servings can wait for a plan lookup, one query per meal, CPU aggregation, and a complete embedded-list update.

Updating one private recipe refreshes every plan containing it, serially, and each plan repeats the N+1 recipe process.

### Immediate implementation: batch reads

1. Add `MongoRecipeStore.getMany`.
   - Accept unique recipe IDs plus access context.
   - Query with `_id: { $in: ids }` and the access filter.
   - Project only fields required for shopping aggregation: name, servings, visibility, and `recipeIngredients`.
   - Return a map keyed by recipe ID.

2. Refactor `aggregatePlan`.
   - Collect unique recipe IDs from all plan items.
   - Fetch them in one query.
   - Preserve plan-item order while building aggregation inputs.
   - Reuse one recipe for repeated meals rather than retrieving it repeatedly.

3. Remove duplicate membership checks inside a single domain operation.
   - Authorize once at the operation boundary.
   - Pass an internal authorized context to plan and recipe helpers.

4. Avoid duplicate recipe validation when adding a meal.
   - The route currently fetches the recipe and `addItem` fetches it again.
   - Make `plans.addItem` the authoritative validation point and return a stable `recipe_not_shareable` error.

### Second implementation: versioned asynchronous refresh

Introduce list freshness rather than forcing every plan mutation to rebuild the complete list synchronously.

Add these fields:

- meal plan: `contentVersion`, incremented on item/serving changes;
- recipe: `contentVersion`, incremented on relevant recipe edits;
- shopping list: `sourcePlanVersion`, `sourceRecipeVersions`, `refreshStatus`, `refreshRequestedAt`, `refreshedAt`, and `refreshError`.

Mutation flow:

1. Update the plan and increment `contentVersion` transactionally.
2. Mark linked shopping lists as `stale`.
3. Enqueue a deduplicated `shopping-list-refresh` message containing household ID, plan ID, and target plan version.
4. Return the mutation response immediately.
5. The queue consumer loads the plan and all recipes in batches, aggregates the list, and writes it only if the requested version is still current.
6. If a newer version exists, acknowledge the old job and ensure a job for the newest version exists.

Use an idempotency key such as `shopping-refresh:<planId>:<contentVersion>`. A unique index or Durable Object coordination must prevent duplicate concurrent refreshes for the same version.

### Read behavior

- Return `refreshStatus` and whether the list is stale.
- The authenticated shopping UI should show “Updating quantities” while retaining the previous list.
- Public checklists should continue showing the last complete list and may show an updated timestamp; never expose partial aggregation.
- Explicit “Generate from plan” can await initial generation because no previous list exists.

### Recipe edit behavior

Maintain or query the existing `meal_plans` index on `items.recipeId`, mark affected lists stale in a bounded update, and enqueue one refresh job per affected plan. Do not regenerate plans serially in the recipe-edit request.

### Queue configuration

- Add a shopping-refresh producer and consumer separate from email delivery.
- Start with a small batch size and bounded consumer concurrency.
- Retry transient gateway and MongoDB failures.
- Send terminal failures to a dead-letter queue and leave `refreshStatus=failed`.
- Add replay tooling and operational documentation.

### Tests

- repeated recipes in one plan cause one recipe document read;
- serving update returns before asynchronous refresh completes;
- two rapid serving updates produce only the latest list version;
- checked state survives refresh using the stable item key;
- recipe edit marks all linked lists stale;
- queue retry is idempotent;
- public readers never observe partially written items;
- initial list generation remains synchronous and deterministic.

### Acceptance criteria

- Shopping generation uses one plan read and one batched recipe read.
- Plan mutation latency does not grow linearly with meals when a list already exists.
- A plan mutation performs no synchronous full-list replacement.
- List freshness and failed refreshes are visible and recoverable.

## 7. Recommendation 4: Cache session and authorization state once per request

### Current limitation

The layout loader and child loader independently resolve the session and call `ensureUserHousehold`. Store methods then repeatedly query household membership. This adds fixed latency to every page and duplicates authorization queries inside compound operations.

### Request-scoped service container

Extend the React Router load context with lazy, request-scoped services:

```ts
interface RequestServices {
  storage: StorageClient;
  getSession(): Promise<RequestSession | null>;
  requireSession(): Promise<RequestSession>;
}
```

Create it once in `workers/app.ts` for each incoming request. `getSession()` stores its promise immediately, so concurrent parent and child loaders await the same work.

Implementation requirements:

- construct one `StorageClient` per request;
- memoize the Better Auth session lookup;
- memoize household resolution;
- never place session results in module-global state;
- do not cache across requests or users;
- preserve public routes that do not require authentication by keeping lookup lazy.

Refactor loaders and actions to obtain services from `cloudflareContext` rather than independently calling `createStorageClient` and `requireRequestSession`.

### Authorization inside domain RPC

Each domain RPC must authorize once at its boundary:

1. Query membership with `{ householdId, userId }` and a minimal projection.
2. Create an internal `AuthorizedHouseholdContext` containing user ID, household ID, and role.
3. Pass that context to nested store helpers.
4. Prevent nested helpers from requerying membership.

Page-data operations should share the same authorized context across all reads.

Do not use a long-lived membership cache initially. Immediate membership removal is security-sensitive. If later measurements justify caching, use a very short TTL plus explicit invalidation and document the consistency tradeoff.

### Household provisioning

`ensureUserHousehold` should not run on every request after migration:

- store `defaultHouseholdId` in the session payload or a strongly consistent session-side profile snapshot;
- provision the first household only during sign-up/sign-in completion;
- validate the default membership when the session is created or refreshed;
- provide a recovery path when the referenced membership has been removed.

During transition, keep request-scoped memoization even if `ensureUserHousehold` remains in the request path.

### Tests

- parent and child loaders trigger one session lookup;
- four concurrent calls to `requireSession()` share one promise;
- unauthenticated public routes do not initialize auth or storage unnecessarily;
- household switch invalidates or refreshes session household state;
- membership removal prevents subsequent authorized requests;
- one page-data domain operation performs one membership query.

### Acceptance criteria

- Initial authenticated SSR performs one session resolution and at most one household resolution.
- No route creates multiple storage clients during one request.
- Every domain operation performs at most one membership lookup.
- Authorization behavior remains unchanged in negative tests.

## 8. Recommendation 5: Replace ingredient scans with indexed, batched candidate lookup

### Current limitation

Ingredient candidates use an unanchored, case-insensitive regular expression. This query cannot efficiently use the existing normalized-name index for arbitrary substring matching. The review loader sends one request per ingredient with unbounded `Promise.all`, potentially launching many scans at once.

Ingredient mapping during draft creation also performs alias and canonical-ingredient lookups one ingredient at a time.

### Indexed prefix search

For the first implementation, use normalized prefix matching:

1. Normalize the query to lowercase with `normalizeIngredientName`.
2. Remove the `i` regex option because the stored field is normalized.
3. Prefer an index-range query:

```js
{
  normalizedName: {
    $gte: prefix,
    $lt: `${prefix}\uffff`
  }
}
```

4. Sort by `normalizedName` and apply a small limit.
5. Return exact matches first, followed by prefix matches.

If product requirements require typo tolerance or token-in-the-middle matching, add an Atlas Search autocomplete index for ingredients rather than returning to an unanchored regex.

### Batch candidate operation

Replace per-ingredient calls with:

```ts
listIngredientCandidateBatches(
  queries: string[],
  limitPerQuery?: number
): Promise<Record<string, IngredientCandidate[]>>
```

Contract limits:

- at most 50 unique normalized queries;
- at most 10 candidates per query by default;
- at most 20 candidates per query;
- bounded input string length.

Because MongoDB cannot efficiently express many independently limited prefix windows in one simple query, execute prefix lookups inside the gateway with a small concurrency limiter, for example four concurrent queries. This remains one application-to-gateway request and prevents a review page from overwhelming the pool.

### Batch automatic mapping

Refactor `saveDraft` and `recipeIngredients`:

1. Parse and normalize all ingredient names.
2. Query aliases once using:
   - `normalizedAlias: { $in: names }`;
   - `householdId: { $in: [householdId, null] }`.
3. Resolve household aliases ahead of global aliases.
4. Query canonical ingredients once with `normalizedName: { $in: unresolvedNames }`.
5. Build mappings in memory.
6. Use `bulkWrite` for remembered aliases rather than sequential updates.

Consider changing the alias index to support both household and global aliases explicitly if `null` values conflict with the current unique-index behavior.

### Search-index migration

If Atlas autocomplete is adopted:

- add an `ingredients_v1` search index;
- index `normalizedName` as autocomplete and `canonicalName` for display search;
- keep exact normalized lookup in the regular B-tree index;
- include a deterministic fallback to prefix search if Atlas Search is unavailable.

### Tests

- exact and prefix matches use normalized values;
- explain plan uses `ingredient_name_unique` for prefix ranges;
- punctuation and accented input normalize consistently;
- duplicate ingredient queries are executed once;
- 50-query review respects the concurrency bound;
- alias precedence is household, global, canonical, then unmapped;
- Atlas outage falls back without a collection scan.

### Acceptance criteria

- Review-page ingredient lookup creates one domain RPC.
- No candidate query uses an unanchored case-insensitive regex.
- Draft mapping uses at most one alias query and one canonical-ingredient query.
- Candidate lookup latency remains bounded as the ingredient collection grows.

## 9. Recommendation 6: Enforce admission control, deadlines, result bounds, and pool telemetry

### Current limitation

The gateway checks the in-flight count before asynchronously reading the request body, then increments it afterward. Concurrent requests can pass the check together, so the configured maximum is not a hard limit. Request deadlines are checked before execution but are not applied to MongoDB. Client aborts can therefore leave database work running.

The aggregate endpoint has no enforced result limit, and read responses have no payload ceiling.

### Correct admission control

Increment the admitted-request count before the first `await`:

```ts
if (inFlight >= maxInFlight) return gatewayBusy();
inFlight += 1;
try {
  const parsed = await readAndParseBody(request);
  return await execute(parsed);
} finally {
  inFlight -= 1;
}
```

Use separate limits for:

- total admitted requests, including parsing;
- database operations waiting for or holding a pool connection;
- expensive operation classes such as search aggregation or bulk writes.

Start with measured conservative values. A gateway with a 10-connection pool should not accept 100 expensive operations without evidence that the queue and Worker memory remain healthy.

### Deadline propagation

1. Calculate `remainingMs = deadlineAt - Date.now()` after parsing.
2. Reject non-positive deadlines.
3. Add `maxTimeMS` to supported MongoDB operations using the smaller of:
   - the request's remaining time minus response overhead;
   - an operation-specific maximum.
4. Recheck the deadline before serialization.
5. Where supported and verified by integration tests, connect request cancellation to the driver's operation abort mechanism.
6. Distinguish deadline errors from gateway unavailability and pool checkout timeout.

Suggested maximums:

- point reads and simple updates: 3 seconds;
- recipe browse and detail aggregation: 5 seconds;
- text search and facets: 8 seconds;
- shopping generation: 10 seconds;
- administrative bulk operations: separate non-interactive endpoint.

### Result and payload bounds

- Require every `find` and aggregate domain operation to have an explicit server-side limit.
- Do not expose arbitrary pipelines through application-facing contracts.
- Measure encoded response size before returning it.
- Return a stable `response_too_large` error rather than exhausting Worker memory.
- Paginate list operations that can grow without a small product cap.
- Keep the generic Better Auth facade restricted to known adapter operations and collections.

### Pool telemetry

Subscribe to MongoDB pool events and record:

- connection pool created/closed;
- connection created/closed;
- checkout started/succeeded/failed;
- checkout wait duration;
- checked-out and available connection gauges;
- wait queue timeout count;
- server-selection failures.

For every domain operation, log or emit:

- request ID and operation name;
- total duration;
- admission wait;
- pool checkout wait;
- MongoDB command count and total command duration;
- request/response bytes;
- result count;
- timeout or rejection reason.

Do not include private query payloads in normal metrics.

### Overload behavior

- Return `429 gateway_busy` before reading large bodies when capacity is exhausted.
- Include a small bounded `Retry-After`.
- Do not automatically retry non-idempotent mutations in the application client.
- Permit one bounded retry for safe reads on gateway-busy and transient network errors, with jitter and respect for the original deadline.
- Require idempotency keys for mutations that clients may retry.

### Tests

- 101 simultaneous requests never exceed a configured 100 admitted requests;
- slow body parsing counts toward admission;
- expired deadlines do not reach MongoDB;
- long MongoDB operations receive `maxTimeMS`;
- aborted clients do not cause unbounded pool occupancy;
- aggregate and response bounds reject oversized work;
- pool checkout failure produces the correct metric and error code;
- retries never extend beyond the original deadline.

### Acceptance criteria

- Configured admission limits are enforceable under concurrency tests.
- No interactive MongoDB operation can run without a bounded execution time.
- Pool saturation, checkout wait, and rejected load are visible in dashboards.
- The gateway fails quickly and predictably rather than accumulating an unbounded queue.

## 10. Recommendation 7: Add domain size limits and split growing embedded collections when necessary

### Current limitation

Meal plans and shopping lists store all items in embedded arrays. Shopping items also embed every source recipe line. There is no limit on meals per week, shopping items, or source references. Large replacements can exceed the gateway's 1 MiB request-body limit before reaching MongoDB's document limit.

The same issue affects plan copying and private recipe writes that send complete arrays through the generic MongoDB facade.

### Immediate domain limits

Define and enforce product-level limits at API, domain, and database boundaries. Proposed starting values:

| Resource | Proposed limit |
| --- | ---: |
| Meal sections | 8, already enforced |
| Planned items per week | 112 |
| Ingredients per private recipe | 250 |
| Steps per private recipe | 250 |
| Tags per private recipe | 50 |
| Shopping items per generated list | 500 |
| Source references per shopping item | 25 |
| Saved searches per household | 200 |
| Active shopping shares per list | 10 |

Confirm these values with product requirements before implementation. Return stable, user-facing errors when a limit is reached.

### Reduce embedded payloads

- Domain RPCs should generate and update arrays inside the gateway so complete arrays do not cross the application-to-gateway boundary.
- Store only source recipe ID, recipe name, and a bounded raw-line excerpt in shopping items.
- Deduplicate source references by recipe and raw line.
- Store `sourceCount` when additional references are omitted.
- Project plan summary fields instead of reading an entire plan when only the linked name and dates are needed.

### Split collections if limits are insufficient

If measured household workloads need larger lists, normalize the model:

```text
meal_plans
meal_plan_items          indexed by planId, plannedDate, mealSlot

shopping_lists
shopping_list_items      indexed by listId, position
shopping_item_sources    optional, indexed by shoppingItemId
```

Benefits:

- item updates no longer rewrite or deserialize the parent document;
- items can be paginated;
- list metadata remains small;
- indexes can directly serve `items.id` lookups;
- document-size risk is removed.

Costs:

- list reads require aggregation or multiple queries;
- transactions are required for atomic generation;
- export and public-list paths need explicit pagination or bounded collection;
- migration is more complex.

For a family-scale product, enforced caps plus server-side domain operations may be sufficient. Normalize only if preview data shows embedded arrays approaching payload or CPU budgets.

### Index corrections

If arrays remain embedded:

- add `{ householdId: 1, "items.id": 1 }` for meal-plan item lookup;
- change shopping plan lookup to `{ householdId: 1, planId: 1, createdAt: -1 }`;
- keep `{ householdId: 1, createdAt: -1 }` for latest-list lookup;
- validate that multikey indexes do not create unacceptable write amplification.

### Migration

1. Add limits to schemas and domain validation.
2. Report existing records exceeding proposed limits.
3. Reduce unbounded shopping source arrays during refresh.
4. Deploy domain RPC so large server-side updates no longer cross the gateway body boundary.
5. Decide on normalization only after measuring the bounded embedded model.

### Tests

- every limit at `limit - 1`, `limit`, and `limit + 1`;
- long raw ingredient lines and repeated sources;
- plan copy at the item limit;
- shopping refresh preserves checked state at maximum size;
- payload-size metrics and graceful rejection;
- migration report identifies oversized existing documents.

### Acceptance criteria

- No domain write depends on an undocumented MongoDB or gateway size failure.
- Interactive request bodies remain comfortably below the gateway cap.
- Maximum-size supported plans and lists meet latency and memory budgets.

## 11. Recommendation 8: Cache safe catalog data, facets, and versioned PDFs

### Current limitation

The gateway correctly marks private database responses `no-store`, but the application has no higher-level caching for immutable catalog summaries or precomputed facets. PDF exports synchronously reload data and invoke Browser Rendering for every download.

### Cache boundaries

Never cache mixed-scope or household-private responses in a shared cache. Split cacheable catalog data from user-specific overlays.

Safe shared-cache candidates:

- catalog-only recipe summary pages;
- catalog-only recipe detail for dataset recipes;
- catalog tag facets;
- static OpenAPI output;
- versioned PDF bytes after authorization.

Private per-request data such as favorite state, private recipes, plans, shopping lists, sessions, and household membership must not enter a public shared cache.

### Catalog cache keys

Use explicit versioned keys:

```text
catalog:page:<catalogVersion>:<filtersHash>:<cursor>:<limit>
catalog:recipe:<catalogVersion>:<recipeId>:<recipeUpdatedAt>
catalog:facets:<catalogVersion>
```

Maintain `catalogVersion` in a small metadata document. Increment it only after a completed import/facet refresh. A versioned key avoids expensive cache-wide deletion.

Possible storage:

- Cloudflare Cache API for short-lived HTTP responses;
- KV for small catalog facets and metadata if eventual consistency is acceptable;
- R2 for large generated artifacts;
- in-isolate memory only as a very short best-effort optimization, never as the sole cache.

### Mixed `all` scope

Compose it from:

1. cached catalog page data;
2. uncached owner/household data;
3. a bounded deterministic merge.

Cursor semantics must account for both sources. If this makes cache composition too complex, cache catalog-only scope first and leave `all` uncached until measured.

### PDF caching

After authorization and export-model construction, derive:

```text
pdf/<kind>/<resourceId>/<resourceVersion>/<optionsHash>/<rendererVersion>.pdf
```

Where:

- `resourceVersion` is `updatedAt` or a stable content-version tuple;
- `optionsHash` includes paper, orientation, servings, measurement system, checked-item inclusion, and source inclusion;
- `rendererVersion` changes when HTML/CSS rendering changes.

Flow:

1. Authenticate and authorize every request, even on a cache hit.
2. Derive the versioned R2 key from authorized resource metadata.
3. Return cached bytes if present.
4. Otherwise render once, store in private R2, and return the bytes.
5. Use a short lock or single-flight Durable Object to prevent identical concurrent renders.
6. Apply lifecycle rules to delete old PDF versions.

Do not use a public R2 bucket or a guessable unauthenticated URL.

### Facet refresh

- Refresh catalog facets only after a completed import, not after a deliberately paused partial run.
- Write a new facet version and then atomically update `catalogVersion`.
- Continue serving the previous complete facet version during refresh.

### Tests

- no private or household fields enter shared cache values;
- catalog-version changes invalidate pages without manual deletion;
- identical authorized PDF requests render once;
- different servings or measurement systems produce different keys;
- revoked access blocks retrieval of previously cached private PDFs;
- failed render does not store a partial object;
- stale facet generation never replaces the last complete version.

### Acceptance criteria

- Repeated catalog/facet requests can avoid MongoDB without risking tenant leakage.
- Identical PDF requests reuse bytes after authorization.
- Cache hit ratio, render avoidance, bytes, and latency are observable.

## 12. Recommendation 9: Virtualize the infinite recipe grid

### Current limitation

The browser retains every loaded recipe in state and renders every card. Each new page rebuilds a set of all existing IDs and appends to a growing array. DOM nodes, React reconciliation, and memory continue growing as the user scrolls.

### Implementation approach

Adopt a virtualized grid library compatible with React 19, or build a small windowed grid if dependency policy requires it.

Requirements:

- render only visible rows plus a bounded overscan region;
- support responsive column counts;
- preserve stable card keys;
- measure or constrain card height so scroll offsets remain stable;
- keep the load-more sentinel tied to the virtual range rather than a permanent DOM element after all cards;
- maintain keyboard navigation and screen-reader usability;
- restore scroll position when returning from recipe detail;
- reset loaded data and scroll state when filters change.

### Data retention

Virtualization bounds DOM nodes but not the recipe array. Choose one of:

1. Retain loaded summaries in memory.
   - Simplest back-navigation behavior.
   - Acceptable if summary projection makes each item small and testing confirms memory budgets.

2. Retain a bounded page window.
   - Keep, for example, the nearest 20 pages.
   - Store cursor checkpoints for discarded pages.
   - Refetch when the user scrolls back beyond the retained window.

Start with full summary retention plus DOM virtualization. Add page eviction only if browser memory remains excessive at 5,000 or more summaries.

### Fetch-state improvements

- Consume `nextCursor`, not `recipes.length`, for continuation.
- Keep one active page request at a time.
- Ignore responses whose filter-generation ID is stale.
- Use a `Map` or persistent ID set updated incrementally rather than rebuilding a set over the full array for every page.
- Stop prefetching when the document is hidden or the user is on a constrained connection if browser APIs provide that signal.

### Accessibility

- Announce newly loaded result counts, not every virtualized card.
- Preserve logical result position with `aria-posinset` and `aria-setsize` when a total is known.
- Ensure tab focus is not destroyed while a focused card is still visible.
- Provide a manual “Load more” fallback if IntersectionObserver or virtualization measurement fails.

### Tests

- DOM node count remains approximately constant after 5,000 loaded recipes;
- responsive resize from one to multiple columns preserves position;
- back navigation restores the selected card vicinity;
- filter changes cancel stale requests and reset the virtual list;
- keyboard traversal and screen-reader announcements remain usable;
- no duplicate recipes across cursor pages.

### Acceptance criteria

- Rendering cost and DOM node count are bounded independently of loaded result count.
- Scrolling remains responsive with at least 5,000 loaded summaries on the agreed test devices.
- Pagination and accessibility behavior remain correct.

## 13. Recommendation 10: Avoid command-payload capture when DEBUG is disabled

### Current limitation

MongoDB command monitoring is always enabled. `commandStarted` recursively redacts and copies the complete command, stores it in a map, and only then calls `logger.debug`. The logger suppresses output at INFO, but the expensive traversal and retained payload have already occurred.

This is particularly costly for bulk imports, recipe writes, shopping-list replacements, and large `$in` queries.

### Logger capability

Extend the logger interface:

```ts
interface Logger {
  isEnabled(level: LogLevel): boolean;
  debug(...): void;
  info(...): void;
  error(...): void;
}
```

Use it before constructing debug context.

### Separate metrics from query logging

Command timing does not require retaining command payloads:

- `commandSucceeded` and `commandFailed` already provide duration and command name;
- pool events provide checkout timing;
- domain operation instrumentation supplies request correlation.

At INFO:

- record command name, database, collection if cheaply available, duration, and outcome;
- do not copy filters, pipelines, write documents, or bulk operations;
- do not retain complete commands in the `commands` map.

At DEBUG:

- allow sanitized command logging;
- truncate arrays and strings;
- replace inserted/replacement documents with counts and estimated byte sizes;
- sample routine commands;
- never log full recipe source text, ingredient arrays, auth records, or token-bearing values.

### Bounded debug representation

Implement a summary function with explicit budgets:

- maximum nesting depth;
- maximum keys per object;
- maximum array items;
- maximum string length;
- maximum serialized context bytes.

For bulk operations, log:

```json
{
  "operationCount": 500,
  "operationTypes": {
    "updateOne": 420,
    "replaceOne": 80
  },
  "estimatedBytes": 734000
}
```

Do not recursively redact all 500 operations.

### Command correlation

If started/succeeded correlation is needed:

- store only request ID, command name, collection, and start timestamp;
- impose a maximum map size;
- remove entries on success and failure;
- periodically discard stale entries and emit a leak diagnostic;
- never retain the original command object.

### Tests and benchmarks

- INFO logging does not call the payload sanitizer;
- a 1,000-operation bulk write produces bounded log context;
- sensitive fields remain redacted at DEBUG;
- command-correlation entries are removed on success and failure;
- logging overhead benchmark compares OFF/INFO/DEBUG for point reads and bulk writes;
- gateway behavior remains correct if logging itself throws.

### Acceptance criteria

- INFO-level command monitoring performs no recursive query or document copy.
- Debug log contexts have a strict byte bound.
- Bulk import throughput and gateway memory do not materially regress when INFO logging is enabled.

## 14. Delivery sequence

Implement the work in phases so measurements can attribute improvements.

### Phase A: Instrument and protect

1. Add load-test scenarios and baseline dashboards.
2. Correct admission control.
3. Propagate deadlines and add operation/result bounds.
4. Add pool telemetry.
5. Remove suppressed command-payload capture.

This phase reduces overload risk before changing query architecture.

### Phase B: Collapse the network boundary

1. Add `/v1/storage`.
2. Run domain stores inside the gateway.
3. Add the domain gateway client.
4. Add request-scoped session and storage services.
5. Migrate read-only operations, then mutations.

This phase should produce the largest general latency reduction.

### Phase C: Fix high-cardinality paths

1. Add recipe summary projections and `sortName`.
2. Backfill and create cursor indexes.
3. Deploy cursor browse and Atlas search continuation.
4. Batch shopping recipe reads.
5. Batch ingredient mapping and candidate lookup.

### Phase D: Decouple and bound mutations

1. Add plan/list content versions.
2. Add the shopping-refresh queue.
3. Enforce domain size limits.
4. Correct array lookup indexes or normalize collections if measurements require it.

### Phase E: Cache and optimize the browser

1. Cache catalog-only pages and facets.
2. Add private versioned PDF caching.
3. Virtualize the recipe grid.
4. Add page eviction only if browser memory measurements require it.

## 15. Verification strategy

### Unit tests

- cursor encoding, decoding, validation, and ordering;
- summary projection;
- batched recipe aggregation;
- authorized-context reuse;
- ingredient prefix bounds and batch mapping;
- admission counters and deadline calculation;
- domain size validation;
- cache key generation;
- bounded log summarization.

### Integration tests

- `/v1/storage` contract and error mapping;
- Better Auth continues through `/v1/mongodb`;
- domain transactions and retry behavior;
- shopping refresh queue idempotency;
- MongoDB explain plans for browse, item lookup, and candidate lookup;
- PDF authorization on cache hit;
- membership removal and household switching.

### Load tests

Run at minimum:

- steady recipe browse with catalog and all scopes;
- deep traversal through at least 100,000 recipes;
- mixed browse and Atlas text search;
- recipe detail traffic with favorite and plan context;
- concurrent plan updates across independent households;
- one large household with repeated serving changes;
- shopping generation at maximum supported plan size;
- ingredient review with 50 unique ingredients;
- public checklist reads and toggles;
- repeated identical and unique PDF requests;
- overload test beyond the gateway admission limit.

### Regression gates

A change should not ship if it:

- increases gateway calls per page beyond the documented target;
- introduces a collection scan for a common query;
- permits an unbounded interactive query or response;
- weakens authorization or tenant isolation;
- causes duplicate or missing cursor results;
- exposes private data through a shared cache;
- allows stale shopping refresh jobs to overwrite newer data.

## 16. Operational dashboards and alerts

Create dashboards for:

- application request latency and errors by route;
- storage domain latency and errors by operation;
- gateway admission, rejection, in-flight count, and response bytes;
- MongoDB pool size, checked-out connections, checkout wait, and timeouts;
- command duration and slow-command count without payloads;
- recipe search latency by browse/text/facet mode;
- shopping refresh queue age, retries, dead letters, and stale-list count;
- cache hit ratio for catalog, facets, and PDFs;
- PDF render latency and failures;
- browser performance measurements from synthetic tests.

Initial alerts should cover:

- sustained pool checkout wait;
- gateway-busy or deadline errors above the agreed rate;
- storage p95 budget breach;
- shopping-refresh oldest-message age;
- failed refresh count;
- Atlas Search error rate;
- PDF renderer failure rate;
- unexpected response-too-large errors.

## 17. Completion criteria

The optimization program is complete when:

- preview load tests use production-scale data and have repeatable reports;
- the application uses domain RPCs rather than the remote `Db` facade;
- authenticated pages resolve session and household once per request;
- recipe browsing is cursor-based, summary-projected, and complete beyond 100,000 rows;
- shopping generation uses batched recipe reads and refreshes asynchronously;
- ingredient candidates and automatic mapping use indexed, bounded batches;
- gateway admission, deadlines, result sizes, and pool behavior are enforceable and observable;
- domain sizes are explicit and tested;
- safe catalog/PDF caching is active without tenant leakage;
- the recipe grid has bounded DOM growth;
- INFO logging does not copy MongoDB command payloads;
- the agreed p95 latency and error budgets pass under realistic preview concurrency.
