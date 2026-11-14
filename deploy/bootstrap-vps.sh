#!/usr/bin/env bash
# Initial Ubuntu installation only. Existing installations use release-on-vps.sh.
# Existing databases/uploads are retained; no reset, restore or data removal occurs.
set -Eeuo pipefail
umask 077
export LC_ALL=C
TARGET_SHA="${1:-}"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 2; }
[[ "$(id -u)" -eq 0 ]] || { echo 'Root installation required' >&2; exit 2; }
# The shipped nginx/systemd configuration is verified against Ubuntu 24.04.
# shellcheck source=/dev/null
. /etc/os-release
[[ "$ID" = ubuntu && "$VERSION_ID" = 24.04 ]] || { echo 'Ubuntu 24.04 is required' >&2; exit 2; }
APP=/opt/po-puti
DATA=/var/lib/po-puti
ENV_FILE=/etc/po-puti/po-puti.env
[[ ! -e "$APP" ]] || { echo 'Application path exists; use the update workflow' >&2; exit 2; }
# Refuse to initialise a second DB when an old local installation still has data.
[[ ! -f /opt/po-puti/server-data/po-puti.sqlite ]] || { echo 'Legacy data requires migration' >&2; exit 2; }
exec 9>/run/lock/po-puti-deploy.lock
flock -n 9 || { echo 'Another deployment is running' >&2; exit 2; }
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg git nginx certbot sqlite3 openssl util-linux python3
if ! /usr/bin/node -e 'if(process.versions.node.split(".")[0]!=="24")process.exit(1)' >/dev/null 2>&1; then
 install -d -m 0755 /etc/apt/keyrings
 key_file=$(mktemp)
 curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$key_file"
 gpg --batch --yes --dearmor -o /etc/apt/keyrings/nodesource.gpg "$key_file"
 rm -f "$key_file"
 chmod 0644 /etc/apt/keyrings/nodesource.gpg
 printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' > /etc/apt/sources.list.d/nodesource.list
 apt-get update
 DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
/usr/bin/node -e 'if(process.versions.node.split(".")[0]!=="24")process.exit(1);const {DatabaseSync}=require("node:sqlite");new DatabaseSync(":memory:").close()'
git clone --branch main https://github.com/rsad79922-sys/po-puti.git "$APP"
git -C "$APP" merge-base --is-ancestor "$TARGET_SHA" origin/main
git -C "$APP" checkout --detach "$TARGET_SHA"
git -C "$APP" switch -C main
# Git inherits the private installer umask. Source contains only public repository
# files; make it readable by the unprivileged runtime, without touching DATA/env.
chmod -R a+rX "$APP"
# Repeat isolated verification on the exact candidate before starting it.
(cd "$APP" && /usr/bin/node scripts/check.mjs && /usr/bin/node scripts/test.mjs && /usr/bin/node scripts/build.mjs)
backup_dir=$(mktemp -d /var/backups/po-puti-bootstrap-XXXXXXXX)
if [[ -f "$DATA/po-puti.sqlite" ]]; then
 /usr/bin/node "$APP/deploy/backup-sqlite.mjs" "$DATA/po-puti.sqlite" "$backup_dir/po-puti.sqlite"
 if [[ -d "$DATA/uploads" ]]; then tar -C "$DATA" -czf "$backup_dir/uploads.tar.gz" uploads; fi
 echo 'EXISTING_DATABASE_PRESERVED_AND_BACKED_UP'
else
 echo 'NO_DATABASE_FOUND_AT_STANDARD_DATA_PATH: first launch will create an empty database'
fi
if ! id poputi >/dev/null 2>&1; then adduser --system --group --home "$DATA" --no-create-home poputi; fi
install -d -m 0700 -o poputi -g poputi "$DATA"
# Database files are not rewritten here; grant only the application user access.
chown -R poputi:poputi "$DATA"
install -d -m 0700 /var/backups/po-puti
install -d -m 0750 -o root -g poputi /etc/po-puti
if [[ -e "$ENV_FILE" ]]; then
 cp -a "$ENV_FILE" "$backup_dir/env.before"
 python3 - "$ENV_FILE" <<'PY'
import pathlib,sys
text=pathlib.Path(sys.argv[1]).read_text()
settings=dict(line.split('=',1) for line in text.splitlines() if '=' in line and not line.lstrip().startswith('#'))
if settings.get('DATA_DIR','').strip()!='/var/lib/po-puti':raise SystemExit('Non-standard DATA_DIR requires operator review; environment preserved')
PY
else
 install -m 0640 -o root -g poputi "$APP/deploy/po-puti.env.example" "$ENV_FILE"
fi
printf 'RELEASE_SHA=%s\n' "$TARGET_SHA" > /var/lib/po-puti-release.env
chmod 0600 /var/lib/po-puti-release.env
install -m 0644 "$APP"/deploy/po-puti.service "$APP"/deploy/po-puti-health.service "$APP"/deploy/po-puti-health.timer "$APP"/deploy/po-puti-backup.service "$APP"/deploy/po-puti-backup.timer /etc/systemd/system/
runuser -u poputi -- test -r "$APP/server/server.mjs"
runuser -u poputi -- test -r "$APP/www/index.html"
runuser -u poputi -- test -r "$APP/deploy/healthcheck.mjs"
systemctl daemon-reload
systemctl enable --now po-puti
healthy=0
for ((attempt=1; attempt<=15; attempt++)); do
 if /usr/bin/node "$APP/deploy/healthcheck.mjs"; then healthy=1; break; fi
 sleep 1
done
[[ "$healthy" -eq 1 ]] || { echo 'Backend failed startup' >&2; exit 1; }
# Preserve pre-existing domain configuration privately before replacing this site's file.
install -d -m 0755 /var/www/letsencrypt
for path in /etc/nginx/sites-available/po-puti /etc/nginx/conf.d/po-puti-log.conf; do
 if [[ -e "$path" ]]; then cp -a "$path" "$backup_dir/$(basename "$path").before"; fi
done
install -m 0644 "$APP/deploy/nginx-log-format.conf" /etc/nginx/conf.d/po-puti-log.conf
install -m 0644 "$APP/deploy/nginx-po-puti.conf" /etc/nginx/sites-available/po-puti
if [[ ! -e /etc/nginx/sites-enabled/po-puti ]]; then ln -s /etc/nginx/sites-available/po-puti /etc/nginx/sites-enabled/po-puti; fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx
certbot certonly --webroot -w /var/www/letsencrypt -d vputipoputka.ru --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring
install -m 0644 "$APP/deploy/nginx-po-puti-tls.conf" /etc/nginx/sites-available/po-puti
nginx -t
systemctl reload nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
printf '%s\n' '#!/bin/sh' 'nginx -t && systemctl reload nginx' > /etc/letsencrypt/renewal-hooks/deploy/po-puti-nginx
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/po-puti-nginx
systemctl enable --now certbot.timer po-puti-health.timer po-puti-backup.timer
systemctl start po-puti-backup.service
/usr/bin/node "$APP/deploy/healthcheck.mjs" https://vputipoputka.ru/api/health
echo "INSTALL_OK: $TARGET_SHA; backups: $backup_dir"
