#!/bin/sh
# designdiff X06 (ios-sim 代替経路) 撮影レグを GitHub Actions の macOS ランナの
# iPhone Simulator (実機ではない) で2巡実行する。
#
# 前提: iPhone シミュレータがちょうど1台 boot 済みであること。driver が booted
# 台数を検査するので、ワークフロー側で1台だけ boot しておく。
# 使い方: sh .github/scripts/device-legs-ios-sim.sh <evidence-dir>
# 終了コード: 0=2巡とも合格 / 1=round 1 のみ失敗 / 2=round 2 のみ失敗 / 3=両方失敗

set -eu

evidence_dir="${1:?evidence dir argument is required}"
mkdir -p "$evidence_dir"

# ホストが GitHub Actions の macOS ランナ上のシミュレータであることを
# 記録から明示する (実機 iPhone ではない)。
{
  echo "host=github-actions-ios-simulator"
  uname -a
  sw_vers
  xcodebuild -version
  xcrun simctl list devices booted
} >"$evidence_dir/runner-host.txt" 2>&1
cat "$evidence_dir/runner-host.txt"

status=0
round=1
while [ "$round" -le 2 ]; do
  round_dir="$evidence_dir/round-$round"
  mkdir -p "$round_dir"
  echo "::group::iOS simulator driver round $round"
  if node app/mcp-server/script/stdio-ios-sim-verification.mjs "$round_dir" >"$round_dir/driver.log" 2>&1; then
    echo "ios-sim round $round: PASS"
  else
    echo "ios-sim round $round: FAIL"
    status=$((status + round))
  fi
  cat "$round_dir/driver.log"
  echo "::endgroup::"
  round=$((round + 1))
done
exit "$status"
