# Local Development

## Prerequisites

Java 21, Node 22, npm 10, and either Docker Compose or a MongoDB 8 replica set.

## Start

Create an optional local environment file from the checked-in example:

```bash
cp .env.example .env
```

The application loads `.env` from its current working directory before Spring starts.
Existing process environment variables and JVM `-D` properties take precedence.

```bash
docker compose up -d
./gradlew :backend:bootJar
java -jar backend/build/libs/tableplan.jar migrate
JOBS_ENABLED=true java -jar backend/build/libs/tableplan.jar serve
```

When Cloudflare Email Service credentials are not configured, confirmation and password-reset emails are captured in the
application log. Their single-use local links are printed so the flows can be exercised during
development. Production refuses to start without a Cloudflare account ID, dedicated Email
Sending API token, and sender address.

For split hot reload, use one browser-visible origin even though two processes run:

```dotenv
TABLEPLAN_PUBLIC_ORIGIN=http://localhost:5173
SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_REDIRECT_URI=http://localhost:5173/login/oauth2/code/google
TABLEPLAN_SESSION_COOKIE_SECURE=false
```

Register that exact callback URI in the local Google OAuth web client. Run
`./gradlew :backend:bootRun` from the repository root and `npm run dev` in `frontend`, then
open only `http://localhost:5173`. Vite proxies API, MCP, OAuth initiation, and the OAuth
callback to Spring Boot. Do not mix `localhost` and `127.0.0.1` in browser URLs.

For packaged local testing, set both origins to `http://localhost:9090`, build the JAR, and
open Spring Boot directly. A separate Google OAuth client for local development is recommended.

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

`sync-indexes` also creates or updates the `recipes_v1` MongoDB Search index. Its `name`
and `_id` fields are indexed as case-sensitive `token` mappings so relevance-sorted
searches can use stable sequence-token pagination.
