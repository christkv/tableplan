#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/remote-deploy.sh"

inventory="$TABLEPLAN_DEFAULT_INVENTORY"
skip_build=false
for argument in "$@"; do
    case "$argument" in
        --skip-build) skip_build=true ;;
        --inventory=*) inventory="${argument#*=}" ;;
        *)
            echo "Unknown argument: $argument" >&2
            echo "Usage: $0 [--skip-build] [--inventory=/path/to/servers.conf]" >&2
            exit 2
            ;;
    esac
done

jar="$TABLEPLAN_PROJECT_ROOT/backend/build/libs/tableplan.jar"
if [[ "$skip_build" == false ]]; then
    echo "== build and verify Tableplan"
    (
        cd "$TABLEPLAN_PROJECT_ROOT"
        ./gradlew clean check :backend:bootJar
        ./scripts/check-performance-budgets.sh
    )
fi
[[ -f "$jar" ]] || {
    echo "JAR not found: $jar" >&2
    echo "Build it first or omit --skip-build." >&2
    exit 1
}

tableplan_load_servers "$inventory"
commit="$(git -C "$TABLEPLAN_PROJECT_ROOT" rev-parse --short=12 HEAD)"
release="$(date -u +%Y%m%dT%H%M%SZ)-$commit"
checksum="$(tableplan_sha256 "$jar")"

for index in "${!TABLEPLAN_SERVER_NAMES[@]}"; do
    name="${TABLEPLAN_SERVER_NAMES[$index]}"
    target="${TABLEPLAN_SERVER_TARGETS[$index]}"
    identity="${TABLEPLAN_SERVER_IDENTITIES[$index]}"
    app_port="${TABLEPLAN_SERVER_APP_PORTS[$index]}"
    ssh_port="${TABLEPLAN_SERVER_SSH_PORTS[$index]}"
    remote_upload="/tmp/tableplan-${release}.jar"

    echo "== [$name] upload release $release to $target"
    echo "   copy:    $jar"
    echo "   upload:  $target:$remote_upload"
    echo "   install: $target:/opt/tableplan/releases/$release/tableplan.jar"
    echo "   activate: $target:/opt/tableplan/current -> /opt/tableplan/releases/$release"
    tableplan_scp "$jar" "$target" "$identity" "$ssh_port" "$remote_upload"
    tableplan_ssh "$target" "$identity" "$ssh_port" \
        bash -s -- "$remote_upload" "$release" "$checksum" "$app_port" <<'REMOTE'
set -euo pipefail
upload="$1"
release="$2"
expected_checksum="$3"
app_port="$4"
root="/opt/tableplan"
release_directory="$root/releases/$release"
previous_target="$(readlink -f "$root/current" 2>/dev/null || true)"

[[ -f "$root/shared/application.properties" ]] || {
    echo "application.properties is missing. Deploy it before the application JAR." >&2
    exit 1
}
configured_server_port="$(
    awk -F= '
        /^[[:space:]]*[#!]/ { next }
        {
            key = $1
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
            if (key == "server.port") {
                value = substr($0, index($0, "=") + 1)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
                resolved = value
            }
        }
        END { print resolved }
    ' "$root/shared/application.properties"
)"
configured_server_port="${configured_server_port:-9090}"
if [[ "$configured_server_port" != "$app_port" ]]; then
    rm -f "$upload"
    echo "Port mismatch: remote application.properties configures server.port=$configured_server_port" >&2
    echo "but the server inventory configures application port $app_port." >&2
    echo "Deploy the current application.properties before deploying the JAR." >&2
    exit 1
fi
if ((app_port < 1024)); then
    ambient_capabilities="$(systemctl show tableplan.service --property=AmbientCapabilities --value)"
    if [[ " $ambient_capabilities " != *" cap_net_bind_service "* ]]; then
        rm -f "$upload"
        echo "The installed tableplan.service cannot bind privileged port $app_port." >&2
        echo "Run scripts/bootstrap-remote.sh to install the updated systemd unit first." >&2
        exit 1
    fi
fi
actual_checksum="$(sha256sum "$upload" | awk '{print $1}')"
[[ "$actual_checksum" == "$expected_checksum" ]] || {
    echo "Uploaded JAR checksum mismatch." >&2
    exit 1
}

install -d -o tableplan -g tableplan -m 0750 "$release_directory"
install -o tableplan -g tableplan -m 0440 "$upload" "$release_directory/tableplan.jar"
printf '%s\n' "$expected_checksum" > "$release_directory/tableplan.jar.sha256"
chown tableplan:tableplan "$release_directory/tableplan.jar.sha256"
chmod 0440 "$release_directory/tableplan.jar.sha256"
rm -f "$upload"

ln -sfn "$release_directory" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
echo "Installed release JAR: $release_directory/tableplan.jar"
echo "Activated release: $root/current -> $release_directory"
systemctl reset-failed tableplan.service || true
systemctl restart tableplan.service

for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "http://127.0.0.1:${app_port}/health/ready" >/dev/null; then
        echo "Tableplan release $release is ready."
        exit 0
    fi
    sleep 2
done

journalctl -u tableplan.service -n 80 --no-pager >&2 || true
if [[ -n "$previous_target" && -f "$previous_target/tableplan.jar" ]]; then
    ln -sfn "$previous_target" "$root/current.next"
    mv -Tf "$root/current.next" "$root/current"
    systemctl reset-failed tableplan.service || true
    systemctl restart tableplan.service
    echo "Release failed health checks; rolled back to $previous_target." >&2
else
    echo "Release failed health checks and no previous release was available." >&2
fi
exit 1
REMOTE
done

echo "Deployment complete: $release"
