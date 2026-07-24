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

google_client_id="$(property_value spring.security.oauth2.client.registration.google.client-id)"
google_client_secret="$(property_value spring.security.oauth2.client.registration.google.client-secret)"
google_redirect_uri="$(property_value spring.security.oauth2.client.registration.google.redirect-uri)"
if [[ -n "$google_client_id" || -n "$google_client_secret" || -n "$google_redirect_uri" ]]; then
    missing_google_properties=()
    [[ -n "$google_client_id" ]] ||
        missing_google_properties+=("spring.security.oauth2.client.registration.google.client-id")
    [[ -n "$google_client_secret" ]] ||
        missing_google_properties+=("spring.security.oauth2.client.registration.google.client-secret")
    [[ -n "$google_redirect_uri" ]] ||
        missing_google_properties+=("spring.security.oauth2.client.registration.google.redirect-uri")
    if ((${#missing_google_properties[@]} > 0)); then
        echo "Google OAuth configuration is incomplete. Configure all three properties or comment all three." >&2
        printf 'Missing: %s\n' "${missing_google_properties[@]}" >&2
        exit 1
    fi
fi

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

tableplan_load_servers "$inventory"
configured_server_port="$(property_value server.port)"
configured_server_port="${configured_server_port:-9090}"
for index in "${!TABLEPLAN_SERVER_NAMES[@]}"; do
    name="${TABLEPLAN_SERVER_NAMES[$index]}"
    app_port="${TABLEPLAN_SERVER_APP_PORTS[$index]}"
    if [[ "$configured_server_port" != "$app_port" ]]; then
        echo "Port mismatch for '$name': $properties_file configures server.port=$configured_server_port" >&2
        echo "but $inventory configures application port $app_port." >&2
        exit 1
    fi
done

for index in "${!TABLEPLAN_SERVER_NAMES[@]}"; do
    name="${TABLEPLAN_SERVER_NAMES[$index]}"
    target="${TABLEPLAN_SERVER_TARGETS[$index]}"
    identity="${TABLEPLAN_SERVER_IDENTITIES[$index]}"
    app_port="${TABLEPLAN_SERVER_APP_PORTS[$index]}"
    ssh_port="${TABLEPLAN_SERVER_SSH_PORTS[$index]}"
    remote_upload="/tmp/tableplan-application.properties.$$"

    echo "== [$name] deploy application.properties to $target"
    echo "   copy:    $properties_file"
    echo "   upload:  $target:$remote_upload"
    echo "   install: $target:/opt/tableplan/shared/application.properties"
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
if ((app_port < 1024)); then
    ambient_capabilities="$(systemctl show tableplan.service --property=AmbientCapabilities --value)"
    if [[ " $ambient_capabilities " != *" cap_net_bind_service "* ]]; then
        rm -f "$upload"
        echo "The installed tableplan.service cannot bind privileged port $app_port." >&2
        echo "Run scripts/bootstrap-remote.sh to install the updated systemd unit first." >&2
        exit 1
    fi
fi
if [[ -f "$destination" ]]; then
    cp --preserve=mode,ownership "$destination" "$previous"
fi
install -o tableplan -g tableplan -m 0600 "$upload" "$destination.new"
mv -f "$destination.new" "$destination"
rm -f "$upload"
echo "Installed properties: $destination"

if [[ ! -f /opt/tableplan/current/tableplan.jar ]]; then
    echo "Properties staged; no deployed JAR exists yet."
    exit 0
fi

systemctl reset-failed tableplan.service || true
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
    systemctl reset-failed tableplan.service || true
    systemctl restart tableplan.service
    echo "Properties deployment failed; the previous file was restored." >&2
else
    echo "Properties deployment failed and no previous file was available." >&2
fi
exit 1
REMOTE
done
