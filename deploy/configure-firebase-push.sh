#!/usr/bin/env bash
# Input JSON contains serviceAccount and android; only pass its private file path.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" -eq 0 && $# -eq 1 && -f "$1" ]] || exit 2
cd /opt/po-puti
install -d -m 0750 -o root -g poputi /etc/po-puti
candidate=$(mktemp -d /etc/po-puti/.firebase-pending-XXXXXXXX)
trap 'rm -rf "$candidate"' EXIT
node deploy/prepare-firebase-settings.mjs "$1" "$candidate"
backup=$(mktemp -d /var/backups/po-puti-firebase-XXXXXXXX)
target=/etc/po-puti/firebase-push
dropin=/etc/systemd/system/po-puti.service.d/46-firebase-push.conf
[[ ! -L "$target" && ! -L "$dropin" ]] || { echo "Unsafe existing Firebase settings path" >&2;exit 2; }
[[ ! -d "$target" ]] || cp -a "$target" "$backup/before"
[[ ! -f "$dropin" ]] || cp -a "$dropin" "$backup/dropin.before"
rollback(){
 local status=$?
 trap - ERR
 [[ ! -d "$target" ]] || mv "$target" "$backup/failed"
 [[ ! -d "$backup/before" ]] || cp -a "$backup/before" "$target"
 if [[ -f "$backup/dropin.before" ]];then cp -a "$backup/dropin.before" "$dropin";else rm -f "$dropin";fi
 systemctl daemon-reload;systemctl restart po-puti || true
 echo 'FIREBASE_ACTIVATION_FAILED: previous settings restored; application data untouched' >&2
 exit "$status"
}
trap rollback ERR
chown root:poputi "$candidate" "$candidate/"*
chmod 0750 "$candidate";chmod 0640 "$candidate/"*
if [[ -d "$target" ]];then mv "$target" "$backup/replaced";fi
mv "$candidate" "$target"
install -d -m 0755 /etc/systemd/system/po-puti.service.d
printf '[Service]\nEnvironmentFile=/etc/po-puti/firebase-push/firebase.env\n' > "$dropin"
chmod 0644 "$dropin"
systemctl daemon-reload
systemctl restart po-puti
healthy=0
for ((attempt=0;attempt<15;attempt++));do
 if curl --noproxy '*' -fsS --connect-timeout 2 --max-time 3 http://127.0.0.1:8080/api/health | grep -q '"ok":true';then healthy=1;break;fi
 sleep 1
done
[[ "$healthy" -eq 1 ]]
trap - ERR
echo "FIREBASE_CONFIGURED: credentials remain outside repository and web root; backup $backup. Verify receipt on an opted-in Android device."
