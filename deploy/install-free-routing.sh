#!/usr/bin/env bash
# Own free routing only. Application DB, uploads, nginx and firewall are untouched.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" -eq 0 ]] || exit 2
exec 8>/run/lock/po-puti-routing-install.lock
flock -n 8 || { echo 'Routing installation is already running' >&2; exit 2; }
SOURCE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ROUTER=/opt/po-puti-brouter
DATA=/var/lib/po-puti-brouter
VERSION=1.7.10
EXPECTED_SHA=023fec3ba997758e8cd7ab9e1bae52e962af3f00b57683e3de86b84ffad01532
if [[ -e "$ROUTER" && ! -f "$ROUTER/.po-puti-managed-router" ]]; then echo 'Unmanaged router directory; refusing' >&2; exit 2; fi
available_kb=$(awk '/MemTotal:/{print $2}' /proc/meminfo)
[[ "$available_kb" -ge 3000000 ]] || { echo 'Free router requires at least 3 GiB RAM on this installation profile' >&2; exit 2; }
# No paid API account, token, billing or subscription is used.
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openjdk-17-jre-headless curl python3 unzip
if ! getent group poputi-router >/dev/null; then groupadd --system poputi-router; fi
if ! id poputi-router >/dev/null 2>&1; then useradd --system --gid poputi-router --no-create-home --home-dir "$DATA" --shell /usr/sbin/nologin poputi-router; fi
getent group poputi >/dev/null
install -d -m 0755 "$ROUTER" "$ROUTER/releases" "$ROUTER/bin"
printf 'po-puti-free-router-v1\n' > "$ROUTER/.po-puti-managed-router"
install -d -m 0555 "$ROUTER/custom-profiles"
TMP=$(mktemp -d /tmp/po-puti-free-routing-XXXXXXXX)
stage_unit="po-puti-router-stage-$$"
cleanup(){ systemctl stop "$stage_unit" >/dev/null 2>&1 || true;rm -rf "$TMP"; }
trap cleanup EXIT
curl -fL --retry 2 --connect-timeout 10 --max-time 120 -o "$TMP/router.zip" "https://github.com/abrensch/brouter/releases/download/v$VERSION/brouter-$VERSION.zip"
printf '%s  %s\n' "$EXPECTED_SHA" "$TMP/router.zip" | sha256sum -c -
unzip -q "$TMP/router.zip" -d "$TMP/package"
if [[ ! -d "$ROUTER/releases/$VERSION" ]]; then
  (umask 022; cp -a "$TMP/package/brouter-$VERSION" "$ROUTER/releases/$VERSION")
  find "$ROUTER/releases/$VERSION" -type d -exec chmod 0755 {} +
  find "$ROUTER/releases/$VERSION" -type f -exec chmod 0644 {} +
fi
install -m 0755 "$SOURCE/scripts/brouter-maps.py" "$ROUTER/bin/brouter-maps.py"
if [[ -n "${1:-}" ]]; then python3 "$ROUTER/bin/brouter-maps.py" --import "$DATA" "$1"; else python3 "$ROUTER/bin/brouter-maps.py" "$DATA"; fi
# Probe on a separate loopback port before replacing any live router unit/config.
systemd-run --unit="$stage_unit" --uid=poputi-router --gid=poputi-router --collect \
  -p MemoryMax=2048M -p CPUQuota=100% -p StandardOutput=null \
  /usr/bin/java -Xms64m -Xmx1280m -DmaxRunningTime=28 -cp "$ROUTER/releases/$VERSION/brouter-$VERSION-all.jar" \
  btools.server.RouteServer "$DATA/current" "$ROUTER/releases/$VERSION/profiles2" "$ROUTER/custom-profiles" 17778 1 127.0.0.1
ready=0
for ((attempt=0; attempt<15; attempt++)); do
  if ss -H -ltn '( sport = :17778 )' | grep -q 17778; then ready=1;break;fi
  sleep 1
done
[[ "$ready" -eq 1 ]]
python3 "$SOURCE/scripts/probe-brouter.py" http://127.0.0.1:17778
systemctl stop "$stage_unit"
ln -sfn "releases/$VERSION" "$ROUTER/current"
install -m 0644 "$SOURCE/deploy/po-puti-router.service" "$SOURCE/deploy/po-puti-router-maps.service" "$SOURCE/deploy/po-puti-router-maps.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now po-puti-router
systemctl restart po-puti-router
python3 "$SOURCE/scripts/probe-brouter.py" http://127.0.0.1:17777
systemctl disable --now po-puti-router-maps.timer || true
# Weekly delivery runs through GitHub Actions because the VPS-to-mirror route is unreliable.
# Keep any already-configured free geocoder key, but disable external paid routing fallbacks.
install -d -m 0750 -o root -g poputi /etc/po-puti
config_backup=$(mktemp -d /var/backups/po-puti-free-routing-XXXXXXXX)
if [[ -f /etc/po-puti/routing.env ]]; then cp -a /etc/po-puti/routing.env "$config_backup/routing.env.before"; fi
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/po-puti/routing.env')
lines=p.read_text().splitlines() if p.exists() else []
keep=[line for line in lines if not line.strip().startswith('ROUTING_')]
keep+=['ROUTING_PROVIDER=brouter','ROUTING_URL=http://127.0.0.1:17777']
p.write_text('\n'.join(keep)+'\n')
PY
chown root:poputi /etc/po-puti/routing.env
chmod 0640 /etc/po-puti/routing.env
install -d -m 0755 /etc/systemd/system/po-puti.service.d
if [[ -f /etc/systemd/system/po-puti.service.d/40-routing.conf ]]; then cp -a /etc/systemd/system/po-puti.service.d/40-routing.conf "$config_backup/40-routing.conf.before"; fi
printf '[Service]\nEnvironmentFile=/etc/po-puti/routing.env\n' > /etc/systemd/system/po-puti.service.d/40-routing.conf
chmod 0644 /etc/systemd/system/po-puti.service.d/40-routing.conf
systemctl daemon-reload
# API restart is performed by the separate verified application release.
echo "FREE_ROUTING_INSTALLED: owned BRouter, OSM Russia offline maps, loopback only; zero paid API keys; application data untouched; config backup: $config_backup"
