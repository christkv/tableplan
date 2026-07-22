# Production environment setup

Production uses the Atlas database `application`, gateway Worker `tableplan-mongodb-gateway-production`, and application Worker `family-meal-planner`. Complete and approve the [preview setup](preview.md) before provisioning or deploying production.

## 1. Provision isolated production infrastructure

Create or select the transaction-capable production Atlas deployment. Enable Atlas Search and backups, confirm restore procedures, and keep it close to the `MONGO_LOCATION_HINT` in `wrangler.gateway.jsonc`.

Create production-only least-privilege credentials for:

- gateway runtime reads and writes;
- catalog imports;
- schema and index administration.

Do not reuse preview databases, credentials, gateway tokens, auth secrets, OAuth clients, buckets, or queues. Confirm Atlas network access and calculate the gateway/importer/admin connection budget before continuing.

## 2. Prepare the production database

```bash
cp gateway/production.env.example .env.gateway.production
```

Replace all placeholders. The ignored file must use `APP_ENV=production`, `MONGODB_DATABASE=application`, production-only credentials, the production Better Auth URL, and the production Better Auth secret.

Create collections, validators, and the Atlas Search definition:

```bash
node --env-file=.env.gateway.production --import tsx gateway/migrate.ts --atlas-search
```

Wait for `recipes_v1` to become ready. Then reconcile indexes:

```bash
npm run gateway:indexes:sync:production -- --dry-run
npm run gateway:indexes:sync:production -- --confirm-production
```

Review the dry-run carefully. Production index removal or rebuilding can affect live query performance and should run in an approved maintenance window.

## 3. Import the production catalog

Use the production importer credential. The production safety flag is mandatory:

```bash
MONGODB_URI='mongodb+srv://<production-import-user>:<password>@<cluster>/' \
npm run import -- data/recipes_ingredients.csv \
  --database application \
  --batch-size 500 \
  --allow-production
```

Do not add `--limit`. Confirm the latest `import_runs` record is complete and reconcile counts and issues using [recipe import operations](../operations/recipe-import.md).

## 4. Provision production Cloudflare resources

```bash
npx wrangler r2 bucket create meal-planner-private-recipes-production
npx wrangler queues create tableplan-email-production
npx wrangler queues create tableplan-email-production-dlq
```

Do not recreate existing resources. Verify the production email sender domain and all account-level Cloudflare product access.

## 5. Store production secrets

Gateway-only Atlas and Better Auth secrets:

```bash
npx wrangler secret put MONGODB_URI --config wrangler.gateway.jsonc --env production
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --config wrangler.gateway.jsonc --env production
npx wrangler secret put BETTER_AUTH_SECRET --config wrangler.gateway.jsonc --env production
```

Optional gateway-owned authentication integrations:

```bash
npx wrangler secret put BETTER_AUTH_API_KEY --config wrangler.gateway.jsonc --env production
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.gateway.jsonc --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.gateway.jsonc --env production
```

Application-owned secrets:

```bash
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --env production
npx wrangler secret put OPENROUTER_API_KEY --env production
```

Add the production email provider secret when cloud delivery is enabled. The gateway and application service tokens must match.

Never configure `MONGODB_GATEWAY_URL` in production and never give the application Worker `MONGODB_URI`. Traffic reaches the gateway only through the private `MONGODB_GATEWAY` service binding.

## 6. Configure production authentication

Create a separate Better Auth Dash project using the production public URL and `/api/auth` base path. Configure production-only OAuth redirect URLs and store issued secrets only on the gateway Worker.

The checked-in placeholder production URL is `https://meal-planner.example.com`. Replace it in `wrangler.jsonc` and `wrangler.gateway.jsonc` before deployment if the real hostname differs.

## 7. Deploy and verify

Deploy only after preview approval:

```bash
npm run check
npm run deploy:production
curl -fsS https://<production-origin>/api/v1/health
```

The health response must report `storageBackend: "mongodb-gateway"` and status `ok`. Smoke-test authentication, catalog search, household isolation, planning, shopping, invitations, private recipe ingestion, PDF, email, API keys, and MCP.

Monitor gateway errors, Atlas connections, pool wait latency, slow queries, and application health throughout the rollout.

## 8. Production release rules

- Keep storage-contract changes backward-compatible while the gateway deploys before the application.
- Apply schema and index changes before code that depends on them.
- Treat catalog imports as separate audited operations.
- Roll back Worker versions through Cloudflare; forward-fix database changes or restore from verified Atlas backups.

For release, rollback, and smoke-test detail, see [Cloudflare deployment operations](../operations/cloudflare-deployment.md).
