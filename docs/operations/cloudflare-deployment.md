# Cloudflare Deployment

## Environments

- `local`: Wrangler/Vite emulation and local D1 state.
- `preview`: isolated cloud resources, test OAuth clients, and non-production keys.
- `production`: production D1, Vectorize, AI, Queue, R2, OAuth, and secrets.

Never share D1 databases, API keys, OAuth credentials, Vectorize indexes, or queues between preview and production.

## Required Resources

Create environment-specific resources and replace placeholder IDs in `wrangler.jsonc`:

```bash
npx wrangler d1 create meal-planner-preview
npx wrangler d1 create meal-planner-production
npx wrangler r2 bucket create meal-planner-private-recipes-preview
npx wrangler r2 bucket create meal-planner-private-recipes-production
```

Private recipe ingestion requires R2 and Workers AI. The Worker deployment
creates or updates the `RecipeIngestionAgent` Durable Object class and the
environment-specific `RecipeIngestionWorkflow` from `wrangler.jsonc`. Confirm
the account has Workers AI, Workflows, Durable Objects, and R2 enabled before
deploying preview. Vectorize and import queues remain future Phase 10/11
resources and are not required for private recipe ingestion.

## Secrets

Set secrets separately for each environment:

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env preview
npx wrangler secret put GOOGLE_CLIENT_ID --env preview
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
npx wrangler secret put EMAIL_PROVIDER_API_KEY --env preview
```

Repeat for production. Use distinct values. `BETTER_AUTH_URL`, `APP_ENV`, and non-secret feature configuration may be Wrangler variables.

## Migrate and Deploy Preview

```bash
npm run check
npm run db:migrate:preview
npm run deploy:preview
```

After deployment:

- Verify `/api/v1/health`.
- Complete Google and first-party sign-in tests.
- Search and open a known imported recipe.
- Create a meal plan and generate a shopping list.
- Exercise a scoped test API key.
- Connect MCP Inspector and one supported assistant client.
- Paste and publish a private text recipe, then confirm a second account gets
  404 for its ID.
- Upload an image/PDF, review the Workers AI extraction, publish it, share it
  with the household, and add it to a plan.

## Deploy Production

Production requires a reviewed preview release and import plan:

```bash
npm run check
npm run db:migrate:production
npm run deploy:production
```

Do not combine schema migration, full catalog replacement, and application deployment into an unreviewed single command. The full recipe import follows `docs/operations/recipe-import.md`.

## OAuth URLs

Register exact preview and production callback URLs with Google and remote assistant clients. Do not use wildcard production redirects. Keep local callbacks in a separate development OAuth client where the provider permits it.

## Rollback and Forward Fix

- Cloudflare Worker code can be rolled back using deployment versions.
- D1 schema/data changes are forward-fixed from migrations or restored/rebuilt through a reviewed export/import procedure.
- Vectorize can be rebuilt from relational recipe IDs and embedding-document versions.
- Queue failures must leave FTS and normal application reads operational.
- Failed ingestion workflows retain an owned job and artifact for retry or
  support inspection; they do not create a recipe row.

## CI Deployment

CI runs `npm ci`, `npm run check`, then deploys with an environment-scoped Cloudflare API token. Production deploys should require protected-branch approval and should not expose secrets to preview builds from untrusted contributions.
