#!/usr/bin/env bash
# Private runner files; pin is a public fingerprint verified by the owner in VPS console.
set -euo pipefail
umask 077
ssh_dir="${1:?Private SSH directory required}"
pin_file="${2:-$(dirname -- "$0")/ssh-host-fingerprint.txt}"
test -n "${DEPLOY_HOST:-}" && test -n "${DEPLOY_KEY:-}"
port="${DEPLOY_PORT:-22}"
[[ "$port" =~ ^[0-9]{1,5}$ ]]
install -d -m 0700 "$ssh_dir"
printf '%s\n' "$DEPLOY_KEY" > "$ssh_dir/key"
if [[ -s "$pin_file" ]]; then
 expected=$(cat "$pin_file")
 [[ "$expected" =~ ^SHA256:[A-Za-z0-9+/]{43}=?$ ]] || { echo 'Invalid verified host fingerprint' >&2; exit 2; }
 ssh-keyscan -T 10 -p "$port" -t rsa "$DEPLOY_HOST" > "$ssh_dir/scan" 2>/dev/null
 actual=$(ssh-keygen -lf "$ssh_dir/scan" -E sha256 | awk '{print $2}')
 [[ "$actual" = "$expected" ]] || { echo 'SSH host fingerprint mismatch; connection refused' >&2; exit 2; }
 mv "$ssh_dir/scan" "$ssh_dir/known_hosts"
 echo 'SSH_HOST_PIN_VERIFIED'
else
 test -n "${DEPLOY_KNOWN_HOSTS:-}"
 printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
fi
