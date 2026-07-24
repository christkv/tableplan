#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/remote-deploy.sh"

inventory="${1:-$TABLEPLAN_DEFAULT_INVENTORY}"
service_file="$TABLEPLAN_PROJECT_ROOT/deploy/tableplan.service"
tableplan_load_servers "$inventory"

for index in "${!TABLEPLAN_SERVER_NAMES[@]}"; do
    name="${TABLEPLAN_SERVER_NAMES[$index]}"
    target="${TABLEPLAN_SERVER_TARGETS[$index]}"
    identity="${TABLEPLAN_SERVER_IDENTITIES[$index]}"
    ssh_port="${TABLEPLAN_SERVER_SSH_PORTS[$index]}"
    remote_service="/tmp/tableplan.service.$$"

    echo "== [$name] bootstrap $target"
    tableplan_scp "$service_file" "$target" "$identity" "$ssh_port" "$remote_service"
    tableplan_ssh "$target" "$identity" "$ssh_port" bash -s -- "$remote_service" <<'REMOTE'
set -euo pipefail
service_file="$1"

[[ "$(id -u)" == "0" ]] || {
    echo "Remote bootstrap must run as root." >&2
    exit 1
}
[[ -r /etc/os-release ]] || {
    echo "Cannot identify the remote operating system." >&2
    exit 1
}
source /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || {
    echo "This bootstrap supports Ubuntu; found ${PRETTY_NAME:-unknown}." >&2
    exit 1
}

java_is_compatible=false
if [[ -x /usr/bin/java ]]; then
    java_version="$(/usr/bin/java -version 2>&1 | head -n 1)"
    if [[ "$java_version" =~ \"([0-9]+) ]] && ((BASH_REMATCH[1] >= 21)); then
        java_is_compatible=true
    fi
fi
if [[ "$java_is_compatible" == false ]] || ! command -v curl >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install --yes --no-install-recommends openjdk-21-jre-headless curl ca-certificates
fi

java_version="$(/usr/bin/java -version 2>&1 | head -n 1)"
if [[ ! "$java_version" =~ \"([0-9]+) ]] || ((BASH_REMATCH[1] < 21)); then
    echo "Tableplan requires Java 21 or newer; found: $java_version" >&2
    exit 1
fi
command -v systemctl >/dev/null 2>&1 || {
    echo "systemd is required on the remote server." >&2
    exit 1
}

if ! id tableplan >/dev/null 2>&1; then
    useradd --system --home-dir /opt/tableplan --shell /usr/sbin/nologin tableplan
fi
install -d -o tableplan -g tableplan -m 0750 /opt/tableplan
install -d -o tableplan -g tableplan -m 0750 /opt/tableplan/releases
install -d -o tableplan -g tableplan -m 0750 /opt/tableplan/shared
install -d -o tableplan -g tableplan -m 0750 /opt/tableplan/shared/artifacts
install -o root -g root -m 0644 "$service_file" /etc/systemd/system/tableplan.service
rm -f "$service_file"
systemctl daemon-reload
systemctl enable tableplan.service
echo "Tableplan service installed. Deploy application.properties and the JAR before starting it."
REMOTE
done
