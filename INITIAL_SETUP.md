# Initial setup

Tableplan uses MongoDB exclusively. Use these database names exactly:

| Environment | MongoDB database |
| --- | --- |
| Local | `application_local` |
| Preview | `application_preview` |
| Production | `application` |

The Cloudflare application Worker must not connect to MongoDB directly. Deploy `Dockerfile.gateway` near the database with a hard instance limit; the gateway owns the bounded connection pool and Better Auth.

## 1. Install and verify

```bash
node --version
npm ci
npm run check
npx wrangler login
npx wrangler whoami
```

Node.js 22 or newer is required. Confirm Wrangler is using the intended Cloudflare account.

## 2. Provision MongoDB

Create a transaction-capable MongoDB replica set or Atlas cluster. Atlas Search is required for deployed catalog search. Place it in the same region as the gateway and enable backups.

Create separate credentials for:

- gateway runtime reads/writes;
- catalog imports;
- schema/index administration.

Restrict database network access to the gateway/import administration network. Calculate the connection budget before deployment:

```text
(maximum gateway instances × MONGODB_MAX_POOL_SIZE) + 4 importer connections + admin headroom
```

Keep that total below roughly 60–70% of the deployment connection limit.

## 3. Configure and migrate the preview database

Configure the administration shell with the preview URI and exact database name:

```bash
export MONGODB_URI='mongodb+srv://<admin-user>:<password>@<cluster>/'
export MONGODB_DATABASE='application_preview'
export MONGODB_GATEWAY_SERVICE_TOKEN='<at-least-32-random-characters>'
export BETTER_AUTH_URL='https://family-meal-planner-preview.christkv.workers.dev'
export BETTER_AUTH_SECRET='<at-least-32-random-characters>'
npm run gateway:migrate -- --atlas-search
```

Wait for the `recipes_v1` Atlas Search index to become ready.

## 4. Import the raw recipe catalog into preview

Use the dedicated importer credential, not the gateway credential:

```bash
MONGODB_URI='mongodb+srv://<import-user>:<password>@<cluster>/' \
npm run import -- data/recipes_ingredients.csv \
  --database application_preview \
  --batch-size 500
```

The importer caps its pool at four connections, stores a SHA-256-based run ID in `import_runs`, resumes from `checkpointRow`, upserts stable recipe IDs, and records malformed/duplicate rows in `import_issues`. Re-running the same command resumes or safely reapplies the same source. See [recipe import operations](docs/operations/recipe-import.md) for verification queries.

## 5. Deploy the preview MongoDB gateway

Build `Dockerfile.gateway` on a regional container platform with HTTPS ingress, readiness path `/readyz`, liveness path `/healthz`, graceful draining, and a hard maximum instance count.

Set these protected runtime values:

The checked-in template is `gateway/preview.env.example`.

```text
APP_ENV=preview
MONGODB_URI=<gateway MongoDB credential URI>
MONGODB_DATABASE=application_preview
MONGODB_GATEWAY_SERVICE_TOKEN=<same random service token used by the Worker>
MONGODB_MAX_POOL_SIZE=<value from the connection budget>
MONGODB_MIN_POOL_SIZE=0
MONGODB_MAX_IDLE_TIME_MS=60000
MONGODB_WAIT_QUEUE_TIMEOUT_MS=2000
MONGODB_SERVER_SELECTION_TIMEOUT_MS=3000
MONGODB_MAX_CONNECTING=2
GATEWAY_MAX_BODY_BYTES=1048576
GATEWAY_MAX_IN_FLIGHT=100
BETTER_AUTH_URL=https://family-meal-planner-preview.christkv.workers.dev
BETTER_AUTH_SECRET=<preview auth secret>
BETTER_AUTH_API_KEY=<Better Auth Dash key, when enabled>
GOOGLE_CLIENT_ID=<optional preview OAuth client>
GOOGLE_CLIENT_SECRET=<optional preview OAuth secret>
```

Verify the gateway before deploying the application:

```bash
curl -fsS https://<preview-gateway-host>/healthz
curl -fsS https://<preview-gateway-host>/readyz
```

## 6. Provision Cloudflare preview resources

Tableplan uses Workers, R2, Queues, Workers AI, Durable Objects, Workflows, Browser Rendering, and Email Sending.

```bash
npx wrangler r2 bucket create meal-planner-private-recipes-preview
npx wrangler queues create tableplan-email-preview
npx wrangler queues create tableplan-email-preview-dlq
```

If Wrangler already provisioned the R2 bucket, do not recreate it. The Durable Object and Workflow are created during deployment from `wrangler.jsonc`. Verify the email sender domain before enabling cloud delivery.

## 7. Store Cloudflare preview secrets

The service token must exactly match the gateway. The Better Auth secret must also be identical on the gateway and application Worker.

```bash
npx wrangler secret put MONGODB_GATEWAY_URL --env preview
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --env preview
npx wrangler secret put BETTER_AUTH_SECRET --env preview
npx wrangler secret put OPENROUTER_API_KEY --env preview
```

Optional integrations:

```bash
npx wrangler secret put BETTER_AUTH_API_KEY --env preview
npx wrangler secret put GOOGLE_CLIENT_ID --env preview
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
```

The Worker gateway URL must be HTTPS. Never put MongoDB credentials in Worker secrets or `wrangler.jsonc`; only the gateway URL and service token belong there.

## 8. Configure Better Auth Dash

Use these Create Project values:

- Project name: `Tableplan Preview`
- Base URL: `https://family-meal-planner-preview.christkv.workers.dev`
- Auth base path, when requested: `/api/auth`

Store the issued Dash API key on both the gateway and Worker, then redeploy both. Use the public application URL, not the private gateway URL, for ownership verification.

Diagnostic requests:

```bash
curl -i https://family-meal-planner-preview.christkv.workers.dev/api/auth/get-session
curl -i https://family-meal-planner-preview.christkv.workers.dev/api/auth/dash/validate
```

An unauthenticated Dash validation request should return `401`, which proves the route exists. `404` means the application proxy is not reaching a gateway build containing the Dash plugin. The Dash wizard supplies the signed bearer token required for successful verification.

## 9. Deploy preview

```bash
npm run check
npm run deploy:preview
```

Use the repository script. It sets `CLOUDFLARE_ENV=preview` before the Vite build; a standalone `wrangler deploy --env preview` cannot change an environment already selected during the build.

Verify:

```bash
curl -fsS https://family-meal-planner-preview.christkv.workers.dev/api/v1/health
```

The response must report `storageBackend: "mongodb-gateway"` and status `ok`.

Smoke-test sign-up/sign-in, a known catalog search, planning, shopping, invitations, private recipe ingestion, PDF, email, API keys, and MCP.

## 10. Provision production

Repeat the MongoDB schema and import steps with the production database name. Production imports require the explicit safety flag:

```bash
MONGODB_URI='mongodb+srv://<production-import-user>:<password>@<cluster>/' \
npm run import -- data/recipes_ingredients.csv \
  --database application \
  --batch-size 500 \
  --allow-production
```

Deploy a separate production gateway configured with `MONGODB_DATABASE=application`, distinct credentials, production URLs, and a separately calculated instance/pool budget.
Use `gateway/production.env.example` as the production configuration checklist.

Provision Cloudflare resources:

```bash
npx wrangler r2 bucket create meal-planner-private-recipes-production
npx wrangler queues create tableplan-email-production
npx wrangler queues create tableplan-email-production-dlq
```

Store production secrets with `--env production`, including `MONGODB_GATEWAY_URL`, `MONGODB_GATEWAY_SERVICE_TOKEN`, `BETTER_AUTH_SECRET`, and `OPENROUTER_API_KEY`. Then:

```bash
npm run check
npm run deploy:production
```

Do not share MongoDB databases, credentials, gateway tokens, auth secrets, OAuth clients, buckets, or queues between preview and production.

## 11. Normal releases

Preview:

```bash
npm run check
npm run deploy:preview
```

Production after preview approval:

```bash
npm run check
npm run deploy:production
```

Run `npm run gateway:migrate` before deploying code that introduces a new collection, validator, or index. Catalog import remains a separate audited operation.
