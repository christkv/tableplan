#!/usr/bin/env bash
set -euo pipefail

: "${TABLEPLAN_MONGO_URI:?TABLEPLAN_MONGO_URI is required}"
: "${TABLEPLAN_MONGO_DATABASE:?TABLEPLAN_MONGO_DATABASE is required}"
destination="${1:?usage: backup.sh DESTINATION_DIRECTORY}"
mkdir -p "$destination"
mongodump --uri="$TABLEPLAN_MONGO_URI" --db="$TABLEPLAN_MONGO_DATABASE" --archive="$destination/tableplan.archive" --gzip
sha256sum "$destination/tableplan.archive" > "$destination/tableplan.archive.sha256"
printf 'Backup written to %s\n' "$destination/tableplan.archive"
