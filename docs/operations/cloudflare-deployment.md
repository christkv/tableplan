# Cloudflare deployment

MongoDB Atlas is the only database. Cloudflare deploys application and gateway code only; it does not deploy MongoDB. The application Worker calls a private gateway Worker through a service binding. One gateway Durable Object (`pool-0`) owns a bounded `MongoClient` pool and connects to Atlas.

## Environment mapping

| Worker environment | Gateway Worker | Atlas database |
| --- | --- | --- |
| Preview | `tableplan-mongodb-gateway-preview` | `application_preview` |
| Production | `tableplan-mongodb-gateway-production` | `application` |

Each environment needs a separate service token, auth secret, Atlas credential, R2 bucket, queues, OAuth client, and provider keys. No public gateway URL is required.

## Cloudflare resources

```bash
npx wrangler r2 bucket create meal-planner-private-recipes-preview
npx wrangler queues create tableplan-email-preview
npx wrangler queues create tableplan-email-preview-dlq
npx wrangler r2 bucket create meal-planner-private-recipes-production
npx wrangler queues create tableplan-email-production
npx wrangler queues create tableplan-email-production-dlq
```

The application deployment provisions the ingestion Durable Object and Workflow declared in `wrangler.jsonc`. The gateway deployment provisions `MongoGatewayDO` from `wrangler.gateway.jsonc`. Enable Workers AI, Browser Rendering, Email Sending, Workflows, Durable Objects, and R2 on the account.

## Required secrets

Set the Atlas URI, matching service token, and Better Auth secret on the gateway Worker:

```bash
npx wrangler secret put MONGODB_URI --config wrangler.gateway.jsonc --env preview
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --config wrangler.gateway.jsonc --env preview
npx wrangler secret put BETTER_AUTH_SECRET --config wrangler.gateway.jsonc --env preview
```

Set the same service token on the application Worker, along with application-owned provider secrets:

```bash
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --env preview
npx wrangler secret put OPENROUTER_API_KEY --env preview
```

Optional gateway secrets are `BETTER_AUTH_API_KEY`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`; include `--config wrangler.gateway.jsonc`. Repeat all commands with `--env production` and isolated values.

`MONGODB_GATEWAY_SERVICE_TOKEN` must match on the application and gateway. Never give the application Worker `MONGODB_URI`; only `MongoGatewayDO` receives the Atlas credential.

The gateway has `workers_dev: false`, so it has no public `workers.dev` endpoint. `MONGO_LOCATION_HINT=weur`, `MONGODB_MAX_POOL_SIZE=10`, `MONGODB_MIN_POOL_SIZE=0`, and one named Durable Object keep it near Atlas while bounding connection growth. Confirm `weur` matches the Atlas region before deployment. Atlas network access must also permit Cloudflare Worker egress.

`MongoGatewayDO` is declared with `new_sqlite_classes`. New Cloudflare accounts and Workers Free accounts cannot create legacy key-value-backed Durable Object namespaces. The gateway does not persist application data in Durable Object storage; SQLite is only the required namespace backend.

`mongodb` and its transitive `bson` package are intentionally pinned to `7.2.0`, matching the known-working Workers gateway. BSON 7.3 performs secure-random initialization at module scope, which the Workers runtime rejects. Do not remove the package override without repeating `npm run gateway:worker:dev` and the authenticated RPC smoke test.

## Preview deployment

Apply the MongoDB schema/indexes and import first. Then:

```bash
npm run check
npm run deploy:preview
curl -fsS https://family-meal-planner-preview.christkv.workers.dev/api/v1/health
```

The repository script deploys the gateway first, builds with `CLOUDFLARE_ENV=preview`, and then deploys the application whose service binding targets that gateway. Do not replace it with a bare application `wrangler deploy --env preview` after a build made for another environment.

## Production deployment

After preview approval and production gateway/database preparation:

```bash
npm run check
npm run deploy:production
curl -fsS https://<production-origin>/api/v1/health
```

The production script deploys the gateway before the application. Schema migration, catalog import, index synchronization, and code deployment remain separate reviewed operations.

## MongoDB index synchronization

Index definitions in `gateway/schema.ts` are authoritative for every declared collection. Configure admin-capable MongoDB credentials in ignored environment files before running the environment-specific targets:

```bash
cp gateway/preview.env.example .env.gateway.preview
cp gateway/production.env.example .env.gateway.production
```

Replace each `MONGODB_URI` placeholder with that environment's index-administration credential. Always inspect the plan before applying it:

```bash
npm run gateway:indexes:sync:preview -- --dry-run
npm run gateway:indexes:sync:preview

npm run gateway:indexes:sync:production -- --dry-run
npm run gateway:indexes:sync:production -- --confirm-production
```

The command validates the exact environment/database mapping, creates missing collections with their declared validator when necessary, creates missing indexes, drops and rebuilds changed indexes, and removes obsolete named indexes. `_id_` is always preserved. Index removal can affect live query performance and takes a collection lock, so apply preview first and schedule production changes in a reviewed maintenance window.

## Smoke tests

Verify application health reports `mongodb-gateway` through the private binding, then test authentication/Dash, catalog search, household isolation, planning, shopping, PDF, email/share links, invitation acceptance, private recipe ingestion, API keys, and MCP.

Cloudflare Worker code can be rolled back using deployment versions. Database changes are forward-fixed or restored from MongoDB backups; there is no alternate application storage engine.
