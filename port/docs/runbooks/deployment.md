# Deployment Runbook

1. Run `./gradlew clean check :backend:bootJar`, then
   `./scripts/check-performance-budgets.sh`, and record the JAR SHA-256.
2. Scan dependencies and the runtime image; triage all high or critical findings.
3. Restore the latest backup into an isolated database and run `migrate --dry-run`.
4. Run `migrate` as a one-shot operator job. Re-run dry-run and confirm no additive drift.
5. Deploy the immutable image with `JOBS_ENABLED=false`; verify liveness/readiness and smoke.
6. Enable jobs on only the designated worker replica.
7. Exercise login, recipe search, plan, shopping, share, email sandbox, PDF, and MCP.
8. Shift traffic progressively while monitoring HTTP errors/latency, Mongo pool, and job depth.

Required secrets are injected at runtime. Never place Mongo, OAuth, delivery, API-key, email,
or object-store credentials in the image or repository.

Connection budget: `replicas × TABLEPLAN_MONGO_MAX_POOL_SIZE`, plus operator jobs, must stay
below the deployment's MongoDB connection allowance with at least 20% headroom.

Virtual threads are enabled by default and can be disabled with
`TABLEPLAN_VIRTUAL_THREADS=false` during a controlled rollback. Monitor
`tableplan.operation.duration` histograms for recipe search/facets, shopping aggregation,
and ingestion review alongside HTTP latency and Mongo pool saturation.
