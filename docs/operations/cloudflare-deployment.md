# Cloudflare deployment

MongoDB is the only database. The Cloudflare Worker calls an HTTPS MongoDB gateway; it has no MongoDB URI and no database binding.

## Environment mapping

| Worker environment | Gateway database |
| --- | --- |
| Preview | `application_preview` |
| Production | `application` |

Each environment needs a separate gateway URL/token, auth secret, MongoDB credential, R2 bucket, queues, OAuth client, and provider keys.

## Cloudflare resources

```bash
npx wrangler r2 bucket create meal-planner-private-recipes-preview
npx wrangler queues create tableplan-email-preview
npx wrangler queues create tableplan-email-preview-dlq
npx wrangler r2 bucket create meal-planner-private-recipes-production
npx wrangler queues create tableplan-email-production
npx wrangler queues create tableplan-email-production-dlq
```

The Worker deployment provisions the Durable Object and Workflow declared in `wrangler.jsonc`. Enable Workers AI, Browser Rendering, Email Sending, Workflows, Durable Objects, and R2 on the account.

## Required Worker secrets

Set separately for preview and production:

```bash
npx wrangler secret put MONGODB_GATEWAY_URL --env preview
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --env preview
npx wrangler secret put BETTER_AUTH_SECRET --env preview
npx wrangler secret put OPENROUTER_API_KEY --env preview
```

Optional: `BETTER_AUTH_API_KEY`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`. Repeat with `--env production` and different values.

`MONGODB_GATEWAY_SERVICE_TOKEN` and `BETTER_AUTH_SECRET` must match the corresponding gateway values. Never give the Worker `MONGODB_URI`.

## Preview deployment

Confirm the gateway `/readyz` endpoint and Mongo schema/import first. Then:

```bash
npm run check
npm run deploy:preview
curl -fsS https://family-meal-planner-preview.christkv.workers.dev/api/v1/health
```

The repository script sets `CLOUDFLARE_ENV=preview` before building. Do not replace it with a bare `wrangler deploy --env preview` after a build made for another environment.

## Production deployment

After preview approval and production gateway/database preparation:

```bash
npm run check
npm run deploy:production
curl -fsS https://<production-origin>/api/v1/health
```

Schema migration, catalog import, gateway deployment, and Worker deployment are separate reviewed operations.

## Smoke tests

Verify health reports `mongodb-gateway`, then test authentication/Dash, catalog search, household isolation, planning, shopping, PDF, email/share links, invitation acceptance, private recipe ingestion, API keys, and MCP.

Cloudflare Worker code can be rolled back using deployment versions. Database changes are forward-fixed or restored from MongoDB backups; there is no alternate application storage engine.
