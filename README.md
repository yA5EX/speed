# SPRINT HUD

GitHub Pagesだけで動くGPSスプリント計測HUDです。GoogleスプレッドシートやGASは使いません。

## できること

- GPS速度、最高速度、スタート地点からの距離を表示
- 移動を検知して自動スタート
- 50m刻みで500mまでの通過タイムを固定記録
- 名前、車種、排気量をブラウザに保存
- ローカル履歴、CSV出力、ローカルランキング

## 登録項目

- `User name`: ランキングに出る名前
- `Machine`: ランキングに出る車種
- `Displacement`: ランキングに出る排気量
- `Auto start`: START後、何m動いたら自動計測開始するか
- `Accuracy limit`: GPS精度が悪いときに記録しないための上限

## ランキング

ランキングはこの端末のブラウザ内に保存された記録から作られます。

GitHub Pagesだけでは、全員の記録を共有するランキングは作れません。全員共通ランキングが必要になったら、GAS、Supabase、Firebase、または自前APIなどの保存先が必要です。

## GitHub Pages

`index.html`、`styles.css`、`app.js` をGitHubリポジトリのルートに置いて、`Settings` → `Pages` から公開します。

GPSはHTTPSまたはlocalhostでのみ動きます。GitHub PagesはHTTPSなので、スマホで開いてそのまま使えます。
