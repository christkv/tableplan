# Local Development

## Prerequisites

Java 21, Node 22, npm 10, and either Docker Compose or a MongoDB 8 replica set.

## Start

```bash
docker compose up -d
./gradlew :backend:bootJar
java -jar backend/build/libs/tableplan.jar migrate
JOBS_ENABLED=true java -jar backend/build/libs/tableplan.jar serve
```

For split hot reload, run `./gradlew :backend:bootRun` and `npm run dev` in `frontend`.
Vite proxies `/api` and `/mcp` to Spring Boot.

## Operator modes

```bash
java -jar backend/build/libs/tableplan.jar migrate --dry-run
java -jar backend/build/libs/tableplan.jar sync-indexes --dry-run
java -jar backend/build/libs/tableplan.jar import-catalog --file=/data/recipes.csv --dry-run
java -jar backend/build/libs/tableplan.jar import-catalog --file=/data/recipes.csv --batch-size=500
java -jar backend/build/libs/tableplan.jar refresh-recipe-facets
```

The production database name `application` additionally requires `--allow-production`.
Operator modes do not start the HTTP server or job workers.
