#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist="$root/frontend/dist"
jar="$root/backend/build/libs/tableplan.jar"

[[ -f "$dist/index.html" ]] || { echo "frontend/dist is missing; build the frontend first" >&2; exit 1; }
[[ -f "$jar" ]] || { echo "tableplan.jar is missing; build :backend:bootJar first" >&2; exit 1; }

entry_path="$(sed -nE 's#.*src="(/assets/[^"]+\.js)".*#\1#p' "$dist/index.html" | head -n 1)"
[[ -n "$entry_path" ]] || { echo "could not resolve the frontend entry chunk" >&2; exit 1; }
entry="$dist$entry_path"
entry_gzip="$(gzip -c "$entry" | wc -c)"
total_js_gzip=0
while IFS= read -r file; do
  size="$(gzip -c "$file" | wc -c)"
  total_js_gzip=$((total_js_gzip + size))
done < <(find "$dist/assets" -maxdepth 1 -type f -name '*.js' | sort)

map_count="$(find "$dist" -type f -name '*.map' | wc -l)"
static_bytes=0
while IFS= read -r -d '' file; do
  file_bytes="$(wc -c < "$file")"
  static_bytes=$((static_bytes + file_bytes))
done < <(find "$dist" -type f -print0)
dist_assets="$(find "$dist/assets" -maxdepth 1 -type f | wc -l)"
jar_assets="$(unzip -Z1 "$jar" | awk '/^BOOT-INF\/classes\/static\/assets\/./ {count++} END {print count + 0}')"

fail=0
check_max() {
  local label="$1" actual="$2" maximum="$3"
  if (( actual > maximum )); then
    echo "FAIL $label: $actual exceeds $maximum" >&2
    fail=1
  else
    echo "PASS $label: $actual <= $maximum"
  fi
}

check_max "entry JavaScript gzip bytes" "$entry_gzip" 85000
check_max "all JavaScript gzip bytes" "$total_js_gzip" 140000
check_max "frontend static bytes" "$static_bytes" 1000000
check_max "source-map files" "$map_count" 0

if (( dist_assets != jar_assets )); then
  echo "FAIL packaged asset count: dist=$dist_assets jar=$jar_assets" >&2
  fail=1
else
  echo "PASS packaged asset count: $jar_assets"
fi

exit "$fail"
