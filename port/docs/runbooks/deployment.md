# Deployment Runbook

## SSH/SCP server layout

Remote instances use this persistent layout:

```text
/opt/tableplan/
├── current -> /opt/tableplan/releases/<release>
├── releases/<release>/tableplan.jar
└── shared/
    ├── application.properties
    └── artifacts/
```

`application.properties` is not part of a release and remains in place when the JAR changes.
The systemd unit starts the application with:

```text
--spring.config.additional-location=file:/opt/tableplan/shared/application.properties
```

This is an additional Spring configuration location: properties in the external file override
the defaults packaged in `application.yaml`. The file is owned by the unprivileged `tableplan`
user with mode `0600`.

The inventory at `deploy/servers.conf` uses:

```text
name|ssh target|identity file|application port|ssh port
primary|root@65.109.133.135|~/.ssh/id_ed25519_hetzner|9090|22
```

Add one row per server. Deployments run sequentially. Host-key checking remains enabled;
the first connection accepts and records a new host key, while changed keys fail.

## First installation

Install a Java 21 runtime and a TLS reverse proxy such as Caddy or nginx on the server. The
example properties bind Spring Boot to `127.0.0.1:9090`; only the reverse proxy should be
publicly reachable.

Create the private local configuration:

```bash
cp deploy/application.properties.example deploy/application.properties
chmod 600 deploy/application.properties
```

Fill in the public origin, MongoDB URL, OAuth credentials, storage, email, and provider
settings. Passwords embedded in URLs must be percent-encoded.

Bootstrap the remote directories, service user, and systemd unit:

```bash
./scripts/bootstrap-remote.sh
```

Bootstrap does not start the service. Deploy configuration and application independently:

```bash
./scripts/deploy-properties.sh deploy/application.properties
./scripts/deploy-application.sh
```

The application deploy performs the full build and tests, uploads the JAR with SCP, verifies
its SHA-256 on the server, switches the `current` symlink atomically, restarts systemd, and
checks `/health/ready`. A failed health check switches back to the previous release.

To redeploy an already verified local JAR:

```bash
./scripts/deploy-application.sh --skip-build
```

To use another inventory:

```bash
./scripts/bootstrap-remote.sh /path/to/servers.conf
./scripts/deploy-properties.sh /path/to/application.properties /path/to/servers.conf
./scripts/deploy-application.sh --inventory=/path/to/servers.conf
```

Configuration deployment is also atomic. If a running release fails health checks after a
configuration update, the prior `application.properties` is restored.

Inspect a server with:

```bash
ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.133.135 \
  'systemctl status tableplan --no-pager; journalctl -u tableplan -n 100 --no-pager'
```

The scripts deliberately do not install Java, configure DNS/TLS/firewalls, migrate MongoDB, or
upload backup material. Those remain explicit operator actions.

## Release procedure

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

The production browser, SPA, API, and OAuth endpoints must share one HTTPS origin. Configure:

```text
SPRING_PROFILES_ACTIVE=prod
TABLEPLAN_PUBLIC_ORIGIN=https://tablerhythm.com
SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_REDIRECT_URI=https://app.example.com/login/oauth2/code/google
TABLEPLAN_SESSION_COOKIE_SECURE=true
```

Register the exact HTTPS callback in a production Google OAuth web client that is separate
from local development. The trusted edge proxy must remove inbound `Forwarded` and
`X-Forwarded-*` headers before setting its own. Route the complete origin to Spring Boot; the
packaged JAR serves both the SPA and API, so production does not require CORS.

The OAuth authorization request is transient servlet-session state. Run a single web replica
until that state is moved to a shared one-time repository, or configure temporary load-balancer
affinity for OAuth initiation and callback. Table Rhythm application sessions are already
Mongo-backed and do not require affinity after the callback.

Connection budget: `replicas × TABLEPLAN_MONGO_MAX_POOL_SIZE`, plus operator jobs, must stay
below the deployment's MongoDB connection allowance with at least 20% headroom.

Virtual threads are enabled by default and can be disabled with
`TABLEPLAN_VIRTUAL_THREADS=false` during a controlled rollback. Monitor
`tableplan.operation.duration` histograms for recipe search/facets, shopping aggregation,
and ingestion review alongside HTTP latency and Mongo pool saturation.
