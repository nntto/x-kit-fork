# x-kit

X (Twitter) のユーザーデータとツイートを収集・分析するためのツール。

![x-kit](./images/action-stats.png)

## 機能

- 指定したユーザーの基本情報とツイートの自動収集
- タイムラインデータの定期更新
- Neon PostgreSQL データベースへのデータ保存
- GitHub Actions による自動化

## 更新履歴

- 2024-12-24 毎日のツイート投稿機能を追加 `post-twitter-daily.yml` `post-tweet.ts`
- 2025-01-02 ユーザーツイート取得機能を追加 `fetch-user-tweets.ts`
- 2025-03-29 データ保存を Neon DB に移行 `fetch-tweets.ts`

## インストール

```bash
bun install
```

## 使用方法

### 1. 環境変数の設定

プロジェクトのルートディレクトリに `.env` ファイルを作成し、以下の設定を追加:

```bash
AUTH_TOKEN=Xの認証トークン
GET_ID_X_TOKEN=ユーザーID取得用のトークン
NEON_DATABASE_URL=NeonデータベースのURL
```

### 2. 追跡するユーザーの追加

`dev-accounts.json` にユーザー情報を追加:

```json
{
  "username": "ユーザー名",
  "twitter_url": "プロフィールURL",
  "description": "説明",
  "tags": ["タグ1", "タグ2"]
}
```

### 3. スクリプトの実行

```bash
# ユーザー情報の取得
bun run scripts/index.ts

# 最新ツイートの取得とDB保存
bun run scripts/fetch-tweets.ts

# ユーザーの一括フォロー
bun run scripts/batch-follow.ts
```

## 自動化

GitHub Actions による自動化:

- `get-home-latest-timeline.yml`: 4 時間ごとに最新ツイートを取得し DB に保存
- `daily-get-tweet-id.yml`: 毎日ユーザー情報を更新

## データ保存

- ユーザー情報、ツイート、エンゲージメントメトリクスは Neon PostgreSQL に保存
- データベーススキーマの詳細は [Neon DB へのデータ保存設定](docs/neon-db-setup.md) を参照

## 技術スタック

- Bun
- TypeScript
- Twitter API
- PostgreSQL (Neon)
- GitHub Actions

## ライセンス

MIT

## ドキュメント

- [Neon DB へのデータ保存設定](docs/neon-db-setup.md)
- [デプロイメントガイド](docs/deployment-guide.md)
