#!/usr/bin/env bash
# New private backup set on every invocation; no retention deletes and no data restore.
set -Eeuo pipefail
umask 077
exec 9>/run/lock/po-puti-backup.lock
flock -n 9 || exit 0
install -d -m 0700 /var/backups/po-puti
backup_dir=$(mktemp -d "/var/backups/po-puti/backup-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")
node /opt/po-puti/deploy/backup-sqlite.mjs /var/lib/po-puti/po-puti.sqlite "$backup_dir/po-puti.sqlite"
# The latest ledger is required even when restoring a database predating erasure.
if [[ -f /var/lib/po-puti/privacy-erasure.jsonl ]]; then
 cp -p /var/lib/po-puti/privacy-erasure.jsonl "$backup_dir/privacy-erasure.jsonl"
fi
# Concurrent erasure may remove a photo after the DB snapshot. The newer ledger
# takes precedence: never restore a backup without the latest erasure ledger.
tar -C /var/lib/po-puti -czf "$backup_dir/uploads.tar.gz" uploads
tar -tzf "$backup_dir/uploads.tar.gz" >/dev/null
echo "BACKUP_SET_OK $backup_dir"
