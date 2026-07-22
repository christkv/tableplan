# Preview environment setup

Preview uses the Atlas database `application_preview`, gateway Worker `tableplan-mongodb-gateway-preview`, and application Worker `family-meal-planner-preview`. MongoDB remains on Atlas; Cloudflare deploys only application and gateway code.

## 1. Verify access and provision Atlas

```bash
npm ci
npm run check
npx wrangler login
npx wrangler whoami
```

Create a transaction-capable Atlas deployment with Atlas Search and backups. The checked-in gateway uses `MONGO_LOCATION_HINT=weur`; change it in `wrangler.gateway.jsonc` if Western Europe is not close to the Atlas region.

Create separate least-privilege credentials for:

- gateway runtime reads and writes;
- catalog imports;
- schema and index administration.

Atlas network access must permit Cloudflare Worker egress and the import/administration networks.

The initial gateway has one named Durable Object (`pool-0`), `MONGODB_MAX_POOL_SIZE=10`, and `MONGODB_MIN_POOL_SIZE=0`. Budget for connections to every replica-set node:

```text
(pool size × replica-set nodes × concurrently active gateway versions)
  + 4 importer connections
  + administration headroom
```

Keep the planned maximum below roughly 60–70% of the Atlas tier's connection limit.

## 2. Prepare the preview database

```bash
cp gateway/preview.env.example .env.gateway.preview
```

Replace all placeholders. This ignored administration file must use `APP_ENV=preview`, `MONGODB_DATABASE=application_preview`, an administration-capable Atlas URI, the preview service token, the preview Better Auth URL, and the preview Better Auth secret.

Create collections, validators, and the Atlas Search definition:

```bash
node --env-file=.env.gateway.preview --import tsx gateway/migrate.ts --atlas-search
```

Wait for the `recipes_v1` Atlas Search index to become ready. Reconcile the named indexes:

```bash
npm run gateway:indexes:sync:preview -- --dry-run
npm run gateway:indexes:sync:preview
```

Always review the dry-run before applying it.

## 3. Import the recipe catalog

Use the importer credential rather than the gateway runtime credential:

```bash
MONGODB_URI='mongodb+srv://<import-user>:<password>@<cluster>/' \
npm run import -- data/recipes_ingredients.csv \
  --database application_preview \
  --batch-size 500
```

Do not add `--limit`. The latest `import_runs` record must report `status: "completed"`. See [recipe import operations](../operations/recipe-import.md) for reconciliation queries.

## 4. Provision Cloudflare resources

```bash
npx wrangler r2 bucket create meal-planner-private-recipes-preview
npx wrangler queues create tableplan-email-preview
npx wrangler queues create tableplan-email-preview-dlq
```

Do not recreate resources that already exist. Application deployment provisions `RecipeIngestionAgent` and its Workflow. Gateway deployment provisions the SQLite-backed `MongoGatewayDO`; it does not store application data in Cloudflare SQLite.

Enable the required Cloudflare products and verify the email sender domain before cloud email delivery.

## 5. Store preview secrets

Only the gateway Worker receives Atlas and Better Auth secrets:

```bash
npx wrangler secret put MONGODB_URI --config wrangler.gateway.jsonc --env preview
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --config wrangler.gateway.jsonc --env preview
npx wrangler secret put BETTER_AUTH_SECRET --config wrangler.gateway.jsonc --env preview
```

Optional gateway-owned authentication integrations:

```bash
npx wrangler secret put BETTER_AUTH_API_KEY --config wrangler.gateway.jsonc --env preview
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.gateway.jsonc --env preview
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.gateway.jsonc --env preview
```

The application Worker receives the matching service token and application-owned provider secrets:

```bash
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --env preview
npx wrangler secret put OPENROUTER_API_KEY --env preview
```

Add the email provider secret when cloud email delivery is enabled.

The service token must be identical on both Workers. Do not configure `MONGODB_GATEWAY_URL` in preview and never give the application Worker `MONGODB_URI`. The gateway has no public route and is available only through the `MONGODB_GATEWAY` service binding.

## 6. Configure Better Auth Dash

Create the project with:

- Project name: `Tableplan Preview`
- Base URL: `https://family-meal-planner-preview.christkv.workers.dev`
- Auth base path: `/api/auth`

Store the Dash key on the gateway Worker. Use the public application URL for ownership verification.

## 7. Deploy and verify

```bash
npm run check
npm run deploy:preview
curl -fsS https://family-meal-planner-preview.christkv.workers.dev/api/v1/health
```

The deploy target publishes the gateway first, builds with `CLOUDFLARE_ENV=preview`, and then publishes the application with its private binding. The health response must report `storageBackend: "mongodb-gateway"` and status `ok`.

Smoke-test authentication, catalog search, household isolation, planning, shopping, invitations, private recipe ingestion, PDF, email, API keys, and MCP.

For release and rollback detail, see [Cloudflare deployment operations](../operations/cloudflare-deployment.md).
