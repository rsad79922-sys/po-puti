#!/usr/bin/env bash
# Read-only, time-bounded HTTPS diagnostic on the VPS. Run manually as root
# only after reviewing the script. No firewall, TLS or service changes.
set -euo pipefail
duration="${1:-90}"
[[ "$duration" =~ ^[0-9]+$ ]] && ((duration >= 10 && duration <= 180)) || { echo "duration must be 10..180 seconds" >&2; exit 2; }
command -v timeout >/dev/null
command -v tcpdump >/dev/null
out="${2:-/tmp/po-puti-tls-evidence-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -m 700 -- "$out"
chmod 700 "$out"
echo "UTC_START=$(date -u +%FT%TZ)" > "$out/metadata.txt"
echo "Capture is text-only TCP packet summaries; files may contain IP addresses." >> "$out/metadata.txt"
# Text summary only: no raw packet capture or TLS payload stored.
timeout "$duration" tcpdump -i any -nn -tttt -q -l 'tcp port 443' >"$out/tcp443-summary.txt" 2>"$out/tcpdump.stderr" &
pid=$!
for ((i=0;i<duration;i+=5)); do
  { date -u +%FT%TZ; ss -tin '( sport = :443 or dport = :443 )' || true; } >> "$out/socket-state.txt"
  sleep 5
done
wait "$pid" || status=$?
echo "UTC_END=$(date -u +%FT%TZ)" >> "$out/metadata.txt"
echo "Capture exit status=${status:-0}" >> "$out/metadata.txt"
echo "Do not publish packet summaries or socket-state: IP addresses are personal data."
echo "Saved: $out"
