# My Life Chart

人生の出来事と、そのときの気持ちの起伏を一本の線で記録・共有するWebアプリです。人生全体、一年間、任意期間のグラフをそれぞれ作成できます。

## 主な機能

- 年・月・日単位での出来事の記録
- 直線・曲線表示、ズーム、パン、ライト・ダークテーマ
- ブラウザ内への編集データ保存
- Cloudflare D1を利用した短縮共有URL
- 共有ページの閲覧専用表示
- 作成した共有リンクの削除
- JSONのインポート・エクスポートとPNG保存
- Cloudflare TurnstileとRate Limitingによる共有APIの保護

## 技術構成

- React 19 / TypeScript / Vite
- Cloudflare Workers Static Assets
- Cloudflare Workers API
- Cloudflare D1
- Cloudflare Turnstile
- Wrangler

## ローカル開発

```bash
npm install
npm run dev
```

Viteの開発サーバーだけではCloudflareのD1 Bindingを利用する共有APIは動作しません。画面開発以外で本番に近い確認を行う場合は、Cloudflareのローカル開発環境とD1マイグレーションを準備してください。

## ビルドとテスト

```bash
npm run build
npm test
```

生成物は `dist` に出力されます。

## Cloudflare構成

Workerの設定は `wrangler.jsonc`、D1のスキーマは `migrations/` で管理しています。

```bash
# ローカルD1へマイグレーションを適用
npx wrangler d1 migrations apply my-life-chart-shares --local

# リモートD1へマイグレーションを適用
npx wrangler d1 migrations apply my-life-chart-shares --remote

# ビルドしてデプロイ
npm run deploy
```

本番環境ではTurnstileの秘密鍵をWorker Secretとして登録します。値をリポジトリやフロントエンドの環境変数へ保存しないでください。

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Turnstileの公開sitekeyはアプリ側の設定を使用します。許可ホスト名と本番Workerのホスト名を一致させる必要があります。

GitHubの `main` ブランチはCloudflare Workers Buildsに接続されており、push時にビルドとデプロイが実行されます。

## データの保存

- 編集中のグラフ、表示設定、テーマはブラウザのローカルストレージに保存されます。
- 短縮共有リンクを作成した場合のみ、共有するグラフデータがCloudflare D1へ保存されます。
- 共有ID、削除トークンのハッシュ、作成日時もD1へ保存されます。削除用トークンそのものは作成したブラウザだけに保存されます。
- 共有データには現在、自動的な有効期限を設定していません。
- IPアドレスはレート制限とTurnstile検証で一時的に処理されますが、アプリのD1テーブルには保存しません。

詳細はサイト内の「プライバシーポリシー」と「利用規約」を参照してください。

## API概要

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/shares` | Turnstile検証後に共有リンクを作成 |
| `GET` | `/api/shares/:id` | 共有グラフを取得 |
| `DELETE` | `/api/shares/:id` | 削除用トークンで共有データを削除 |

APIではリクエストサイズ、ドキュメント構造、出来事数、文字数を検証しています。共有作成はIP単位で1分あたり5回に制限されます。

## リポジトリ

<https://github.com/FukuyaMan/my-life-chart>
