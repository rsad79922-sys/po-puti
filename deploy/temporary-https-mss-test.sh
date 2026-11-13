#!/usr/bin/env bash
# Controlled two-way IPv4 MSS diagnostic. NEVER runs automatically.
# A systemd transient timer is REQUIRED so VNC disconnection or SIGKILL cannot
# leave test rules installed indefinitely. Reboot naturally flushes rules.
set -Eeuo pipefail
if [[ "$EUID" -ne 0 ]]; then
 echo 'Root privileges required. No rules were changed.' >&2
 exit 1
fi
for cmd in iptables systemd-run; do
 if ! command -v "$cmd" >/dev/null 2>&1; then
   echo "$cmd missing. No rules were changed." >&2
   exit 1
 fi
done
MODE="${1:-start}"
TAG="${2:-}"
if [[ "$MODE" == rollback ]]; then
 if [[ ! "$TAG" =~ ^poputi-mss-[0-9]+-[0-9]+$ ]]; then
   echo "Invalid rollback tag" >&2
   exit 2
 fi
else
 if [[ "$MODE" != start ]]; then echo "Usage: bash $0 [start]" >&2; exit 2; fi
 TAG="poputi-mss-$(date +%s)-$$"
fi
# Peer advertises the largest TCP payload it accepts in SYN or SYN-ACK.
# Incoming SYN -> server-to-client packets; outgoing SYN-ACK -> client-to-server.
incoming=(-p tcp --dport 443 --tcp-flags SYN,RST SYN -m comment --comment "$TAG" -j TCPMSS --set-mss 1200)
outgoing=(-p tcp --sport 443 --tcp-flags SYN,RST SYN -m comment --comment "$TAG" -j TCPMSS --set-mss 1200)
rollback(){
 iptables -t mangle -D OUTPUT "${outgoing[@]}" >/dev/null 2>&1 || true
 iptables -t mangle -D PREROUTING "${incoming[@]}" >/dev/null 2>&1 || true
}
if [[ "$MODE" == rollback ]]; then
 rollback
 echo "Auto-rollback completed for $TAG"
 exit 0
fi
SELF="$(readlink -f "$0")"
UNIT="poputi-mss-rollback-$(date +%s)-$$"
# Schedule a separate automatic rollback BEFORE changing any firewall rule.
# A failed timer setup blocks the experiment (important for a remote VNC session).
systemd-run --quiet --collect --unit="$UNIT" --on-active=150s /bin/bash "$SELF" rollback "$TAG"
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
iptables -t mangle -I PREROUTING 1 "${incoming[@]}"
iptables -t mangle -I OUTPUT 1 "${outgoing[@]}"
echo "ACTIVE: Temporary 120-second MSS=1200 diagnostic for TCP:443; fresh connections only."
echo "Independent systemd rollback scheduled after 150 seconds, even if VNC disconnects."
echo "New connections in Safari only; do not reboot or make other server changes during test."
sleep 120
echo 'Experiment finished; removing both rules.'
