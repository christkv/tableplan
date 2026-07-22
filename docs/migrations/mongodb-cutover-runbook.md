# MongoDB gateway deployment runbook

The repository cutover is complete: MongoDB is the only application database and the gateway is mandatory. This runbook covers external infrastructure.

## 1. Local proof

```bash
npm run gateway:migrate:local
npm run import:sample
npm run gateway:dev
curl -fsS http://127.0.0.1:8790/readyz
```

Set the app's gateway URL to `http://127.0.0.1:8790` and use the matching local service token from `.dev.vars`.

The Node gateway is a local fallback. To exercise the Cloudflare Durable Object runtime locally instead, run `npm run gateway:worker:dev` with the same `.env.gateway.local` file.

## 2. Connection budget

For each environment, record Atlas's connection limit, gateway pool size, importer allowance (maximum four), and admin headroom. Keep the planned maximum below roughly 60–70% of the database limit. The gateway starts with exactly one named Durable Object, `MONGODB_MAX_POOL_SIZE=10`, and `MONGODB_MIN_POOL_SIZE=0`. Remember that a MongoDB pool can open connections to each replica-set node.

## 3. Preview

Use `application_preview` for schema migration, raw catalog import, gateway runtime, and Better Auth.

```bash
MONGODB_URI='<admin-uri>' MONGODB_DATABASE=application_preview \
MONGODB_GATEWAY_SERVICE_TOKEN='<token>' BETTER_AUTH_URL='https://family-meal-planner-preview.christkv.workers.dev' \
BETTER_AUTH_SECRET='<secret>' npm run gateway:migrate -- --atlas-search

MONGODB_URI='<import-uri>' npm run import -- data/recipes_ingredients.csv \
  --database application_preview --batch-size 500
```

The gateway Worker and its Durable Object are declared in `wrangler.gateway.jsonc`. It has no public route and is reachable from the application only through the `MONGODB_GATEWAY` service binding. Configure its Atlas URI, service token, Better Auth secret, and optional OAuth/Dash secrets. Use `gateway/preview.env.example` as the value checklist; production has a separate template.

Store gateway-only secrets on the gateway Worker and the matching service token on the application Worker, then deploy:

```bash
npx wrangler secret put MONGODB_URI --config wrangler.gateway.jsonc --env preview
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --config wrangler.gateway.jsonc --env preview
npx wrangler secret put BETTER_AUTH_SECRET --config wrangler.gateway.jsonc --env preview
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --env preview
npm run deploy:preview
```

## 4. Better Auth Dash

Create `Tableplan Preview` with the public application base URL and `/api/auth` base path. Put the issued `BETTER_AUTH_API_KEY` on the gateway Worker. A manual unauthenticated `/api/auth/dash/validate` request through the application should return 401; a 404 indicates the proxy or gateway build is wrong.

## 5. Verification

Require:

- gateway readiness and application health;
- completed `import_runs` reconciliation and reviewed `import_issues`;
- representative Atlas Search results;
- sign-up, sign-in, sign-out, session renewal, and Dash verification;
- household/private-data isolation;
- planning, shopping, invitations, API keys, MCP, ingestion, PDF, and email smoke tests;
- observed gateway pool/queue latency below alert thresholds.

## 6. Production

Repeat with isolated credentials and `MONGODB_DATABASE=application`. Import requires `--allow-production`. Never reuse preview MongoDB credentials, service tokens, auth secrets, OAuth clients, or Cloudflare resources.

There is no storage-backend toggle or fallback database. Roll back application/gateway code with deployment versions; repair database changes forward or restore a verified MongoDB backup.
