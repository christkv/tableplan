# Local development initial setup

This guide creates an isolated `application_local` database and runs the Tableplan application against a local MongoDB gateway.

## 1. Prerequisites

- Node.js 22 or newer.
- A transaction-capable MongoDB instance on `127.0.0.1:27017`.
- The recipe source file at `data/recipes_ingredients.csv` when catalog data is needed.

```bash
node --version
npm ci
cp .dev.vars.example .dev.vars
cp gateway/local.env.example .env.gateway.local
```

Both environment files are ignored. The application-facing `.dev.vars` contains the local gateway URL and service token, but never `MONGODB_URI`. The same service token must appear in `.env.gateway.local`.

## 2. Prepare MongoDB

```bash
npm run gateway:migrate:local
npm run gateway:indexes:sync:local -- --dry-run
npm run gateway:indexes:sync:local
```

The migration creates collections and validators. The index synchronizer makes the named indexes match `gateway/schema.ts`, including removing obsolete named indexes while preserving `_id_`. Always inspect the dry-run before applying it.

Load a small catalog for UI development:

```bash
npm run import:sample
```

For a complete local import, omit the sample limit:

```bash
node --env-file=.env.gateway.local --import tsx \
  scripts/import-recipes-mongodb.ts \
  data/recipes_ingredients.csv \
  --database application_local \
  --batch-size 500
```

## 3. Start the gateway

The default development path uses the Node HTTP gateway:

```bash
npm run gateway:dev
```

To test the deployed architecture locally, stop the Node gateway and run the Cloudflare Worker with its SQLite-backed Durable Object:

```bash
npm run gateway:worker:dev
```

Do not run both simultaneously; each listens on `127.0.0.1:8790`. They share the same domain RPC, Better Auth runtime, MongoDB stores, pool limits, service token, and DEBUG query logging.

The MongoDB driver and BSON are intentionally pinned to `7.2.0`. Do not remove the BSON override without proving that `gateway:worker:dev` can start and connect; newer BSON initialization currently fails at Cloudflare Worker module scope.

## 4. Start the application

In another terminal:

```bash
npm run dev
```

Use the URL printed by React Router, normally `http://127.0.0.1:5173`.

## 5. Verify

```bash
curl -fsS http://127.0.0.1:8790/readyz
npm run check
```

At DEBUG level, the gateway logs MongoDB commands with fully expanded, recursively redacted filters and aggregation pipelines. INFO logs retain gateway lifecycle and RPC summaries without query payloads.

Create the local test account while both services are running:

```bash
npm run seed:test-user
```

For complete local behavior, full-import verification, logging configuration, and troubleshooting, see [local development operations](../operations/local-development.md).
