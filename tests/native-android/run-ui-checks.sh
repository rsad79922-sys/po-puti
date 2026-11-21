#!/usr/bin/env bash
set -euo pipefail
screen=${1:?screen name}
case "$screen" in android15|android11) ;; *) exit 2 ;; esac
destination="$PWD/out/search-ui/$screen"
mkdir -p "$destination"
save_screens() {
  local status=$?
  for name in search-bus search-results search-day-month search-empty; do
    adb pull "/sdcard/Download/po-puti-$name.png" "$destination/$name.png" >/dev/null 2>&1 || true
  done
  return "$status"
}
trap save_screens EXIT
# Deliberately exercise a narrow phone and larger text, rather than a large emulator default.
adb shell wm size 640x1280
adb shell wm density 320
adb shell settings put system font_scale 1.15
cd android
./gradlew :app:connectedDebugAndroidTest --no-daemon -Pandroid.testInstrumentationRunnerArguments.class=ru.poputi.app.SharedUiSmokeTest,ru.poputi.app.UpdatePromptTest
