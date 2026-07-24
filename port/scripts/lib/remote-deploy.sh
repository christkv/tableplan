#!/usr/bin/env bash

set -euo pipefail

TABLEPLAN_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TABLEPLAN_DEFAULT_INVENTORY="$TABLEPLAN_PROJECT_ROOT/deploy/servers.conf"

tableplan_load_servers() {
    local inventory="${1:-$TABLEPLAN_DEFAULT_INVENTORY}"
    [[ -f "$inventory" ]] || {
        echo "Server inventory not found: $inventory" >&2
        return 1
    }

    TABLEPLAN_SERVER_NAMES=()
    TABLEPLAN_SERVER_TARGETS=()
    TABLEPLAN_SERVER_IDENTITIES=()
    TABLEPLAN_SERVER_APP_PORTS=()
    TABLEPLAN_SERVER_SSH_PORTS=()

    local name target identity app_port ssh_port extra
    while IFS='|' read -r name target identity app_port ssh_port extra; do
        [[ -z "$name" || "$name" == \#* ]] && continue
        [[ -z "${extra:-}" ]] || {
            echo "Invalid server inventory row for '$name': expected five pipe-separated fields." >&2
            return 1
        }
        [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || {
            echo "Invalid server name: $name" >&2
            return 1
        }
        [[ "$target" == *@* ]] || {
            echo "Invalid SSH target for '$name': $target" >&2
            return 1
        }
        if [[ "$identity" == "~/"* ]]; then
            identity="$HOME/${identity#\~/}"
        fi
        [[ -f "$identity" ]] || {
            echo "SSH identity for '$name' not found: $identity" >&2
            return 1
        }
        app_port="${app_port:-9090}"
        ssh_port="${ssh_port:-22}"
        [[ "$app_port" =~ ^[0-9]+$ && "$ssh_port" =~ ^[0-9]+$ ]] || {
            echo "Invalid port in server inventory row for '$name'." >&2
            return 1
        }

        TABLEPLAN_SERVER_NAMES+=("$name")
        TABLEPLAN_SERVER_TARGETS+=("$target")
        TABLEPLAN_SERVER_IDENTITIES+=("$identity")
        TABLEPLAN_SERVER_APP_PORTS+=("$app_port")
        TABLEPLAN_SERVER_SSH_PORTS+=("$ssh_port")
    done < "$inventory"

    ((${#TABLEPLAN_SERVER_NAMES[@]} > 0)) || {
        echo "No servers configured in $inventory" >&2
        return 1
    }
}

tableplan_ssh() {
    local target="$1" identity="$2" ssh_port="$3"
    shift 3
    ssh \
        -o BatchMode=yes \
        -o IdentitiesOnly=yes \
        -o ServerAliveInterval=30 \
        -o ServerAliveCountMax=4 \
        -o StrictHostKeyChecking=accept-new \
        -i "$identity" \
        -p "$ssh_port" \
        "$target" "$@"
}

tableplan_scp() {
    local source="$1" target="$2" identity="$3" ssh_port="$4" destination="$5"
    scp \
        -o BatchMode=yes \
        -o IdentitiesOnly=yes \
        -o ServerAliveInterval=30 \
        -o ServerAliveCountMax=4 \
        -o StrictHostKeyChecking=accept-new \
        -i "$identity" \
        -P "$ssh_port" \
        "$source" "$target:$destination"
}

tableplan_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}
