#!/usr/bin/env bash
# Time-limited, reversible HTTPS TCP MSS experiment. NOT an automatic deploy fix.
# This affects only new TCP:443 handshakes, not SSH, the database or application code.
# Execute as root on the VPS, from a persistent terminal; Ctrl-C also rolls back.
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run as root (sudo). No rules changed.' >&2
  exit 1
fi
if ! command -v iptables >/dev/null 2>&1; then
  echo 'iptables is unavailable. No rules changed.' >&2
  exit 1
fi

# Incoming SYN advertises what the client can receive (server -> client).
# Outgoing SYN-ACK advertises what the server can receive (client -> server).
# Both directions must be clamped when investigating an incomplete ClientHello.
incoming=(-p tcp --dport 443 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200)
outgoing=(-p tcp --sport 443 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200)
added_in=0
added_out=0
cleanup(){
  trap - EXIT INT TERM
  if [[ "$added_out" -eq 1 ]]; then
    iptables -t mangle -D OUTPUT "${outgoing[@]}" || echo 'WARNING: OUTPUT rollback failed!' >&2
  fi
  if [[ "$added_in" -eq 1 ]]; then
    iptables -t mangle -D PREROUTING "${incoming[@]}" || echo 'WARNING: PREROUTING rollback failed!' >&2
  fi
  echo 'Experiment ended. Newly inserted TCPMSS rules removed.'
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo 'Starting a 120-second test; rules will be deleted when this script exits.'
echo 'Connections already established will retain their previous MSS.'
if ! iptables -t mangle -C PREROUTING "${incoming[@]}" >/dev/null 2>&1; then
  iptables -t mangle -I PREROUTING 1 "${incoming[@]}"
  added_in=1
else
  echo 'Matching PREROUTING rule already exists; this script will not remove it.'
fi
if ! iptables -t mangle -C OUTPUT "${outgoing[@]}" >/dev/null 2>&1; then
  iptables -t mangle -I OUTPUT 1 "${outgoing[@]}"
  added_out=1
else
  echo 'Matching OUTPUT rule already exists; this script will not remove it.'
fi

echo 'ACTIVE: retry a fresh Safari tab on both Wi-Fi and LTE. Do not reuse an old TCP connection.'
echo 'Always compare against the same site without the rule afterward.'
sleep 120
