#!/usr/bin/env bash
# Explicit, manual release via GitHub Actions. No unattended deployment.
# Only code and po-puti systemd service are changed. Nginx/firewall/DNS are untouched.
set -Eeuo pipefail
export LC_ALL=C
TARGET_SHA="$1"
APP=/opt/po-puti
DB=/var/lib/po-puti/po-puti.sqlite
BACKUP_ROOT=/var/backups/po-puti

if [[ ! "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]; then echo 'Invalid commit SHA' >&2; exit 2; fi
if [[ "$(id -u)" -ne 0 ]]; then echo 'Requires privileged deploy account (sudo -n)' >&2; exit 2; fi
for cmd in git node systemctl curl mktemp install; do
  command -v "$cmd" >/dev/null || { echo "Missing command: $cmd" >&2; exit 2; }
done
test -d "$APP/.git" || { echo 'Missing git checkout' >&2; exit 2; }
test -f "$DB" || { echo 'Missing live SQLite database; refusing' >&2; exit 2; }
test "$(git -C "$APP" branch --show-current)" = main || { echo 'Checkout must be on main' >&2; exit 2; }
test -z "$(git -C "$APP" status --porcelain)" || { echo 'Local git changes detected; refusing' >&2; exit 2; }
systemctl is-active --quiet po-puti || { echo 'Application service is not active' >&2; exit 2; }
curl --noproxy '*' -fsS --connect-timeout 3 --max-time 8 http://127.0.0.1:8080/api/health |
  grep -q '"ok":true' || { echo 'Old backend is unhealthy' >&2; exit 2; }

PREVIOUS_SHA="$(git -C "$APP" rev-parse HEAD)"
echo "Installed SHA: $PREVIOUS_SHA"
echo "Candidate SHA: $TARGET_SHA"

# Download candidate and check fast-forward before touching live data or service.
git -C "$APP" fetch --no-tags origin "$TARGET_SHA"
git -C "$APP" cat-file -e "$TARGET_SHA^{commit}"
git -C "$APP" merge-base --is-ancestor "$PREVIOUS_SHA" "$TARGET_SHA" ||
  { echo 'Cannot fast-forward existing production checkout' >&2; exit 2; }
git -C "$APP" cat-file -e "$TARGET_SHA:server/server.mjs"
git -C "$APP" cat-file -e "$TARGET_SHA:www/index.html"

# Consistent online SQLite backup in WAL mode. Create destination exclusively.
install -d -m 0700 "$BACKUP_ROOT"
SHORT_SHA="$(printf '%s' "$TARGET_SHA" | cut -c1-8)"
BACKUP="$BACKUP_ROOT/po-puti-$(date -u +%Y%m%dT%H%M%SZ)-$SHORT_SHA.sqlite"
export POPUTI_LIVE_DB="$DB" POPUTI_BACKUP_DB="$BACKUP"
node --input-type=module <<'JS'
import {DatabaseSync,backup} from 'node:sqlite';
import {openSync,closeSync,unlinkSync,statSync} from 'node:fs';
const source=process.env.POPUTI_LIVE_DB,destination=process.env.POPUTI_BACKUP_DB;
let created=false,db;
try{
  closeSync(openSync(destination,'wx',0o600));created=true;
  db=new DatabaseSync(source,{readOnly:true});
  await backup(db,destination);db.close();db=null;
  const verify=new DatabaseSync(destination,{readOnly:true});
  try{
    if(verify.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')
      throw new Error('SQLite integrity check failed');
    verify.prepare('SELECT count(*) as n FROM users').get();
    verify.prepare('SELECT count(*) as n FROM rides').get();
    if(!statSync(destination).size)throw new Error('Empty backup');
  }finally{verify.close();}
  console.log('Verified SQLite backup created outside /opt/po-puti');
}catch(e){
  if(db)db.close();
  if(created){try{unlinkSync(destination)}catch{}}
  console.error('Backup failed:',e.message);process.exitCode=1;
}
JS

# Rollback previous source on failing service start or health check.
DEPLOY_STARTED=0
rollback(){
  local original_status=$?
  trap - ERR
  if [[ "$DEPLOY_STARTED" -eq 1 ]]; then
    echo "Release failed, restoring $PREVIOUS_SHA"
    systemctl stop po-puti || true
    git -C "$APP" reset --hard "$PREVIOUS_SHA" || true
    systemctl start po-puti || true
    systemctl is-active --quiet po-puti || echo 'WARNING: service needs manual attention' >&2
  fi
  exit "$original_status"
}
trap rollback ERR
DEPLOY_STARTED=1
systemctl stop po-puti
git -C "$APP" merge --ff-only "$TARGET_SHA"
node --check "$APP/server/server.mjs"
systemctl start po-puti

healthy=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --noproxy '*' -fsS --connect-timeout 2 --max-time 4 \
    http://127.0.0.1:8080/api/health | grep -q '"ok":true'; then
    healthy=1; break
  fi
  sleep 2
done
test "$healthy" -eq 1 || { echo 'New backend health failed' >&2; false; }
curl --noproxy '*' -fsS --connect-timeout 5 --max-time 12 \
  https://vputipoputka.ru/api/health | grep -q '"ok":true' ||
  { echo 'HTTPS health failed from VPS; rolling back' >&2; false; }
test "$(git -C "$APP" rev-parse HEAD)" = "$TARGET_SHA"
trap - ERR
DEPLOY_STARTED=0
echo "RELEASE_OK: $TARGET_SHA. Verified backup: $BACKUP"
echo 'Note: operator/device reliability still requires independent observation.'
