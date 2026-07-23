#!/usr/bin/env bash
set -euo pipefail

origin="${TABLEPLAN_PUBLIC_ORIGIN:-http://127.0.0.1:9090}"
curl --fail --silent --show-error "$origin/health/live"
curl --fail --silent --show-error "$origin/health/ready"
curl --fail --silent --show-error "$origin/api/v1/recipes/search?limit=1"
curl --fail --silent --show-error "$origin/api/v1/openapi.json"
printf '\nTableplan smoke checks passed.\n'
