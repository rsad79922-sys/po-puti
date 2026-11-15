#!/usr/bin/env bash
# Explicit owner command: hidden key input, private files, probe before activation.
set -euo pipefail
umask 077
[[ "$(id -u)" -eq 0 ]] || { echo 'Run through the trusted server console as root' >&2; exit 2; }
APP=/opt/po-puti
ENV_PATH=/etc/po-puti/routing.env
command -v node >/dev/null
getent group poputi >/dev/null
test -f "$APP/scripts/probe-routing.mjs"
read -r -s -p 'Ключ Яндекс API Получения деталей маршрута (ввод скрыт): ' poputi_route_key </dev/tty
printf '\n'
[[ "$poputi_route_key" =~ ^[A-Za-z0-9_-]{10,200}$ ]] || { echo 'Invalid key format' >&2; exit 2; }
read -r -s -p 'Отдельный ключ HTTP Геокодера, Enter чтобы пропустить (ввод скрыт): ' poputi_geocoder_key </dev/tty
printf '\n'
[[ -z "$poputi_geocoder_key" || "$poputi_geocoder_key" =~ ^[A-Za-z0-9_-]{10,200}$ ]] || { echo 'Invalid geocoder key format' >&2; exit 2; }
install -d -m 0750 -o root -g poputi /etc/po-puti
tmp_env=$(mktemp /etc/po-puti/.routing-XXXXXXXX)
trap 'rm -f "$tmp_env"' EXIT
{
  printf 'ROUTING_PROVIDER=yandex\nROUTING_URL=https://api.routing.yandex.net\nROUTING_API_KEY=%s\n' "$poputi_route_key"
  if [[ -n "$poputi_geocoder_key" ]]; then printf 'GEOCODING_PROVIDER=yandex\nGEOCODING_API_KEY=%s\n' "$poputi_geocoder_key"; fi
} > "$tmp_env"
unset poputi_route_key poputi_geocoder_key
# Only public test coordinates; no production accounts, quotes or data are written.
(cd "$APP" && node scripts/probe-routing.mjs "$tmp_env")
backup_dir=$(mktemp -d /var/backups/po-puti-routing-config-XXXXXXXX)
if [[ -f "$ENV_PATH" ]]; then cp -a "$ENV_PATH" "$backup_dir/routing.env.before"; fi
chown root:poputi "$tmp_env";chmod 0640 "$tmp_env";mv "$tmp_env" "$ENV_PATH"
install -d -m 0755 /etc/systemd/system/po-puti.service.d
if [[ -f /etc/systemd/system/po-puti.service.d/40-routing.conf ]]; then cp -a /etc/systemd/system/po-puti.service.d/40-routing.conf "$backup_dir/40-routing.conf.before"; fi
printf '[Service]\nEnvironmentFile=/etc/po-puti/routing.env\n' > /etc/systemd/system/po-puti.service.d/40-routing.conf
chmod 0644 /etc/systemd/system/po-puti.service.d/40-routing.conf
rollback_config(){
  local status=$?
  trap - ERR
  cp -a "$ENV_PATH" "$backup_dir/routing.env.failed" || true
  if [[ -f "$backup_dir/routing.env.before" ]]; then cp -a "$backup_dir/routing.env.before" "$ENV_PATH"; else rm -f "$ENV_PATH"; fi
  if [[ -f "$backup_dir/40-routing.conf.before" ]]; then cp -a "$backup_dir/40-routing.conf.before" /etc/systemd/system/po-puti.service.d/40-routing.conf; else rm -f /etc/systemd/system/po-puti.service.d/40-routing.conf; fi
  systemctl daemon-reload || true
  systemctl restart po-puti || true
  echo "Configuration activation failed; prior settings restored; private backup: $backup_dir" >&2
  exit "$status"
}
trap rollback_config ERR
systemctl daemon-reload
systemctl restart po-puti
healthy=0
for ((attempt=0; attempt<10; attempt++)); do
  if curl --noproxy '*' -fsS --connect-timeout 2 --max-time 3 http://127.0.0.1:8080/api/health | grep -q '"ok":true'; then healthy=1;break;fi
  sleep 1
done
[[ "$healthy" -eq 1 ]]
trap - ERR
echo "YANDEX_CONFIGURED: private settings activated; previous configuration saved in $backup_dir"
