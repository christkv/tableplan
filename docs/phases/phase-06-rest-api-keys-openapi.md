# Phase 6: REST API, API Keys, and OpenAPI

## Objective

Expose the stable product capabilities through a versioned JSON API with scoped API keys, consistent household authorization, and machine-readable OpenAPI documentation.

## Dependencies

- Phase 5 domain services and product workflow.
- Phase 1 authentication and authorization context.

## Deliverables

- `/api/v1` REST surface using the same services as the UI.
- Request/response schemas that generate OpenAPI rather than drifting from it.
- API-key creation, one-time reveal, hashing, lookup, expiration, revocation, and audit events.
- Scope and household-binding enforcement.
- Pagination, limits, idempotency rules, and consistent error envelopes.
- Generated `/api/v1/openapi.json` with local, preview, and production server definitions.
- API-key settings UI.
- Rate-limit interface with a local implementation and Cloudflare-compatible production implementation.

## API-Key Model

- Prefixes distinguish environment: `mp_test_` and `mp_live_`.
- Persist only a key identifier/prefix and a strong hash of the secret material.
- Display the complete key once at creation.
- Keys have name, owner, optional household binding, scopes, expiration, last-used time, and revocation time.
- Key authentication resolves into the same authorization context used by session requests.
- Never accept keys in query parameters or log authorization headers.

Initial scopes:

```text
recipes:read
plans:read
plans:write
shopping:read
shopping:write
household:read
admin:import
```

## Initial Endpoints

```text
GET    /api/v1/health
GET    /api/v1/openapi.json
GET    /api/v1/recipes/search
GET    /api/v1/recipes/:id
GET    /api/v1/ingredients/search
GET    /api/v1/tags
GET    /api/v1/favorites
POST   /api/v1/favorites
DELETE /api/v1/favorites/:recipeId
GET    /api/v1/meal-plans
POST   /api/v1/meal-plans
GET    /api/v1/meal-plans/:id
POST   /api/v1/meal-plans/:id/items
PATCH  /api/v1/meal-plans/:id/items/:itemId
DELETE /api/v1/meal-plans/:id/items/:itemId
POST   /api/v1/shopping-lists/generate
GET    /api/v1/shopping-lists/:id
PATCH  /api/v1/shopping-lists/:id/items/:itemId
POST   /api/v1/api-keys
GET    /api/v1/api-keys
DELETE /api/v1/api-keys/:id
```

## Contract Rules

- IDs are opaque strings in external contracts.
- Dates and times use ISO 8601 with explicit timezone semantics.
- Quantities include machine values, unit/dimension metadata, display text, and unresolved status.
- Collection endpoints use cursor pagination and enforce maximum page sizes.
- Mutations support idempotency keys where retries could duplicate resources.
- Errors include stable code, message, request ID, and field details when applicable.

## Implementation Sequence

1. Define shared request/response schemas and error model.
2. Build API auth middleware and scope mapping.
3. Implement key lifecycle and settings UI.
4. Add read endpoints, then plan/list mutations.
5. Generate and validate OpenAPI from route schemas.
6. Add audit events, rate limits, request IDs, and structured logs.
7. Publish curl examples using test placeholders only.

## Verification

- Contract tests for every endpoint and error shape.
- Scope matrix tests, including forbidden writes and cross-household access.
- Key hash, expiration, revocation, and last-used tests.
- Idempotency tests for create/generate operations.
- OpenAPI schema validation and generated-file drift check in CI.
- Preview smoke tests using an API key created through the UI.

## Acceptance Criteria

- An external client can search recipes, modify a meal plan, and generate/read a shopping list with appropriate scopes.
- Full API-key secrets are never persisted or shown after creation.
- Session and API-key requests receive equivalent domain behavior and authorization.
- OpenAPI describes every public endpoint and validates in CI.
- Requests with insufficient scope or another household's ID fail without leaking resource existence.

## Non-Goals

- OAuth for remote assistant clients; Phase 7 adds it to the MCP resource flow.
- Public anonymous APIs.
- Import administration endpoints beyond schema/reserved scope.
- GraphQL.

## Exit Artifact

A documented, secure external API that becomes the contract foundation for MCP and Agent Skills.
