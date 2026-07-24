#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/remote-deploy.sh"

inventory="$TABLEPLAN_DEFAULT_INVENTORY"
skip_build=false
properties_file=""
for argument in "$@"; do
    case "$argument" in
        --skip-build) skip_build=true ;;
        --inventory=*) inventory="${argument#*=}" ;;
        --properties=*) properties_file="${argument#*=}" ;;
        *)
            echo "Unknown argument: $argument" >&2
            echo "Usage: $0 [--skip-build] [--inventory=/path/to/servers.conf] [--properties=/path/to/application.properties]" >&2
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
if [[ -n "$properties_file" ]]; then
    [[ -f "$properties_file" ]] || {
        echo "Properties file not found: $properties_file" >&2
        exit 1
    }
    property_value() {
        local property_name="$1"
        awk -v wanted="$property_name" '
            /^[[:space:]]*[#!]/ { next }
            {
                separator = index($0, "=")
                if (separator == 0) next
                key = substr($0, 1, separator - 1)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
                if (key == wanted) {
                    value = substr($0, separator + 1)
                    gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
                    resolved = value
                }
            }
            END { print resolved }
        ' "$properties_file"
    }
    cloudflare_account_id="$(property_value tableplan.email.cloudflare-account-id)"
    cloudflare_api_token="$(property_value tableplan.email.cloudflare-api-token)"
    email_from_address="$(property_value tableplan.email.from-address)"
    missing_email_properties=()
    [[ -n "$cloudflare_account_id" ]] ||
        missing_email_properties+=("tableplan.email.cloudflare-account-id")
    [[ -n "$cloudflare_api_token" ]] ||
        missing_email_properties+=("tableplan.email.cloudflare-api-token")
    [[ -n "$email_from_address" ]] ||
        missing_email_properties+=("tableplan.email.from-address")
    if ((${#missing_email_properties[@]} > 0)); then
        echo "Cloudflare email configuration is incomplete." >&2
        printf 'Missing: %s\n' "${missing_email_properties[@]}" >&2
        exit 1
    fi
fi

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
    remote_properties_upload=""
    properties_checksum=""
    if [[ -n "$properties_file" ]]; then
        remote_properties_upload="/tmp/tableplan-${release}.properties"
        properties_checksum="$(tableplan_sha256 "$properties_file")"
    fi

    echo "== [$name] upload release $release to $target"
    echo "   copy:    $jar"
    echo "   upload:  $target:$remote_upload"
    echo "   install: $target:/opt/tableplan/releases/$release/tableplan.jar"
    echo "   activate: $target:/opt/tableplan/current -> /opt/tableplan/releases/$release"
    tableplan_scp "$jar" "$target" "$identity" "$ssh_port" "$remote_upload"
    if [[ -n "$properties_file" ]]; then
        echo "   config:   $properties_file"
        echo "   install:  $target:/opt/tableplan/shared/application.properties"
        tableplan_scp "$properties_file" "$target" "$identity" "$ssh_port" "$remote_properties_upload"
    fi
    tableplan_ssh "$target" "$identity" "$ssh_port" \
        bash -s -- \
        "$remote_upload" \
        "$release" \
        "$checksum" \
        "$app_port" \
        "$remote_properties_upload" \
        "$properties_checksum" <<'REMOTE'
set -euo pipefail
upload="$1"
release="$2"
expected_checksum="$3"
app_port="$4"
properties_upload="$5"
expected_properties_checksum="$6"
root="/opt/tableplan"
release_directory="$root/releases/$release"
previous_target="$(readlink -f "$root/current" 2>/dev/null || true)"
properties_destination="$root/shared/application.properties"
properties_rollback="$root/shared/application.properties.rollback-$release"

[[ -f "$properties_destination" ]] || {
    echo "application.properties is missing. Deploy it before the application JAR." >&2
    exit 1
}
configuration_to_check="$properties_destination"
if [[ -n "$properties_upload" ]]; then
    configuration_to_check="$properties_upload"
fi
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
    ' "$configuration_to_check"
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
if [[ -n "$properties_upload" ]]; then
    actual_properties_checksum="$(sha256sum "$properties_upload" | awk '{print $1}')"
    [[ "$actual_properties_checksum" == "$expected_properties_checksum" ]] || {
        echo "Uploaded application.properties checksum mismatch." >&2
        exit 1
    }
fi

install -d -o tableplan -g tableplan -m 0750 "$release_directory"
install -o tableplan -g tableplan -m 0440 "$upload" "$release_directory/tableplan.jar"
printf '%s\n' "$expected_checksum" > "$release_directory/tableplan.jar.sha256"
chown tableplan:tableplan "$release_directory/tableplan.jar.sha256"
chmod 0440 "$release_directory/tableplan.jar.sha256"
rm -f "$upload"

if [[ -n "$properties_upload" ]]; then
    cp --preserve=mode,ownership "$properties_destination" "$properties_rollback"
    install -o tableplan -g tableplan -m 0600 "$properties_upload" "$properties_destination.new"
    mv -f "$properties_destination.new" "$properties_destination"
    rm -f "$properties_upload"
    echo "Installed coordinated properties: $properties_destination"
fi

ln -sfn "$release_directory" "$root/current.next"
mv -Tf "$root/current.next" "$root/current"
echo "Installed release JAR: $release_directory/tableplan.jar"
echo "Activated release: $root/current -> $release_directory"
systemctl reset-failed tableplan.service || true
systemctl restart tableplan.service

for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "http://127.0.0.1:${app_port}/health/ready" >/dev/null; then
        rm -f "$properties_rollback"
        echo "Tableplan release $release is ready."
        exit 0
    fi
    sleep 2
done

journalctl -u tableplan.service -n 80 --no-pager >&2 || true
if [[ -n "$previous_target" && -f "$previous_target/tableplan.jar" ]]; then
    ln -sfn "$previous_target" "$root/current.next"
    mv -Tf "$root/current.next" "$root/current"
    if [[ -f "$properties_rollback" ]]; then
        install -o tableplan -g tableplan -m 0600 "$properties_rollback" "$properties_destination"
        rm -f "$properties_rollback"
        echo "Restored previous properties: $properties_destination" >&2
    fi
    systemctl reset-failed tableplan.service || true
    systemctl restart tableplan.service
    echo "Release failed health checks; rolled back to $previous_target." >&2
else
    if [[ -f "$properties_rollback" ]]; then
        install -o tableplan -g tableplan -m 0600 "$properties_rollback" "$properties_destination"
        rm -f "$properties_rollback"
    fi
    echo "Release failed health checks and no previous release was available." >&2
fi
exit 1
REMOTE
done

echo "Deployment complete: $release"
