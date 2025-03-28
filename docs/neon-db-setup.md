# GitHub Actions から Neon DB へのデータ保存設定

## 目次

- [1. はじめに](#1-はじめに)
- [2. 前提条件](#2-前提条件)
- [3. 設定手順](#3-設定手順)
  - [3.1. Neon データベース接続文字列の取得](#31-neon-データベース接続文字列の取得)
  - [3.2. GitHub Secrets の設定](#32-github-secrets-の設定)
  - [3.3. DB クライアントライブラリのインストール](#33-db-クライアントライブラリのインストール)
  - [3.4. GitHub Actions ワークフローの修正](#34-github-actions-ワークフローの修正)
  - [3.5. データ保存スクリプトの修正](#35-データ保存スクリプトの修正)
- [4. 動作確認](#4-動作確認)
- [参考: テーブルスキーマ](#参考-テーブルスキーマ)

## 1. はじめに

このドキュメントは、GitHub Actions ワークフローを使用して取得したツイートデータを、Neon でホストされている PostgreSQL データベースに保存するための設定手順を説明します。

具体的には、`.github/workflows/get-home-latest-timeline.yml` ワークフローが `scripts/fetch-tweets.ts` を実行して取得したデータを、Git リポジトリにコミットする代わりに Neon DB に直接書き込むように変更します。

## 2. 前提条件

- Neon アカウントが作成され、プロジェクトが存在すること。
- Neon プロジェクト内にデータベースと、以下のテーブルが作成済みであること。
  - `tweets`
  - `authors`
  - `engagement_metrics`
  - (テーブルスキーマは [こちら](#参考-テーブルスキーマ) を参照)
- データを保存したい GitHub リポジトリが存在すること。
- プロジェクトで Bun および TypeScript が使用されていること。
- `scripts/fetch-tweets.ts` がツイートデータを取得するスクリプトであること。
- ツイート取得に必要な認証トークン (`AUTH_TOKEN`) があること。

## 3. 設定手順

### 3.1. Neon データベース接続文字列の取得

1. [Neon コンソール](https://console.neon.tech/) にログインします。
2. 対象のプロジェクトを選択します。
3. **Dashboard** ページにある **Connection Details** ウィジェットを探します。
4. **Connection string** の下にある URI 形式の接続文字列をコピーします。通常、`postgresql://<user>:<password>@<host>.neon.tech/<database>?sslmode=require` のような形式です。

### 3.2. GitHub Secrets の設定

データベース接続情報や認証トークンは、安全に管理するために GitHub Secrets に登録します。

1. GitHub リポジトリの **Settings** タブを開きます。
2. 左側のメニューから **Secrets and variables** > **Actions** を選択します。
3. **Repository secrets** セクションで **New repository secret** ボタンをクリックします。
4. 以下の 2 つのシークレットを作成します。
   - **Name:** `NEON_DATABASE_URL`
     - **Secret:** 手順 3.1 でコピーした Neon データベース接続文字列を貼り付けます。
   - **Name:** `AUTH_TOKEN`
     - **Secret:** ツイート取得 API の認証に必要なトークンを貼り付けます。（既に設定済みかもしれません）

### 3.3. DB クライアントライブラリのインストール

TypeScript/JavaScript から PostgreSQL に接続するためのライブラリをプロジェクトに追加します。ここでは `postgres` (porsager/postgres) を使用します。

1. ターミナルでプロジェクトのルートディレクトリに移動します。
2. 以下のコマンドを実行して、ライブラリを依存関係に追加します。

```bash
bun add postgres
```

3. これにより、`package.json` に `postgres` が追加されます。

### 3.4. GitHub Actions ワークフローの修正

`.github/workflows/get-home-latest-timeline.yml` ファイルを以下のように修正します。

```yaml
name: Get Home Latest Timeline

on:
  schedule:
    - cron: "0 */4 * * *" # 4時間ごとに実行
  workflow_dispatch: # 手動トリガーを許可

jobs:
  update-data:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install # bun add postgres で package.json に追加されていれば、これでOK

      - name: Run fetch script and save to DB
        env:
          AUTH_TOKEN: ${{ secrets.AUTH_TOKEN }}
          NEON_DATABASE_URL: ${{ secrets.NEON_DATABASE_URL }} # DB接続情報を環境変数に追加
        run: bun run scripts/fetch-tweets.ts
```

### 3.5. データ保存スクリプトの修正

`scripts/fetch-tweets.ts` を修正して、取得したデータを Neon DB に保存するようにします。以下は主な修正ポイントです：

1. **環境変数の読み込み**

   - `process.env.NEON_DATABASE_URL` から接続文字列を取得
   - 存在しない場合はエラー処理

2. **DB クライアントのセットアップ**

```typescript
import postgres from "postgres";

const sql = postgres(process.env.NEON_DATABASE_URL!);
```

3. **データ整形と保存**

```typescript
// 既存のデータ取得コードの後に追加
interface DBTweet {
  id: bigint;
  author_id: bigint;
  content: string;
  created_at: Date;
  created_at_ts: bigint;
  is_reply: boolean;
  reply_to_tweet_id?: bigint;
  reply_to_user_id?: bigint;
}

interface DBAuthor {
  id: bigint;
  username: string;
  display_name: string;
  profile_image_url: string;
  created_at: Date;
  updated_at: Date;
  is_bot: boolean;
}

interface DBEngagementMetric {
  tweet_id: bigint;
  impressions: number;
  retweets: number;
  likes: number;
  replies: number;
  quotes: number;
  collected_at: Date;
}

// データベースへの保存処理
await sql.begin(async (tx) => {
  // Authors の保存
  for (const tweet of originalTweets) {
    const author: DBAuthor = {
      id: BigInt(tweet.user.id_str),
      username: tweet.user.screen_name,
      display_name: tweet.user.name,
      profile_image_url: tweet.user.profile_image_url_https,
      created_at: new Date(tweet.user.created_at),
      updated_at: new Date(),
      is_bot: false,
    };

    await tx`
      INSERT INTO authors ${tx(author)}
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        profile_image_url = EXCLUDED.profile_image_url,
        updated_at = EXCLUDED.updated_at
    `;
  }

  // Tweets の保存
  for (const tweet of originalTweets) {
    const dbTweet: DBTweet = {
      id: BigInt(tweet.id_str),
      author_id: BigInt(tweet.user.id_str),
      content: tweet.full_text,
      created_at: new Date(tweet.created_at),
      created_at_ts: BigInt(new Date(tweet.created_at).getTime()),
      is_reply: tweet.in_reply_to_status_id_str !== null,
      reply_to_tweet_id: tweet.in_reply_to_status_id_str
        ? BigInt(tweet.in_reply_to_status_id_str)
        : undefined,
      reply_to_user_id: tweet.in_reply_to_user_id_str
        ? BigInt(tweet.in_reply_to_user_id_str)
        : undefined,
    };

    await tx`
      INSERT INTO tweets ${tx(dbTweet)}
      ON CONFLICT (id) DO NOTHING
    `;

    // Engagement Metrics の保存
    const metrics: DBEngagementMetric = {
      tweet_id: dbTweet.id,
      impressions: tweet.metrics?.impression_count || 0,
      retweets: tweet.retweet_count,
      likes: tweet.favorite_count,
      replies: tweet.reply_count,
      quotes: tweet.quote_count,
      collected_at: new Date(),
    };

    await tx`
      INSERT INTO engagement_metrics ${tx(metrics)}
    `;
  }
});

// 最後に接続を閉じる
await sql.end();
```

## 4. 動作確認

1. 修正したファイルを GitHub リポジトリにプッシュします。
2. GitHub の **Actions** タブで `Get Home Latest Timeline` ワークフローを手動で実行します。
3. ワークフローの実行ログを確認し、エラーが発生していないか確認します。
4. Neon コンソールの **SQL Editor** や **Tables** ページで、データが正しくテーブルに挿入されているか確認します。

## 参考: テーブルスキーマ

```sql
-- Authors table
CREATE TABLE authors (
  id SERIAL PRIMARY KEY,
  twitter_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  profile_image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_bot BOOLEAN NOT NULL DEFAULT FALSE
);

-- Tweets table
CREATE TABLE tweets (
  id BIGINT PRIMARY KEY,
  author_id INTEGER REFERENCES authors(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at_ts BIGINT NOT NULL,
  is_reply BOOLEAN NOT NULL DEFAULT FALSE,
  reply_to_tweet_id BIGINT,
  reply_to_user_id BIGINT
);

-- Engagement metrics table
CREATE TABLE engagement_metrics (
  id SERIAL PRIMARY KEY,
  tweet_id BIGINT REFERENCES tweets(id),
  impressions INTEGER NOT NULL DEFAULT 0,
  retweets INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  quotes INTEGER NOT NULL DEFAULT 0,
  collected_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- インデックスの作成
CREATE INDEX idx_authors_twitter_id ON authors(twitter_id);
CREATE INDEX idx_tweets_author_id ON tweets(author_id);
CREATE INDEX idx_engagement_metrics_tweet_id ON engagement_metrics(tweet_id);
```
