# Tableplan scripts

This directory contains the local verification, backup, and Ubuntu deployment
scripts for Tableplan. Run all commands below from the repository root.

## Remote deployment overview

The deployment scripts use SSH and SCP. They do not require Docker on the
server.

The remote layout is:

```text
/opt/tableplan/
├── current -> /opt/tableplan/releases/<release>
├── releases/
│   └── <timestamp>-<git-sha>/
│       ├── tableplan.jar
│       └── tableplan.jar.sha256
└── shared/
    ├── application.properties
    └── artifacts/
```

`application.properties` is server-local configuration. It is deployed
separately from the application JAR and is retained when a new application
release is installed.

The application runs as the unprivileged `tableplan` user under systemd.
Systemd starts it at server boot and restarts it five seconds after an
unexpected exit. Restart attempts are limited to ten within five minutes. An
explicit `systemctl stop tableplan` remains stopped.

## Prerequisites

The local machine needs:

- Bash, SSH, and SCP.
- The SSH private key configured in `deploy/servers.conf`.
- Java 21 and the Gradle wrapper for application builds.

The remote machine needs:

- Ubuntu and systemd.
- Root SSH access during bootstrap.
- Outbound apt access.
- Network access to MongoDB and any configured external services.

The bootstrap installs `openjdk-21-jre-headless`, `curl`, and
`ca-certificates` when needed. DNS, TLS, firewall rules, MongoDB, and a reverse
proxy such as Caddy or nginx remain separate operator responsibilities.

## Server inventory

Servers are listed in `deploy/servers.conf`:

```text
# name|ssh target|identity file|application port|ssh port
primary|root@65.109.133.135|~/.ssh/id_ed25519_hetzner|9090|22
```

Add one row for each server. Application deployments are performed
sequentially in file order.

The fields are:

1. A unique display name.
2. The SSH target in `user@host` form. Bootstrap currently requires `root`.
3. The SSH private-key path.
4. The port where Spring Boot listens on the server.
5. The SSH port.

Use separate inventory files when environments or servers require different
configuration:

```text
deploy/servers.preview.conf
deploy/servers.production.conf
```

## First installation

Create a private properties file:

```bash
cp deploy/application.properties.example deploy/application.properties
```

Edit at least:

- `tableplan.public-origin`
- Google OAuth client ID, secret, and redirect URI
- MongoDB URI and database
- artifact-storage settings
- extraction and SMTP settings when enabled

The local `deploy/application.properties` file is ignored by Git. Never commit
production credentials.

Bootstrap all servers in the default inventory:

```bash
./scripts/bootstrap-remote.sh
```

Or use a specific inventory:

```bash
./scripts/bootstrap-remote.sh deploy/servers.production.conf
```

Bootstrap creates the `tableplan` user and remote directories, installs the
systemd unit, reloads systemd, and enables the service at boot. It deliberately
does not start an incomplete installation.

Deploy the configuration:

```bash
./scripts/deploy-properties.sh deploy/application.properties
```

With a specific inventory:

```bash
./scripts/deploy-properties.sh \
  deploy/application.production.properties \
  deploy/servers.production.conf
```

Deploy the application:

```bash
./scripts/deploy-application.sh
```

This builds and tests the project, checks frontend performance budgets,
uploads the JAR, verifies its SHA-256 checksum, activates the new release,
starts or restarts the service, and waits for `/health/ready`.

## Normal releases

Deploy a tested application release:

```bash
./scripts/deploy-application.sh
```

Deploy to a different inventory:

```bash
./scripts/deploy-application.sh \
  --inventory=deploy/servers.production.conf
```

To deploy an already built `backend/build/libs/tableplan.jar` without running
the build again:

```bash
./scripts/deploy-application.sh --skip-build
```

Use `--skip-build` only when the local JAR is known to match the source revision
being deployed.

If the new release does not become ready within approximately 60 seconds, the
script prints recent service logs and switches the `current` symlink back to
the previous release.

## Updating server configuration

Configuration can be changed without rebuilding the application:

```bash
./scripts/deploy-properties.sh deploy/application.properties
```

The script installs the file as:

```text
/opt/tableplan/shared/application.properties
```

It is owned by `tableplan:tableplan` with mode `0600`. If an application is
already installed, the service is restarted and its readiness is checked. A
failed configuration update restores the previous properties file.

The external properties file is loaded explicitly by the systemd command:

```text
--spring.config.additional-location=file:/opt/tableplan/shared/application.properties
```

## Operating the service

Check status:

```bash
ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.133.135 \
  'systemctl status tableplan --no-pager'
```

Follow logs:

```bash
ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.133.135 \
  'journalctl -u tableplan -f'
```

Show recent logs:

```bash
ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.133.135 \
  'journalctl -u tableplan -n 200 --no-pager'
```

Restart or stop the application:

```bash
ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.133.135 \
  'systemctl restart tableplan'

ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.133.135 \
  'systemctl stop tableplan'
```

Check readiness directly on the server:

```bash
ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.133.135 \
  'curl --fail --silent --show-error http://127.0.0.1:9090/health/ready'
```

The application binds to `127.0.0.1:9090` in the example configuration.
Terminate public HTTPS at the reverse proxy and forward requests to that
address. The public origin and Google OAuth redirect URI must use the public
HTTPS hostname.

## Adding another server

1. Add the server to an inventory file.
2. Verify its SSH host fingerprint and key access.
3. Run `bootstrap-remote.sh` for that inventory.
4. Deploy that server's properties.
5. Deploy the application.
6. Verify systemd status, readiness, and the public HTTPS endpoint.

If servers need different credentials or origins, use one properties file and
one inventory file per deployment group rather than deploying a shared
properties file to every server.

## Other scripts

### `check-performance-budgets.sh`

Checks the built frontend size, source maps, and packaged JAR assets:

```bash
./gradlew :backend:bootJar
./scripts/check-performance-budgets.sh
```

### `smoke.sh`

Checks liveness, readiness, recipe search, and OpenAPI:

```bash
TABLEPLAN_PUBLIC_ORIGIN=https://tableplan.example.com ./scripts/smoke.sh
```

It defaults to `http://127.0.0.1:9090`.

### `backup.sh`

Creates a compressed MongoDB archive and SHA-256 file. It requires MongoDB
Database Tools:

```bash
TABLEPLAN_MONGO_URI='mongodb://...' \
TABLEPLAN_MONGO_DATABASE='application' \
./scripts/backup.sh /secure/backups/tableplan-2026-07-24
```

### `restore.sh`

Restores an archive into an isolated database. The script refuses to restore
into `application` or `application_preview`:

```bash
TABLEPLAN_MONGO_URI='mongodb://...' \
TABLEPLAN_RESTORE_DATABASE='application_restore_test' \
./scripts/restore.sh /secure/backups/tableplan-2026-07-24/tableplan.archive
```

Validate a restored copy before considering any production restore or cutover.

## Troubleshooting

If bootstrap fails, confirm the target is Ubuntu, the SSH user is root, and apt
can reach Ubuntu repositories.

If deployment fails before upload, run:

```bash
./gradlew clean check :backend:bootJar
./scripts/check-performance-budgets.sh
```

If the service repeatedly restarts, inspect:

```bash
systemctl status tableplan --no-pager
journalctl -u tableplan -n 200 --no-pager
```

Typical causes are an invalid external property, unavailable MongoDB, invalid
OAuth or storage credentials, a port conflict, or insufficient access to an
external service.

If OAuth succeeds but the browser is not authenticated, verify that the public
origin, Google redirect URI, reverse-proxy headers, cookie security setting,
and browser-visible hostname all agree.
