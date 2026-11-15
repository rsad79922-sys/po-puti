#!/usr/bin/env bash
# Owner console only. Preserve the own free router; activate no paid routing service.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" -eq 0 ]] || exit 2
APP=/opt/po-puti
read -r -s -p 'Ключ бесплатного HTTP Геокодера Яндекса (ввод скрыт): ' poputi_geo_key </dev/tty
printf '\n'
[[ "$poputi_geo_key" =~ ^[A-Za-z0-9_-]{10,200}$ ]] || { echo 'Invalid geocoder key format' >&2; exit 2; }
install -d -m 0750 -o root -g poputi /etc/po-puti
candidate=$(mktemp /etc/po-puti/.free-geocoder-XXXXXXXX)
trap 'rm -f "$candidate"' EXIT
if [[ -f /etc/po-puti/routing.env ]]; then sed '/^[[:space:]]*GEOCODING_/d' /etc/po-puti/routing.env > "$candidate"; fi
printf 'GEOCODING_PROVIDER=yandex\nGEOCODING_API_KEY=%s\n' "$poputi_geo_key" >> "$candidate"
unset poputi_geo_key
(cd "$APP" && node scripts/probe-routing.mjs "$candidate" --geocoder-only)
backup_dir=$(mktemp -d /var/backups/po-puti-free-geocoder-XXXXXXXX)
if [[ -f /etc/po-puti/routing.env ]]; then cp -a /etc/po-puti/routing.env "$backup_dir/routing.env.before"; fi
chown root:poputi "$candidate";chmod 0640 "$candidate";mv "$candidate" /etc/po-puti/routing.env
install -d -m 0755 /etc/systemd/system/po-puti.service.d
printf '[Service]\nEnvironmentFile=/etc/po-puti/routing.env\n' > /etc/systemd/system/po-puti.service.d/40-routing.conf
chmod 0644 /etc/systemd/system/po-puti.service.d/40-routing.conf
systemctl daemon-reload
systemctl restart po-puti
healthy=0
for ((attempt=0; attempt<10; attempt++)); do
 if curl --noproxy '*' -fsS --connect-timeout 2 --max-time 3 http://127.0.0.1:8080/api/health | grep -q '"ok":true'; then healthy=1;break;fi
 sleep 1
done
if [[ "$healthy" -ne 1 ]]; then
 cp -a /etc/po-puti/routing.env "$backup_dir/routing.env.failed"
 if [[ -f "$backup_dir/routing.env.before" ]]; then cp -a "$backup_dir/routing.env.before" /etc/po-puti/routing.env; else rm -f /etc/po-puti/routing.env /etc/systemd/system/po-puti.service.d/40-routing.conf; fi
 systemctl daemon-reload;systemctl restart po-puti
 echo 'Geocoder activation failed; previous configuration restored' >&2;exit 1
fi
echo "FREE_GEOCODER_CONFIGURED: key remains private; app cap 900/24h; own free routing preserved; backup $backup_dir"
