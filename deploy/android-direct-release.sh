#!/usr/bin/env bash
# CI transfers ONLY public APKs/tools. Production signing secrets stay on the VPS.
set -euo pipefail
set +x
umask 077
mode="${1:?sign or publish required}"
[[ "$mode" = sign || "$mode" = publish ]] || exit 2
test "${DEPLOY_USER:-}" = root || { echo 'Signing operations require the existing root VPS deployment identity.' >&2; exit 2; }
test -n "${DEPLOY_HOST:-}" && test -n "${DEPLOY_KEY:-}"
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ && "${GITHUB_RUN_ATTEMPT:-}" =~ ^[0-9]+$ && "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "${ANDROID_VERSION_CODE:-}" =~ ^[1-9][0-9]{0,8}$ && "$ANDROID_VERSION_CODE" -ge 4 && "${ANDROID_VERSION_NAME:-}" =~ ^[0-9]+(\.[0-9]+){1,3}$ ]] || exit 2
ssh_dir="$RUNNER_TEMP/android-signing-ssh-$mode"
trap 'rm -rf "$ssh_dir"' EXIT
bash deploy/prepare-ssh.sh "$ssh_dir"
port="${DEPLOY_PORT:-22}";[[ "$port" =~ ^[0-9]{1,5}$ ]] || exit 2
options=(-i "$ssh_dir/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$ssh_dir/known_hosts" -o ConnectTimeout=12)
host="$DEPLOY_USER@$DEPLOY_HOST"
stage="/var/lib/po-puti-android-builds/run-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
if [[ "$mode" = sign ]]; then
 ssh "${options[@]}" -p "$port" "$host" "umask 077; install -d -m 0700 /var/lib/po-puti-android-builds '$stage'"
 scp "${options[@]}" -P "$port" scripts/android-signing-vault.mjs "$host:$stage/android-signing-vault.mjs"
 scp "${options[@]}" -P "$port" out/release-aligned.apk out/test-aligned.apk "$ANDROID_HOME/build-tools/35.0.0/lib/apksigner.jar" "$host:$stage/"
 ssh "${options[@]}" -p "$port" "$host" "chmod 0600 '$stage/'*; node '$stage/android-signing-vault.mjs' sign '$stage' '$ANDROID_VERSION_CODE' '$ANDROID_VERSION_NAME' '$GITHUB_SHA'"
 for file in po-puti-release.apk signed-test.apk release-info.json certificate.pem; do
  scp "${options[@]}" -P "$port" "$host:$stage/$file" "out/$file"
 done
 echo 'SIGNED_APKS_RECEIVED: private signing key/password never left the VPS.'
else
 ssh "${options[@]}" -p "$port" "$host" "install -d -m 0700 '$stage/scripts' '$stage/server'"
 scp "${options[@]}" -P "$port" scripts/android-signing-vault.mjs "$host:$stage/scripts/android-signing-vault.mjs"
 scp "${options[@]}" -P "$port" server/android-download.mjs "$host:$stage/server/android-download.mjs"
 scp "${options[@]}" -P "$port" scripts/publish-android-apk.mjs "$host:$stage/scripts/publish-android-apk.mjs"
 ssh "${options[@]}" -p "$port" "$host" "chmod 0600 '$stage/scripts/'* '$stage/server/'*; node '$stage/scripts/publish-android-apk.mjs' '$stage' '$GITHUB_SHA'"
fi
