# Tableplan Spring Boot Port

The replacement runtime is implemented in Kotlin/Spring Boot with an embedded React/Vite
SPA, direct MongoDB persistence, Mongo-leased jobs, S3-compatible artifacts, SMTP delivery,
PDF export, and MCP.

## Build and run

```bash
./gradlew check :backend:bootJar
./scripts/check-performance-budgets.sh
docker compose up -d
java -jar backend/build/libs/tableplan.jar migrate
JOBS_ENABLED=true java -jar backend/build/libs/tableplan.jar serve
```

Operator modes use the same JAR:

```bash
java -jar backend/build/libs/tableplan.jar migrate --dry-run
java -jar backend/build/libs/tableplan.jar sync-indexes --dry-run
java -jar backend/build/libs/tableplan.jar import-catalog --file=/data/recipes.csv --dry-run
java -jar backend/build/libs/tableplan.jar import-catalog --file=/data/recipes.csv
java -jar backend/build/libs/tableplan.jar refresh-recipe-facets
java -jar backend/build/libs/tableplan.jar jobs-status
java -jar backend/build/libs/tableplan.jar replay-job --id=JOB_ID
```

The database named `application` requires `--allow-production` for operator writes.

## Repository map

- `backend` — Spring MVC API, security, application services, Mongo persistence, workers,
  providers, MCP, and executable JAR.
- `odm` — independent hardened string-ID Mongo mapper.
- `frontend` — isolated full React/Vite page port embedded by the Gradle build; see its
  [route and development guide](frontend/README.md).
- `contracts` — source baseline, executable CSV fixture, and checked-in 64-operation OpenAPI.
- `implementation-plan` — phase-by-phase design and gates.
- `docs/runbooks` — local, deployment, backup/restore, incident, and cutover procedures.

See [implementation status](docs/implementation-status.md), the
[local verification report](docs/verification-report-2026-07-23.md), and
[implementation decisions](docs/architecture-decisions.md). The completed query, bundle,
rendering, polling, packaging, and observability work is recorded in the
[performance implementation](docs/performance-implementation.md).

Production cutover was not attempted: it requires production credentials, restored-copy
evidence, owners, a change window, and traffic authority.
