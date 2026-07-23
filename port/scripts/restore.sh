#!/usr/bin/env bash
set -euo pipefail

: "${TABLEPLAN_MONGO_URI:?TABLEPLAN_MONGO_URI is required}"
: "${TABLEPLAN_RESTORE_DATABASE:?TABLEPLAN_RESTORE_DATABASE is required}"
archive="${1:?usage: restore.sh ARCHIVE}"
case "$TABLEPLAN_RESTORE_DATABASE" in
  application|application_preview)
    printf 'Refusing restore into protected database %s\n' "$TABLEPLAN_RESTORE_DATABASE" >&2
    exit 2
    ;;
esac
test -f "$archive"
mongorestore --uri="$TABLEPLAN_MONGO_URI" --nsFrom='application.*' --nsTo="$TABLEPLAN_RESTORE_DATABASE.*" --archive="$archive" --gzip --drop
printf 'Restore completed into isolated database %s\n' "$TABLEPLAN_RESTORE_DATABASE"
