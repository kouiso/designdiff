# Correlation report storage

`baseline-report.json` と `baseline-report.md` の現行版は、
`.active-generation.runtime` が指す世代ディレクトリに保存します。
JSON と Markdown を同じ世代から読むことで、更新途中の混在を防ぎます。
ルート直下の同名ファイルは初期世代の互換スナップショットです。

`.generation/generation-initial/` は fresh checkout でも解決できるように
追跡する初期世代です。再計測で作られる世代と runtime pointer は
`.gitignore` の対象なので、生成物をコミットせずに pointer だけを原子的に
切り替えられます。`.active-generation` は追跡する初期世代への fallback pointer
として残し、fresh checkout でも runtime 状態がなくて解決できます。

読み取り側は `resolveActiveReportPath` または
`resolveActiveReportPaths` を使い、`baseline-report.*` を直接開きません。
