#!/bin/sh
# designdiff X05/X07 撮影レグを GitHub Actions の Android エミュレータ (実機では
# ない) で2巡実行する。reactivecircus/android-emulator-runner の script 入力は
# 1行ずつ独立した sh -c で走るため、複数行の処理はすべてこのスクリプトに置く。
#
# 前提: android-emulator-runner が port 5554 でエミュレータを起動済みであること。
# 使い方: sh .github/scripts/device-legs-android.sh <evidence-dir>
# 終了コード: 0=2巡とも合格 / 1=round 1 のみ失敗 / 2=round 2 のみ失敗 / 3=両方失敗

set -eu

evidence_dir="${1:?evidence dir argument is required}"
mkdir -p "$evidence_dir"

sdk_root="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
export PATH="$sdk_root/platform-tools:$PATH"
# action が ANDROID_SERIAL を設定して渡してくる。これが残っていると
# mobile-capture が env 経由で serial を拾い、「1台しか無い時の自動選択」を
# 検証しないまま通る。X05 の検証目的を壊すので外す。
unset ANDROID_SERIAL

is_uint() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

# ホストが GitHub Actions の仮想エミュレータであることを記録から明示する。
{
  echo "host=github-actions-android-emulator"
  uname -a
  if command -v lsb_release >/dev/null 2>&1; then lsb_release -ds; fi
  if command -v sw_vers >/dev/null 2>&1; then sw_vers; fi
  if command -v sysctl >/dev/null 2>&1; then sysctl kern.hv_support 2>&1 || true; fi
  adb version
  adb shell getprop ro.build.version.release
  adb shell getprop ro.build.version.sdk
  adb shell getprop ro.product.model
  adb shell wm size
} >"$evidence_dir/runner-host.txt" 2>&1
cat "$evidence_dir/runner-host.txt"

adb devices -l

# macOS Intel ホストでは guest の SystemUI が ANR ダイアログを繰り返し出して
# swipe が背面のページへ届かなかった (実測 12巡中1巡)。グローバルに error
# dialog を抑止し、残る場合に備えて CLOSE_SYSTEM_DIALOGS を定期的に投げる
# ウォッチャをバックグラウンドで回す。
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell settings put global show_first_crash_dialog 0 >/dev/null 2>&1 || true
(
  while :; do
    adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1
    sleep 10
  done
) &
anr_watcher_pid=$!
trap 'kill $anr_watcher_pid 2>/dev/null || true' EXIT

# 画面が消灯・ロック中だと screencap は単色になり swipe も届かない。起こして
# ロックを外し、どの window が前面かを証跡に残す (macOS ホストで単色画面を実測)。
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
# sys.boot_completed が立っても、ユーザ領域の解錠が終わるまでは
# Settings の FallbackHome が前面に居て launcher も Chrome も動かない
# (macOS ホストで実測)。抜けるまで待ち、待った秒数を証跡に残す。
fallback_start="$(date +%s)"
fallback_deadline=$((fallback_start + 900))
while adb shell dumpsys window 2>/dev/null | grep -q 'mCurrentFocus=.*FallbackHome'; do
  if [ "$(date +%s)" -ge "$fallback_deadline" ]; then
    echo "fallback_home_still_focused_after_seconds=900" >>"$evidence_dir/runner-host.txt"
    break
  fi
  adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
  sleep 10
done
echo "fallback_home_wait_seconds=$(($(date +%s) - fallback_start))" >>"$evidence_dir/runner-host.txt"
{
  adb shell dumpsys power | grep -E 'mWakefulness=|Display Power' || true
  adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' || true
} >>"$evidence_dir/runner-host.txt" 2>&1

width=""
height=""

# `wm size` は "Physical size: 320x640" を返す。空白を残すと整数判定に落ちて
# 後段のタップと swipe 計測がまるごと飛ぶ (初回実行で実測)。
size="$(adb shell wm size 2>/dev/null | tr -d '\r' | grep -E '^Physical size:' | head -1 | tr -d ' ')"
dims="${size#*:}"
width="${dims%%x*}"
height="${dims##*x}"

# X07 は Chrome で長いページを開く。fresh AVD の Chrome は初回に利用規約画面
# ("Welcome to Chrome") を出して URL を描画せず、swipe も効かない
# (初回実行で captureCount=1 / didNotScroll=true を実測)。Chrome が debug app
# の時に読むコマンドラインファイルで初回フローを無効化し、念のため
# 「Accept & continue」位置のタップも残す。各段階のスクリーンショットを証跡にする。
adb shell pm list packages >"$evidence_dir/chrome-packages.txt" 2>&1
if grep -q com.android.chrome "$evidence_dir/chrome-packages.txt"; then
  adb shell am force-stop com.android.chrome
  adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line' \
    >>"$evidence_dir/chrome-warmup-note.txt" 2>&1 || true
  adb shell am set-debug-app --persistent com.android.chrome \
    >>"$evidence_dir/chrome-warmup-note.txt" 2>&1 || true
  adb shell am start -a android.intent.action.VIEW -d http://10.0.2.2:65535/ >/dev/null 2>&1 || true
  sleep 10
  # --disable-fre を潜り抜けて出る通知許可モーダルは Back 1回で閉じる
  # (フレッシュ AVD で実測: keyevent 4 でモーダル消去→実ページ露出)。
  adb shell input keyevent 4 >/dev/null 2>&1 || true
  sleep 3
  if is_uint "$width" && is_uint "$height"; then
    attempt=1
    while [ "$attempt" -le 3 ]; do
      adb exec-out screencap -p >"$evidence_dir/chrome-warmup-$attempt.png" 2>/dev/null || true
      adb shell input tap "$((width / 2))" "$((height * 19 / 20))"
      sleep 3
      attempt=$((attempt + 1))
    done
  else
    echo "wm size parse failed: $size" >>"$evidence_dir/chrome-warmup-note.txt"
  fi
  adb exec-out screencap -p >"$evidence_dir/chrome-warmup-final.png" 2>/dev/null || true
  adb shell am force-stop com.android.chrome
else
  echo "com.android.chrome is not installed; X07 depends on another browser" \
    >"$evidence_dir/chrome-warmup-note.txt"
fi

# X07 の合否は swipe 1回の所要時間に強く依存する。低速ホスト (TCG の macOS VM
# で実測 4m50s) では mobile-capture 側の 60s adb タイムアウトを swipe が超えて
# 失敗する。加速の実態を数字で証跡に残す。
if is_uint "$width" && is_uint "$height"; then
  swipe_start="$(date +%s)"
  adb shell input swipe \
    "$((width / 2))" "$((height * 7 / 10))" \
    "$((width / 2))" "$((height * 3 / 10))" 600 >/dev/null 2>&1 || true
  swipe_end="$(date +%s)"
  echo "swipe_probe_seconds=$((swipe_end - swipe_start))" >>"$evidence_dir/runner-host.txt"
fi

status=0
round=1
while [ "$round" -le 2 ]; do
  round_dir="$evidence_dir/round-$round"
  mkdir -p "$round_dir"
  echo "::group::Android driver round $round"
  if node app/mcp-server/script/stdio-android-verification.mjs "$round_dir" >"$round_dir/driver.log" 2>&1; then
    echo "android round $round: PASS"
  else
    echo "android round $round: FAIL"
    status=$((status + round))
  fi
  cat "$round_dir/driver.log"
  echo "::endgroup::"
  round=$((round + 1))
done
exit "$status"
