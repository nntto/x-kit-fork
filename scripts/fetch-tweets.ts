import dayjs from "dayjs";
import { get } from "lodash";
import postgres from "postgres";
import type { TweetApiUtilsData } from "twitter-openapi-typescript";
import { XAuthClient } from "./utils";

interface TweetMetrics {
  impressionCount: number;
  retweetCount: number;
  likeCount: number;
  quoteCount: number;
  replyCount: number;
}

interface ExtendedTweetData {
  user: {
    screenName: string;
    name: string;
    profileImageUrl: string;
    description: string;
    followersCount: number;
    friendsCount: number;
    location: string;
  };
  images: string[];
  videos: string[];
  tweetUrl: string;
  fullText: string;
  metrics?: TweetMetrics;
}

// postgres の型定義
type PostgresParameters = Parameters<ReturnType<typeof postgres>>[0];

// データベース接続の初期化
const neonDbUrl = process.env.NEON_DATABASE_URL;
if (!neonDbUrl) {
  console.error("Error: NEON_DATABASE_URL is not set.");
  process.exit(1);
}
const sql = postgres(neonDbUrl);

const client = await XAuthClient();

const resp = await client.getTweetApi().getHomeLatestTimeline({
  count: 100,
});

// オリジナルのツイートのみをフィルタリング
const originalTweets = resp.data.data.filter((tweet: TweetApiUtilsData) => {
  const referencedTweets = get(tweet, "tweet.referenced_tweets", []);
  return !referencedTweets || referencedTweets.length === 0;
});

const rows: ExtendedTweetData[] = [];
// すべてのオリジナルツイートのURLを出力
originalTweets.forEach((tweet: TweetApiUtilsData) => {
  const isQuoteStatus = get(tweet, "raw.result.legacy.isQuoteStatus");
  if (isQuoteStatus) {
    return;
  }
  const fullText = get(tweet, "raw.result.legacy.fullText", "RT @");
  if (fullText?.includes("RT @")) {
    return;
  }
  const createdAt = get(tweet, "raw.result.legacy.createdAt");
  // 1日以上前のツイートは除外
  if (dayjs().diff(dayjs(createdAt), "day") > 1) {
    return;
  }
  const screenName = get(tweet, "user.legacy.screenName");
  const tweetUrl = `https://x.com/${screenName}/status/${get(
    tweet,
    "raw.result.legacy.idStr"
  )}`;
  // ユーザー情報の抽出
  const user = {
    screenName: get(tweet, "user.legacy.screenName"),
    name: get(tweet, "user.legacy.name"),
    profileImageUrl: get(tweet, "user.legacy.profileImageUrlHttps"),
    description: get(tweet, "user.legacy.description"),
    followersCount: get(tweet, "user.legacy.followersCount"),
    friendsCount: get(tweet, "user.legacy.friendsCount"),
    location: get(tweet, "user.legacy.location"),
  };

  // 画像の抽出
  const mediaItems = get(tweet, "raw.result.legacy.extendedEntities.media", []);
  const images = mediaItems
    .filter((media: any) => media.type === "photo")
    .map((media: any) => media.mediaUrlHttps);

  // 動画の抽出
  const videos = mediaItems
    .filter(
      (media: any) => media.type === "video" || media.type === "animated_gif"
    )
    .map((media: any) => {
      const variants = get(media, "videoInfo.variants", []);
      const bestQuality = variants
        .filter((v: any) => v.contentType === "video/mp4")
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      return bestQuality?.url;
    })
    .filter(Boolean);

  // メトリクス情報の抽出
  const metrics: TweetMetrics = {
    impressionCount: get(tweet, "raw.result.views.count", 0),
    retweetCount: get(tweet, "raw.result.legacy.retweetCount", 0),
    likeCount: get(tweet, "raw.result.legacy.favoriteCount", 0),
    quoteCount: get(tweet, "raw.result.legacy.quoteCount", 0),
    replyCount: get(tweet, "raw.result.legacy.replyCount", 0),
  };

  rows.push({
    user,
    images,
    videos,
    tweetUrl,
    fullText,
    metrics,
  });
});

// データベースへの保存処理
try {
  await sql.begin(async (tx) => {
    for (const row of rows) {
      const tweetId = row.tweetUrl.split("/").pop();
      if (!tweetId) continue;

      // 対応するツイートデータを検索
      const tweetData = originalTweets.find(
        (t) => get(t, "user.legacy.screenName") === row.user.screenName
      );

      if (!tweetData) {
        console.error(`Tweet data not found for user: ${row.user.screenName}`);
        continue;
      }

      // ユーザーIDの取得
      const twitterId =
        get(tweetData, "raw.result.legacy.userIdStr") ||
        get(tweetData, "user.restId");
      if (!twitterId) {
        console.error(`Twitter ID not found for user: ${row.user.screenName}`);
        continue;
      }

      // Authors の保存
      const result = await (tx as postgres.TransactionSql)`
        INSERT INTO authors (
          twitter_id,
          username,
          display_name,
          profile_image_url,
          created_at,
          updated_at,
          is_bot
        ) VALUES (
          ${BigInt(twitterId) as unknown as PostgresParameters},
          ${row.user.screenName},
          ${row.user.name},
          ${row.user.profileImageUrl},
          ${new Date()},
          ${new Date()},
          ${false}
        )
        ON CONFLICT (twitter_id) DO UPDATE SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          profile_image_url = EXCLUDED.profile_image_url,
          updated_at = EXCLUDED.updated_at
        RETURNING id
      `;

      const authorId = result[0].id;

      // Tweets の保存
      await (tx as postgres.TransactionSql)`
        INSERT INTO tweets (
          id,
          author_id,
          content,
          created_at,
          created_at_ts,
          is_reply,
          reply_to_tweet_id,
          reply_to_user_id
        ) VALUES (
          ${BigInt(tweetId) as unknown as PostgresParameters},
          ${authorId},
          ${row.fullText},
          ${new Date()},
          ${BigInt(new Date().getTime()) as unknown as PostgresParameters},
          ${false},
          ${null},
          ${null}
        )
        ON CONFLICT (id) DO NOTHING
      `;

      // Engagement Metrics の保存
      if (row.metrics) {
        await (tx as postgres.TransactionSql)`
          INSERT INTO engagement_metrics (
            tweet_id,
            impressions,
            retweets,
            likes,
            replies,
            quotes,
            collected_at
          ) VALUES (
            ${BigInt(tweetId) as unknown as PostgresParameters},
            ${row.metrics.impressionCount},
            ${row.metrics.retweetCount},
            ${row.metrics.likeCount},
            ${row.metrics.replyCount},
            ${row.metrics.quoteCount},
            ${new Date()}
          )
        `;
      }
    }
  });

  console.log(`Successfully saved ${rows.length} tweets to database.`);
} catch (error) {
  console.error("Error saving data to database:", error);
  process.exit(1);
} finally {
  await sql.end();
}
