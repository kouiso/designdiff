# Windows / WSL からの Android 実機検証 (2026-09-18)

`stdio-android-verification.mjs` を WSL / Windows から動かすための端末配線メモ。
Android 実機・エミュレータは macmini (`macmini-lan`) に物理接続されている。

## 結論: リモート adb server ではなく端末の TCP 直結を使う

試して不安定だった経路:

- `ADB_SERVER_SOCKET=tcp:192.168.55.2:5037 adb devices` — 接続は張るが
  端末一覧が空 / offline で出たり消えたりする。複数 adb ホスト配下の
  USB 端末トラッキングは adbd 側が安定しない。
- `adb -H <mac>` / `adb -H macmini-lan` — リモートホストでの server 起動は
  非対応 (`cannot start server on remote host`)。`macmini-lan` は
  Windows 側 DNS では解決しないので IP 指定が要る。
- `adb reverse` (実機 → driver ホスト localhost) — reverse 登録は adbd が
  「要求した transport」に紐付けるが、複数 adb ホストが同時接続していると
  死んだ transport に向くことがあり、Chrome は `ERR_EMPTY_RESPONSE` に
  なる。実際に再現済み。

## 動く構成

1. macmini 側で実機を TCP モードにする (USB 接続したまま一度だけ):

   ```
   adb -s 2A091FDH300C0J tcpip 5555
   ```

   以降、実機は `192.168.11.12:5555` (端末の WLAN IP) で adb を受け付ける。
   再起動・USB 抜差しで USB モードに戻るので、その時はやり直し。

2. 各クライアントに macmini の承認済み adbkey を複製する。
   新規クライアントの adbkey は端末画面での RSA 承認が要り、リモートからは
   承認できないため。承認済みキーを使い回せばダイアログ不要。

   ```
   scp macmini-lan:.android/adbkey macmini-lan:.android/adbkey.pub ~/.android/
   cp ~/.android/adbkey* /mnt/c/Users/suker/.android/   # Windows 側
   adb kill-server   # クライアントは起動時に鍵を読むので再起動が要る
   ```

3. 接続:

   ```
   adb connect 192.168.11.12:5555   # => ... device
   ```

   WSL / Windows 双方から同時にぶら下げられる。macmini 側の USB 接続も
   そのまま残る (serial `2A091FDH300C0J` と `192.168.11.12:5555` は
   adbd 側で別 transport として見える)。

## driver の実行

scroll 検体ページは driver ホストではなく、実機と同一 LAN に届く
macmini (`192.168.11.9`) に立てる:

```
ssh macmini-lan 'cd /tmp && nohup python3 -m http.server 48901 --bind 0.0.0.0 &'
# /tmp/tall.html を置く (driver と同じ縞模様 fixture)
```

実行 (WSL / Windows 共通):

```
ANDROID_EXPECT_SERIALS="192.168.11.12:5555" \
ANDROID_PAGE_URL="http://192.168.11.9:48901/tall.html" \
node app/mcp-server/script/stdio-android-verification.mjs <evidence-dir>
```

macmini 側では USB+emulator の2台体制が組める:

```
ANDROID_EXPECT_SERIALS="2A091FDH300C0J,emulator-5554" \
ANDROID_SCROLL_DEVICE="2A091FDH300C0J" \
ANDROID_PAGE_URL="http://192.168.11.9:48901/tall.html" \
node app/mcp-server/script/stdio-android-verification.mjs <evidence-dir>
```

## 既知の制約

- WSL / Windows では実機1台のみ見えるため「複数台接続時の serial 省略拒否」
  は macOS 側の2台証跡 (`android-mac-r5`) で担保する。単端末環境では
  serial 省略の自動選択が成功することを記録する。
- emulator `x08emu` はスナップショット復元するとネットワークが死ぬ
  (`10.0.2.2`・LAN 双方 `ERR_ADDRESS_UNREACHABLE`)。cold boot
  (`emulator -avd x08emu -no-snapshot-load -no-window`) で復旧した。
  復旧後は emulator への scroll も通る (`android-mac-r6`)。
- 実機の Chrome はテキスト入りページで翻訳ポップアップを出し swipe を
  食う。検体はテキストなしの縞模様にしてある。
