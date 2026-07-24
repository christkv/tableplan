# Implementation Decisions

## Runtime

- Spring Boot 4.1.0, Kotlin 2.4.10, Java 21, Gradle 9.0.
- Spring MVC and the synchronous MongoDB driver; no reactive façade around blocking calls.
- One executable JAR embeds the React/Vite SPA and exposes server and non-web operator modes.
- The extracted ODM remains its own module; Atlas pipelines, sessions, jobs, bulk import, and
  transactions use the native driver where it is clearer.

## Identity and authorization

- Self-registration remains enabled.
- New credential passwords use BCrypt cost 12. Existing BCrypt hashes are verified directly.
  Unproven Better Auth hash formats return `password_migration_required`; they are never
  guessed or silently rewritten.
- Google linking is enabled only when standard Spring OAuth credentials exist. A Google
  identity may link by email only when Google asserts a verified email.
- Opaque browser sessions store only SHA-256 token IDs in Mongo. Existing Durable Object
  sessions intentionally do not migrate.
- API keys preserve `mp_test_`/`mp_live_`, prefix lookup, SHA-256 verification, one-time raw
  display, and application-service scopes.

## Jobs, artifacts, providers

- Background work uses atomic Mongo leases with bounded concurrency, retry/backoff, dead
  letters, idempotency keys, graceful drain, payload-free queue inspection, and guarded
  dead-letter replay.
- Development uses a bounded local artifact directory. Deployment uses the AWS SDK v2 S3
  adapter, including S3-compatible endpoints and server-side encryption.
- Deterministic text/Markdown extraction is the default. OpenRouter is an explicit opt-in
  adapter with a bounded input, total request timeout, JSON validation, and no content logs.
- Cloudflare Email Service's HTTPS REST API is the production email adapter. Local execution uses a capture adapter that logs
  neither recipient nor message.
- PDF export uses structured recipe, weekly-plan, shopping-list, and combined document models
  rendered with Apache PDFBox 3.0.8. The layout ports the original Node export's typography,
  recipe columns, weekly grid, meal cards, tags, and checklist styling while deliberately replacing
  browser rendering to keep the runtime deterministic, bounded, and free from runtime browser
  downloads.

## Protocol and operations

- MCP uses a small stateless Streamable HTTP JSON-response adapter instead of an additional
  SDK. It negotiates `2025-11-25`, accepts supported prior versions, validates Origin, and
  dispatches directly to application services.
- Kotlin owns catalog import, checkpoints, issue records, unit seeding, facet refresh,
  schema/validator/index reconciliation, and production database guards. The Node operator
  scripts are no longer required by the Spring runtime.
- Atlas Search remains separately administered because it is not a normal Mongo collection
  index.
