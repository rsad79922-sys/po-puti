#!/usr/bin/env bash
# Owner console only: no key in argv, shell history, GitHub or diagnostic output.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" -eq 0 ]] || { echo 'Run from the VPS owner console with sudo' >&2; exit 2; }
APP=/opt/po-puti
install -d -m 0750 -o root -g poputi /etc/po-puti
read -r -p 'Условия API Расписаний проверены; тариф бесплатный без платного превышения? Введите YES: ' confirmation </dev/tty
[[ "$confirmation" == YES ]] || exit 2
read -r -p 'Безопасный лимит приложения за 24 часа (ниже бесплатной квоты, 1–1000): ' quota </dev/tty
read -r -p 'Разрешённый условиями временный кэш, секунды (1–86400): ' ttl </dev/tty
[[ "$quota" =~ ^[1-9][0-9]{0,3}$ && "$ttl" =~ ^[1-9][0-9]{0,4}$ ]] && ((quota<=1000 && ttl<=86400)) || { echo 'Invalid quota/TTL' >&2; exit 2; }
read -r -s -p 'Ключ API Яндекс Расписаний (ввод скрыт): ' rasp_key </dev/tty
printf '\n'
[[ "$rasp_key" =~ ^[A-Za-z0-9_-]{10,200}$ ]] || { echo 'Invalid key format' >&2; exit 2; }
candidate=$(mktemp /etc/po-puti/.rasp-XXXXXXXX)
trap 'rm -f "$candidate"' EXIT
printf 'YANDEX_RASP_API_KEY=%s\nRASP_LICENSE_CONFIRMED=true\nRASP_DAILY_LIMIT=%s\nRASP_CACHE_SECONDS=%s\n' "$rasp_key" "$quota" "$ttl" > "$candidate"
unset rasp_key
node "$APP/scripts/probe-timetables.mjs" "$candidate"
install -d -m 0700 /var/backups/po-puti
backup_dir=$(mktemp -d /var/backups/po-puti/rasp-config-XXXXXXXX)
dropin=/etc/systemd/system/po-puti.service.d/50-rasp.conf
[[ ! -f /etc/po-puti/rasp.env ]] || cp -p /etc/po-puti/rasp.env "$backup_dir/rasp.env"
[[ ! -f "$dropin" ]] || cp -p "$dropin" "$backup_dir/50-rasp.conf"
chown root:poputi "$candidate";chmod 0640 "$candidate";mv "$candidate" /etc/po-puti/rasp.env
install -d -m 0755 /etc/systemd/system/po-puti.service.d
printf '[Service]\nEnvironmentFile=/etc/po-puti/rasp.env\n' > "$dropin"
chmod 0644 "$dropin"
rollback(){
 if [[ -f "$backup_dir/rasp.env" ]]; then cp -p "$backup_dir/rasp.env" /etc/po-puti/rasp.env; else rm -f /etc/po-puti/rasp.env; fi
 if [[ -f "$backup_dir/50-rasp.conf" ]]; then cp -p "$backup_dir/50-rasp.conf" "$dropin"; else rm -f "$dropin"; fi
 systemctl daemon-reload;systemctl restart po-puti || true
 echo "RASP_ACTIVATION_FAILED: previous settings restored; private backup $backup_dir" >&2
}
trap 'rollback' ERR
systemctl daemon-reload;systemctl restart po-puti
healthy=0
for ((attempt=0;attempt<15;attempt++)); do
 if curl --noproxy '*' -fsS --connect-timeout 2 --max-time 3 http://127.0.0.1:8080/api/health 2>/dev/null | grep -q '"ok":true'; then healthy=1;break;fi
 sleep 1
done
if [[ "$healthy" != 1 ]]; then rollback;exit 1;fi
trap - ERR
echo "RASP_CONFIGURED: authenticated copyright probe passed; key private; quota/TTL bounded; backup $backup_dir"
