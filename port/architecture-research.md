# Tableplan Kotlin API and React/Vite Port Research

Status: proposed architecture and migration plan  
Date: 2026-07-23  
Scope: replace the React Router/Cloudflare full-stack runtime with a Kotlin API backend and a React/Vite frontend while keeping MongoDB as the source of truth.

## Executive summary

The port is viable without a database export/import or a feature reset. The current application already has useful boundaries:

- MongoDB is the only database.
- Most persistence behavior is behind a 64-operation `StorageClient`.
- The application uses stable string/UUID identifiers.
- The public API is namespaced under `/api/v1` and already has an OpenAPI document.
- The UI is React and can retain most components, styles, and route structure.

The required target is one deployable JVM artifact:

```text
Browser
   |
   | same origin
   v
tableplan.jar
   +-- embedded HTTP server
   +-- React/Vite assets + SPA fallback
   +-- Kotlin API
   +-- application/domain services
   +-- Mongo repositories using ODM
   +-- auth/session handling
   +-- persistent background job runner
   +-- OpenAPI + MCP adapters
   +-- migration/import operator commands
   |
   +--> MongoDB / Atlas
   +--> S3-compatible object storage
   +--> email provider
   +--> OpenRouter
   +--> Chromium PDF service/runtime
```

The important decisions are:

1. Use one Kotlin backend that connects directly to MongoDB. The current application Worker, Mongo gateway Worker, gateway RPC protocol, and Mongo Durable Object are removed.
2. Select the HTTP framework through a focused bake-off. Spring MVC is the completeness/safety baseline; Micronaut is the leading performance-oriented challenger; Javalin is the minimal blocking challenger. Ktor, Quarkus, and http4k remain evaluated alternatives.
3. Extract the QMplus ODM into a small, versioned Gradle module. Do not make Tableplan depend on the entire `qmplus-shared-core` artifact or on an absolute filesystem path in production.
4. Keep the existing Mongo collection names, field names, BSON types, UUIDs, validators, and named indexes during the port.
5. Embed `frontend/dist` in the executable JAR. In development, Vite proxies `/api`, `/mcp`, and download paths to Kotlin; in production, the embedded server serves both the API and SPA.
6. Treat authentication as a distinct migration project. Better Auth and Cloudflare Durable Object sessions cannot simply move into Kotlin. Existing user IDs must remain stable, while all existing sessions can be intentionally invalidated at cutover.
7. Port by vertical feature slice with contract and data-parity tests. Do not rewrite every layer and switch everything at once.

The framework decision should not be based on a hello-world requests/second chart. Tableplan is dominated by Mongo queries, Atlas Search, authorization checks, JSON mapping, uploads, and external calls. The bake-off must measure those paths with the same application code and security behavior.

The highest risks are authentication compatibility, ODM extraction/hardening, preserving Mongo schema/index behavior, packaging frontend resources correctly, and replacing Cloudflare-specific background, object, email, document-conversion, and PDF services.

## Research basis

This document is based on direct inspection of:

- Current runtime and dependencies: [`package.json`](../package.json), [`README.md`](../README.md), [`vite.config.ts`](../vite.config.ts), [`wrangler.jsonc`](../wrangler.jsonc), and [`wrangler.gateway.jsonc`](../wrangler.gateway.jsonc).
- Routes and UI: [`app/routes.ts`](../app/routes.ts), route modules under [`app/routes`](../app/routes), and reusable UI under [`app/components`](../app/components).
- Persistence boundary and implementations: [`src/storage/contract.ts`](../src/storage/contract.ts), [`src/storage/application-client.ts`](../src/storage/application-client.ts), and [`src/storage/mongodb`](../src/storage/mongodb).
- Mongo runtime and schema: [`gateway/mongo.ts`](../gateway/mongo.ts), [`gateway/schema.ts`](../gateway/schema.ts), [`gateway/index-sync.ts`](../gateway/index-sync.ts), and [`gateway/migrate.ts`](../gateway/migrate.ts).
- Authentication: [`src/auth/runtime.ts`](../src/auth/runtime.ts), [`src/auth/server.ts`](../src/auth/server.ts), and [`workers/auth-session-store.ts`](../workers/auth-session-store.ts).
- Async and external services: [`workers/recipe-ingestion.ts`](../workers/recipe-ingestion.ts), [`src/ingestion`](../src/ingestion), [`src/email`](../src/email), and [`src/exports`](../src/exports).
- Current architecture decisions: [`docs/decisions/0001-mongodb-gateway-runtime.md`](../docs/decisions/0001-mongodb-gateway-runtime.md) and [`docs/migrations/mongodb-storage-migration-plan.md`](../docs/migrations/mongodb-storage-migration-plan.md).
- QMplus ODM source:
  `/Users/christkv/coding/project/qmplus/shared/kotlin/core/src/main/kotlin/com/qmplus/web/framework/odm`.
- Representative QMplus ODM models and transaction usage under:
  `/Users/christkv/coding/project/qmplus/shared/kotlin/core/src/main/kotlin` and
  `/Users/christkv/coding/project/qmplus/src/main/kotlin`.

Some older planning/progress documents still describe D1 and an earlier Cloudflare architecture. The current README, source code, Mongo migration documents, and Wrangler configuration are more authoritative for this port.

## Current application baseline

### Runtime topology

The current production design has two Cloudflare deployments:

```text
Browser / API client / MCP client
        |
Cloudflare application Worker
        |
private service binding + gateway token
        |
Mongo gateway Worker
        |
single named Durable Object ("pool-0")
        |
bounded MongoClient pool
        |
MongoDB Atlas
```

The application Worker contains:

- React Router v8 SSR and route loaders/actions.
- Authentication orchestration with Better Auth.
- Application/domain services.
- Mongo store composition through a remote `Db` façade.
- API, PDF, MCP, email, and ingestion entry points.

The gateway contains:

- A versioned generic Mongo operation protocol.
- Request authentication, body/deadline/concurrency limits, and logging.
- The singleton Mongo client/pool.
- Schema/index tooling.

This topology was designed to prevent unbounded Mongo pools in Cloudflare isolates. A conventional long-running Kotlin service already has a bounded process-level connection pool, so retaining the gateway would add latency and operational complexity without preserving its original benefit.

### Code and contract size

At the time of inspection:

- The TypeScript application has approximately 167 `.ts`/`.tsx` files and 9,667 lines across `app`, `src`, `gateway`, `workers`, and `scripts`.
- `StorageClient` exposes 64 operations.
- `app/routes.ts` defines the index, one layout, and 43 explicit routes.
- `gateway/schema.ts` manages 28 Mongo collections.
- There are 31 top-level TypeScript test files within the inspected depth, plus tests nested further in domain folders.

This is a medium port, not a greenfield rewrite. Preserving contracts and moving by feature slice will reduce risk substantially.

### Functional areas

The implemented system includes:

- Email/password, username, and optional Google authentication.
- User/household bootstrap, household switching, invitations, and roles.
- Recipe catalog search, Atlas Search, facets, detail, favorites, and saved searches.
- Private/household recipes and recipe ingestion/review/publishing.
- Quantity parsing, scaling, unit conversion, and shopping aggregation.
- Weekly meal plans and configurable meal slots.
- Shopping list generation, checked state, public shares, and email delivery.
- API keys, REST API, OpenAPI, MCP, and Agent Skill contracts.
- Recipe, plan, shopping, and combined PDF export.
- Streaming/resumable raw catalog import and facet refresh scripts.

### Current Cloudflare-specific dependencies

| Current capability | Cloudflare mechanism | Port implication |
| --- | --- | --- |
| React SSR | Workers + React Router framework mode | Replace with static Vite SPA |
| Mongo connectivity | service binding + gateway Worker + Durable Object | Replace with direct Kotlin Mongo client |
| Auth sessions | one Durable Object per key | Replace with Kotlin session storage |
| Ingestion orchestration | Agents + Workflows | Replace with persistent Kotlin worker jobs |
| Private artifacts | R2 binding | Use R2 through its S3 API or another S3-compatible store |
| Email jobs | Cloudflare Queue | Replace with selected queue or Mongo-leased jobs |
| Email sending | email binding | Replace with provider/SMTP adapter |
| Document-to-Markdown | Workers AI `toMarkdown` | Replace with JVM extraction and/or provider adapter |
| PDF rendering | Browser Rendering binding | Replace with Chromium/Playwright or a PDF service |
| Runtime observability | Workers observability/logs | Replace with structured logs, metrics, and traces |

## Target architecture

### Framework decision

Do not lock the port to Spring before measuring alternatives. Use Spring MVC as the feature-completeness baseline and compare it with Micronaut and Javalin using a real Tableplan vertical slice.

Provisional ranking:

1. **Micronaut** — leading alternative if lower startup/memory and compile-time framework work are worth explicit blocking-executor and session implementation.
2. **Spring MVC** — lowest delivery/security risk and the baseline that every alternative must beat in a meaningful way.
3. **Javalin** — best minimal/blocking fit and useful performance control, but highest security/infrastructure code ownership among the three finalists.
4. **Ktor** — excellent Kotlin API and first-class fat-JAR tooling, but more custom auth/session/CSRF code and mandatory blocking isolation around the ODM.
5. **Quarkus** — strong build-time optimization, security, health, and metrics, but its reactive core and build-time model add complexity for this synchronous reflection-heavy ODM.
6. **http4k** — small, functional, testable, and blocking-friendly, but leaves the largest portion of the application platform to composition choices.

The recommendation is a three-implementation spike, not six production prototypes:

- Build the same read-only recipe/authenticated-session vertical slice in Spring MVC, Micronaut, and Javalin.
- Keep Ktor and Quarkus as paper-evaluated fallbacks unless the team already has strong production experience with one.
- Select only after measuring the representative workload and estimating security/operations implementation effort.

### Non-negotiable framework fit

The selected framework must:

- Build one executable/fat/uber JAR runnable with `java -jar tableplan.jar`.
- Serve classpath Vite assets and an SPA fallback from that JAR.
- Run the synchronous Mongo driver without blocking an event loop.
- Support bounded request concurrency and graceful shutdown.
- Support cookie sessions backed by Mongo, Google authorization-code login, first-party username/password login, API keys, and public token principals.
- Support CSRF protection for cookie-authenticated JSON/form mutations.
- Support multipart streaming and request size limits.
- Support OpenAPI 3.1 generation or faithful serving of the checked-in contract.
- Support health, metrics, request IDs, structured logging, and tracing.
- Start a persistent Mongo-leased job runner in the same JVM.
- Allow operator modes such as `migrate`, `import`, `sync-indexes`, and `serve`.
- Work well with Kotlin/Jackson and the extracted reflection-based ODM.

### Framework comparison

| Framework | Single JAR + SPA | Sync ODM execution fit | Security/OAuth/session | OpenAPI/ops | Runtime profile | Tableplan assessment |
| --- | --- | --- | --- | --- | --- | --- |
| Spring MVC | `bootJar`; classpath static resources are built in | Natural thread-per-request blocking model; virtual threads are an option | Most complete integrated security/CSRF/OAuth ecosystem; Mongo session support exists | Strong validation, error handling, Actuator/Micrometer, Mongo metrics | Heaviest baseline in startup, memory, and dependency surface | Safest delivery baseline; may already be fast enough because requests are Mongo-bound |
| Micronaut | Shadow executable JAR; classpath static resource mappings | Netty event loop requires `@ExecuteOn`/blocking executor discipline for ODM calls | Full security and OAuth2 modules; session security exists, but Tableplan still needs a proven Mongo session store | Compile-time OpenAPI, management, Micrometer, validation | Compile-time DI/AOP is designed to reduce runtime reflection/scanning | Strongest balanced challenger; likely best first alternative to spike |
| Javalin | Standard shaded JAR; embedded Jetty; explicit SPA/static support | Excellent match: blocking handlers on platform or virtual threads | Route roles and hooks exist, but login, Google OAuth, CSRF, session persistence, and hardening are mostly application-owned/integrated libraries | Compile-time OpenAPI module and Micrometer module exist; health/DI/config are composed | Very small framework layer and direct control | Performance-first challenger; choose only if the team accepts security-platform ownership |
| Ktor | First-class `buildFatJar`; classpath static fallback | Netty/coroutine server requires every synchronous ODM path to use a bounded blocking dispatcher | Auth, OAuth, sessions are provided as plugins; persistent session storage and CSRF policy need application work | OpenAPI serving, Micrometer, StatusPages, testing plugins | Lightweight and Kotlin-native, but blocking bridges add complexity | Good choice for a coroutine-native persistence stack; less compelling with this ODM |
| Quarkus | Explicit `uber-jar`; `META-INF/resources` static serving | REST endpoints must be correctly classified/annotated as blocking | Broad Quarkus Security/OIDC/CSRF feature set; first-party Mongo identity/session flow remains custom | Excellent SmallRye OpenAPI/Health, Micrometer, Mongo pool metrics | Strong build-time augmentation and JVM/native startup focus | Capable, but more conceptual friction with the chosen ODM than Micronaut/Spring |
| http4k | Standard shaded JAR with selectable server | Natural synchronous functional handlers | OAuth/security lenses exist; full session/CSRF/account platform is composed by the application | Strong contract/OpenAPI and observability modules | Minimal/reflection-light core | Architecturally elegant, but too much platform assembly for the first port unless the team already uses it |

“Runtime profile” is a framework-design assessment, not a measured result for Tableplan. No selection claim should use that column without the bake-off.

### Spring MVC baseline

Strengths:

- It aligns directly with the blocking Mongo driver.
- Spring Security supplies the most mature integrated route for cookies, OAuth2 login, authorization, CSRF, password encoders, and security headers.
- Spring Boot serves classpath static content and creates an executable JAR.
- Actuator/Micrometer provides HTTP/JVM health and metrics, including Mongo command and pool metrics when the client is configured through the framework.
- Existing QMplus developers and ODM usage are likely to be familiar with the Spring model.

Costs:

- Largest framework/dependency surface.
- Typically slower cold startup and higher idle memory than compile-time/minimal frameworks.
- Auto-configuration can obscure ownership unless module boundaries and explicit configuration are enforced.
- Pulling Spring Data Mongo solely for session support may introduce a second Mongo mapping stack beside the ODM.

Spring is the baseline because it minimizes functional and security uncertainty, not because it is assumed to win throughput.

### Micronaut challenger

Strengths:

- Compile-time dependency injection, AOP, and OpenAPI generation reduce runtime classpath scanning/reflection performed by the framework.
- It produces an executable shaded JAR and serves classpath resources.
- Security supports OAuth2/OpenID flows and session-based authorization.
- Management and Micrometer modules cover health and operational metrics.
- Kotlin is a first-class application language.

Costs:

- The default Netty runtime is event-loop based. Every synchronous ODM/repository entry point must be placed on a bounded blocking executor (or a deliberately configured virtual-thread executor).
- A Mongo-backed opaque session implementation must be proven; do not assume the default session feature provides the desired distributed Mongo store.
- Micronaut itself is compile-time oriented while the selected ODM is reflection-heavy. That is compatible on the JVM, but it reduces the benefit of native-image/AOT and needs explicit reflection testing.
- Security APIs include reactive types in places even when application persistence is synchronous.

Micronaut is the provisional performance-oriented favorite because it retains an integrated application framework without requiring Tableplan to own the entire web/security platform.

### Javalin challenger

Strengths:

- Embedded Jetty uses a straightforward request-thread model that naturally supports the synchronous ODM.
- Virtual-thread request execution can be enabled on supported JVMs.
- SPA/classpath resources, uploads, testing, OpenAPI, and Micrometer support are available.
- The framework adds little indirection and creates a normal shaded JAR.
- Route registration and lifecycle behavior are explicit.

Costs:

- Javalin intentionally leaves authentication policy to application filters/handlers.
- Robust Google OAuth, Mongo-backed opaque sessions, session fixation prevention, CSRF, password reset, account linking, and security event handling require more owned code or additional libraries.
- Dependency injection, configuration validation, health conventions, scheduled work, and transaction boundaries must be composed.
- The apparent performance advantage can disappear if the custom platform layer is poorly designed.

Javalin should be included in the spike because it is the cleanest match to the blocking ODM and establishes how much overhead the integrated frameworks actually add.

### Ktor assessment

Ktor officially supports fat JARs, static resource fallbacks, OAuth, session authentication, OpenAPI serving, and Micrometer. Its Kotlin DSL and test engine are attractive.

The concern is execution model, not capability. Ktor handlers are coroutine-based while this ODM performs synchronous driver calls. Repository access must always use a bounded `Dispatchers.IO`-style dispatcher. Authentication/session validation that touches Mongo needs the same treatment. Missing one bridge can stall event-loop threads under load.

Ktor moves more security/session policy into Tableplan than Spring or Micronaut. It becomes a stronger candidate if the ODM is later replaced by the coroutine Mongo driver.

### Quarkus assessment

Quarkus supports JVM uber-JARs, Kotlin, static resources, OIDC/form security, CSRF, OpenAPI, health, Micrometer, and Mongo pool metrics. It also has a clear build-time optimization story.

The main mismatch is the same as Ktor: Quarkus REST is built on a reactive runtime, so the synchronous ODM must never run on an event loop. Reflection-heavy ODM mapping also works against native-image goals. A JVM uber-JAR is still viable, but the port would accept Quarkus complexity without using its most distinctive native/reactive advantages.

### http4k assessment

http4k is a strong technical option for a team that prefers functional composition:

- HTTP handlers are pure function-shaped and naturally blocking.
- It has contract/OpenAPI, OAuth/security, Micrometer, and OpenTelemetry modules.
- It can use embedded Jetty/Undertow/Netty and package as a normal shaded JAR.

For this application, however, “same results as Spring” would require selecting and integrating more independent pieces for sessions, CSRF, DI/config, lifecycle, jobs, and management endpoints. It is not a first-spike candidate unless the team already has http4k production conventions.

### Performance bake-off

Use one shared `domain`, `application`, `persistence-mongo`, and `odm` implementation. Only the HTTP/security/bootstrap adapter should vary.

Required endpoints:

1. `GET /benchmark/json` — serialization/framework floor.
2. `GET /api/v1/recipes/{id}` — membership/access check plus one recipe read.
3. `GET /api/v1/recipes/search` — Atlas Search, filters, mapping, and pagination.
4. `POST /api/v1/meal-plans` — cookie session, CSRF, validation, membership, and Mongo write.
5. `POST /api/v1/recipe-ingestions` — authenticated multipart streaming to a no-op/test artifact store.
6. `GET /recipes` and one hashed asset — embedded SPA serving.
7. One background lease/complete cycle while HTTP load is active.

Run every candidate with:

- The same JDK, JVM flags, container CPU/memory limits, Mongo deployment, pool settings, dataset, JSON mapper, logging level, and TLS/proxy topology.
- Warm and cold runs.
- Authentication and authorization enabled where production requires them.
- Identical response bodies and cache headers.
- At least one saturation run beyond the Mongo pool size.

Measure:

- Cold time to readiness and first successful request.
- Executable JAR size.
- Idle RSS/heap and loaded class count.
- Throughput and p50/p95/p99 latency.
- CPU per request and allocation/GC rate.
- Mongo pool wait/checked-out metrics.
- Error rate and timeout behavior under saturation.
- Static asset throughput/cache correctness.
- Graceful shutdown with in-flight requests and leased jobs.
- Build time and incremental developer restart time.
- Lines/configuration required for auth, sessions, CSRF, errors, health, and observability.

Selection rule:

- A framework must pass all functional/security gates before performance is compared.
- Prefer the simplest complete option if p95 application latency and resource cost are materially equivalent.
- Select Micronaut over Spring only if it shows a useful measured resource/startup or tail-latency benefit without increasing security/operational risk.
- Select Javalin only if its measured benefit justifies owning the additional platform/security code.
- Do not optimize on `/benchmark/json`; it exists only to explain framework overhead.

Do not use WebFlux or another reactive API layer with this ODM. It adds a reactive abstraction without removing the blocking Mongo call.

### Recommended repository layout

```text
meal-planner/
  backend/
    settings.gradle.kts
    build.gradle.kts
    app/
      src/main/kotlin/.../Application.kt
      src/main/resources/
    domain/
      pure Kotlin domain rules
    application/
      use cases and ports
    persistence-mongo/
      ODM models, repositories, schema migrations
    odm/
      extracted and hardened QMplus ODM
    worker/
      ingestion and email job handlers
    api/
      controllers, auth, OpenAPI, problem responses
    test-support/
      Mongo fixtures and contract fixtures
  frontend/
    package.json
    vite.config.ts
    src/
      app/
      routes/
      components/
      api/
      domain/
  contracts/
    openapi.yaml
    fixtures/
      quantity/
      recipes/
      plans/
      shopping/
  scripts/
    import/
    migration/
  compose.yaml
  port/
    architecture-research.md
```

The backend may be a Gradle multi-project build or a single module with strict packages at first. The boundaries matter more than the number of Gradle modules. `odm` should be an actual module from day one because it has separate ownership, tests, and upstream provenance.

### Single uber-JAR build and runtime

The frontend remains a Node/Vite project at build time, but Node is not part of the deployed runtime.

Build graph:

```text
frontend npmCi
       |
frontend npmBuild
       |
copy frontend/dist -> backend app classpath /static
       |
compile Kotlin modules
       |
framework packaging task
       |
build/libs/tableplan.jar
```

Framework packaging equivalents:

| Framework | Packaging task/configuration |
| --- | --- |
| Spring Boot | `bootJar` |
| Micronaut | Shadow `shadowJar`/optimized all-JAR task |
| Javalin | Gradle Shadow `shadowJar` |
| Ktor | `buildFatJar` |
| Quarkus | `quarkusBuild` with JAR type `uber-jar` |
| http4k | Gradle Shadow `shadowJar` |

Artifact rule:

```text
java -jar tableplan.jar
```

must be sufficient to start:

- The embedded HTTP server.
- API/auth/public/MCP endpoints.
- Static hashed Vite assets.
- SPA `index.html` fallback for non-file, non-API browser routes.
- The Mongo-leased email and ingestion job pollers.
- Health/metrics endpoints.

The same artifact should support explicit operator modes:

```text
java -jar tableplan.jar serve
java -jar tableplan.jar migrate --dry-run
java -jar tableplan.jar migrate
java -jar tableplan.jar sync-indexes --dry-run
java -jar tableplan.jar import-catalog ...
java -jar tableplan.jar refresh-recipe-facets
```

Only `serve` starts HTTP and job pollers. Migration/import modes must exit with a meaningful status and must not start the web server.

This is one artifact and one deployment unit, not necessarily one process-wide responsibility with no controls. In a multi-replica deployment every replica may safely poll jobs only if leases are atomic. Alternatively, `JOBS_ENABLED=false` can disable pollers on selected replicas while retaining the same JAR.

The Vite build output should be reproducible and included in the JAR checksum. CI must fail if frontend tests/build, Kotlin tests, or the final JAR smoke test fails.

Chromium is the notable packaging exception: Java integration code and PDF templates can be inside the JAR, but a compatible browser binary still has to exist in the runtime image or be reached as an external service. Do not silently download it at application startup.

### Backend layering

```text
HTTP / MCP / worker adapters
            |
            v
Application services
            |
            v
Domain rules and repository ports
            |
            v
Mongo repositories + ODM/native driver
```

Rules:

- Controllers parse/validate transport input and map errors; they do not build Mongo queries.
- Application services own authorization-sensitive workflows and transaction boundaries.
- Domain code owns quantity, date, planning, visibility, and normalization rules.
- Repositories own Mongo query shape and BSON mapping.
- ODM models never double as public API DTOs.
- Worker handlers invoke the same application services as HTTP controllers.

### Frontend runtime

Use React with Vite in SPA mode:

- Keep React Router in library/data-router mode for the current URLs.
- Keep the existing Tailwind CSS, Base UI/shadcn-style components, Lucide icons, and most JSX.
- Replace server-only route loaders/actions with API calls.
- Generate TypeScript types/client functions from the canonical OpenAPI contract.
- Keep UI-only helpers in TypeScript. Put business-critical calculations in Kotlin and verify any duplicated display behavior with shared JSON fixtures.

Development routing:

```text
Vite :5173
  /api/*  -> http://127.0.0.1:8080
  /mcp    -> http://127.0.0.1:8080
  /*      -> Vite SPA
```

Production should remain same-origin:

```text
https://tableplan.example/
  /api/*  -> embedded Kotlin routes
  /mcp    -> embedded Kotlin route
  /*      -> classpath Vite assets / SPA fallback
```

The executable JAR is the origin server behind the platform load balancer/TLS terminator. Same-origin deployment avoids unnecessary CORS, keeps secure cookie behavior simple, and preserves OAuth callback and public-share URL construction.

## QMplus ODM assessment

### What the ODM provides

The inspected ODM is an active-record/reflection layer over the synchronous Mongo Java driver.

Core model conventions:

- `@MongoDocument("collection")` selects the collection.
- A model subclasses `BaseModel(database: MongoDatabase)`.
- Persisted mutable properties use `@Field`.
- `_id` is inherited as `Any?`.
- Embedded objects implement `Embedded` and also use mutable `@Field` properties.
- `@MongoPolyMorphic` supports discriminator-based embedded interfaces.
- Annotation families define single, compound, text, TTL, wildcard, and geo indexes.
- Optional `@APMIntegration(APMProvider.SENTRY)` creates spans.

Core operations include:

- Insert, replace, delete, partial update, and raw update.
- `findOne`, `findAll`, cursor/iterable queries, count, aggregation.
- Bulk-style update/delete helpers.
- Optional `ClientSession` on some instance methods.
- Reflection mapping between BSON `Document` and mutable Kotlin objects.
- UTC conversion between BSON `Date` and JVM date/time values.
- Index create/diff utilities.

The code is proven in a large application and is capable of expressing Tableplan's embedded recipe, plan, and shopping documents.

### Why the existing artifact should not be consumed directly

The source directory is not a self-contained library:

- `BaseModel.kt` and `utilities.kt` import `com.qmplus.shared.common.createObjectMapper`.
- `index.kt` imports the QMplus tenant `Feature` enum.
- APM classes import Sentry directly.
- The `qmplus-shared-core` Gradle module contains many unrelated dependencies: Spring Web, Azure SDKs, Stripe, mail, document processing, AI utilities, and more.
- The module currently pins an older Kotlin/Mongo/Jackson/Spring generation than a new service should inherit automatically.
- The package has no independent release/version boundary visible from Tableplan.
- An absolute dependency on `/Users/christkv/...` would fail in CI, containers, and other developer machines.

Recommended integration:

1. Extract the ODM files into `backend/odm`.
2. Record the QMplus repository commit and source path in a `NOTICE` or provenance file.
3. Replace the QMplus object-mapper dependency with an ODM-local mapper abstraction.
4. Replace the `Feature` dependency with a generic feature-key predicate or remove KNN feature gating if unused.
5. Make Sentry support an optional adapter rather than a compile-time core dependency.
6. Publish the extracted module to the local Gradle build immediately; optionally publish it to the organization's Maven repository later.
7. Keep a small upstream-diff process so fixes can be proposed back to QMplus.

If policy requires using the original module rather than copying it, first split `qmplus-odm` out of `qmplus-shared-core` upstream and publish that narrow artifact. A Gradle composite build pointing at the absolute source path is acceptable only for the extraction spike.

### ODM behaviors that affect Tableplan

| Behavior | Consequence | Required treatment |
| --- | --- | --- |
| Synchronous Mongo driver | Repository calls block request threads | Use a blocking request model or a rigorously bounded blocking executor |
| `insert()` creates `ObjectId()` when `_id` is null | Current collections require string `_id` values | Every aggregate factory must assign a UUID before insert; add a guard/test |
| Models use mutable nullable `var` properties | Immutable Kotlin data classes are not a direct fit | Keep persistence models separate from domain/API types |
| Mapping requires a database constructor or usable empty/minimal constructor | Some idiomatic constructors will fail reflection mapping | Standardize one `MongoDatabase` constructor and no required non-null constructor args |
| `buildDocument` omits null values | A null field is not written on insert | Decide per field whether absence and BSON null are equivalent |
| Partial `update()` omits null values | It cannot clear a field | Use raw `$unset`/`$set` repositories for clearable fields |
| `@Field(name = "...")` is honored when reading but writes use the Kotlin property name | Renamed persisted fields can become asymmetric | Avoid renamed fields until fixed; add a round-trip test and patch the extractor |
| `_id` is `Any?` | Type mistakes compile | Add typed ID accessors/factories and schema integration tests |
| Date conversion treats `LocalDateTime` as UTC | Accidental local-time values can shift meaning | Use `Instant`/BSON Date for timestamps and ISO `YYYY-MM-DD` strings for plan dates |
| Queries and pipelines use raw `Document` | Flexible but typo-prone | Centralize field constants/builders in repositories |
| Some companion operations do not accept `ClientSession` | ODM helpers cannot cover every transaction | Use native driver collections inside transactional repositories |
| APM descriptions/logging contain raw query JSON | Tokens, hashes, emails, or private recipe content could leak | Add central redaction and do not attach raw queries by default |
| `findOne` returns early on no result before finishing its APM span | Spans may remain unfinished | Patch and test before production use |
| Index helpers exist but schema validation does not | Current `$jsonSchema` validators would be lost | Keep explicit schema migration code |
| The migration engine file is commented out | There is no usable ordered migration framework | Implement a Tableplan schema migrator |
| Reflection caches are mutable maps | Thread-safety is not explicit | Replace with concurrent maps or initialize models at startup |

### Recommended ODM qualification spike

Before porting application repositories, build a focused test suite against a real replica-set Mongo container.

Required tests:

1. String UUID insert/read/update/delete.
2. `@Field(name)` round trip.
3. BSON null versus missing field.
4. Clearing a nullable field with `$unset`.
5. `Instant`, `Date`, `LocalDateTime`, and ISO date-only behavior.
6. Empty and non-empty embedded lists/maps.
7. Embedded recipe ingredients, steps, plan items, and shopping items.
8. Projection behavior when non-projected fields map to null.
9. Numeric conversions for `Int`, `Long`, `Double`, and `Decimal128`.
10. Unique, sparse, TTL, compound, and multikey indexes.
11. Duplicate-key error mapping.
12. Transactions with `ClientSession`.
13. Concurrent plan creation and ingestion publication.
14. Query/APM redaction.
15. Concurrent reflection-cache access.

Exit gate: no Tableplan feature repository is implemented until this suite passes and the ODM is a portable Gradle dependency.

## MongoDB compatibility plan

### Preserve the existing physical schema

The first Kotlin release should use the existing databases:

- Local: `application_local`
- Preview: `application_preview`
- Production: `application`

Do not rename collections or normalize embedded documents during the runtime port. That would combine an application rewrite with a data migration and make parity harder to prove.

The 28 managed collections are:

| Area | Collections |
| --- | --- |
| Auth | `users`, `accounts`, `verifications`, `auth_error_events` |
| Households/preferences | `households`, `household_memberships`, `user_profiles`, `household_invitations` |
| Recipes/catalog | `recipes`, `ingredients`, `ingredient_aliases`, `units`, `tags`, `favourites`, `saved_recipe_searches`, `collections`, `collection_recipes` |
| Planning/shopping | `meal_plans`, `shopping_lists`, `shopping_list_shares` |
| API/integration | `api_keys`, `api_key_events`, `email_deliveries`, `idempotency_keys` |
| Ingestion/import | `recipe_ingestions`, `recipe_mutation_events`, `import_runs`, `import_issues` |

The Kotlin migration system must reproduce:

- All named indexes and their order/direction.
- Unique and sparse behavior.
- TTL indexes.
- Collection `$jsonSchema` validators.
- Atlas Search index `recipes_v1`.
- Validation level/action.

### ID policy

Current application documents use string UUIDs, and relationships store those same strings. Preserve that policy.

Recommended model pattern:

```kotlin
@MongoDocument("meal_plans")
class MealPlanDocument(database: MongoDatabase) : BaseModel(database) {
    @Field var householdId: String? = null
    @Field var startsOn: String? = null
    @Field var endsOn: String? = null
    @Field var items: List<MealPlanItemDocument>? = null

    companion object {
        fun new(database: MongoDatabase): MealPlanDocument =
            MealPlanDocument(database).apply {
                _id = UUID.randomUUID().toString()
                items = emptyList()
            }
    }
}
```

Repositories should reject non-string IDs for Tableplan collections. Do not let ODM-generated ObjectIds enter new documents.

### Date/time policy

Preserve current BSON semantics:

- Timestamps such as `createdAt`, `updatedAt`, `expiresAt`, and `sentAt`: BSON Date, represented as `Instant` at domain/API boundaries.
- Meal-plan dates such as `startsOn`, `endsOn`, and `plannedDate`: ISO date strings.
- Household timezone: IANA timezone string.
- JSON timestamps: ISO-8601 UTC strings.
- JSON date-only values: `YYYY-MM-DD`.

Do not map `startsOn` or `plannedDate` to BSON Date during the port.

### Repository approach

Use the ODM where it is strongest:

- Model-to-document mapping.
- Straightforward reads and inserts.
- Embedded document mapping.
- Collection naming.
- Simple index metadata.

Use the native Mongo driver within repository implementations for:

- Aggregation pipelines and Atlas Search.
- Array filters and positional embedded updates.
- Bulk import/upsert.
- Compare-and-set claims and leases.
- Transactions.
- Schema validators, `collMod`, and search-index administration.

This hybrid approach still uses the selected ODM while avoiding artificial wrappers around operations it does not model well.

### Transaction opportunities

The current gateway intentionally strips sessions and runs multi-document workflows sequentially. A direct Kotlin backend can improve consistency with real Mongo transactions.

Initial transaction candidates:

- First-user household bootstrap.
- Household invitation acceptance plus membership/default-household update.
- Private recipe publication, remembered aliases, mutation event, and ingestion completion.
- Email share plus delivery creation.
- API-key creation plus audit event.

Transactions require a replica set locally and in every deployed environment. Keep idempotency keys and unique indexes even when a transaction is added.

## API design and compatibility

### Contract ownership

Make OpenAPI the checked-in contract under `contracts/openapi.yaml`.

The contract should drive:

- Kotlin request/response conformance tests.
- Generated TypeScript frontend types/client.
- API client documentation.
- MCP adapter input/output types where practical.

Keep existing public paths and semantics unless there is a documented incompatibility:

- `/api/v1/*` for authenticated/API-key operations.
- `/api/public/*` for public share/invitation exchange.
- `/mcp` for Streamable HTTP MCP.
- `/api/v1/openapi.json`.

The current [`src/api/openapi.ts`](../src/api/openapi.ts) is a useful starting inventory but is description-heavy and schema-light. The port contract should define reusable component schemas and standardized error responses.

### Error envelope

Use one machine-readable error shape:

```json
{
  "code": "plan_item_not_found",
  "message": "The meal-plan item was not found.",
  "requestId": "uuid",
  "fieldErrors": {
    "servings": "Must be between 0.25 and 100."
  }
}
```

Map:

- Validation failures to `400`.
- Unauthenticated to `401`.
- Unauthorized household/scope access to `403` or privacy-preserving `404` as explicitly chosen.
- Missing resources to `404`.
- Unique/idempotency conflicts to `409`.
- Rate limits to `429`.
- Dependency unavailability to `502`/`503`.

Do not expose Mongo exception messages, queries, collection names, tokens, or hashes.

### Authorization model

Resolve one request principal containing:

```text
userId
activeHouseholdId
authentication kind: session | api-key | public-share | invitation-token
API scopes, when applicable
```

Household membership and role checks belong in application services/repository guards, not only in controllers. Every household-scoped Mongo filter should include `householdId`; every owned recipe mutation should include both owner and household criteria.

Retain current API scopes and one-time raw-key display. Preserve API key prefixes and hashes so existing API keys can continue to work if their hashing format is reproduced exactly.

### Route migration inventory

Frontend page routes to preserve:

- `/sign-in`
- `/auth/error`
- `/household/join`
- `/shared/shopping`
- `/shared/shopping/:shareId`
- `/recipes`
- `/recipes/new`
- `/recipes/import/:ingestionId`
- `/recipes/:recipeId/edit`
- `/recipes/:recipeId`
- `/favorites`
- `/plan`
- `/shopping`
- `/settings`

The React Router loaders/actions for these routes currently call storage and authentication directly. In the SPA they should call the corresponding HTTP contract. Presentational JSX and CSS can move largely unchanged after server imports are removed.

## Authentication migration

### Current behavior

The current application uses Better Auth with:

- Mongo-backed users, accounts, and verification records.
- Email/password sign-up and sign-in.
- Username plugin.
- Optional Google OAuth.
- UUID generation.
- No database sessions.
- Durable Object secondary storage for sessions.
- Same-origin `/api/auth/*` endpoints.

Therefore:

- User/account identity data exists in Mongo.
- Active session data exists outside Mongo in Cloudflare Durable Objects.
- A Kotlin backend cannot execute the Better Auth runtime directly.

### Recommended target

Use a framework adapter around one Tableplan-owned authentication model:

- Server-side opaque session cookies.
- A Mongo-backed session collection with TTL, managed separately from application ODM models.
- Authorization-code OAuth support for Google.
- CSRF protection for cookie-authenticated mutations.
- Secure, HTTP-only, SameSite cookies.
- Explicit username/email login endpoint.
- Password hashing configured to the selected migration strategy.

API keys and public share tokens remain independent authentication mechanisms.

The implementation differs by framework:

| Candidate | Authentication implementation |
| --- | --- |
| Spring MVC | Spring Security for login/OAuth/CSRF and Spring Session Mongo or a narrow custom session repository |
| Micronaut | Micronaut Security/OAuth2 plus a tested custom Mongo-backed session store |
| Javalin | Tableplan-owned filters/handlers and session repository; the spike must account for all OAuth, CSRF, fixation, logout, and header hardening code |

Do not select a candidate merely because its login demo is short. The spike must prove session rotation, logout invalidation, CSRF rejection, OAuth state/nonce handling, cookie attributes, account linking rules, and authorization failures.

### Identity migration rules

1. Preserve `users._id` exactly. Household memberships, profiles, recipes, API keys, and audit records reference it.
2. Preserve normalized email uniqueness.
3. Preserve provider/account IDs where they can be mapped to the new Google login implementation.
4. Inspect real `accounts` documents and Better Auth's configured password hash format before deciding whether password verification is compatible.
5. If hashes cannot be safely verified in Kotlin, require a password reset or use a short-lived, isolated verification bridge. Do not attempt to transform hashes without a proven algorithm.
6. Intentionally invalidate all Durable Object sessions at cutover and require sign-in again.
7. Add a new Mongo session collection and TTL index; do not reuse `verifications`.
8. Preserve the existing username uniqueness and length rules.
9. Decide whether open self-sign-up remains enabled before implementing the new endpoints.

### Auth compatibility façade

The frontend does not need to preserve Better Auth's internal response format. It can move to a small Tableplan-owned API:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
GET  /api/auth/oauth/google
GET  /api/auth/oauth/google/callback
POST /api/auth/password/reset/request
POST /api/auth/password/reset/confirm
```

Keeping these under `/api/auth` preserves proxy and cookie routing while allowing a clean frontend client.

## Frontend port strategy

### What can be reused

- `app/app.css`.
- UI components under `app/components`.
- Most page JSX.
- React Router paths and navigation.
- Lucide icons, Base UI/shadcn-style controls, Tailwind configuration.
- Browser-side selection/date helpers.
- Sign-in and public-share visual flows.

### What must change

- Remove React Router framework/server build and Cloudflare Vite plugin.
- Remove `cloudflareContext`.
- Remove route imports of `src/auth/server`, `src/storage`, email, PDF, and ingestion server modules.
- Replace server loaders/actions with generated API client calls.
- Replace Better Auth's React client.
- Add an SPA fallback for direct navigation.
- Decide cache/revalidation behavior for recipes, plan, shopping, and settings.
- Add upload progress and ingestion-status polling.

### Suggested frontend data approach

React Router data loaders/actions can remain the page-level orchestration mechanism, but they now call the Kotlin API through the generated client. Add a query cache only where it materially helps, especially recipe infinite scrolling and ingestion polling.

Avoid hand-maintained duplicate DTO interfaces. Generate them from OpenAPI and keep view-specific types local.

### SSR consequences

Moving to Vite SPA mode means:

- Initial authenticated pages are client-rendered.
- Search engines will not receive recipe page HTML unless prerendering is added.
- Auth redirects happen after the session request unless protected-route bootstrapping is implemented.
- The deployment needs `index.html` fallback for non-API routes.

For a private household application, these are acceptable. Public shopping shares also work as SPA routes. If public recipe SEO becomes a product requirement, add a separate prerender/SSR decision later rather than keeping the current server runtime accidentally.

## Domain logic port

The TypeScript domain modules are valuable specifications. Port behavior, not syntax.

High-priority pure logic:

- Quantity parsing, fractions/ranges, units, aggregation, conversion, and formatting.
- Recipe-search normalization.
- Recipe draft normalization and deterministic text extraction.
- Meal-plan week/date and slot rules.
- Shopping aggregation and checked-item retention.
- Saved-search validation.
- Token lifetime and input normalization rules.

Use shared JSON golden fixtures:

```text
input JSON
expected normalized/domain output JSON
```

Run those fixtures in both Vitest and Kotlin tests during the port. Once Kotlin is authoritative, retain frontend tests only for duplicated browser display helpers.

Do not return raw ODM models from controllers. Define Kotlin domain/API DTOs with non-nullability that reflects the external contract.

## Background work and external services

### Recipe ingestion

Replace Cloudflare Agents/Workflows with a persistent job model:

```text
HTTP upload/create
   |
write source artifact + recipe_ingestion + job
   |
worker atomically leases job
   |
extract -> map -> save review draft
   |
frontend polls or receives status
```

Recommended first implementation:

- A `jobs` collection with job type, payload reference, status, attempts, available-at, lease owner/expiry, idempotency key, last error, and timestamps.
- Atomic `findOneAndUpdate` leasing.
- A separate `backend:worker` process using the same application modules.
- Bounded concurrency and retry backoff.
- A terminal failed/dead-letter state and admin visibility.

This avoids selecting a new queue product before deployment infrastructure is known. If a managed queue is already standard in the destination environment, implement the same `JobPublisher`/`JobHandler` ports over it instead.

### Object storage

Keep R2 if desired, but access it through its S3-compatible API from Kotlin. This preserves existing object keys:

```text
households/{householdId}/users/{userId}/recipe-ingestions/{ingestionId}/source
```

The backend should use an `ArtifactStore` interface and never expose bucket credentials or internal object keys to the browser.

### Text/document extraction

Use adapters by media type:

- Plain text/Markdown: UTF-8 decode.
- PDF: text extraction library for text PDFs; vision path for scans.
- DOCX/ODT: JVM document extraction.
- Images: send bytes to the configured vision model.

Keep OpenRouter behind a `RecipeExtractor` port. Validate its structured response against the same recipe-draft schema before persistence.

### Email

Retain the existing claim/update/idempotency state machine. Replace the Cloudflare email binding with an `EmailSender` adapter for the selected provider or SMTP.

Queue messages must never be the only copy of a raw share token. If retry requires the token, store an encrypted short-lived delivery secret or design the job payload store accordingly. Never log the token.

### PDF generation

The current export HTML uses modern CSS including grid, columns, and print rules. A simple JVM HTML-to-PDF renderer may not produce equivalent output.

Recommended order:

1. Use a pinned Chromium renderer through Playwright for Java or a dedicated service such as a containerized browser/PDF service.
2. Reuse the export view models and HTML/CSS after porting them to Kotlin templates.
3. Run visual regression checks for A4/Letter and portrait/landscape.
4. Preserve no-store headers and safe filenames.

### MCP and Agent Skills

Keep the existing MCP tool contract stable. Implement the Kotlin MCP adapter over application services rather than over HTTP calls back into the same process.

Before committing to a Kotlin MCP library, spike:

- Streamable HTTP protocol compatibility.
- Session/concurrency behavior.
- Tool annotations and structured result schemas.
- API-key authentication and scope checks.
- Existing server test vectors.

The repository Agent Skills are documentation/contract assets and can remain TypeScript-independent. Update their endpoint examples only after API parity.

## Schema migrations and operations

### Migration mechanism

Implement an ordered, idempotent Kotlin migrator because the ODM migration engine is commented out.

Each migration should have:

- Immutable ID and checksum.
- Description.
- Apply function.
- Optional precondition/verification.
- Recorded start/completion/failure.
- No automatic destructive index drops in normal application startup.

Suggested separation:

- Safe collection/index/validator creation can run as a deploy job.
- Destructive or long-running changes require an explicit operator command.
- Atlas Search index changes are explicit and asynchronously verified.

Port the current exact index synchronizer behavior or generate a declarative manifest from Kotlin model/schema definitions. The migration command needs a `--dry-run`.

### Mongo connection configuration

Carry forward:

- `maxPoolSize`
- `minPoolSize`
- `maxIdleTimeMS`
- `waitQueueTimeoutMS`
- `serverSelectionTimeoutMS`
- `maxConnecting`
- retry reads/writes
- application name
- command/pool metrics

The connection budget becomes:

```text
maximum application replicas * maxPoolSize
+ maximum worker replicas * worker maxPoolSize
+ importer/admin headroom
```

Do not reuse the gateway's pool size without calculating the new replica count.

### Observability

Required telemetry:

- Request count, latency, status, and request ID.
- Mongo pool checked-out/waiting/created/closed metrics.
- Mongo command duration by operation/collection without raw sensitive payloads.
- Job queue depth, lease age, attempts, failures, and dead letters.
- Ingestion step duration and provider/model.
- Email delivery outcomes.
- Auth login/register/OAuth outcomes without credentials.
- JVM heap, threads, GC, and container health.

Expose:

- `/health/live`: process liveness only.
- `/health/ready`: Mongo and required startup readiness.
- Metrics endpoint restricted to internal monitoring.

## Migration plan

### Phase 0: freeze contracts and capture evidence

- Export the current OpenAPI response.
- Capture representative Mongo documents for every active collection with secrets redacted.
- Capture exact named indexes, validators, and Atlas Search definition from local/preview.
- Record current API status/body fixtures.
- Record quantity/domain golden fixtures.
- Record current page screenshots and critical browser flows.
- Confirm whether production users/data exist and whether downtime is acceptable.

Exit gate: the team can describe what parity means without referring to implementation intuition.

### Phase 1: architecture and ODM spike

- Scaffold Gradle backend and Vite frontend.
- Extract/harden the ODM module.
- Start replica-set Mongo with Compose.
- Implement Mongo configuration, liveness/readiness, structured logging, and request IDs.
- Reproduce schema inspection and dry-run migration.
- Complete the ODM qualification suite.
- Build the Spring MVC, Micronaut, and Javalin adapters for the defined benchmark slice.
- Prove frontend same-origin proxy and cookie round trip for development.
- Produce and smoke-test each candidate as one executable JAR containing the Vite build.
- Run the benchmark and record both runtime results and implementation/security complexity.

Exit gate: a Kotlin endpoint can read/write a UUID test document safely, the portable build passes without QMplus's full core artifact, a framework is selected from recorded evidence, and `java -jar tableplan.jar` serves both the API and SPA.

### Phase 2: read-only recipe slice

- Port recipe DTOs and access filters.
- Port search normalization.
- Implement Atlas Search query, catalog/custom merge, pagination, detail, and facets.
- Add `/api/v1/recipes/search` and `/api/v1/recipes/{id}`.
- Port `/recipes` and `/recipes/:id`.
- Compare responses and query behavior against the current implementation.

Exit gate: catalog count, access visibility, pagination, ordering, search, and facets match accepted fixtures.

### Phase 3: authentication and households

- Implement session, login/register/logout, username/email lookup, Google OAuth, and CSRF.
- Implement user/household bootstrap.
- Port household overview, switching, invitations, and roles.
- Decide and execute password compatibility/reset plan.
- Port protected frontend shell, sign-in, join, and settings identity sections.

Exit gate: new and migrated accounts preserve user IDs and cannot cross household boundaries.

### Phase 4: favorites, preferences, and saved searches

- Port favorites.
- Port measurement preference and meal slots.
- Port saved searches.
- Port settings and favorites pages.
- Add API-key authentication compatibility.

Exit gate: all mutations are idempotent or conflict-safe and UI parity tests pass.

### Phase 5: planning and shopping

- Port date/slot/quantity/aggregation domain logic with golden fixtures.
- Port plan create/add/remove/update/copy.
- Port shopping generate/refresh/toggle.
- Add transactions or compare-and-set guards where identified.
- Port plan and shopping pages.

Exit gate: concurrent plan creation, checked-item retention, serving propagation, and household isolation pass.

### Phase 6: private recipes and ingestion

- Add S3-compatible artifact store.
- Add worker job lease/retry model.
- Port deterministic and OpenRouter extraction.
- Port review, ingredient mapping, publish, edit, and visibility workflows.
- Port upload/review/edit/new pages.

Exit gate: private recipes never appear outside authorized user/household scopes, and duplicate publish returns one recipe.

### Phase 7: shares, email, and PDFs

- Port public share exchange/cookie flow.
- Port invitation and shopping email jobs.
- Port PDF rendering and visual regression tests.
- Port public shopping pages.

Exit gate: token hashing, expiry, revocation, claim concurrency, retries, and document output pass.

### Phase 8: OpenAPI, MCP, importer, and operational parity

- Complete OpenAPI component schemas and generate the frontend client.
- Port MCP tools and scope tests.
- Port raw catalog importer/facet refresh or retain the Node operator scripts temporarily with a documented retirement date.
- Add deployment, backup/restore, monitoring, and incident runbooks.

Exit gate: API/MCP clients and operational tasks no longer require the old application runtime.

### Phase 9: cutover

Preferred cutover:

1. Back up MongoDB and object storage.
2. Stop old writes or place the old app into maintenance/read-only mode.
3. Run Kotlin schema migration dry-run, then apply.
4. Deploy the selected `tableplan.jar` (API, SPA, and enabled job runners) and verify readiness on the final origin.
5. Verify immutable asset caching and SPA fallback without routing API, MCP, health, metrics, or download paths to `index.html`.
6. Invalidate old sessions and require login.
7. Run smoke tests for auth, recipes, plan, shopping, ingestion, shares, email, PDF, API keys, and MCP.
8. Observe error/latency/job metrics.
9. Keep the old deployment available for rollback, but do not run two independent writers after schema changes.

No collection copy should be necessary if the Kotlin implementation preserves the schema.

## Test strategy

### Test layers

| Layer | Purpose |
| --- | --- |
| Kotlin unit | Domain rules, validation, normalization, error mapping |
| ODM unit/integration | Reflection mapping, IDs, dates, nulls, indexes |
| Repository integration | Real replica-set Mongo queries and transactions |
| API contract | OpenAPI request/response and error conformance |
| Cross-runtime parity | Current TypeScript fixtures versus Kotlin results |
| Frontend component | Forms, states, accessibility, error handling |
| Browser E2E | Auth, recipes, plan, shopping, ingestion, sharing |
| Load/concurrency | Search latency, pool budget, claims, duplicate writes |
| Visual regression | Existing UI and generated PDFs |

### Critical security tests

- User-private recipe access by another user.
- Household recipe access by another household.
- Every write without membership.
- Viewer/adult/owner role restrictions.
- CSRF on cookie-authenticated mutations.
- API-key scope denial and revoked/expired keys.
- Public share token expiry/revocation and share-ID mismatch.
- Invitation token replay.
- Session fixation and cookie flags.
- Redaction of passwords, tokens, API keys, cookies, and private artifact content.
- Upload media type, size, filename, and decompression limits.

### Critical concurrency tests

- Two first household bootstraps for one user.
- Two first plan creations for the same household/week.
- Two ingestion publish requests.
- Two invitation acceptance requests.
- Two email worker claims.
- Concurrent shopping toggles and list refresh.
- Job lease expiry and worker recovery.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Full QMplus core dependency leaks into backend | Large, conflicting, nonportable build | Extract a narrow ODM module |
| ODM generates ObjectIds | Broken string references and validators | UUID factories, insert guard, integration tests |
| ODM null/field-name asymmetry | Silent BSON drift | Patch ODM and test round trips |
| Better Auth hashes are incompatible | Existing password users cannot log in | Inspect format; bridge or password reset |
| Old Durable Object sessions disappear | All users logged out | Planned session invalidation and communication |
| Schema/index mismatch | Query failures or data integrity regression | Declarative migration diff and dry-run |
| Atlas Search definition is missed | Search fails after cutover | Capture/reconcile search index explicitly |
| Blocking Mongo calls overload service | Request latency/thread exhaustion or event-loop stalls | Bounded request/blocking executor, Mongo pool budget, timeouts, saturation tests |
| Framework benchmark favors synthetic throughput | Wrong framework selected | Gate on complete auth/ops behavior and representative Mongo endpoints before comparing performance |
| SPA conversion changes navigation/data behavior | UX regressions | Reuse JSX/CSS, browser parity tests |
| Cloudflare workflows/queues are replaced poorly | Lost/stuck work | Persistent jobs, leases, retries, dead-letter state |
| Raw tokens leak through logs/jobs | Account/share compromise | Hash at rest, encrypt retry secret, central redaction |
| Domain logic diverges between TS and Kotlin | Quantity/planning errors | Shared golden fixtures |
| Two writers diverge during a long migration | Inconsistent state | Vertical routing or short controlled write cutover |

## Open decisions

These decisions should be resolved during Phases 0-1:

1. Spring MVC, Micronaut, or Javalin after the prescribed vertical-slice bake-off. Recommendation: treat Spring as the completeness baseline and Micronaut as the leading performance-oriented challenger; do not decide from hello-world benchmarks.
2. Extract ODM into this repository or publish a new `qmplus-odm` artifact upstream. Recommendation: upstream slim artifact if it can be done quickly; otherwise a provenance-tracked local module.
3. Password migration compatibility after inspecting real Better Auth account records.
4. Mongo-backed jobs or an existing managed queue in the target platform.
5. Continue using R2 through S3, or move objects to another S3-compatible service.
6. Chromium embedded with the service, or a dedicated PDF rendering service.
7. Kotlin MCP library choice after protocol spike.
8. Whether Node importer scripts remain temporarily as operator tools.
9. Deployment platform, replica counts, region, and Mongo connection budget.
10. Whether job pollers are enabled in every replica or only selected replicas through `JOBS_ENABLED`; the artifact remains identical.

## Recommended immediate next work

The first implementation milestone should be deliberately small:

1. Capture the current schema/index/search definition and representative documents.
2. Create `backend/odm` with the extracted source and provenance.
3. Remove QMplus-specific dependencies from that module.
4. Add the ODM qualification suite against replica-set Mongo.
5. Scaffold shared domain/application/persistence modules plus thin Spring MVC, Micronaut, and Javalin adapters.
6. Port the benchmark endpoints, including recipe search/detail and a minimal authenticated write.
7. Package each candidate with the same Vite SPA into an executable JAR.
8. Run the functional/security gates and benchmark matrix; record raw commands, configuration, and results.
9. Select the framework and delete the two losing adapters before broader porting.
10. Compare API responses and browser behavior before proceeding to the remaining features.

This sequence attacks the most architecture-specific uncertainty early while producing a demonstrable end-to-end vertical slice.

## Definition of port completion

The port is complete when:

- The Vite frontend owns all current page routes.
- The Kotlin backend owns all current REST, auth, public, PDF, ingestion, email, and MCP behavior.
- One versioned JVM artifact contains the embedded server, backend, Vite assets, and job code and starts with `java -jar tableplan.jar`.
- Production does not require a separately deployed Node server or frontend service.
- No application request uses the Cloudflare Mongo gateway protocol.
- No active session or job depends on a Durable Object or Cloudflare Workflow.
- Mongo validators, indexes, Atlas Search, IDs, field types, and access filters are verified.
- Existing users have an explicit login migration path.
- Existing API keys and public data links behave according to the chosen compatibility policy.
- Contract, browser, security, concurrency, load, and backup/restore gates pass.
- The old Worker application and gateway can be retired without losing an operator workflow.

## Official framework sources

Framework capabilities in this document were checked against official project documentation on 2026-07-23. They establish feature and packaging availability, not comparative performance; Tableplan-specific performance must come from the bake-off.

### Spring Boot

- [Servlet web applications and static content](https://docs.spring.io/spring-boot/reference/web/servlet.html)
- [Spring Security auto-configuration](https://docs.spring.io/spring-boot/reference/web/spring-security.html)
- [Actuator metrics, including Mongo command and pool instrumentation](https://docs.spring.io/spring-boot/reference/actuator/metrics.html)
- [Spring Session MongoDB package](https://docs.spring.io/spring-session/reference/3.5/api/java/org/springframework/session/data/mongo/package-summary.html)

### Micronaut

- [Executable JAR with Gradle](https://guides.micronaut.io/latest/executable-jar-gradle-java.html)
- [Static classpath resources](https://docs.micronaut.io/4.10.18/guide/)
- [Micronaut Security](https://micronaut-projects.github.io/micronaut-security/latest/guide/)
- [Micronaut OpenAPI](https://micronaut-projects.github.io/micronaut-openapi/6.13.2/guide/)
- [Micrometer integration](https://micronaut-projects.github.io/micronaut-micrometer/latest/guide/)

### Javalin

- [Javalin documentation: embedded Jetty, static/SPA serving, uploads, virtual threads, and deployment](https://javalin.io/documentation)
- [Javalin OpenAPI plugin](https://javalin.io/plugins/openapi)

### Ktor

- [Create a fat JAR](https://ktor.io/docs/server-fatjar.html)
- [Static content and SPA fallback](https://ktor.io/docs/server-static-content.html)
- [OAuth authentication](https://ktor.io/docs/server-oauth.html)
- [Session authentication](https://ktor.io/docs/server-session-auth.html)
- [OpenAPI](https://ktor.io/docs/server-openapi.html)
- [Micrometer metrics](https://ktor.io/docs/server-metrics-micrometer.html)

### Quarkus

- [Gradle tooling and application packaging](https://quarkus.io/guides/gradle-tooling)
- [Static web resources](https://quarkus.io/guides/web)
- [Security architecture](https://quarkus.io/guides/security-overview)
- [CSRF prevention](https://quarkus.io/guides/security-csrf-prevention)
- [MongoDB client, health, and pool metrics](https://quarkus.io/guides/mongodb.html)

### http4k

- [http4k ecosystem, including contracts, observability, and security modules](https://www.http4k.org/ecosystem/http4k/)
