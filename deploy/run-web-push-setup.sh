#!/usr/bin/env bash
set -euo pipefail
candidate="$1"
[[ "$candidate" =~ ^[0-9a-f]{40}$ ]]
source_dir=$(mktemp -d /tmp/po-puti-push-setup-XXXXXXXX)
trap 'rm -rf "$source_dir"' EXIT
git -C /opt/po-puti fetch --no-tags origin "$candidate"
git -C /opt/po-puti archive "$candidate" | tar -x -C "$source_dir"
bash "$source_dir/deploy/setup-web-push.sh"
