#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/remote-deploy.sh"

properties_file="${1:-$TABLEPLAN_PROJECT_ROOT/deploy/application.properties}"
inventory="${2:-$TABLEPLAN_DEFAULT_INVENTORY}"
[[ -f "$properties_file" ]] || {
    echo "Properties file not found: $properties_file" >&2
    echo "Copy deploy/application.properties.example to deploy/application.properties first." >&2
    exit 1
}
tableplan_load_servers "$inventory"

for index in "${!TABLEPLAN_SERVER_NAMES[@]}"; do
    name="${TABLEPLAN_SERVER_NAMES[$index]}"
    target="${TABLEPLAN_SERVER_TARGETS[$index]}"
    identity="${TABLEPLAN_SERVER_IDENTITIES[$index]}"
    app_port="${TABLEPLAN_SERVER_APP_PORTS[$index]}"
    ssh_port="${TABLEPLAN_SERVER_SSH_PORTS[$index]}"
    remote_upload="/tmp/tableplan-application.properties.$$"

    echo "== [$name] deploy application.properties to $target"
    tableplan_scp "$properties_file" "$target" "$identity" "$ssh_port" "$remote_upload"
    tableplan_ssh "$target" "$identity" "$ssh_port" bash -s -- "$remote_upload" "$app_port" <<'REMOTE'
set -euo pipefail
upload="$1"
app_port="$2"
destination="/opt/tableplan/shared/application.properties"
previous="/opt/tableplan/shared/application.properties.previous"

[[ -d /opt/tableplan/shared ]] || {
    echo "Remote server is not bootstrapped. Run scripts/bootstrap-remote.sh first." >&2
    exit 1
}
if [[ -f "$destination" ]]; then
    cp --preserve=mode,ownership "$destination" "$previous"
fi
install -o tableplan -g tableplan -m 0600 "$upload" "$destination.new"
mv -f "$destination.new" "$destination"
rm -f "$upload"

if [[ ! -f /opt/tableplan/current/tableplan.jar ]]; then
    echo "Properties staged; no deployed JAR exists yet."
    exit 0
fi

systemctl restart tableplan.service
for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "http://127.0.0.1:${app_port}/health/ready" >/dev/null; then
        rm -f "$previous"
        echo "Tableplan is ready with the new properties."
        exit 0
    fi
    sleep 2
done

journalctl -u tableplan.service -n 80 --no-pager >&2 || true
if [[ -f "$previous" ]]; then
    install -o tableplan -g tableplan -m 0600 "$previous" "$destination"
    rm -f "$previous"
    systemctl restart tableplan.service
    echo "Properties deployment failed; the previous file was restored." >&2
else
    echo "Properties deployment failed and no previous file was available." >&2
fi
exit 1
REMOTE
done
