#!/usr/bin/env bash
# Rehearsal on a private copy on the VPS. Never replaces or restores the live database.
set -euo pipefail
umask 077
candidate="${1:-}"
[[ "$candidate" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ "$(id -u)" -eq 0 ]] || exit 2
test -f /var/lib/po-puti/po-puti.sqlite
snapshot_root=$(mktemp -d /var/backups/po-puti-v3-rehearsal-XXXXXXXX)
# Repository is public and the candidate is pinned; this does not alter production HEAD.
git -C /opt/po-puti fetch --no-tags origin "$candidate"
install -d -m 0700 "$snapshot_root/code"
git -C /opt/po-puti archive "$candidate" | tar -x -C "$snapshot_root/code"
node "$snapshot_root/code/scripts/validate-lifecycle-copy.mjs" /var/lib/po-puti/po-puti.sqlite "$snapshot_root/data"
echo "PRIVATE_REHEARSAL_SAVED: $snapshot_root; live database not replaced"
