# MongoDB gateway deployment and cutover runbook

This runbook covers the remaining external work after the repository-controlled migration implementation. Run preview first. Do not delete D1, its migrations, or its backups during this procedure.

## 1. Provision MongoDB

1. Create a MongoDB replica set or Atlas deployment in the same region as the gateway. Transactions are mandatory. Atlas Search is required for the current recipe search implementation.
2. Record the deployment connection limit, region, backup policy, point-in-time recovery setting, and named operator.
3. Create separate least-privilege credentials for the gateway, catalog importer, and schema administration. Disable the importer credential when no import is running.
4. Restrict network ingress to the gateway runtime/private network. Never expose MongoDB to the Cloudflare application Worker or the public internet.
5. Choose the instance cap and pool size so `(maximum instances × MONGODB_MAX_POOL_SIZE) + importer pool + admin headroom` stays below 60–70% of the database connection limit.

## 2. Exercise the local replica set

```bash
docker compose -f compose.mongodb.yml up --build
MONGODB_URI='mongodb://127.0.0.1:27018/?replicaSet=rs0' \
MONGODB_DATABASE=meal_planner_local \
MONGODB_GATEWAY_SERVICE_TOKEN='local-gateway-token-change-me-1234567890' \
BETTER_AUTH_URL='http://127.0.0.1:5173' \
BETTER_AUTH_SECRET='local-only-secret-change-before-deployment-32-chars' \
npm run gateway:migrate
```

Set `STORAGE_BACKEND=mongodb-gateway` in `.dev.vars`, start the app, and smoke-test sign-up, sign-in, a private recipe import, a meal plan, shopping list sharing, and captured email. Restore `STORAGE_BACKEND=d1` when the test is finished.

The Compose defaults expose MongoDB on host port `27018` and the gateway on `8790` so they do not collide with common local services. Set `MONGODB_GATEWAY_URL=http://127.0.0.1:8790` for this proof.

## 3. Deploy the bounded gateway

Build `Dockerfile.gateway` in a regional container service with a hard maximum instance count and HTTPS/private ingress. Configure these gateway values as secrets or protected runtime variables:

```text
APP_ENV=preview
MONGODB_URI=...
MONGODB_DATABASE=meal_planner_preview
MONGODB_GATEWAY_SERVICE_TOKEN=<at least 32 random characters>
MONGODB_MAX_POOL_SIZE=<from the recorded connection budget>
MONGODB_MIN_POOL_SIZE=0
MONGODB_MAX_IDLE_TIME_MS=60000
MONGODB_WAIT_QUEUE_TIMEOUT_MS=2000
MONGODB_SERVER_SELECTION_TIMEOUT_MS=3000
MONGODB_MAX_CONNECTING=2
GATEWAY_MAX_BODY_BYTES=1048576
GATEWAY_MAX_IN_FLIGHT=<bounded from load testing; start at 100>
BETTER_AUTH_URL=https://family-meal-planner-preview.christkv.workers.dev
BETTER_AUTH_SECRET=<the exact same secret used by the Cloudflare preview Worker>
BETTER_AUTH_API_KEY=<Dash key, when Dash is enabled>
GOOGLE_CLIENT_ID=<optional preview OAuth client>
GOOGLE_CLIENT_SECRET=<optional preview OAuth secret>
```

Do not autoscale without a maximum. Configure readiness on `/readyz`, liveness on `/healthz`, deployment draining, TLS, request logs, pool saturation metrics, and alerts.

Verify:

```bash
curl -fsS https://<gateway-host>/healthz
curl -fsS https://<gateway-host>/readyz
```

## 4. Create collections, indexes, and Atlas Search

Run with the administration credential:

```bash
MONGODB_URI='...' MONGODB_DATABASE=meal_planner_preview \
MONGODB_GATEWAY_SERVICE_TOKEN='...' BETTER_AUTH_URL='https://family-meal-planner-preview.christkv.workers.dev' \
BETTER_AUTH_SECRET='...' npm run gateway:migrate -- --atlas-search
```

Wait until the `recipes_v1` Atlas Search index reports ready before importing or switching reads.

## 5. Import the catalog

Use the dedicated import credential and a pool no larger than four connections:

```bash
MONGODB_URI='...' MONGODB_DATABASE=meal_planner_preview \
MONGODB_GATEWAY_SERVICE_TOKEN='...' BETTER_AUTH_URL='https://family-meal-planner-preview.christkv.workers.dev' \
BETTER_AUTH_SECRET='...' npm run import:mongodb -- data/recipes_ingredients.csv --batch-size 500
```

The run is resumable by source hash/checkpoint and quarantines documents near MongoDB's size limit. Review `import_runs` and `import_issues` before continuing.

## 6. Export and stage D1 state

Create a private working directory. Snapshot files contain users, sessions, hashes, household data, and private recipes; do not commit or upload them.

```bash
mkdir -p .import/preview-cutover
npx wrangler d1 export DB --env preview --remote --output .import/preview-cutover/d1.sql
npm run migrate:d1-to-mongodb -- materialize .import/preview-cutover/d1.sql --out .import/preview-cutover/d1.sqlite
npm run migrate:d1-to-mongodb -- snapshot .import/preview-cutover/d1.sqlite --out .import/preview-cutover/snapshot.json
```

This first pass is a rehearsal. Load and verify it, test preview against MongoDB, then discard the target database or repeat the final load under the write freeze.

```bash
MONGODB_URI='...' MONGODB_DATABASE=meal_planner_preview MONGODB_GATEWAY_SERVICE_TOKEN='...' \
BETTER_AUTH_URL='https://family-meal-planner-preview.christkv.workers.dev' BETTER_AUTH_SECRET='...' \
npm run migrate:d1-to-mongodb -- load .import/preview-cutover/snapshot.json

MONGODB_URI='...' MONGODB_DATABASE=meal_planner_preview MONGODB_GATEWAY_SERVICE_TOKEN='...' \
BETTER_AUTH_URL='https://family-meal-planner-preview.christkv.workers.dev' BETTER_AUTH_SECRET='...' \
npm run migrate:d1-to-mongodb -- verify .import/preview-cutover/snapshot.json
```

The command exits non-zero unless the top-level result is `"ok": true`. Every collection must report `missing: 0` and `checksumMatches: true`, and every `orphanReferences` count must be zero. Do not continue on a partial report. The catalog must be loaded first because favourites and plan items legitimately reference catalog recipe IDs. Also manually verify private recipe ownership, session expiry dates, invitation/share hashes, embedded plan item IDs, shopping checks, and ingestion R2 keys.

For the frozen rehearsal, set `STORAGE_SHADOW_READS=mongodb-gateway` while leaving `STORAGE_BACKEND=d1`. Reads return the D1 value but synchronously compare the gateway value; writes go only to D1. Inspect structured `storage.shadow` events for `match`, `mismatch`, and `shadow_error`, then unset the flag. Do not enable this on unfrozen data unless divergence from new D1 writes is expected, and do not leave it enabled when the Mongo gateway becomes primary.

## 7. Configure the Cloudflare preview Worker

Store the gateway URL and service token as preview secrets:

```bash
npx wrangler secret put MONGODB_GATEWAY_URL --env preview
npx wrangler secret put MONGODB_GATEWAY_SERVICE_TOKEN --env preview
```

The gateway URL must be HTTPS. Keep `BETTER_AUTH_SECRET` identical in the Worker and gateway. Do not change `STORAGE_BACKEND` yet.

## 8. Rehearse authentication and Dash

In Better Auth Dash, create the preview project with:

- project name: `Tableplan Preview` (or another unambiguous environment-specific name);
- base URL: `https://family-meal-planner-preview.christkv.workers.dev`;
- auth base path: `/api/auth` when the dialog asks for it;
- API key: use the value issued/shown by the wizard, unchanged.

Store that API key as `BETTER_AUTH_API_KEY` on both the gateway and the preview Worker, redeploy both, and then let the wizard perform ownership verification. The plugin route is always registered, including before the key is configured, but successful ownership verification requires the configured key to match the hash in Dash's signed request.

With a temporary preview deployment pointed at the staged MongoDB database, verify the same-origin proxy:

```bash
curl -i https://family-meal-planner-preview.christkv.workers.dev/api/auth/dash/validate
curl -i https://family-meal-planner-preview.christkv.workers.dev/api/auth/get-session
```

The Dash validation endpoint must no longer return 404. A manual `curl` without Dash's signed `Authorization: Bearer ...` token should return 401; that proves the route exists but does not complete verification. A 404 means the new application/gateway build is not active or the auth proxy is not reaching the gateway. Complete ownership verification using the public application base URL, never the private gateway URL.

## 9. Final maintenance-window cutover

1. Announce the preview maintenance window. Set `MIGRATION_MAINTENANCE_MODE=true` and deploy; non-read requests return 503.
2. Pause new queue/workflow dispatch and wait for in-flight recipe ingestion and email jobs to finish.
3. Export D1 again, materialize, snapshot, load, and verify using the commands above.
4. Change preview `STORAGE_BACKEND` in `wrangler.jsonc` from `d1` to `mongodb-gateway` and deploy while maintenance remains enabled.
5. Run health, authentication, catalog search, private recipe, meal plan, shopping, invitation, API-key, MCP, ingestion, PDF, and email smoke tests.
6. If any acceptance check fails, switch `STORAGE_BACKEND` back to `d1` before reopening writes. Investigate and repeat the frozen migration.
7. If all checks pass, set `MIGRATION_MAINTENANCE_MODE=false`, deploy, and monitor errors, latency, gateway instance count, connection usage, queue retries, and Atlas Search for at least one full usage cycle.

Once MongoDB writes are reopened, D1 is stale. Do not perform an automatic rollback to D1; first freeze writes and reconcile MongoDB changes. This is why D1 deletion is a separate approval gate.

## 10. Production and retirement gate

Repeat every step with isolated production resources and production secrets. After the agreed rollback/retention window and a verified backup restore:

1. Export and retain a final encrypted D1 archive according to policy.
2. Confirm no runtime caller uses `env.DB`; D1 references should exist only in the compatibility adapter, old migrations, and migration tooling.
3. Obtain explicit approval before removing the D1 binding/database, D1 adapter, SQL migrations, Wrangler D1 scripts, and old import path.
4. Remove the compatibility code in a separate reviewed change. Resource deletion is irreversible and is not performed by this implementation.
